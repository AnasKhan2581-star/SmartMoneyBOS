/*
 * Three 15m strategies around the New York open (Nov 2026, user request: "make 3 new ones … people trade before or in
 * the first hour of the New York open with SMC, try one that way, backtest and check if any give consistent
 * results"). RESEARCH ONLY: detector.js, the webapp and the bot are unchanged.
 *
 *   node research/nyopen/ny_lab.js run [gross|fut|slip2]  # every strategy, variant and control → research/cache/nyopen/run*.json
 *   node research/nyopen/ny_lab.js diag                   # BTC and ETH: the average move in each New York half-hour, by period
 *   node research/nyopen/ny_report.js > research/nyopen/RESULTS_nyopen_2026-11.md       # needs run, run gross and run fut
 *
 * Data: research/cache/lb15 (the user's 103 coins) + research/cache/lb15dead (171 delisted or collapsed coins), full
 * Binance 15m history (research/liqbrk15m/fetch15.js). The clock is New York's (EST/EDT by the US daylight-saving
 * rules), weekdays only, long only (spot). Everything below was fixed from the trading logic BEFORE any result was
 * seen; every variant changes ONE thing.
 *
 * S1 JUDAS  ICT's New York morning model. The overnight range is 00:00–08:30 ET. In the kill zone (08:30–11:00 ET)
 *           price sweeps the overnight low (the sell stops under it), then a 15m candle closes above the last swing
 *           high before the sweep low (the market-structure shift) with a bullish fair value gap in the leg
 *           up from the low (a candle whose low is above the high two candles back). A limit buy at the gap's midpoint
 *           waits until 12:00 ET (cancelled if price reaches the target first). Stop 0.1 × the 15m ATR under the
 *           sweep low; target the overnight high (the buy stops above it), taken only when it is ≥ 2R away; out at
 *           16:00 ET. Daily bias: the coin closed yesterday above its 20-day average. Risk under 0.25% is skipped.
 * S2 ORB    Opening-range breakout on the coins in play (Zarattini & Aziz's equity method). At 09:45 ET rank the
 *           coins by the volume of their 09:30–09:45 candle against that candle's last 14 weekdays; of the top 5
 *           with relative volume ≥ 1, those whose opening candle closed green get a stop-buy at its high (until
 *           15:00 ET). Stop at the opening candle's low; out at 16:00 ET. 20% of the pot each.
 * S3 NEWS   The 08:30 ET macro candle (CPI, payrolls, PPI…). When BTC's 08:30–08:45 candle is ≥ 2 × its 15m ATR wide
 *           on ≥ 3 × that slot's usual volume (last 20 weekdays), green and closing in its upper half, buy BTC at its
 *           close; stop 0.1 ATR under its low; out at 11:00 ET. Also run on ETH and on the 5 most liquid other coins.
 *
 * Fills: a limit buy fills at its own price only when price trades BELOW it; a stop-buy fills at its level or a worse
 * open; on the fill candle a stop counts first and a target cannot fill; a stop fills at the stop or a worse open; a
 * target fills at its price. Costs: 0.1% fee a side; market orders, stop-buys, stops and timed exits also pay 0.05%
 * slippage on coins trading ≥ $100M a day, 0.15% on the rest. A coin counts only with ≥ $5M a day (30-day average).
 */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const { load, LIST } = require('../liqbrk15m/lab15.js');
const OUT = path.join(ROOT, 'research', 'cache', 'nyopen');
const DEADDIR = path.join(ROOT, 'research', 'cache', 'lb15dead');
const BAR = 900, DAY = 86400;
let FEE = 0.001;
const TRUNC = { LUNAUSDT: Date.UTC(2022, 4, 14) / 1e3 };     // the original LUNA only (the ticker was reused)
const STABLE = /USD|^(DAI|PAX|UST|EUR|GBP|AUD|TRY|BRL|IDRT|BIDR)$/;
const T0 = Date.UTC(2018, 0, 1) / 1e3, SPLIT = Date.UTC(2022, 0, 1) / 1e3, T1 = Date.UTC(2026, 10, 5) / 1e3;
const MIN_TURN = 5e6, LIQ_TIER = 1e8;
let SLIPX = 1;                                                // stress: multiply every slippage
// cost modes: `slip2` doubles slippage; `fut` = futures-like costs (0.05% a side, slippage × 0.4); `gross` = no costs
const COSTMODE = ['slip2', 'fut', 'gross'].find((m) => process.argv.includes(m)) || 'spot';

function universe() {
  const U = LIST.map((s) => [s, null]);
  if (fs.existsSync(DEADDIR)) for (const f of fs.readdirSync(DEADDIR).sort()) if (f.endsWith('_15m.json')) U.push([f.replace('_15m.json', ''), DEADDIR]);
  return U.filter(([s]) => !STABLE.test(s.replace(/USDT$/, '')));
}

// ---------------------------------------------------------------- the New York clock
const dstOf = {};
function nyOff(t) {                                           // seconds to add to UTC for New York local time
  const y = new Date(t * 1000).getUTCFullYear();
  let c = dstOf[y];
  if (!c) {
    const sunday = (m, n) => { const d1 = Date.UTC(y, m, 1) / 1e3, dow = new Date(d1 * 1000).getUTCDay(); return d1 + (((7 - dow) % 7) + 7 * (n - 1)) * DAY; };
    c = dstOf[y] = [sunday(2, 2) + 7 * 3600, sunday(10, 1) + 6 * 3600];   // 2nd Sunday of March 02:00 EST → 1st Sunday of November 02:00 EDT
  }
  return t >= c[0] && t < c[1] ? -4 * 3600 : -5 * 3600;
}
const anchorOf = (D) => D * DAY - nyOff(D * DAY + 6 * 3600);  // 00:00 ET of New York day D, in UTC seconds
const dowOf = (D) => (D + 4) % 7;                              // 0 Sunday … 6 Saturday
const yearOf = (t) => new Date(t * 1000).getUTCFullYear();

// ---------------------------------------------------------------- one coin, as typed arrays + daily context
function prep(sym, dir) {
  let c = dir ? load(sym, dir) : load(sym);
  if (!c || c.length < 3000) return null;
  if (TRUNC[sym]) c = c.filter((b) => b.time < TRUNC[sym]);
  const n = c.length, T = new Float64Array(n), O = new Float64Array(n), H = new Float64Array(n), L = new Float64Array(n), C = new Float64Array(n), V = new Float64Array(n), A = new Float64Array(n);
  let a = 0;
  for (let i = 0; i < n; i++) {
    const b = c[i]; T[i] = b.time; O[i] = b.open; H[i] = b.high; L[i] = b.low; C[i] = b.close; V[i] = b.volume;
    const tr = i ? Math.max(H[i] - L[i], Math.abs(H[i] - C[i - 1]), Math.abs(L[i] - C[i - 1])) : H[i] - L[i];
    a = i < 14 ? (a * i + tr) / (i + 1) : (a * 13 + tr) / 14;          // Wilder ATR(14) of 15m candles, known at the close
    A[i] = a;
  }
  const t0 = T[0], m = Math.round((T[n - 1] - t0) / BAR) + 1, ix = new Int32Array(m).fill(-1);
  for (let i = 0; i < n; i++) ix[Math.round((T[i] - t0) / BAR)] = i;
  const at = (t) => { const k = Math.round((t - t0) / BAR); return k >= 0 && k < m ? ix[k] : -1; };
  // UTC days, each read only once it is complete
  const u0 = Math.floor(T[0] / DAY), nu = Math.floor(T[n - 1] / DAY) - u0 + 1;
  const dH = new Float64Array(nu).fill(NaN), dL = new Float64Array(nu).fill(NaN), dC = new Float64Array(nu).fill(NaN), dT = new Float64Array(nu);
  for (let i = 0; i < n; i++) {
    const u = Math.floor(T[i] / DAY) - u0;
    if (Number.isNaN(dH[u])) { dH[u] = H[i]; dL[u] = L[i]; } else { if (H[i] > dH[u]) dH[u] = H[i]; if (L[i] < dL[u]) dL[u] = L[i]; }
    dC[u] = C[i]; dT[u] += V[i] * C[i];
  }
  const atrD = new Float64Array(nu).fill(NaN), sma20 = new Float64Array(nu).fill(NaN), sma50 = new Float64Array(nu).fill(NaN), turn30 = new Float64Array(nu).fill(NaN);
  let ad = NaN, k = 0, prevC = NaN; const q20 = [], q50 = []; let s20 = 0, s50 = 0, sT = 0;
  for (let u = 0; u < nu; u++) {
    sT += dT[u]; if (u >= 30) sT -= dT[u - 30]; if (u >= 29) turn30[u] = sT / 30;
    if (Number.isNaN(dC[u])) continue;
    const tr = Number.isNaN(prevC) ? dH[u] - dL[u] : Math.max(dH[u] - dL[u], Math.abs(dH[u] - prevC), Math.abs(dL[u] - prevC));
    k++; ad = k <= 14 ? (Number.isNaN(ad) ? tr : (ad * (k - 1) + tr) / k) : (ad * 13 + tr) / 14; if (k >= 14) atrD[u] = ad;
    q20.push(dC[u]); s20 += dC[u]; if (q20.length > 20) s20 -= q20.shift(); if (q20.length === 20) sma20[u] = s20 / 20;
    q50.push(dC[u]); s50 += dC[u]; if (q50.length > 50) s50 -= q50.shift(); if (q50.length === 50) sma50[u] = s50 / 50;
    prevC = dC[u];
  }
  const uOf = (D) => D - 1 - u0;                                  // the last UTC day completed before 00:00 ET of day D
  const ok = (u) => u >= 0 && u < nu;
  return {
    sym: sym.replace(/USDT$/, ''), dead: !!dir, n, T, O, H, L, C, V, A, at,
    D0: Math.floor((T[0] - 5 * 3600) / DAY) + 1, D1: Math.floor((T[n - 1] - 5 * 3600) / DAY) - 1,
    turn: (D) => { const u = uOf(D); return ok(u) ? turn30[u] : NaN; },
    atrD: (D) => { const u = uOf(D); return ok(u) ? atrD[u] : NaN; },
    up20: (D) => { const u = uOf(D); return ok(u) && dC[u] > sma20[u]; },
    up50: (D) => { const u = uOf(D); return ok(u) && dC[u] > sma50[u]; },
    slip: (D) => { const u = uOf(D); return SLIPX * (ok(u) && turn30[u] >= LIQ_TIER ? 0.0005 : 0.0015); },
  };
}

// ---------------------------------------------------------------- the exit side of a long trade
// From fill candle f at fillPx: each later candle until the one opening at lastOpen (whose close is the time exit):
// stop first, then the target. `fillBarStop`: the fill candle itself can still stop (a resting order filled inside it).
function ride(cn, f, fillPx, stop, target, lastOpen, slip, fillBarStop) {
  if (fillBarStop && cn.L[f] <= stop) return { px: stop * (1 - slip), why: 'stop' };
  let j = f + 1;
  for (; j < cn.n && cn.T[j] <= lastOpen; j++) {
    if (cn.L[j] <= stop) return { px: Math.min(cn.O[j], stop) * (1 - slip), why: 'stop' };
    if (cn.H[j] >= target) return { px: target, why: 'target' };
    if (cn.T[j] === lastOpen) return { px: cn.C[j] * (1 - slip), why: 'time' };
  }
  return { px: cn.C[Math.max(f, j - 1)] * (1 - slip), why: 'time' };   // the exit candle is missing: the last close before it
}
const mk = (cn, si, D, f, fillPx, lvl, stop, r) => {
  const ret = r.px * (1 - FEE) / (fillPx * (1 + FEE)) - 1, risk = (lvl - stop) / lvl;
  return { D, s: si, t: cn.T[f], ret: +ret.toFixed(6), R: +(ret / risk).toFixed(4), risk: +risk.toFixed(5), why: r.why };
};

// ---------------------------------------------------------------- S1: the Judas swing
const S1BASE = { refFrom: 0, refTo: 510, winFrom: 510, winTo: 660, until: 720, exitOpen: 945, entry: 'ce', target: 'liq', minRR: 2, bias: 'coin20', minRisk: 0.0025, shift: 0 };
const S1V = {
  base: {},
  'no daily bias': { bias: 'none' },
  'bias: BTC over its 50-day': { bias: 'btc50' },
  'sweep the London low (02–05 ET)': { refFrom: 120, refTo: 300 },
  'sweep the Asia low (20–24 ET)': { refFrom: -240, refTo: 0 },
  'kill zone 09:30–11:00': { winFrom: 570 },
  'kill zone 07:00–10:00': { winFrom: 420, winTo: 600 },
  'Silver Bullet 10:00–11:00': { winFrom: 600, winTo: 660 },
  'entry at the gap top': { entry: 'top' },
  'entry at the shift close': { entry: 'mss' },
  'target 2R': { target: 2 },
  'target 3R': { target: 3 },
  'liquidity target ≥ 1R': { minRR: 1 },
  'out at 12:00 ET': { exitOpen: 705 },
  'CONTROL: same rules 6h later': { shift: 360 },
  'CONTROL: same rules 12h later': { shift: 720 },
  'CONTROL: same rules 18h later': { shift: 1080 },
};
function s1(cn, si, D, cfg, btcUp) {
  if (cfg.bias === 'coin20' && !cn.up20(D)) return null;
  if (cfg.bias === 'btc50' && !btcUp(D)) return null;
  const A0 = anchorOf(D) + cfg.shift * 60;
  let rH = -Infinity, rL = Infinity, got = 0, want = 0;
  for (let m = cfg.refFrom; m < cfg.refTo; m += 15) { want++; const i = cn.at(A0 + m * 60); if (i < 0) continue; got++; if (cn.H[i] > rH) rH = cn.H[i]; if (cn.L[i] < rL) rL = cn.L[i]; }
  if (got < 0.8 * want) return null;
  let lowI = -1, lowV = Infinity, set = null;
  for (let m = cfg.winFrom; m < cfg.winTo; m += 15) {
    const i = cn.at(A0 + m * 60); if (i < 0) continue;
    if (lowI < 0) { if (cn.L[i] < rL) { lowI = i; lowV = cn.L[i]; } continue; }      // the sweep
    if (cn.L[i] < lowV) { lowI = i; lowV = cn.L[i]; continue; }                      // still running lower
    // the market-structure shift: a close above the last swing high before the low (a 15m pivot: higher than the
    // candles either side), else above the highest high of the hour before the low
    let M = -Infinity;
    for (let j = lowI - 1; j >= Math.max(1, lowI - 16); j--) if (cn.H[j] >= cn.H[j - 1] && cn.H[j] > cn.H[j + 1]) { M = cn.H[j]; break; }
    if (M === -Infinity) for (let j = Math.max(0, lowI - 4); j < lowI; j++) if (cn.H[j] > M) M = cn.H[j];
    if (!(cn.C[i] > M)) continue;
    let k = -1; for (let q = i; q >= lowI + 2; q--) if (cn.L[q] > cn.H[q - 2]) { k = q; break; }
    if (k < 0 && cfg.entry !== 'mss') continue;                                       // no displacement gap yet
    set = { i, k, m }; break;
  }
  if (!set) return null;
  const { i, k } = set, slip = cn.slip(D), stop = lowV - 0.1 * cn.A[i];
  const lvl = cfg.entry === 'mss' ? cn.C[i] : cfg.entry === 'top' ? cn.L[k] : (cn.H[k - 2] + cn.L[k]) / 2;
  if (!(lvl > stop) || (lvl - stop) / lvl < cfg.minRisk) return null;
  const risk = lvl - stop, target = cfg.target === 'liq' ? rH : lvl + cfg.target * risk;
  if (cfg.target === 'liq' && target - lvl < cfg.minRR * risk) return null;
  const lastOpen = A0 + cfg.exitOpen * 60;
  if (cfg.entry === 'mss') { const px = lvl * (1 + slip); return mk(cn, si, D, i, px, lvl, stop, ride(cn, i, px, stop, target, lastOpen, slip, false)); }
  for (let m = set.m + 15; m < cfg.until; m += 15) {
    const j = cn.at(A0 + m * 60); if (j < 0) continue;
    if (cn.L[j] < lvl) return mk(cn, si, D, j, lvl, lvl, stop, ride(cn, j, lvl, stop, target, lastOpen, slip, true));
    if (cn.H[j] >= target) return null;                                              // ran to the target without us
  }
  return null;
}

// ---------------------------------------------------------------- S2: opening-range breakout, per coin-day
// Trade configs (each changes ONE thing from the base); the coin-in-play selection is applied after every coin is read.
const S2T = {
  base: { anchor: 'ny', orM: 570, orBars: 1, entry: 'brk', stop: 'orl', until: 900, exitOpen: 945 },
  'buy the opening candle close': { entry: 'close' },
  '30-minute opening range': { orBars: 2 },
  'stop 0.1 daily ATR': { stop: 'atr' },
  'out at 12:00 ET': { exitOpen: 705 },
  'CONTROL: the 00:00 UTC open': { anchor: 'utc', orM: 0, until: 330, exitOpen: 375 },
  'CONTROL: the London open (03:00 ET)': { orM: 180, until: 510, exitOpen: 555 },
};
function s2(cn, si, D, cfg, hist) {
  const A0 = cfg.anchor === 'utc' ? D * DAY : anchorOf(D);
  let oh = -Infinity, ol = Infinity, vol = 0, first = -1, last = -1;
  for (let b = 0; b < cfg.orBars; b++) { const i = cn.at(A0 + (cfg.orM + 15 * b) * 60); if (i < 0) return null; if (first < 0) first = i; last = i; if (cn.H[i] > oh) oh = cn.H[i]; if (cn.L[i] < ol) ol = cn.L[i]; vol += cn.V[i]; }
  const prior = hist.slice(-14); hist.push(vol);
  if (prior.length < 10) return null;
  const avg = prior.reduce((s, x) => s + x, 0) / prior.length; if (!(avg > 0)) return null;
  const rec = { D, s: si, rv: +(vol / avg).toFixed(3), green: cn.C[last] > cn.O[first], up20: cn.up20(D), trade: null };
  if (!rec.green) return rec;
  const slip = cn.slip(D), lastOpen = A0 + cfg.exitOpen * 60, aD = cn.atrD(D);
  if (cfg.entry === 'close') {
    const lvl = cn.C[last], stop = cfg.stop === 'atr' ? lvl - 0.1 * aD : ol;
    if (lvl > stop) rec.trade = mk(cn, si, D, last, lvl * (1 + slip), lvl, stop, ride(cn, last, lvl * (1 + slip), stop, Infinity, lastOpen, slip, false));
    return rec;
  }
  for (let m = cfg.orM + 15 * cfg.orBars; m < cfg.until; m += 15) {
    const j = cn.at(A0 + m * 60); if (j < 0) continue;
    if (cn.H[j] > oh) {
      const lvl = Math.max(cn.O[j], oh), px = lvl * (1 + slip), stop = cfg.stop === 'atr' ? lvl - 0.1 * aD : ol;
      if (lvl > stop) rec.trade = mk(cn, si, D, j, px, lvl, stop, ride(cn, j, px, stop, Infinity, lastOpen, slip, true));
      break;
    }
  }
  return rec;
}
const S2SEL = {
  base: { T: 'base', N: 5, minRV: 1 },
  'top 3 in play': { T: 'base', N: 3, minRV: 1 },
  'top 10 in play': { T: 'base', N: 10, minRV: 1 },
  'relative volume ≥ 2': { T: 'base', N: 5, minRV: 2 },
  'only when BTC is over its 50-day': { T: 'base', N: 5, minRV: 1, btc: true },
  'only coins over their 20-day': { T: 'base', N: 5, minRV: 1, up20: true },
  'CONTROL: 5 random liquid coins': { T: 'base', N: 5, minRV: 0, random: true },
  ...Object.fromEntries(Object.keys(S2T).filter((k) => k !== 'base').map((k) => [k, { T: k, N: 5, minRV: 1 }])),
};
function s2select(recs, sel, btcUp) {
  const byD = new Map();
  for (const r of recs) { let L = byD.get(r.D); if (!L) byD.set(r.D, (L = [])); L.push(r); }
  const out = [];
  for (const [D, L0] of byD) {
    if (sel.btc && !btcUp(D)) continue;
    let L = L0.filter((r) => r.rv >= sel.minRV && (!sel.up20 || r.up20));
    if (sel.random) { const rnd = require('../rng.js').mulberry32(D * 7919 + 13); L = L.map((r) => [rnd(), r]).sort((a, b) => a[0] - b[0]).map((p) => p[1]); }
    else L.sort((a, b) => b.rv - a.rv);
    for (const r of L.slice(0, sel.N)) if (r.trade) out.push(r.trade);
  }
  return out;
}

// ---------------------------------------------------------------- S3: the 08:30 ET news candle
const S3BASE = { slot: 510, rngK: 2, volK: 3, exitOpen: 645, entry: 'close' };
const S3V = {
  base: {},
  'out at 09:30 ET': { exitOpen: 555 },
  'out at 12:00 ET': { exitOpen: 705 },
  'out at 16:00 ET': { exitOpen: 945 },
  'buy the pullback to its middle (until 10:00)': { entry: 'mid' },
  'smaller candles too (1.5 ATR, 2× volume)': { rngK: 1.5, volK: 2 },
  'only the biggest (3 ATR)': { rngK: 3 },
  'the 14:00 ET candle instead (FOMC), out 16:00': { slot: 840, exitOpen: 945 },
  'the 10:00 ET candle instead (ISM, sentiment…)': { slot: 600, exitOpen: 735 },
};
function newsEvents(btc, cfg, slots) {
  const ev = [], hist = new Map();
  for (let D = btc.D0; D <= btc.D1; D++) {
    const dow = dowOf(D); if (dow === 0 || dow === 6) continue;
    const A0 = anchorOf(D);
    for (const slot of slots) {
      const i = btc.at(A0 + slot * 60); if (i < 1) continue;
      const h = hist.get(slot) || hist.set(slot, []).get(slot), prior = h.slice(-20); h.push(btc.V[i]);
      if (prior.length < 15) continue;
      const avg = prior.reduce((s, x) => s + x, 0) / prior.length, rng = btc.H[i] - btc.L[i], a = btc.A[i - 1];
      if (!(rng >= cfg.rngK * a && btc.V[i] >= cfg.volK * avg)) continue;
      if (!(btc.C[i] > btc.O[i] && btc.C[i] >= btc.L[i] + 0.5 * rng)) continue;
      ev.push({ D, slot, t: btc.T[i] });
    }
  }
  return ev;
}
function s3(cn, si, ev, cfg) {
  const A0 = anchorOf(ev.D), i = cn.at(A0 + ev.slot * 60); if (i < 1) return null;
  const slip = cn.slip(ev.D), stop = cn.L[i] - 0.1 * cn.A[i - 1], lastOpen = A0 + (cfg.exitOpen ?? ev.slot + 135) * 60;
  if (cfg.entry === 'mid') {
    const lvl = (cn.H[i] + cn.L[i]) / 2;
    for (let m = ev.slot + 15; m < 600; m += 15) { const j = cn.at(A0 + m * 60); if (j < 0) continue; if (cn.L[j] < lvl) return mk(cn, si, ev.D, j, lvl, lvl, stop, ride(cn, j, lvl, stop, Infinity, lastOpen, slip, true)); }
    return null;
  }
  const lvl = cn.C[i]; if (!(lvl > stop)) return null;
  return mk(cn, si, ev.D, i, lvl * (1 + slip), lvl, stop, ride(cn, i, lvl * (1 + slip), stop, Infinity, lastOpen, slip, false));
}

// ---------------------------------------------------------------- statistics
const inSpan = (t) => t >= T0 && t < T1;
function tstats(tr) {
  const T = tr.filter((x) => inSpan(x.t)), n = T.length;
  if (!n) return { n: 0 };
  const w = T.filter((x) => x.ret > 0), g = w.reduce((s, x) => s + x.ret, 0), l = -T.filter((x) => x.ret <= 0).reduce((s, x) => s + x.ret, 0);
  const half = (a, b) => { const h = T.filter((x) => x.t >= a && x.t < b); return h.length ? { n: h.length, avg: h.reduce((s, x) => s + x.ret, 0) / h.length, wr: h.filter((x) => x.ret > 0).length / h.length } : { n: 0 }; };
  const Y = {}; for (const x of T) { const y = yearOf(x.t); (Y[y] = Y[y] || { n: 0, s: 0 }); Y[y].n++; Y[y].s += x.ret; }
  const srt = T.map((x) => x.ret).sort((a, b) => a - b);
  return { n, wr: w.length / n, avg: T.reduce((s, x) => s + x.ret, 0) / n, med: srt[Math.floor(n / 2)], pf: l > 0 ? g / l : Infinity, avgR: T.reduce((s, x) => s + x.R, 0) / n,
    is: half(T0, SPLIT), oos: half(SPLIT, T1), yrs: Object.fromEntries(Object.entries(Y).map(([y, v]) => [y, { n: v.n, avg: v.s / v.n }])) };
}
// the pot: each trade gets w of the pot at the day's start, at most `cap` a day (first filled first); all are flat by the
// day's end, so the day's return is exact and the drawdown is read on those daily marks
function port(tr, w, cap, from = T0, to = T1) {
  const byD = new Map(); for (const x of tr) if (x.t >= from && x.t < to) { let L = byD.get(x.D); if (!L) byD.set(x.D, (L = [])); L.push(x); }
  let eq = 1, pk = 1, dd = 0; const Y = {};
  for (const D of [...byD.keys()].sort((a, b) => a - b)) {
    const r = byD.get(D).sort((a, b) => a.t - b.t).slice(0, cap).reduce((s, x) => s + w * x.ret, 0);
    eq *= 1 + r; if (eq > pk) pk = eq; dd = Math.max(dd, 1 - eq / pk);
    const y = yearOf(D * DAY); Y[y] = (Y[y] || 1) * (1 + r);
  }
  const yrs = (to - from) / 31557600;
  return { mult: eq, cagr: eq ** (1 / yrs) - 1, maxDD: dd, years: Y };
}

// ---------------------------------------------------------------- run
const mode = require.main === module ? process.argv[2] : null;
if (mode === 'run') {
  if (COSTMODE === 'slip2') SLIPX = 2;
  if (COSTMODE === 'fut') { FEE = 0.0005; SLIPX = 0.4; }
  if (COSTMODE === 'gross') { FEE = 0; SLIPX = 0; }
  fs.mkdirSync(OUT, { recursive: true });
  const t00 = Date.now(), U = universe().slice(0, Number(process.env.LIMIT) || Infinity);
  const btc = prep('BTCUSDT');
  const btcUp = (D) => btc.up50(D);
  // S3 events (BTC) and the control slots: every other weekday slot 00:00–20:00 ET with the same candle rules
  const S3EV = Object.fromEntries(Object.entries(S3V).map(([k, v]) => { const cfg = { ...S3BASE, ...v }; return [k, newsEvents(btc, cfg, [cfg.slot])]; }));
  const ctrlSlots = []; for (let m = 0; m < 1200; m += 15) if (m !== 510 && m !== 600 && m !== 840) ctrlSlots.push(m);
  S3EV['CONTROL: the same candle at any other time of day'] = newsEvents(btc, S3BASE, ctrlSlots);
  const res = { s1: {}, s2recs: {}, s3: {}, coins: [] };
  for (const k of Object.keys(S1V)) res.s1[k] = [];
  for (const k of Object.keys(S2T)) res.s2recs[k] = [];
  for (const k of Object.keys(S3EV)) res.s3[k] = [];
  for (const [ui, [sym, dir]] of U.entries()) {
    const cn = sym === 'BTCUSDT' ? btc : prep(sym, dir); if (!cn) continue;
    const si = res.coins.length; res.coins.push({ sym: cn.sym, dead: cn.dead });
    const hist = Object.fromEntries(Object.keys(S2T).map((k) => [k, []]));
    const S1C = Object.fromEntries(Object.entries(S1V).map(([k, v]) => [k, { ...S1BASE, ...v }])), S2C = Object.fromEntries(Object.entries(S2T).map(([k, v]) => [k, { ...S2T.base, ...v }]));
    for (let D = cn.D0; D <= cn.D1; D++) {
      const dow = dowOf(D); if (dow === 0 || dow === 6) continue;
      const liquid = cn.turn(D) >= MIN_TURN;
      for (const [k, cfg] of Object.entries(S2C)) { const r = s2(cn, si, D, cfg, hist[k]); if (r && liquid && (k === 'base' || r.rv >= 1)) res.s2recs[k].push(r); }   // the volume history runs every day
      if (!liquid) continue;
      for (const [k, cfg] of Object.entries(S1C)) { const r = s1(cn, si, D, cfg, btcUp); if (r) res.s1[k].push(r); }
    }
    for (const [k, ev] of Object.entries(S3EV)) {
      const cfg = { ...S3BASE, ...(S3V[k] || {}), exitOpen: S3V[k] ? ({ ...S3BASE, ...S3V[k] }).exitOpen : undefined };
      for (const e of ev) { if (!(cn.turn(e.D) >= MIN_TURN)) continue; const r = s3(cn, si, e, cfg); if (r) res.s3[k].push({ ...r, turn: Math.round(cn.turn(e.D)) }); }
    }
    if (ui % 25 === 0) process.stderr.write(`${ui + 1}/${U.length} ${sym} · ${((Date.now() - t00) / 1000).toFixed(0)}s\n`);
  }
  // S3 assets: BTC alone, ETH alone, and the 5 most liquid other coins at each event
  const SY = res.coins.map((c) => c.sym), bi = SY.indexOf('BTC'), ei = SY.indexOf('ETH');
  const s3sets = {};
  for (const [k, L] of Object.entries(res.s3)) {
    s3sets[k] = L.filter((x) => x.s === bi);
    {
      s3sets[k + ' · ETH'] = L.filter((x) => x.s === ei);
      const byT = new Map(); for (const x of L) if (x.s !== bi && x.s !== ei) { let a = byT.get(x.D + ':' + x.t); if (!a) byT.set(x.D + ':' + x.t, (a = [])); a.push(x); }
      s3sets[k + ' · 5 most liquid alts'] = [...byT.values()].flatMap((a) => a.sort((p, q) => q.turn - p.turn).slice(0, 5));
    }
  }
  const S2 = Object.fromEntries(Object.entries(S2SEL).map(([k, sel]) => [k, s2select(res.s2recs[sel.T], sel, btcUp)]));
  // summarise
  const rows = [];
  const add = (strat, k, tr, w, cap) => { const s = tstats(tr), p = port(tr, w, cap), pi = port(tr, w, cap, T0, SPLIT), po = port(tr, w, cap, SPLIT, T1);
    const coinAvg = {}; for (const x of tr) if (inSpan(x.t)) { const c = (coinAvg[x.s] = coinAvg[x.s] || { n: 0, s: 0 }); c.n++; c.s += x.ret; }
    const cs = Object.values(coinAvg).filter((c) => c.n >= 20);
    rows.push({ strat, k, ...s, port: p, portIS: pi, portOOS: po, coins20: cs.length, coinsPos: cs.filter((c) => c.s > 0).length }); };
  for (const [k, tr] of Object.entries(res.s1)) add('S1 Judas', k, tr, 0.2, 5);
  for (const [k, tr] of Object.entries(S2)) add('S2 ORB', k, tr, 0.2, 5);
  for (const [k, tr] of Object.entries(s3sets)) add('S3 News', k, tr, k.includes('alts') ? 0.2 : 1, k.includes('alts') ? 5 : 1);
  const f = (x, d = 2) => (x == null || !Number.isFinite(x) ? '   —  ' : (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(d) + '%');
  console.log(`\nCOSTS: ${COSTMODE} · ${res.coins.length} coins · ${((Date.now() - t00) / 1000).toFixed(0)}s`);
  console.log('strategy  variant                                        trades  win   avg/tr  PF    avgR | 2018-21 avg (n)    2022-26 avg (n)   | pot ×  CAGR    maxDD | IS ×   OOS × | yrs+  coins+');
  for (const r of rows) {
    const yrs = Object.values(r.yrs || {}).filter((v) => v.n >= 5), yp = yrs.filter((v) => v.avg > 0).length;
    console.log(`${r.strat.padEnd(9)} ${r.k.slice(0, 46).padEnd(46)} ${String(r.n).padStart(6)} ${r.n ? (r.wr * 100).toFixed(0).padStart(3) + '%' : '    '} ${f(r.avg).padStart(7)} ${r.n ? r.pf.toFixed(2).padStart(5) : '     '} ${r.n ? r.avgR.toFixed(2).padStart(5) : ''} | ${f(r.is?.avg).padStart(7)} (${String(r.is?.n ?? 0).padStart(5)})   ${f(r.oos?.avg).padStart(7)} (${String(r.oos?.n ?? 0).padStart(5)}) | ${('×' + r.port.mult.toFixed(2)).padStart(6)} ${f(r.port.cagr, 1).padStart(6)} ${('−' + (r.port.maxDD * 100).toFixed(1) + '%').padStart(7)} | ${('×' + r.portIS.mult.toFixed(2)).padStart(5)} ${('×' + r.portOOS.mult.toFixed(2)).padStart(6)} | ${yp}/${yrs.length}  ${r.coins20 ? r.coinsPos + '/' + r.coins20 : ''}`);
  }
  fs.writeFileSync(path.join(OUT, COSTMODE === 'spot' ? 'run.json' : `run_${COSTMODE}.json`), JSON.stringify({ at: new Date().toISOString(), costs: COSTMODE, coins: res.coins, rows,
    trades: { s1: res.s1, s2: S2, s3: s3sets }, events: Object.fromEntries(Object.entries(S3EV).map(([k, v]) => [k, v.length])) }));
}

if (mode === 'diag') {
  // the average 30-minute move of BTC and ETH in each New York half-hour, weekdays, per period (before costs)
  for (const sym of ['BTCUSDT', 'ETHUSDT']) {
    const cn = prep(sym), P = [['2018–21', T0, SPLIT], ['2022–23', SPLIT, Date.UTC(2024, 0, 1) / 1e3], ['2024–26', Date.UTC(2024, 0, 1) / 1e3, T1]];
    const acc = P.map(() => Array.from({ length: 48 }, () => ({ n: 0, s: 0, ss: 0 })));
    for (let D = cn.D0; D <= cn.D1; D++) {
      const dow = dowOf(D); if (dow === 0 || dow === 6) continue;
      const A0 = anchorOf(D);
      for (let h = 0; h < 48; h++) {
        const i = cn.at(A0 + h * 1800), j = cn.at(A0 + h * 1800 + BAR); if (i < 0 || j < 0) continue;
        const r = Math.log(cn.C[j] / cn.O[i]), p = P.findIndex(([, a, b]) => cn.T[i] >= a && cn.T[i] < b); if (p < 0) continue;
        const a = acc[p][h]; a.n++; a.s += r; a.ss += r * r;
      }
    }
    console.log(`\n${sym}: average move per New York half-hour, weekdays (t-stat), before costs`);
    console.log('ET     ' + P.map(([n]) => n.padStart(17)).join(''));
    for (let h = 0; h < 48; h++) {
      const cells = acc.map((A) => { const a = A[h], m = a.s / a.n, sd = Math.sqrt(a.ss / a.n - m * m); return `${(m >= 0 ? '+' : '−') + Math.abs(m * 1e4).toFixed(1).padStart(4)}bp (${(m / (sd / Math.sqrt(a.n))).toFixed(1).padStart(4)})`; });
      console.log(`${String(Math.floor(h / 2)).padStart(2, '0')}:${h % 2 ? '30' : '00'}  ${cells.map((c) => c.padStart(17)).join('')}`);
    }
  }
}
module.exports = { prep, nyOff, anchorOf, dowOf, ride, s1, s2, s3, newsEvents, tstats, port, S1BASE, S1V, S2T, S2SEL, S3BASE, S3V, universe };
