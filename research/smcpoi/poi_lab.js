/*
 * The user's 15m SMC continuation pattern (Nov 2026, user request with a chart). RESEARCH ONLY: detector.js, the
 * webapp and the bot are unchanged.
 *
 *   node research/smcpoi/poi_lab.js run [round2…round8|final] [gross|slip2]   # → research/cache/smcpoi/<round>_run*.json
 *   node research/smcpoi/poi_lab.js report > research/smcpoi/RESULTS_smcpoi_2026-11.md   # needs run (round 1), round2…8 and
 *                                                        final, and final/round7/round8 also with gross and slip2
 * The final version (round 8): the HTF context, the first gap paying ≥ 2R, and a stop 1–5% below the entry. Its
 * money comes from coins later delisted; on the user's 103 coins it breaks even. Not shipped.
 *
 * THE PATTERN (fixed from the trading logic before any result was seen; each variant changes ONE thing):
 *   structure  an ATR zigzag on 15m candles: a swing is confirmed once price reverses Z × the 15m ATR (Z = 3).
 *   uptrend    the last two swing highs AND the last two swing lows before the setup are rising (higher highs and
 *              higher lows). H0 = the last major high, L0 = the higher low before it.
 *   drop       within 8 hours of H0 price trades BELOW L0: the sell stops under the higher low are taken.
 *   up move    within 6 hours of the drop's low (the sweep low) a 15m candle CLOSES above H0: the break of structure.
 *   POI        the deepest bullish fair value gap in that up move (a candle whose low is above the high two candles
 *              back); the limit buy rests at its middle for 12 hours (cancelled if price reaches the target first).
 *   stop       0.1 × the 15m ATR under the sweep low: below it the drop was not a trap.
 *   target     the high of the up move (the buy stops above it), taken only when it pays ≥ 3R; risk under 0.5% of the
 *              price is skipped (costs would eat it); out after 24 hours if neither is hit.
 *   HTF        variants test the higher-timeframe liquidity as the deciding context: the sweep took the previous
 *              day's low; an untaken previous-day high sits above; the coin over its 20-day average; BTC over its
 *              50-day average; and the New York morning only.
 * Fills: a limit buy fills at its price only when price trades below it; on the fill candle a stop counts first and a
 * target cannot fill; a stop fills at the stop or a worse open; a target fills at its price. Costs: 0.1% fee a side;
 * stops and timed exits also pay 0.05% slippage on coins trading ≥ $100M a day, 0.15% on the rest. A coin counts
 * only with ≥ $5M a day (30-day average). Data: the user's 103 coins + 171 delisted or collapsed (274), full 15m
 * history; 2018–21 is where anything may be chosen, 2022–26 is the judge.
 */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const { load, LIST } = require('../liqbrk15m/lab15.js');
const { nyOff } = require('../nyopen/ny_lab.js');
const { mulberry32 } = require('../rng.js');
const OUT = path.join(ROOT, 'research', 'cache', 'smcpoi'), DEADDIR = path.join(ROOT, 'research', 'cache', 'lb15dead');
const DAY = 86400, BAR = 900;
const TRUNC = { LUNAUSDT: Date.UTC(2022, 4, 14) / 1e3 };
const STABLE = /USD|^(DAI|PAX|UST|EUR|GBP|AUD|TRY|BRL|IDRT|BIDR)$/;
const T0 = Date.UTC(2018, 0, 1) / 1e3, SPLIT = Date.UTC(2022, 0, 1) / 1e3, T1 = Date.UTC(2026, 10, 5) / 1e3;
const COSTMODE = ['slip2', 'gross'].find((m) => process.argv.includes(m)) || 'spot';
const FEE = COSTMODE === 'gross' ? 0 : 0.001, SLIPX = COSTMODE === 'gross' ? 0 : COSTMODE === 'slip2' ? 2 : 1;

function universe() {
  const U = LIST.map((s) => [s, null]);
  for (const f of fs.readdirSync(DEADDIR).sort()) if (f.endsWith('_15m.json')) U.push([f.replace('_15m.json', ''), DEADDIR]);
  return U.filter(([s]) => !STABLE.test(s.replace(/USDT$/, '')));
}

// ---------------------------------------------------------------- one coin: arrays, ATR, UTC-day context
function prep(sym, dir) {
  let c = dir ? load(sym, dir) : load(sym);
  if (!c || c.length < 3000) return null;
  if (TRUNC[sym]) c = c.filter((b) => b.time < TRUNC[sym]);
  const n = c.length, T = new Float64Array(n), O = new Float64Array(n), H = new Float64Array(n), L = new Float64Array(n), C = new Float64Array(n), A = new Float64Array(n);
  let a = 0;
  for (let i = 0; i < n; i++) {
    const b = c[i]; T[i] = b.time; O[i] = b.open; H[i] = b.high; L[i] = b.low; C[i] = b.close;
    const tr = i ? Math.max(H[i] - L[i], Math.abs(H[i] - C[i - 1]), Math.abs(L[i] - C[i - 1])) : H[i] - L[i];
    a = i < 14 ? (a * i + tr) / (i + 1) : (a * 13 + tr) / 14; A[i] = a;
  }
  const u0 = Math.floor(T[0] / DAY), nu = Math.floor(T[n - 1] / DAY) - u0 + 1;
  const dH = new Float64Array(nu).fill(NaN), dL = new Float64Array(nu).fill(NaN), dC = new Float64Array(nu).fill(NaN), dT = new Float64Array(nu);
  for (let i = 0; i < n; i++) { const u = Math.floor(T[i] / DAY) - u0;
    if (Number.isNaN(dH[u])) { dH[u] = H[i]; dL[u] = L[i]; } else { if (H[i] > dH[u]) dH[u] = H[i]; if (L[i] < dL[u]) dL[u] = L[i]; } dC[u] = C[i]; dT[u] += c[i].volume * C[i]; }
  const sma = (len) => { const o = new Float64Array(nu).fill(NaN), q = []; let s = 0; for (let u = 0; u < nu; u++) { if (Number.isNaN(dC[u])) continue; q.push(dC[u]); s += dC[u]; if (q.length > len) s -= q.shift(); if (q.length === len) o[u] = s / len; } return o; };
  const s20 = sma(20), s50 = sma(50), turn30 = new Float64Array(nu).fill(NaN); { let s = 0; for (let u = 0; u < nu; u++) { s += dT[u]; if (u >= 30) s -= dT[u - 30]; if (u >= 29) turn30[u] = s / 30; } }
  // 4h candles from the 15m ones, and their swing points (2 candles either side), each known only once confirmed
  const h4 = []; for (let i = 0; i < n; i++) { const k = Math.floor(T[i] / 14400) * 14400, x = h4[h4.length - 1];
    if (!x || x.t !== k) h4.push({ t: k, h: H[i], l: L[i] }); else { if (H[i] > x.h) x.h = H[i]; if (L[i] < x.l) x.l = L[i]; } }
  const h4lo = [], h4hi = [];
  for (let k = 2; k < h4.length - 2; k++) {
    const conf = h4[k + 2].t + 14400;                                  // the close of the 2nd candle after it
    if (h4[k].l < h4[k - 1].l && h4[k].l < h4[k - 2].l && h4[k].l <= h4[k + 1].l && h4[k].l <= h4[k + 2].l) h4lo.push({ k, p: h4[k].l, conf });
    if (h4[k].h > h4[k - 1].h && h4[k].h > h4[k - 2].h && h4[k].h >= h4[k + 1].h && h4[k].h >= h4[k + 2].h) h4hi.push({ k, p: h4[k].h, conf });
  }
  const h4idx = (t) => { let lo = 0, hi = h4.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (h4[m].t <= t) lo = m; else hi = m - 1; } return lo; };
  // the last confirmed 4h swing low known at time t
  const lastH4Low = (t) => { let r = NaN; for (let j = h4lo.length - 1; j >= 0; j--) if (h4lo[j].conf <= t) { r = h4lo[j].p; break; } return r; };
  // is there a 4h swing high above `lvl`, known at time t, that no later 4h candle has traded through (untaken)?
  const h4DrawAbove = (t, lvl) => { const kt = h4idx(t);
    for (let j = h4hi.length - 1; j >= 0; j--) { const x = h4hi[j]; if (x.conf > t) continue; if (h4[x.k].t < t - 30 * DAY) break; if (!(x.p > lvl)) continue;
      let taken = false; for (let q = x.k + 1; q <= kt; q++) if (h4[q].h > x.p) { taken = true; break; } if (!taken) return true; }
    return false; };
  const prev = (i) => Math.floor(T[i] / DAY) - u0 - 1;                 // the last complete UTC day before candle i
  const ok = (u) => u >= 0 && u < nu;
  return { sym: sym.replace(/USDT$/, ''), dead: !!dir, n, T, O, H, L, C, A, lastH4Low, h4DrawAbove,
    turn: (i) => { const u = prev(i); return ok(u) ? turn30[u] : NaN; },
    pdh: (i) => { const u = prev(i); return ok(u) ? dH[u] : NaN; }, pdl: (i) => { const u = prev(i); return ok(u) ? dL[u] : NaN; },
    p3h: (i) => { const u = prev(i); let m = NaN; for (let k = u; k > u - 3; k--) if (ok(k) && !(dH[k] <= m)) m = dH[k]; return m; },
    up20: (i) => { const u = prev(i); return ok(u) && dC[u] > s20[u]; }, up50: (i) => { const u = prev(i); return ok(u) && dC[u] > s50[u]; },
    slip: (i) => { const u = prev(i); return SLIPX * (ok(u) && turn30[u] >= 1e8 ? 0.0005 : 0.0015); } };
}

// ---------------------------------------------------------------- the ATR zigzag: swings confirmed by a Z × ATR reversal
function zigzag(cn, Z) {
  const piv = []; let dir = 0, hiI = 0, hiP = cn.H[0], loI = 0, loP = cn.L[0];
  for (let i = 1; i < cn.n; i++) {
    const z = Z * cn.A[i];
    if (dir !== -1 && cn.H[i] > hiP) { hiP = cn.H[i]; hiI = i; }
    if (dir !== 1 && cn.L[i] < loP) { loP = cn.L[i]; loI = i; }
    if (dir !== -1 && hiP - cn.L[i] >= z && hiI < i) { piv.push({ i: hiI, p: hiP, t: 'H', conf: i }); dir = -1; loP = cn.L[i]; loI = i; }
    else if (dir !== 1 && cn.H[i] - loP >= z && loI < i) { piv.push({ i: loI, p: loP, t: 'L', conf: i }); dir = 1; hiP = cn.H[i]; hiI = i; }
  }
  return piv;
}

// ---------------------------------------------------------------- the exit side of a long
function ride(cn, f, fillPx, stop, target, lastI, slip, fillBarStop) {
  if (fillBarStop && cn.L[f] <= stop) return { px: stop * (1 - slip), why: 'stop', j: f };
  for (let j = f + 1; j <= Math.min(lastI, cn.n - 1); j++) {
    if (cn.L[j] <= stop) return { px: Math.min(cn.O[j], stop) * (1 - slip), why: 'stop', j };
    if (cn.H[j] >= target) return { px: Math.max(target, 0) , why: 'target', j };
    if (j === lastI) return { px: cn.C[j] * (1 - slip), why: 'time', j };
  }
  const j = Math.min(lastI, cn.n - 1); return { px: cn.C[j] * (1 - slip), why: 'time', j };
}
// the same with HALF sold at `half` (a limit) and the rest's stop moved to the entry. A candle that touches the stop
// counts the stop first; a candle that sells the half and trades back to the entry also stops the rest.
function rideHalf(cn, f, px, stop, target, lastI, slip, fillBarStop, half) {
  if (fillBarStop && cn.L[f] <= stop) return { px: stop * (1 - slip), why: 'stop', j: f };
  let got = false, stp = stop; const end = Math.min(lastI, cn.n - 1);
  for (let j = f + 1; j <= end; j++) {
    if (cn.L[j] <= stp) { const o = Math.min(cn.O[j], stp) * (1 - slip); return got ? { px: (half + o) / 2, why: 'half', j } : { px: o, why: 'stop', j }; }
    if (cn.H[j] >= target) return { px: (half + target) / 2, why: 'target', j };
    if (!got && cn.H[j] >= half) { got = true; stp = px; if (cn.L[j] <= px) return { px: (half + px * (1 - slip)) / 2, why: 'half', j }; }
    if (j === end) break;
  }
  const o = cn.C[end] * (1 - slip); return { px: got ? (half + o) / 2 : o, why: 'time', j: end };
}
const trade = (cn, si, f, lvl, stop, target, r, extra = {}) => {
  const ret = r.px * (1 - FEE) / (lvl * (1 + FEE)) - 1, risk = (lvl - stop) / lvl;
  return { s: si, t: cn.T[f], tOut: cn.T[r.j], ret: +ret.toFixed(6), R: +(ret / risk).toFixed(4), risk: +risk.toFixed(5), rr: +((target - lvl) / (lvl - stop)).toFixed(2), why: r.why, ...extra };
};

// ---------------------------------------------------------------- the pattern
const BASE = { Z: 3, hh: 2, dropBars: 32, upBars: 24, sweep: true, poi: 'fvgDeep', valid: 48, hold: 96, minRR: 3, minRisk: 0.005, maxRisk: Infinity, target: 'leg', htf: [], ny: null, stop: 'sweep', entry: 'limit', confBars: 8, half: 0 };
const ny = (t) => { const m = (((t + nyOff(t)) % DAY) + DAY) % DAY / 60; return m; };          // minutes after 00:00 New York
// find every setup on a coin (one at a time: a coin waits until its trade or order is done)
function scan(cn, si, piv, cfg, btcUp, rnd) {
  const out = [], ctrl = []; let busyUntil = -1;
  const H = cn.H, L = cn.L, C = cn.C;
  for (let k = 3; k < piv.length; k++) {
    const h0 = piv[k]; if (h0.t !== 'H') continue;
    const l0 = piv[k - 1], h1 = piv[k - 2], l1 = piv[k - 3];
    if (l0.t !== 'L' || h1.t !== 'H' || l1.t !== 'L') continue;
    if (!(h1.p < h0.p && l1.p < l0.p)) continue;                                     // higher high and higher low
    if (cfg.hh >= 3) { const h2 = piv[k - 4]; if (!h2 || h2.t !== 'H' || !(h2.p < h1.p)) continue; }
    if (h0.i <= busyUntil) continue;
    // the drop: price trades under the higher low within dropBars of the high (or, without `sweep`, any pullback)
    let j = -1;
    for (let q = h0.i + 1; q < Math.min(cn.n, h0.i + 1 + cfg.dropBars); q++) {
      if (C[q] > h0.p) break;                                                         // new high first: no trap
      if (cfg.sweep ? L[q] < l0.p : true) { j = q; break; }
    }
    if (j < 0) continue;
    // the sweep low and the break of structure: a CLOSE above H0 within upBars of the lowest low
    let s = j, b = -1;
    for (let q = j; q < Math.min(cn.n, j + cfg.dropBars + cfg.upBars); q++) {
      if (L[q] < L[s]) s = q;
      if (C[q] > h0.p && q > s) { b = q; break; }
      if (q - s > cfg.upBars) break;
    }
    if (b < 0 || b - s > cfg.upBars || b <= busyUntil || h0.conf > b) continue;          // H0 must be a known swing by then
    if (!cfg.sweep && L[s] >= h0.p - 3 * cn.A[b]) continue;                            // without the sweep: still a real pullback
    if (!(cn.turn(b) >= 5e6)) continue;
    // the higher-timeframe context
    const legHi = Math.max(...Array.from(H.subarray(s, b + 1))), pdl = cn.pdl(b), pdh = cn.pdh(b);
    if (cfg.htf.includes('pdl') && !(L[s] < pdl)) continue;
    if (cfg.htf.includes('pdh') && !(pdh > legHi)) continue;
    if (cfg.htf.includes('any') && !(L[s] < pdl || pdh > legHi)) continue;            // either HTF liquidity is in play
    if (cfg.htf.includes('any3') && !(L[s] < pdl || cn.p3h(b) > legHi)) continue;      // …with the 3-day high as the draw
    if (cfg.htf.some((x) => x.startsWith('h4') || x === 'all')) {
      const h4low = L[s] < cn.lastH4Low(cn.T[h0.i]), h4draw = cn.h4DrawAbove(cn.T[b], legHi);
      if (cfg.htf.includes('h4low') && !h4low) continue;
      if (cfg.htf.includes('h4high') && !h4draw) continue;
      if (cfg.htf.includes('h4any') && !(h4low || h4draw)) continue;
      if (cfg.htf.includes('all') && !(h4low || h4draw || L[s] < pdl || pdh > legHi)) continue;   // any HTF pool, daily or 4h
    }
    if (cfg.htf.includes('up20') && !cn.up20(b)) continue;
    if (cfg.htf.includes('btc') && !btcUp(cn.T[b])) continue;
    if (cfg.ny) { const m = ny(cn.T[b]); if (!(m >= cfg.ny[0] && m < cfg.ny[1])) continue; }
    // the POI inside the up move
    let hiLeg = -Infinity; for (let q = s; q <= b; q++) if (H[q] > hiLeg) hiLeg = H[q];
    let lvl = NaN, gapBot = NaN, gapTop = NaN;
    const stop0 = L[s] - 0.1 * cn.A[b];
    if (cfg.poi === 'fvgPay' || cfg.poi === 'fvgPayBos') {
      const tg = cfg.target === 'htf' ? (pdh > hiLeg ? pdh : hiLeg) : hiLeg, gaps = [];
      for (let q = s + 2; q <= b; q++) if (L[q] > H[q - 2]) gaps.push((H[q - 2] + L[q]) / 2);
      gaps.sort((x, y) => y - x);                                                         // shallowest first
      if (cfg.poi === 'fvgPayBos') gaps.push(h0.p);                                        // …or a retest of the broken high
      const pay = gaps.find((g) => g > stop0 && g < C[b] && (tg - g) >= cfg.minRR * (g - stop0) && (g - stop0) / g >= cfg.minRisk);
      if (pay === undefined) continue;
      lvl = pay;
    } else if (cfg.poi === 'fvgDeep' || cfg.poi === 'fvgShallow' || cfg.poi === 'fvgTop') {
      let best = -1;
      for (let q = s + 2; q <= b; q++) if (L[q] > H[q - 2]) { if (best < 0 || (cfg.poi === 'fvgShallow' ? H[q - 2] > H[best - 2] : H[q - 2] < H[best - 2])) best = q; }
      if (best < 0) continue;
      lvl = cfg.poi === 'fvgTop' ? L[best] : (H[best - 2] + L[best]) / 2; gapBot = H[best - 2]; gapTop = L[best];
    } else if (cfg.poi === 'ob') {                                                     // the last down candle at the base
      let q = s; while (q > s - 4 && !(C[q] < cn.O[q])) q--; if (!(C[q] < cn.O[q])) continue; lvl = cn.O[q];
    } else if (cfg.poi === 'bos') lvl = h0.p;                                          // a retest of the broken high
    else if (cfg.poi.startsWith('fib')) lvl = hiLeg - Number(cfg.poi.slice(3)) / 100 * (hiLeg - L[s]);
    const stop = cfg.stop === 'gap' && Number.isFinite(gapBot) ? gapBot - 0.1 * cn.A[b] : L[s] - 0.1 * cn.A[b];
    if (!(lvl > stop) || (lvl - stop) / lvl < cfg.minRisk || (lvl - stop) / lvl > cfg.maxRisk || lvl >= C[b]) continue;
    if (!Number.isFinite(gapTop)) gapTop = lvl;
    const risk = lvl - stop, liqT = cfg.target === 'leg' || cfg.target === 'htf';
    const tgt0 = cfg.target === 'leg' ? hiLeg : cfg.target === 'htf' ? (pdh > hiLeg ? pdh : hiLeg) : lvl + cfg.target * risk;
    if (liqT && (tgt0 - lvl) < cfg.minRR * risk) continue;
    // the exit side (all at once, or half at +`half` R), and the entry once the order's level trades on candle f: the
    // limit fill itself, or (`confirm`) the first close back above the gap within confBars candles, bought at that
    // close plus slippage, with the RR and the stop size checked again at that price; the stop trading first kills it
    const exitOf = (f, px, S_, T_, fbs) => cfg.half ? rideHalf(cn, f, px, S_, T_, f + cfg.hold, cn.slip(f), fbs, px + cfg.half * (px - S_)) : ride(cn, f, px, S_, T_, f + cfg.hold, cn.slip(f), fbs);
    const enter = (f, L_, S_, G_, T_) => {
      if (cfg.entry !== 'confirm') return { e: f, px: L_, r: exitOf(f, L_, S_, T_, true) };
      for (let q = f; q <= Math.min(cn.n - 1, f + cfg.confBars); q++) {
        if (L[q] <= S_) return null;
        if (C[q] > G_) { const px = C[q] * (1 + cn.slip(q)), rk = (px - S_) / px;
          if (T_ - px < cfg.minRR * (px - S_) || rk < cfg.minRisk || rk > cfg.maxRisk) return null;
          return { e: q, px, r: exitOf(q, px, S_, T_, false) }; }
      }
      return null;
    };
    // the order: rests from the next candle for `valid` candles
    const sim = (off, scale) => {                                                       // off: candle offset for the control
      const L_ = scale.lvl, S_ = scale.stop; let T_ = scale.tgt, f = -1, run = scale.hi;
      for (let q = b + 1 + off; q <= Math.min(cn.n - 1, b + off + cfg.valid); q++) {
        if (L[q] < L_) { f = q; break; }
        if (H[q] > run) run = H[q];
        if (H[q] >= T_ && !liqT) return null;
      }
      if (f < 0) return null;
      if (liqT) T_ = Math.max(T_, run);                                                  // the high of the move as of the fill
      const x = enter(f, L_, S_, scale.gap, T_); if (!x) return null;
      return { f: x.e, px: x.px, r: x.r, T_ };
    };
    const real = sim(0, { lvl, stop, tgt: tgt0, hi: hiLeg, gap: gapTop });
    if (real) {
      out.push(trade(cn, si, real.f, real.px, stop, real.T_, real.r, { b: cn.T[b], dropAtr: +((h0.p - L[s]) / cn.A[b]).toFixed(2) }));
      busyUntil = real.r.j;
      // the control: the same order geometry, relative to the close, at random candles of the same coin (20 draws)
      if (rnd) for (let draw = 0; draw < 20; draw++) {
        const r0 = Math.floor(rnd() * (cn.n - 600)) + 300, sc = C[r0] / C[b];
        if (cn.turn(r0) >= 5e6) {
          const bb = r0;
          const c2 = (() => { const L2 = lvl * sc, S2 = stop * sc, T2 = real.T_ * sc, G2 = gapTop * sc; let f = -1;
            for (let q = bb + 1; q <= Math.min(cn.n - 1, bb + cfg.valid); q++) if (L[q] < L2) { f = q; break; }
            if (f < 0) return null; const x = enter(f, L2, S2, G2, T2); return x ? trade(cn, si, x.e, x.px, S2, T2, x.r) : null; })();
          if (c2) ctrl.push(c2);
        }
      }
    } else busyUntil = Math.max(busyUntil, b + cfg.valid);
  }
  return { out, ctrl };
}

// ---------------------------------------------------------------- statistics
const inSpan = (t) => t >= T0 && t < T1;
function tstats(tr) {
  const T = tr.filter((x) => inSpan(x.t)), n = T.length; if (!n) return { n: 0 };
  const w = T.filter((x) => x.ret > 0), g = w.reduce((s, x) => s + x.ret, 0), l = -T.filter((x) => x.ret <= 0).reduce((s, x) => s + x.ret, 0);
  const half = (a, b) => { const h = T.filter((x) => x.t >= a && x.t < b); return h.length ? { n: h.length, avg: h.reduce((s, x) => s + x.ret, 0) / h.length, R: h.reduce((s, x) => s + x.R, 0) / h.length, wr: h.filter((x) => x.ret > 0).length / h.length } : { n: 0 }; };
  const Y = {}; for (const x of T) { const y = new Date(x.t * 1000).getUTCFullYear(); (Y[y] = Y[y] || { n: 0, s: 0 }); Y[y].n++; Y[y].s += x.ret; }
  return { n, wr: w.length / n, avg: T.reduce((s, x) => s + x.ret, 0) / n, avgR: T.reduce((s, x) => s + x.R, 0) / n, pf: l > 0 ? g / l : Infinity,
    rr: T.reduce((s, x) => s + x.rr, 0) / n, risk: T.reduce((s, x) => s + x.risk, 0) / n, is: half(T0, SPLIT), oos: half(SPLIT, T1),
    exits: Object.fromEntries(['target', 'stop', 'time', 'half'].map((w) => { const a = T.filter((x) => x.why === w); return [w, { share: a.length / n, avgR: a.length ? a.reduce((s, x) => s + x.R, 0) / a.length : NaN }]; })),
    yrs: Object.fromEntries(Object.entries(Y).map(([y, v]) => [y, { n: v.n, avg: v.s / v.n }])), perYear: n / ((T1 - T0) / 31557600) };
}
// the pot: 5 slots, each 20% of the pot (at cost) when it opens, first filled first
function port(tr, from = T0, to = T1) {
  const ev = []; for (const x of tr) if (x.t >= from && x.t < to) { ev.push([x.t, 1, x]); ev.push([x.tOut + 1, 0, x]); }
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cash = 1, open = new Map(), pk = 1, dd = 0; const Y = {};
  for (const [t, kind, x] of ev) {
    if (kind === 1) { if (open.size >= 5) continue; const E = cash + [...open.values()].reduce((s, v) => s + v, 0), a = Math.min(cash, 0.2 * E); if (a <= 1e-12) continue; cash -= a; open.set(x, a); }
    else if (open.has(x)) { cash += open.get(x) * (1 + x.ret); open.delete(x); const E = cash + [...open.values()].reduce((s, v) => s + v, 0); pk = Math.max(pk, E); dd = Math.max(dd, 1 - E / pk); const y = new Date(t * 1000).getUTCFullYear(); Y[y] = E; }
  }
  const E = cash + [...open.values()].reduce((s, v) => s + v, 0), yrs = (to - from) / 31557600;
  return { mult: E, cagr: E ** (1 / yrs) - 1, maxDD: dd };
}

// ---------------------------------------------------------------- run
const V = {
  base: {},
  'CONTROL: no sweep (any pullback, then the break)': { sweep: false },
  'zigzag 2 ATR (smaller swings)': { Z: 2 },
  'zigzag 4 ATR (bigger swings)': { Z: 4 },
  'three rising highs': { hh: 3 },
  'slower drop and up move (16h / 12h)': { dropBars: 64, upBars: 48 },
  'POI: the shallowest gap': { poi: 'fvgShallow' },
  'POI: the deepest gap, its top': { poi: 'fvgTop' },
  'POI: the order block at the base': { poi: 'ob' },
  'POI: 62% of the up move (≥ 1.5R)': { poi: 'fib62', minRR: 1.5 },
  'POI: 79% of the up move': { poi: 'fib79' },
  'POI: retest of the broken high': { poi: 'bos', minRR: 1.5 },
  'target 2R': { target: 2 },
  'target 3R': { target: 3 },
  'target 5R': { target: 5 },
  'target the high, ≥ 2R': { minRR: 2 },
  'out after 12h': { hold: 48 },
  'out after 48h': { hold: 192 },
  'HTF: the drop took the previous day low': { htf: ['pdl'] },
  'HTF: an untaken previous-day high above': { htf: ['pdh'] },
  'HTF: coin over its 20-day average': { htf: ['up20'] },
  'HTF: BTC over its 50-day average': { htf: ['btc'] },
  'NY: break of structure 08:00–11:00 ET': { ny: [480, 660] },
};
// ROUND 2 (after round 1): the HTF liquidity context becomes part of the rules — a trade needs the drop to have taken
// the previous day's low OR an untaken previous-day high above (either HTF pool in play); then a few logical refinements.
const V2 = {
  'R2: HTF liquidity (prev-day low taken OR prev-day high above)': { htf: ['any'] },
  'R2 + both HTF pools': { htf: ['pdl', 'pdh'] },
  'R2 + target the prev-day high when higher': { htf: ['any'], target: 'htf' },
  'R2 + the shallowest gap': { htf: ['any'], poi: 'fvgShallow' },
  'R2 + the shallowest gap, ≥ 2R': { htf: ['any'], poi: 'fvgShallow', minRR: 2 },
  'R2 + major swings (4 ATR)': { htf: ['any'], Z: 4 },
  'R2 + major swings, shallowest gap ≥ 2R': { htf: ['any'], Z: 4, poi: 'fvgShallow', minRR: 2 },
  'R2 + prev-day-high target, shallowest gap ≥ 2R': { htf: ['any'], target: 'htf', poi: 'fvgShallow', minRR: 2 },
  'R2 + New York morning (break 08:00–11:00 ET)': { htf: ['any'], ny: [480, 660] },
  'R2 + New York, shallowest gap ≥ 2R': { htf: ['any'], ny: [480, 660], poi: 'fvgShallow', minRR: 2 },
};
// ROUND 3 (after round 2: the shallowest gap ≥ 2R carried the edge but only ~13 trades a year): more trades, same logic
const R3 = { htf: ['any'], poi: 'fvgPay', minRR: 2 };
const V3 = {
  'R2 + the shallowest gap, ≥ 2R (round 2 pick)': { htf: ['any'], poi: 'fvgShallow', minRR: 2 },
  'R3: the shallowest gap that pays ≥ 2R (engine rule)': R3,
  'R3 at ≥ 1.5R': { ...R3, minRR: 1.5 },
  'R3 + 3-day high as the draw': { ...R3, htf: ['any3'] },
  'R3 + smaller swings (2 ATR)': { ...R3, Z: 2 },
  'R3 + retest of the break if no gap pays': { ...R3, poi: 'fvgPayBos' },
  'R3 + 3-day draw + retest fallback': { ...R3, htf: ['any3'], poi: 'fvgPayBos' },
  'R3 + New York morning': { ...R3, ny: [480, 660] },
  'R3 without the HTF context': { ...R3, htf: [] },
};
// ROUND 4 (after round 3: going deeper for RR diluted the edge — the quality sits in legs whose gaps are all low, a
// sharp V off the sweep low): keep "the shallowest gap, ≥ 2R" and loosen the other filters for more trades
const S4 = { htf: ['any'], poi: 'fvgShallow', minRR: 2 };
const V4 = {
  'R4 = round 2 pick (HTF any, shallowest gap ≥ 2R)': S4,
  'R4 without the HTF context': { ...S4, htf: [] },
  'R4 at ≥ 1.5R': { ...S4, minRR: 1.5 },
  'R4 without HTF, ≥ 1.5R': { ...S4, htf: [], minRR: 1.5 },
  'R4 + 3-day high as the draw': { ...S4, htf: ['any3'] },
  'R4 + swings 2.5 ATR': { ...S4, Z: 2.5 },
  'R4 + swings 2 ATR': { ...S4, Z: 2 },
  'R4 + slower moves (16h / 12h)': { ...S4, dropBars: 64, upBars: 48 },
  'R4 + order valid 24h': { ...S4, valid: 96 },
  'R4 + hold 48h': { ...S4, hold: 192 },
  'R4 + New York morning': { ...S4, ny: [480, 660] },
};
// ROUND 5 (after round 4): the user's "small stop, high RR" — the stop under the gap instead of under the sweep low —
// and the frequency changes that held up in round 4 (3-day draw, slower moves), alone and together
const S5 = { htf: ['any'], poi: 'fvgShallow', minRR: 2 };
const V5 = {
  'R5 = round 2 pick (stop under the sweep low)': S5,
  'R5 + stop under the gap (small stop, high RR)': { ...S5, stop: 'gap' },
  'R5 + stop under the gap, ≥ 3R': { ...S5, stop: 'gap', minRR: 3 },
  'R5 + 3-day draw + slower moves': { ...S5, htf: ['any3'], dropBars: 64, upBars: 48 },
  'R5 + 3-day draw + slower moves + gap stop': { ...S5, htf: ['any3'], dropBars: 64, upBars: 48, stop: 'gap' },
  'R5 + 3-day draw + slower + swings 2.5': { ...S5, htf: ['any3'], dropBars: 64, upBars: 48, Z: 2.5 },
  'R5 + 3-day draw + slower + swings 2.5 + gap stop': { ...S5, htf: ['any3'], dropBars: 64, upBars: 48, Z: 2.5, stop: 'gap' },
  'R5 + 3-day draw, ≥ 1.5R': { ...S5, htf: ['any3'], minRR: 1.5 },
};
// ROUND 6 (after round 5: tight stops fail; the HTF context is the lever): 4h liquidity as the HTF — a 4h swing low taken
// by the drop, or an untaken 4h swing high above the up move — instead of / as well as the previous day's
const S6 = { poi: 'fvgShallow', minRR: 2 };
const V6 = {
  'R6 ref: daily pools (round 2 pick)': { ...S6, htf: ['any'] },
  'R6: the drop took a 4h swing low': { ...S6, htf: ['h4low'] },
  'R6: an untaken 4h swing high above': { ...S6, htf: ['h4high'] },
  'R6: either 4h pool': { ...S6, htf: ['h4any'] },
  'R6: any pool, daily or 4h': { ...S6, htf: ['all'] },
  'R6: either 4h pool, ≥ 1.5R': { ...S6, htf: ['h4any'], minRR: 1.5 },
  'R6: any pool, ≥ 1.5R': { ...S6, htf: ['all'], minRR: 1.5 },
  'R6: either 4h pool + slower moves': { ...S6, htf: ['h4any'], dropBars: 64, upBars: 48 },
  'R6: 4h low taken AND 4h high above': { ...S6, htf: ['h4low', 'h4high'] },
};
// FINAL: the two finalists of rounds 1–6 (and the bare pattern), each with its own random-geometry control
const VF = {
  'pattern alone (round 1 base)': {},
  'STRICT: prev-day pool + V-shaped up move (shallowest gap ≥ 2R)': { htf: ['any'], poi: 'fvgShallow', minRR: 2 },
  'MODERATE: the same at ≥ 1.5R': { htf: ['any'], poi: 'fvgShallow', minRR: 1.5 },
};
// ROUND 7 (after the final diagnostics): stops under 1% lose in both halves (the costs are a third of the stop or
// more); without its best 5 trades the strict version breaks even; a resting limit fills on the moves that fail.
// Four changes with a reason fixed in advance, each on the moderate (≥ 1.5R) and the strict (≥ 2R) version:
//   cost floor   a stop of at least 1% of the price, so the ~0.3% of costs stay under a third of it
//   stop cap     … and at most 5%: the user asked for small stops, and a 15m setup risking more is a 4h trade
//   confirm      after the gap trades, buy only on the first 15m close back above the gap (within 2 hours)
//   half at 1R   sell half at +1R and move the rest's stop to the entry: fewer, smaller big winners, steadier
const M7 = { htf: ['any'], poi: 'fvgShallow', minRR: 1.5 }, S7 = { ...M7, minRR: 2 };
const V7 = {
  'R7 moderate (reference)': M7,
  'R7 moderate + stop at least 1%': { ...M7, minRisk: 0.01 },
  'R7 moderate + stop 1–5%': { ...M7, minRisk: 0.01, maxRisk: 0.05 },
  'R7 moderate + confirmation close above the gap': { ...M7, entry: 'confirm' },
  'R7 moderate + half at +1R, rest to break-even': { ...M7, half: 1 },
  'R7 strict (reference)': S7,
  'R7 strict + stop at least 1%': { ...S7, minRisk: 0.01 },
  'R7 strict + stop 1–5%': { ...S7, minRisk: 0.01, maxRisk: 0.05 },
  'R7 strict + confirmation close above the gap': { ...S7, entry: 'confirm' },
  'R7 strict + half at +1R, rest to break-even': { ...S7, half: 1 },
};
// ROUND 8 (after round 7: the cost floor helped both versions in both halves; asked after seeing round 7, so it is
// NOT a clean test): does the stop of 1–5% rescue the more frequent versions that broke even or lost in rounds 1–6?
const F8 = { minRisk: 0.01, maxRisk: 0.05 };
const V8 = {
  'R8 pattern alone + stop 1–5%': F8,
  'R8 HTF pool + deepest gap ≥ 3R + stop 1–5%': { ...F8, htf: ['any'] },
  'R8 HTF pool + the first gap paying ≥ 2R + stop 1–5%': { ...F8, htf: ['any'], poi: 'fvgPay', minRR: 2 },
  'R8 HTF pool + the first gap paying ≥ 1.5R + stop 1–5%': { ...F8, htf: ['any'], poi: 'fvgPay', minRR: 1.5 },
  'R8 3-day draw + shallowest gap ≥ 1.5R + stop 1–5%': { ...F8, htf: ['any3'], poi: 'fvgShallow', minRR: 1.5 },
  'R8 no HTF + shallowest gap ≥ 1.5R + stop 1–5%': { ...F8, poi: 'fvgShallow', minRR: 1.5 },
  'R8 swings 2.5 ATR + shallowest gap ≥ 1.5R + stop 1–5%': { ...F8, htf: ['any'], poi: 'fvgShallow', minRR: 1.5, Z: 2.5 },
};
const mode = require.main === module ? process.argv[2] : null;
if (mode === 'run' && process.argv.includes('round8')) { for (const k of Object.keys(V)) delete V[k]; Object.assign(V, V8); }
if (mode === 'run' && process.argv.includes('round7')) { for (const k of Object.keys(V)) delete V[k]; Object.assign(V, V7); }
if (mode === 'run' && process.argv.includes('final')) { for (const k of Object.keys(V)) delete V[k]; Object.assign(V, VF); }
if (mode === 'run' && process.argv.includes('round6')) { for (const k of Object.keys(V)) delete V[k]; Object.assign(V, { base: {} }, V6); }
if (mode === 'run' && process.argv.includes('round5')) { for (const k of Object.keys(V)) delete V[k]; Object.assign(V, { base: {} }, V5); }
if (mode === 'run' && process.argv.includes('round4')) { for (const k of Object.keys(V)) delete V[k]; Object.assign(V, { base: {} }, V4); }
if (mode === 'run' && process.argv.includes('round2')) { for (const k of Object.keys(V)) delete V[k]; Object.assign(V, { base: {} }, V2); }
if (mode === 'run' && process.argv.includes('round3')) { for (const k of Object.keys(V)) delete V[k]; Object.assign(V, { base: {} }, V3); }
if (mode === 'run') {
  fs.mkdirSync(OUT, { recursive: true });
  const t00 = Date.now(), U = universe().slice(0, Number(process.env.LIMIT) || Infinity);
  const btc = prep('BTCUSDT'), btcUp = (t) => { let lo = 0, hi = btc.n - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (btc.T[m] <= t) lo = m; else hi = m - 1; } return btc.up50(lo); };
  const res = Object.fromEntries(Object.keys(V).map((k) => [k, { out: [], ctrl: [] }])), coins = [];
  const rnd = mulberry32(20261108), CTL = ['final', 'round7', 'round8'].some((r) => process.argv.includes(r));
  for (const [ui, [sym, dir]] of U.entries()) {
    const cn = sym === 'BTCUSDT' ? btc : prep(sym, dir); if (!cn) continue;
    const si = coins.length; coins.push({ sym: cn.sym, dead: cn.dead });
    const piv = {};
    for (const [k, v] of Object.entries(V)) {
      const cfg = { ...BASE, ...v }; piv[cfg.Z] = piv[cfg.Z] || zigzag(cn, cfg.Z);
      const r = scan(cn, si, piv[cfg.Z], cfg, btcUp, k === 'base' || CTL ? rnd : null);
      res[k].out.push(...r.out); res[k].ctrl.push(...r.ctrl);
    }
    if (ui % 25 === 0) process.stderr.write(`${ui + 1}/${U.length} ${sym} · ${((Date.now() - t00) / 1000).toFixed(0)}s\n`);
  }
  if (CTL) { for (const k of Object.keys(V)) res[`CONTROL · ${k.split(':')[0]}: same orders at random times`] = { out: res[k].ctrl, ctrl: [] }; }
  else res['CONTROL: same order geometry at random times'] = { out: res.base.ctrl, ctrl: [] };
  const rows = Object.entries(res).map(([k, r]) => ({ k, ...tstats(r.out), port: port(r.out), portIS: port(r.out, T0, SPLIT), portOOS: port(r.out, SPLIT, T1),
    coins: (() => { const m = {}; for (const x of r.out) if (inSpan(x.t)) { (m[x.s] = m[x.s] || { n: 0, s: 0 }); m[x.s].n++; m[x.s].s += x.ret; } const a = Object.values(m).filter((v) => v.n >= 10); return { n: a.length, pos: a.filter((v) => v.s > 0).length }; })() }));
  const f = (x, d = 2) => (x == null || !Number.isFinite(x) ? '—' : (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(d) + '%');
  console.log(`\nCOSTS: ${COSTMODE} · ${coins.length} coins · ${((Date.now() - t00) / 1000).toFixed(0)}s`);
  console.log('variant                                          trades /yr  win   avg/tr  avgR  PF   RR  risk | 2018-21 avg R (n)       2022-26 avg R (n)      | pot ×   CAGR   maxDD | yrs+ coins+');
  for (const r of rows) {
    const yrs = Object.values(r.yrs || {}).filter((v) => v.n >= 10), yp = yrs.filter((v) => v.avg > 0).length;
    console.log(`${r.k.slice(0, 48).padEnd(48)} ${String(r.n).padStart(6)} ${r.n ? r.perYear.toFixed(0).padStart(3) : '   '} ${r.n ? (r.wr * 100).toFixed(0).padStart(3) + '%' : '    '} ${f(r.avg).padStart(7)} ${r.n ? r.avgR.toFixed(2).padStart(5) : ''} ${r.n ? r.pf.toFixed(2).padStart(4) : ''} ${r.n ? r.rr.toFixed(1).padStart(4) : ''} ${r.n ? (r.risk * 100).toFixed(1).padStart(4) + '%' : ''} | ${f(r.is?.avg).padStart(7)} ${r.is?.n ? r.is.R.toFixed(2).padStart(5) : '     '} (${String(r.is?.n ?? 0).padStart(5)})  ${f(r.oos?.avg).padStart(7)} ${r.oos?.n ? r.oos.R.toFixed(2).padStart(5) : '     '} (${String(r.oos?.n ?? 0).padStart(5)}) | ${('×' + r.port.mult.toFixed(2)).padStart(6)} ${f(r.port.cagr, 1).padStart(6)} ${('−' + (r.port.maxDD * 100).toFixed(0) + '%').padStart(5)} | ${yp}/${yrs.length}  ${r.coins.n ? r.coins.pos + '/' + r.coins.n : ''}`);
  }
  console.log('\nvariant                                          IS pot ×  OOS pot × | exits: target % (avg R) · stop % (avg R) · time % (avg R)');
  for (const r of rows) if (r.n) console.log(`${r.k.slice(0, 48).padEnd(48)} ${('×' + r.portIS.mult.toFixed(2)).padStart(7)} ${('×' + r.portOOS.mult.toFixed(2)).padStart(8)} | ${['target', 'stop', 'time'].map((w) => `${w} ${(r.exits[w].share * 100).toFixed(0)}% (${Number.isFinite(r.exits[w].avgR) ? r.exits[w].avgR.toFixed(2) : '—'})`).join(' · ')}`);
  fs.writeFileSync(path.join(OUT, (['round2', 'round3', 'round4', 'round5', 'round6', 'round7', 'round8', 'final'].find((r) => process.argv.includes(r)) || '').replace(/round(\d)/, 'r$1_').replace('final', 'final_') + (COSTMODE === 'spot' ? 'run.json' : `run_${COSTMODE}.json`)), JSON.stringify({ at: new Date().toISOString(), costs: COSTMODE, coins, rows, trades: Object.fromEntries(Object.entries(res).map(([k, r]) => [k, r.out])) }));
}
if (mode === 'report') {
  const J = (f) => JSON.parse(fs.readFileSync(path.join(OUT, f)));
  const runs = {}; for (const r of ['final', 'r7', 'r8']) for (const c of ['', '_gross', '_slip2']) runs[r + c] = J(`${r}_run${c}.json`);
  const RR = { 1: J('run.json'), 2: J('r2_run.json'), 3: J('r3_run.json'), 4: J('r4_run.json'), 5: J('r5_run.json'), 6: J('r6_run.json'), 7: runs.r7, 8: runs.r8 };
  const coins = runs.final.coins, row = (src, k) => src.rows.find((r) => r.k === k);
  const pc = (x, d = 2) => (x == null || !Number.isFinite(x) ? '—' : (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(d) + '%');
  const mean = (a) => (a.length ? a.reduce((q, x) => q + x, 0) / a.length : NaN);
  const o = []; const p = (x = '') => o.push(x);
  const ctl = (k) => `CONTROL · ${k.split(':')[0]}: same orders at random times`;
  const rnd = mulberry32(7);
  const bootLE = (a) => { let le = 0; for (let r = 0; r < 20000; r++) { let s = 0; for (let q = 0; q < a.length; q++) s += a[Math.floor(rnd() * a.length)]; if (s <= 0) le++; } return le / 20000; };
  const bootVs = (a, b) => { let le = 0; for (let r = 0; r < 10000; r++) { let s = 0, u = 0; for (let q = 0; q < a.length; q++) s += a[Math.floor(rnd() * a.length)]; for (let q = 0; q < b.length; q++) u += b[Math.floor(rnd() * b.length)]; if (s / a.length <= u / b.length) le++; } return le / 10000; };
  const span = (x) => x.t >= T0 && x.t < T1, pv = (x) => (x < 0.001 ? '< 0.001' : x.toFixed(3));
  // the versions in the table: [label, run, key]
  const KF = 'R8 HTF pool + the first gap paying ≥ 2R + stop 1–5%', KS = 'R7 strict + stop 1–5%', KM = 'R7 moderate + stop 1–5%', KB = 'pattern alone (round 1 base)';
  const VERS = [['**Final:** the first gap paying ≥ 2R, stop 1–5%', 'r8', KF], ['Selective: the shallowest gap, ≥ 2R, stop 1–5%', 'r7', KS], ['Moderate: the shallowest gap, ≥ 1.5R, stop 1–5%', 'r7', KM],
    ['Before round 7: the shallowest gap ≥ 2R, stops from 0.5%', 'final', 'STRICT: prev-day pool + V-shaped up move (shallowest gap ≥ 2R)'], ['The pattern alone (no HTF context, deepest gap ≥ 3R)', 'final', KB]];
  const D = (run, k) => {
    const T = runs[run].trades[k].filter(span), C = runs[run].trades[ctl(k)].filter(span), r = T.map((x) => x.ret), so = r.slice().sort((x, y) => y - x);
    const live = T.filter((x) => !coins[x.s].dead), dead = T.filter((x) => coins[x.s].dead), oos = T.filter((x) => x.t >= SPLIT);
    return { T, C, r, so, live, dead, oos, s: row(runs[run], k), g: row(runs[run + '_gross'], k), d: row(runs[run + '_slip2'], k), c: row(runs[run], ctl(k)) };
  };
  p('# The user\'s 15m SMC continuation pattern (Nov 2026)');
  p();
  p('Generated by `research/smcpoi/poi_lab.js report`. **Research only: detector.js, the webapp and the bot are unchanged.**');
  p();
  p('**The ask** (with a chart):');
  p('- major higher highs, then a sudden drop and a sudden up move that closes above the last major high;');
  p('- the coin doesn\'t run much, and comes back to a POI inside that up move;');
  p('- trade it with a small stop and high RR, with higher-timeframe liquidity deciding whether to take it;');
  p('- not too few trades;');
  p('- think through the logic, backtest, modify, rethink if needed (e.g. only around the New York open).');
  p();
  p('**The logic.**');
  p('- In a 15m uptrend the stops sit under the last higher low.');
  p('- A sudden drop through it fills big buyers against forced sellers; a sudden close above the last major high shows the drop was a trap.');
  p('- The up move leaves unfilled orders (fair value gaps) that price returns to.');
  p('- Buying there with the stop under the sweep low is cheap risk, and the high of the up move (the buy stops above it) is the target.');
  p('- The known danger is adverse selection: strong moves don\'t come back, so a resting limit fills mostly on the weak ones.');
  p();
  p('**How it was tested.**');
  p('- Data: 273 coins (the user\'s 103 plus 171 delisted or collapsed), full Binance 15m history, 2018-01-01 → 2026-11-05. A coin counts only on days it trades ≥ $5M (30-day average).');
  p('- Fills: a limit buy fills only when price trades below it; on the fill candle the stop counts first and the target cannot fill; stops fill at the stop or a worse open.');
  p('- Costs: 0.1% fee a side, plus 0.05% slippage on stops and timed exits (coins above $100M a day) or 0.15% (the rest).');
  p('- Halves: rules were meant to be chosen on 2018–21 and judged on 2022–26. Every round printed both halves side by side, so 2022–26 is **not a pristine test**; round 8 was designed after seeing round 7.');
  p('- **Control:** every trade\'s exact order (entry depth below the price, stop and target in R) is placed at 20 random times on the same coin.');
  p('- Random numbers come from `research/rng.js` (mulberry32).');
  p('  - The first version of this report drew the controls and bootstraps from a generator that loops after a few thousand draws: `seed * 1103515245` overflows JavaScript\'s 53-bit numbers.');
  p('  - The trades themselves never used it. The controls and p-values here are the corrected ones.');
  p();
  p('## The rules (the final version)');
  p();
  p('1. **Structure.** An ATR zigzag on 15m candles: a swing counts once price reverses 3 × the 15m ATR. The last two swing highs and lows must be rising (higher highs, higher lows). H0 = the last major high, L0 = the higher low before it.');
  p('2. **The drop.** Within 8 hours of H0, price trades below L0 (the sell stops under the higher low).');
  p('3. **The up move.** Within 6 hours of the drop\'s low, a 15m candle CLOSES above H0.');
  p('4. **HTF liquidity (the deciding context).** Either the drop took the previous day\'s low, or the previous day\'s high is still untaken above the up move. Otherwise no trade.');
  p('5. **The POI.** Going down from the top of the up move, the first bullish fair value gap whose middle still pays ≥ 2R to the move\'s high. The limit buy rests at that middle for 12 hours.');
  p('6. **The stop.** 0.1 × the 15m ATR under the sweep low, and only if it is 1–5% below the entry.');
  p('   - Under 1%, the ~0.3% of fees and slippage are a third of the stop or more. Those trades lost in both halves in every version.');
  p('   - Over 5% is not a small stop.');
  p('7. **The exit.** Target: the high of the up move (as of the fill). Out after 24 hours if neither is hit. One trade per coin at a time.');
  p();
  p('## Results');
  p();
  p('| | trades (a year) | win | a trade | before costs | double slippage | 2018–21 | 2022–26 | without the best 5 | the user\'s 103 coins | coins later delisted | pot, 5 slots × 20% | max DD |');
  p('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  const DS = {};
  for (const [lab, run, k] of VERS) {
    const x = DS[k] = D(run, k), s = x.s;
    p(`| ${lab} | ${s.n} (${s.perYear.toFixed(0)}) | ${(s.wr * 100).toFixed(0)}% | ${pc(s.avg)} | ${pc(x.g.avg)} | ${pc(x.d.avg)} | ${pc(s.is.avg)} (${s.is.n}) | ${pc(s.oos.avg)} (${s.oos.n}) | ${pc(mean(x.so.slice(5)))} | ${pc(mean(x.live.map((t) => t.ret)))} (${x.live.length}) | ${pc(mean(x.dead.map((t) => t.ret)))} (${x.dead.length}) | ×${s.port.mult.toFixed(2)} (${pc(s.port.cagr, 1)} a year) | −${(s.port.maxDD * 100).toFixed(0)}% |`);
    p(`| ↳ the same orders at random times | ${x.c.n} | ${(x.c.wr * 100).toFixed(0)}% | ${pc(x.c.avg)} | | | ${pc(x.c.is.avg)} | ${pc(x.c.oos.avg)} | | ${pc(mean(x.C.filter((t) => !coins[t.s].dead).map((t) => t.ret)))} | ${pc(mean(x.C.filter((t) => coins[t.s].dead).map((t) => t.ret)))} | | |`);
  }
  p();
  p('**Odds** (bootstrap, 20,000 resamples of the trades).');
  p();
  p('| | the average trade ≤ 0, all | the same, 2022–26 | the same, the user\'s 103 coins | no better than its random-times control | the same, 2022–26 |');
  p('|---|---|---|---|---|---|');
  for (const [lab, , k] of VERS) { const x = DS[k];
    x.odds = { all: bootLE(x.r), oos: bootLE(x.oos.map((t) => t.ret)), live: bootLE(x.live.map((t) => t.ret)), vs: bootVs(x.r, x.C.map((t) => t.ret)), vsOos: bootVs(x.oos.map((t) => t.ret), x.C.filter((t) => t.t >= SPLIT).map((t) => t.ret)) };
    p(`| ${lab.replace(/\*\*/g, '')} | ${pv(x.odds.all)} | ${pv(x.odds.oos)} | ${pv(x.odds.live)} | ${pv(x.odds.vs)} | ${pv(x.odds.vsOos)} |`); }
  p();
  const F = DS[KF], S = DS[KS];
  {
    const s = F.s, yrs = Object.entries(s.yrs).map(([y, v]) => `${y} ${pc(v.avg)} (${v.n})`).join(' · ');
    const ex = ['target', 'stop', 'time'].map((w) => `${w} ${(s.exits[w].share * 100).toFixed(0)}% (${s.exits[w].avgR >= 0 ? '+' : '−'}${Math.abs(s.exits[w].avgR).toFixed(2)}R)`).join(' · ');
    const top = F.T.slice().sort((a, b) => b.ret - a.ret).slice(0, 5).map((x) => `${coins[x.s].sym}${coins[x.s].dead ? '†' : ''} ${new Date(x.t * 1000).toISOString().slice(0, 10)} ${pc(x.ret, 1)}`).join(' · ');
    const bk = [[0.01, 0.015], [0.015, 0.02], [0.02, 0.03], [0.03, 0.05]].map(([a, b]) => { const f = (z) => z.filter((x) => x.risk >= a && x.risk < b).map((x) => x.ret); return `${(a * 100).toFixed(1)}–${(b * 100).toFixed(1)}%: ${pc(mean(f(F.live)))} (${f(F.live).length}) / ${pc(mean(f(F.dead)))} (${f(F.dead).length})`; }).join(' · ');
    p('**The final version, in detail.**');
    p(`- **Years:** ${yrs}.`);
    p(`- **Exits:** ${ex}. Median trade ${pc(F.so[F.so.length >> 1])}.`);
    p(`- **Coins:** ${new Set(F.T.map((x) => x.s)).size} different. The user\'s 103 coins made ${F.live.length} trades (${(F.live.length / ((T1 - T0) / 31557600)).toFixed(0)} a year) at ${pc(mean(F.live.map((x) => x.ret)))} a trade; the coins later delisted made ${F.dead.length} at ${pc(mean(F.dead.map((x) => x.ret)))}.`);
    p(`- **By stop size,** the user\'s coins / later delisted: ${bk}. No stop size rescues the user\'s coins.`);
    p(`- **Best trades** († = later delisted): ${top}. The best 5 are ${(F.so.slice(0, 5).reduce((q, x) => q + x, 0) / F.r.reduce((q, x) => q + x, 0) * 100).toFixed(0)}% of the net profit.`);
    p();
  }
  p('## How it got there');
  p();
  p('Every round, in order. Rounds 7 and 8 have their own random-times controls.');
  p();
  p('| round | variant | trades a year | a trade | 2018–21 | 2022–26 |');
  p('|---|---|---|---|---|---|');
  const LOG = [[1, 'base'], [1, 'CONTROL: no sweep (any pullback, then the break)'], [1, 'POI: the order block at the base'], [1, 'POI: 79% of the up move'], [1, 'POI: the shallowest gap'], [1, 'target 3R'], [1, 'HTF: the drop took the previous day low'], [1, 'HTF: an untaken previous-day high above'], [1, 'HTF: BTC over its 50-day average'], [1, 'NY: break of structure 08:00–11:00 ET'],
    [2, 'R2: HTF liquidity (prev-day low taken OR prev-day high above)'], [2, 'R2 + the shallowest gap, ≥ 2R'], [2, 'R2 + New York morning (break 08:00–11:00 ET)'], [3, 'R3: the shallowest gap that pays ≥ 2R (engine rule)'], [3, 'R3 + smaller swings (2 ATR)'],
    [4, 'R4 at ≥ 1.5R'], [4, 'R4 without the HTF context'], [4, 'R4 + 3-day high as the draw'], [4, 'R4 + New York morning'], [5, 'R5 + stop under the gap (small stop, high RR)'], [5, 'R5 + 3-day draw + slower + swings 2.5'], [6, 'R6: either 4h pool'],
    [7, 'R7 strict + stop at least 1%'], [7, 'R7 strict + stop 1–5%'], [7, 'R7 strict + confirmation close above the gap'], [7, 'R7 strict + half at +1R, rest to break-even'], [7, 'R7 moderate + stop at least 1%'], [7, 'R7 moderate + stop 1–5%'], [7, 'R7 moderate + confirmation close above the gap'], [7, 'R7 moderate + half at +1R, rest to break-even'],
    [8, 'R8 pattern alone + stop 1–5%'], [8, 'R8 HTF pool + deepest gap ≥ 3R + stop 1–5%'], [8, KF], [8, 'R8 HTF pool + the first gap paying ≥ 1.5R + stop 1–5%'], [8, 'R8 3-day draw + shallowest gap ≥ 1.5R + stop 1–5%'], [8, 'R8 no HTF + shallowest gap ≥ 1.5R + stop 1–5%'], [8, 'R8 swings 2.5 ATR + shallowest gap ≥ 1.5R + stop 1–5%']];
  for (const [r, k] of LOG) { const x = row(RR[r], k); if (!x) throw new Error('missing row ' + k); p(`| ${r} | ${k} | ${x.perYear.toFixed(0)} | ${pc(x.avg)} | ${pc(x.is.avg)} (${x.is.n}) | ${pc(x.oos.avg)} (${x.oos.n}) |`); }
  p();
  p('## Verdict');
  p();
  const B = DS[KB];
  p('**The pattern is real.**');
  p(`- The same orders at random times lose ${pc(-B.c.avg).slice(1)} a trade, and the bare pattern does ${pc(B.s.avg - B.c.avg).slice(1)} better.`);
  p(`- With the HTF context, the first paying gap and a 1–5% stop, it beats its random-times control by ${pc(F.s.avg - F.c.avg).slice(1)} a trade, in both halves.`);
  p();
  p('**What made it pay, in the order found:**');
  p('1. **The HTF liquidity context.** The drop took yesterday\'s low, or yesterday\'s high waits above.');
  p('2. **A V-shaped up move bought at its first gap.** The quality sits in moves whose gaps are all low: a sharp V off the sweep low, then a clean run through H0.');
  p('3. **A stop of at least 1%.** On 15m candles the fees and slippage are fixed in %, so a small stop is mostly cost. The user\'s "small stop" works here only as "1–5%".');
  p();
  p('**What failed:**');
  p('- The stop under the gap: stopped out ~80% of the time.');
  p('- Deep POIs (the order block, 79%): they fill on the moves that fail.');
  p('- Fixed 2R/3R/5R targets.');
  p('- Only the New York morning: it cuts trades without adding edge.');
  p('- 4h pools as the context: they almost never filter.');
  p('- A confirmation close above the gap: far fewer trades, weaker on 2022–26.');
  p('- Selling half at +1R: the win rate rises to 56–63%, but the money falls.');
  p();
  p(`**Why it is not worth adding.**`);
  p(`- **It makes its money on coins that were later delisted.** On the user's 103 coins the final version made ${F.live.length} trades at ${pc(mean(F.live.map((x) => x.ret)))} a trade: the pattern still beats random there (${pc(-mean(F.C.filter((t) => !coins[t.s].dead).map((t) => t.ret))).slice(1)} lost a trade at random times), but only back to zero after costs. Every version earns far less on the user's coins. The best there, the selective version, made ${pc(mean(S.live.map((x) => x.ret)))} a trade on only ${S.live.length} trades (a ${(S.odds.live * 100).toFixed(0)}% chance the true average is ≤ 0).`);
  p(`- **It is small.** Across all 273 coins, at 20% of the pot a trade, it adds ${pc(F.s.port.cagr, 1)} a year (max drawdown −${(F.s.port.maxDD * 100).toFixed(0)}%). The selective version earns more a trade (${pc(S.s.avg)}) but trades ${S.s.perYear.toFixed(0)} times a year, ${S.live.length} times on the user's coins in ${((T1 - T0) / 31557600).toFixed(1)} years.`);
  p('- **Many rules were tried** (about 80 variants in 8 rounds), and 2022–26 was in view the whole time.');
  p('- **The bot can\'t run it as is.** It needs a limit order placed within minutes of a 15m close, and GitHub runs the bot hours late.');
  process.stdout.write(o.join('\n') + '\n');
}
module.exports = { prep, zigzag, scan, ride, tstats, port, BASE, V, universe };
