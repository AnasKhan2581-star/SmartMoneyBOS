// `cycle` (BTC halving playbook) rebuilt with switches, so each fix can be measured on its own.
//   node research/cycle/cycle_lab.js parity [1d|4h]        — lab, all switches off == the PRE-rebuild engine
//                                                             (detector.js at 7a0ad64, read from git), trade-for-trade
//   node research/cycle/cycle_lab.js parity-final [1d|4h]  — lab, SHIPPED switches == today's detector.js
//   require('./cycle_lab.js') from cycle_report.js    — the study (RESULTS_cycle_2026-10.md)
//
// Engine semantics mirrored exactly from detector.js runQuant (cycle branch): day-denominated
// lookbacks S(days), warm-up S(200), fills at the signal close, intrabar stop on the low.
// Switches (all off = today's engine, bugs included):
//   fix:        the stop is checked on the bar's low BEFORE any same-bar tranche fill, fills at
//               min(open, stop) when the bar opens through it, and no zone entry is taken when
//               the program stop is already at or above the price (the "imaginary profit" bug).
//   floor:      what a zone entry does when price is already below the 0.65×200w program stop:
//               'skip' = wait until price is back above it, 'rel' = enter with a −28% stop
//               (the engine's own no-200w fallback). Only read when fix is on.
//   trendStop:  TREND positions also exit at once on a close below trendStop × 40w MA (0 = off).
//   lockout:    after a STOP, no new zone entry until price closes back above the 40w MA.
//   btc:        BTC's own cycle state aligned to this coin's bars (btcAlign) — for alts only:
//   gate:       'trend' = TREND entries need BTC above its 40w MA; 'both' = also zone entries
//               need BTC in its buy zone (score ≥ 2) or above its 40w MA.
//   btcExit:    a TREND position also exits when BTC has closed below 0.97 × its 40w MA for
//               the persistence window (BTC's own bear signal).
//   floor72:    zone entries also need price ≥ 0.72 × 200w MA — the floor of zone B as documented.
//   noAccum:    zone (deep-value) entries are skipped — TREND entries only (for alts).
//   exitMa:     TREND exit MA in days (default 280 = 40 weeks); e.g. 140 = 20 weeks.
//   trail:      TREND positions also exit on a close below (1 − trail) × the highest close since entry.
//   scaleAt:    sell HALF of a TREND position at the first close ≥ scaleAt × 200-day MA (the chart's
//               red SELL ZONE starts at 1.85×); the rest rides the normal exits.
//   scaleMinGain: ...and only once price is at least this far above the entry (0 = never below entry).
//   waitBtc:    an alt's ACCUM program completes on the 40w reclaim only once BTC has left its bear signal.
//   fastExit:   once the close has reached fastExit × the 200-day MA during the position
//               (Mayer euphoria), exit on the first close below the 20-week MA.
'use strict';
const fs = require('fs'), path = require('path');
const CACHE = path.join(__dirname, '..', 'cache');
const FEE = 0.001;

function load(coin, tf) {
  const f = path.join(CACHE, `${coin}_${tf}.json`);
  if (!fs.existsSync(f)) return null;
  return JSON.parse(fs.readFileSync(f)).map((r) => ({ time: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] }));
}

function indicators(c) {
  const n = c.length, dt = n > 1 ? Math.max(60, c[1].time - c[0].time) : 86400, bpd = 86400 / dt;
  const S = (d) => Math.max(2, Math.round(d * bpd));
  const closes = c.map((x) => x.close);
  const sma = (len) => {
    const out = new Array(n).fill(NaN); let s = 0;
    for (let i = 0; i < n; i++) { s += closes[i]; if (i >= len) s -= closes[i - len]; if (i >= len - 1) out[i] = s / len; }
    return out;
  };
  const maL = sma(S(200)), ma111 = sma(S(111)), ma350 = sma(S(350)), ma280 = sma(S(280)), ma1400 = sma(S(1400)), ma140 = sma(S(140));
  const step = Math.max(1, S(7)), wRSI = new Array(n).fill(NaN);
  let g = 0, ls = 0, k = 0, lastR = NaN;
  for (let i = step; i < n; i += step) {
    const ch = closes[i] - closes[i - step];
    g = (g * 13 + Math.max(ch, 0)) / 14; ls = (ls * 13 + Math.max(-ch, 0)) / 14; k++;
    if (k >= 14) lastR = 100 - 100 / (1 + (ls > 0 ? g / ls : 100));
    for (let j = i; j < Math.min(i + step, n); j++) wRSI[j] = lastR;
  }
  const swp = new Array(n).fill(false), h20 = new Array(n).fill(Infinity);
  const wA = S(120), wB = S(10), w20 = S(20);
  for (let i = wA + wB; i < n; i++) {
    let prior = Infinity;
    for (let j = i - wA; j < i - wB; j++) if (c[j].low < prior) prior = c[j].low;
    if (c[i].low < prior && c[i].close > prior) swp[i] = true;
  }
  for (let i = 1; i < n; i++) { let h = 0; for (let j = Math.max(0, i - w20); j < i; j++) if (c[j].high > h) h = c[j].high; h20[i] = h; }
  const zone = (i) => ((closes[i] < 1.1 * ma1400[i]) ? 1 : 0) + ((closes[i] / maL[i] < 0.8) ? 1 : 0) + ((wRSI[i] < 35) ? 1 : 0);
  const pi = (i) => i > 0 && ma111[i] > 2 * ma350[i] && ma111[i - 1] <= 2 * ma350[i - 1];
  return { smaDays: (d) => sma(S(d)), n, bpd, S, dt, closes, maL, ma111, ma350, ma280, ma140, ma1400, wRSI, swp, h20, zone, pi, warm: S(200), persist: Math.max(1, S(5)) };
}

// Sub-daily candles → UTC-day candles that remember their first/last native bar. The cycle machine is
// a DAILY system: run on these, then mapped back (onNative), 4h and 1d produce the same trades.
function toDaily(c) {
  const out = [];
  for (let i = 0; i < c.length; i++) {
    const day = Math.floor(c[i].time / 86400) * 86400, d = out[out.length - 1];
    if (!d || d.time !== day) out.push({ time: day, open: c[i].open, high: c[i].high, low: c[i].low, close: c[i].close, volume: c[i].volume, first: i, last: i });
    else { if (c[i].high > d.high) d.high = c[i].high; if (c[i].low < d.low) d.low = c[i].low; d.close = c[i].close; d.volume += c[i].volume; d.last = i; }
  }
  return out;
}
// daily-run trades → native bar indices; a STOP lands on the first native bar that touched it
function onNative(c, days, run) {
  const map = (t) => {
    const fills = t.fills.map((f) => ({ ...f, i: days[f.i].last }));
    let exitIdx = days[t.exitIdx].last, exitPrice = t.exitPrice;
    if (t.why === 'STOP') {
      for (let k = days[t.exitIdx].first; k <= days[t.exitIdx].last; k++) if (c[k].low <= t.stop) { exitIdx = k; exitPrice = Math.min(c[k].open, t.stop); break; }
    }
    return { ...t, fills, entryIdx: days[t.entryIdx].last, exitIdx, exitPrice, scale: t.scale ? { ...t.scale, i: days[t.scale.i].last } : null };
  };
  return { trades: run.trades.map(map), open: run.open ? map(run.open) : null };
}

// BTC's cycle state read at the last BTC candle CLOSED by each coin candle's close (nothing leaks forward).
function btcAlign(c, ind, Bc, Bi) {
  const n = c.length, dB = Bi.dt, bull = new Array(n).fill(false), zone2 = new Array(n).fill(false), riskOff = new Array(n).fill(false);
  const dn = new Array(Bc.length).fill(0);
  for (let j = 0; j < Bc.length; j++) dn[j] = Bc[j].close < 0.97 * Bi.ma280[j] ? (j ? dn[j - 1] : 0) + 1 : 0;
  for (let i = 0, j = -1; i < n; i++) {
    while (j + 1 < Bc.length && Bc[j + 1].time + dB <= c[i].time + ind.dt) j++;
    if (j < 0) continue;
    bull[i] = Bc[j].close > Bi.ma280[j]; zone2[i] = Bi.zone(j) >= 2; riskOff[i] = dn[j] >= Bi.persist;
  }
  return { bull, zone2, riskOff };
}

// Positions carry their tranche fills [{i, w, px}] so the equity can be marked honestly.
function simulate(c, ind, o = {}) {
  const { n, closes, ma280, ma1400, swp, h20, zone, pi, warm, persist, maL, ma140 } = ind;
  const trades = [];
  const B = o.btc || null;
  const gTrend = (i) => !B || !o.gate || B.bull[i];
  const gZone = (i) => !B || o.gate !== 'both' || B.bull[i] || B.zone2[i];
  if (n < warm + 2) return { trades, open: null };
  let pos = null, cyUp = 0, cyDn = 0, cyCool = false, cyMode = null, locked = false, exitDn = 0;
  const maX = o.exitMa && o.exitMa !== 280 ? ind.smaDays(o.exitMa) : null;
  const fill = (i, w, price) => { pos.fills.push({ i, w, px: price }); pos.invSum += w / price; pos.fracSum += w; pos.entry = pos.fracSum / pos.invSum; };
  const close = (i, px, why) => { trades.push({ ...pos, exitIdx: i, exitPrice: px, why }); pos = null; cyMode = null; };
  const progStop = (i, px) => (isFinite(ma1400[i]) ? 0.65 * ma1400[i] : px * 0.72);
  for (let i = warm; i < n; i++) {
    const px = closes[i];
    const above = px > ma280[i] * 1.02, below = px < ma280[i] * 0.97;
    cyUp = above ? cyUp + 1 : 0; cyDn = below ? cyDn + 1 : 0;
    exitDn = maX ? (px < maX[i] * 0.97 ? exitDn + 1 : 0) : cyDn;
    if (pos) pos.peak = Math.max(pos.peak || 0, px);
    if (cyCool && px < ma280[i]) cyCool = false;
    if (locked && px > ma280[i]) locked = false;
    const zoneB = px < 0.97 * ma1400[i];
    if (pos && o.fastExit && px >= o.fastExit * maL[i]) pos.euph = true;
    if (pos) {
      if (pi(i)) { close(i, px, 'PI-TOP'); cyCool = true; continue; }
      if (cyMode === 'ACCUM') {
        if (o.fix) {
          // the low happened before the close: a stop hit this bar ends the program first
          if (c[i].low <= pos.stop) { close(i, Math.min(c[i].open, pos.stop), 'STOP'); if (o.lockout) locked = true; continue; }
          if (!pos.t2 && zoneB && (swp[i] || px > closes[i - 1]) && !(o.floor72 && px < 0.72 * ma1400[i])) {
            fill(i, 0.4, px); pos.t2 = true;
            const s = progStop(i, px); pos.stop = s < px ? s : pos.stop;   // never move a stop above the price
          }
          if (px > ma280[i] && !(o.waitBtc && B && B.riskOff[i])) { if (pos.fracSum < 1) fill(i, 1 - pos.fracSum, px); cyMode = 'TREND'; }
        } else {
          if (!pos.t2 && zoneB && (swp[i] || px > closes[i - 1])) { fill(i, 0.4, px); pos.t2 = true; pos.stop = progStop(i, px); }
          if (c[i].low <= pos.stop) { close(i, pos.stop, 'STOP'); if (o.lockout) locked = true; }
          else if (px > ma280[i]) { if (pos.fracSum < 1) fill(i, 1 - pos.fracSum, px); cyMode = 'TREND'; }
        }
      } else if (o.scaleAt && !pos.scale && px >= o.scaleAt * maL[i] && px >= (o.scaleMinGain != null ? 1 + o.scaleMinGain : 0) * pos.entry) pos.scale = { i, px, w: 0.5 };
      else if (o.trendStop > 0 && px < o.trendStop * ma280[i]) close(i, px, 'TREND-BRK');
      else if (pos.euph && px < ma140[i]) close(i, px, 'EUPH-20W');
      else if (o.trail && px < (1 - o.trail) * pos.peak) close(i, px, 'TRAIL');
      else if ((exitDn >= persist)) close(i, px, 'TREND');
      else if (B && o.btcExit && B.riskOff[i]) close(i, px, 'BTC-BEAR');
    } else if (!locked && !o.noAccum && zone(i) >= 2 && (swp[i] || px > h20[i]) && gZone(i)) {
      let stop = progStop(i, px);
      if (o.floor72 && isFinite(ma1400[i]) && px < 0.72 * ma1400[i]) continue;   // under zone B: outside the playbook
      if (o.fix && stop >= px) {
        if (o.floor === 'rel') stop = px * 0.72;
        else continue;                                       // 'skip': below the floor → wait
      }
      pos = { fills: [], invSum: 0, fracSum: 0, entry: px, stop, entryIdx: i, t2: zoneB, mode0: 'ACCUM' };
      fill(i, zoneB ? 0.8 : 0.4, px);
      cyMode = 'ACCUM';
    } else if (!cyCool && cyUp >= persist && gTrend(i)) {
      pos = { fills: [], invSum: 0, fracSum: 0, entry: px, stop: ma280[i] * 0.97, entryIdx: i, mode0: 'TREND' };
      fill(i, 1, px);
      cyMode = 'TREND';
    }
  }
  return { trades, open: pos ? { ...pos, exitIdx: n - 1, exitPrice: closes[n - 1], why: 'OPEN' } : null };
}

// Honest money: all-in program capital P = equity at the first fill; tranche k spends w_k·P at
// its own price (0.1% fee), the undeployed rest stays cash; every bar is marked to market.
function equity(c, ind, run, from) {
  const { n } = ind, w0 = Math.max(ind.warm, from || 0);
  const all = run.trades.concat(run.open ? [run.open] : []).filter((t) => t.entryIdx >= w0);
  const eq = new Array(n).fill(NaN);
  let e = 1, inMkt = 0, gp = 0, gl = 0, wins = 0, losses = 0, ti = 0;
  for (let i = w0; i < n; i++) {
    const t = all[ti];
    if (t && i === t.entryIdx) {
      const P = e; let cash = P, units = 0, k = 0;
      for (let j = t.entryIdx; j <= t.exitIdx; j++) {
        while (k < t.fills.length && t.fills[k].i === j) { const f = t.fills[k++]; cash -= f.w * P; units += f.w * P / (f.px * (1 + FEE)); }
        if (t.scale && t.scale.i === j && j < t.exitIdx) { const u = units * t.scale.w; cash += u * t.scale.px * (1 - FEE); units -= u; }
        eq[j] = j === t.exitIdx ? cash + units * t.exitPrice * (1 - FEE) : cash + units * c[j].close;
        inMkt++;
      }
      const pl = eq[t.exitIdx] - P;
      if (t.why !== 'OPEN') { if (pl >= 0) { gp += pl; wins++; } else { gl -= pl; losses++; } }
      e = eq[t.exitIdx]; i = t.exitIdx; ti++;                // the loop's i++ steps past the exit bar
    } else eq[i] = e;
  }
  let pk = 1, dd = 0;
  for (let i = w0; i < n; i++) { pk = Math.max(pk, eq[i]); dd = Math.max(dd, 1 - eq[i] / pk); }
  let bpk = c[w0].close, bdd = 0;
  for (let i = w0; i < n; i++) { bpk = Math.max(bpk, c[i].close); bdd = Math.max(bdd, 1 - c[i].close / bpk); }
  const yrs = (c[n - 1].time - c[w0].time) / 31557600;
  const net = e - 1, bh = c[n - 1].close / c[w0].close - 1;
  return { trades: wins + losses, wins, wr: wins + losses ? wins / (wins + losses) : 0, pf: gl > 0 ? gp / gl : (gp > 0 ? Infinity : 0),
    net, cagr: e > 0 ? Math.pow(e, 1 / Math.max(yrs, 0.1)) - 1 : -1, dd, bh, bdd, edge: (1 + net) / (1 + bh) - 1,
    expo: inMkt / Math.max(1, n - w0), yrs, eq, open: !!run.open && run.open.entryIdx >= w0 };
}

module.exports = { load, indicators, simulate, equity, btcAlign, toDaily, onNative, FEE };

// The shipped rules, as lab switches — detector.js must match these trade-for-trade (parity-final).
const SHIPPED = { fix: true, floor: 'skip', floor72: true, gate: 'both', btcExit: true, scaleAt: 1.85, scaleMinGain: 0 };
module.exports.SHIPPED = SHIPPED;

if (require.main === module && process.argv[2] === 'parity-final') {
  const SMC = require('../../detector.js');
  const tf = process.argv[3] || '1d';
  const coins = process.argv.slice(4).length ? process.argv.slice(4) : ['BTC', 'ETH', 'BNB', 'XRP', 'ADA', 'DOGE', 'LINK', 'LTC', 'TRX', 'SOL', 'AVAX', 'DOT'];
  const B1 = load('BTC', '1d'), B1i = indicators(B1);
  let bad = 0, total = 0;
  for (const coin of coins) {
    const c = load(coin, tf); if (!c) { console.log(coin, 'no data'); continue; }
    const r = SMC.detectAll(c, { strategy: 'cycle', longOnly: true, btcD: coin === 'BTC' ? 'self' : B1 });
    const d = tf === '1d' ? c : toDaily(c), ind = indicators(d);
    const o = coin === 'BTC' ? { ...SHIPPED, gate: null, btcExit: false } : { ...SHIPPED, btc: btcAlign(d, ind, B1, B1i) };
    const run = simulate(d, ind, o), nat = tf === '1d' ? run : onNative(c, d, run);
    const lab = nat.trades.concat(nat.open ? [nat.open] : []), eng = r.trades;
    let ok = lab.length === eng.length;
    for (let k = 0; ok && k < lab.length; k++) {
      const a = lab[k], b = eng[k];
      const aExit = a.scale ? a.scale.w * a.scale.px + (1 - a.scale.w) * a.exitPrice : a.exitPrice;
      ok = a.entryIdx === b.entryIdx && a.exitIdx === b.exitIdx && Math.abs(a.entry / b.entry - 1) < 1e-9
        && Math.abs(aExit / b.exitPrice - 1) < 1e-9 && Math.abs(a.fracSum - b.frac) < 1e-9
        && (a.why === b.targetPool) && (!a.scale === !b.scale) && (!a.scale || (a.scale.i === b.scale.idx && Math.abs(a.scale.px / b.scale.px - 1) < 1e-9));
      if (!ok) console.log('  first diff at trade', k, JSON.stringify({ lab: [a.entryIdx, a.exitIdx, a.entry, aExit, a.fracSum, a.why, a.scale], eng: [b.entryIdx, b.exitIdx, b.entry, b.exitPrice, b.frac, b.targetPool, b.scale] }));
    }
    total++; if (!ok) bad++;
    console.log(`${coin.padEnd(5)} ${tf}: engine ${eng.length} trades, lab ${lab.length} — ${ok ? 'MATCH' : 'DIFF'}`);
  }
  console.log(bad ? `${bad}/${total} DIFFER` : `ALL ${total} MATCH detector.js (shipped rules)`);
}

// the engine as it was before the Oct 2026 rebuild, straight from git, so the "old" parity stays checkable
function oldEngine() {
  const os = require('os'), { execSync } = require('child_process');
  const f = path.join(os.tmpdir(), 'detector_7a0ad64.js');
  if (!fs.existsSync(f)) fs.writeFileSync(f, execSync('git show 7a0ad64:detector.js', { cwd: path.join(__dirname, '..', '..') }));
  return require(f);
}
module.exports.oldEngine = oldEngine;

if (require.main === module && process.argv[2] === 'parity') {
  const SMC = oldEngine();
  const tf = process.argv[3] || '1d';
  const coins = ['BTC', 'ETH', 'BNB', 'XRP', 'ADA', 'DOGE', 'LINK', 'LTC', 'TRX', 'SOL', 'AVAX', 'DOT'];
  let bad = 0, total = 0;
  for (const coin of coins) {
    const c = load(coin, tf); if (!c) { console.log(coin, 'no data'); continue; }
    const r = SMC.detectAll(c, { strategy: 'cycle', longOnly: true });
    const ind = indicators(c), run = simulate(c, ind, {});
    const lab = run.trades.concat(run.open ? [run.open] : []);
    const eng = r.trades;
    let ok = lab.length === eng.length;
    for (let k = 0; ok && k < lab.length; k++) {
      const a = lab[k], b = eng[k];
      ok = a.entryIdx === b.entryIdx && a.exitIdx === b.exitIdx && Math.abs(a.entry / b.entry - 1) < 1e-9
        && Math.abs(a.exitPrice / b.exitPrice - 1) < 1e-9 && Math.abs(a.fracSum - (b.frac || 1)) < 1e-9
        && (a.why === b.targetPool || (a.why === 'OPEN' && b.outcome === 'open'));
      if (!ok) console.log('  first diff at trade', k, JSON.stringify({ lab: [a.entryIdx, a.exitIdx, a.entry, a.exitPrice, a.fracSum, a.why], eng: [b.entryIdx, b.exitIdx, b.entry, b.exitPrice, b.frac, b.targetPool] }));
    }
    total++; if (!ok) bad++;
    console.log(`${coin.padEnd(5)} ${tf}: engine ${eng.length} trades, lab ${lab.length} — ${ok ? 'MATCH' : 'DIFF'}`);
  }
  console.log(bad ? `${bad}/${total} DIFFER` : `ALL ${total} MATCH the pre-rebuild detector.js (7a0ad64)`);
}
