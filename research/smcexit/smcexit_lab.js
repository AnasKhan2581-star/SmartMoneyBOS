// liqbrk exits: the shipped "half at +3R, rest on the 4×ATR stop / 1-day-low trail" vs SMC profit-taking
// at resting buy-side liquidity (BSL: unswept swing highs above) and major bearish FVGs (supply POIs).
//   node research/smcexit/smcexit_lab.js parity     — this simulator == liqbrk_lab's shipped exit, trade-for-trade
//   require from smcexit_report.js                   — the study (RESULTS_smcexit_2026-10.md)
//
// Every SMC level is used only from the bar on which it was KNOWN:
//   • a swing high (the engine's zigzag: a 4×ATR reversal, DEFAULTS.extMult) is known at the bar that
//     confirmed the reversal, not at the high itself — the engine's own detectPivots does not keep that
//     bar, so the zigzag is re-run here with it;
//   • a BSL level stays live until a later wick trades above it (swept);
//   • a bearish FVG (3-candle gap down: low[i−1] > high[i+1]) is known at the close of bar i+1, is "major"
//     when its height is ≥ 0.5 × ATR (DEFAULTS.fvgMult), and stays live until a later bar trades into it.
'use strict';
const path = require('path'), fs = require('fs');
const L = require('../liqbrk_lab.js');
const P = L.P;
const CACHE = path.join(__dirname, '..', 'cache');

// 4h straight from the full-history 4h file when there is one (the alert coins), else 2h aggregated
function load4h(coin) {
  const f = path.join(CACHE, `${coin}_4h.json`);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f)).map((r) => ({ time: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] }));
  return fs.existsSync(path.join(CACHE, `${coin}_2h.json`)) ? L.load(coin, '4h') : null;
}

function levels(c, a) {
  const n = c.length, piv = [];
  let trend = null, hi = { price: c[0].high, i: 0 }, lo = { price: c[0].low, i: 0 };
  for (let i = 1; i < n; i++) {                       // detector.detectPivots, plus the confirming bar
    const noise = P.extMult * a[i];
    if (trend === null) {
      if (c[i].high > hi.price) hi = { price: c[i].high, i };
      if (c[i].low < lo.price) lo = { price: c[i].low, i };
      if (hi.price - c[i].low > noise) { trend = 'down'; piv.push({ kind: 'H', i: hi.i, price: hi.price, conf: i }); lo = { price: c[i].low, i }; }
      else if (c[i].high - lo.price > noise) { trend = 'up'; lo = { price: c[i].low, i }; hi = { price: c[i].high, i }; }
      continue;
    }
    if (trend === 'up') {
      if (c[i].high > hi.price) hi = { price: c[i].high, i };
      if (hi.price - c[i].low > noise) { piv.push({ kind: 'H', i: hi.i, price: hi.price, conf: i }); trend = 'down'; lo = { price: c[i].low, i }; }
    } else {
      if (c[i].low < lo.price) lo = { price: c[i].low, i };
      if (c[i].high - lo.price > noise) { trend = 'up'; hi = { price: c[i].high, i }; }
    }
  }
  // BSL: each confirmed swing high, live from `conf` until the first later wick above it
  const bsl = piv.map((p) => { let sw = n; for (let j = p.i + 1; j < n; j++) if (c[j].high > p.price) { sw = j; break; } return { price: p.price, conf: p.conf, end: sw }; });
  // major bearish FVGs, live from the close of bar i+1 until a later bar trades up into the gap
  const fvg = [];
  for (let i = 1; i < n - 1; i++) {
    if (!(c[i - 1].low > c[i + 1].high)) continue;
    const top = c[i - 1].low, bottom = c[i + 1].high;
    if (top - bottom < P.fvgMult * a[i]) continue;
    let tap = n; for (let j = i + 2; j < n; j++) if (c[j].high >= bottom) { tap = j; break; }
    fvg.push({ price: bottom, top, conf: i + 1, end: tap });
  }
  // PLACEBO for the reaction tests: every major FVG moved 1–2 ATR up or down (seeded), so the fake levels
  // keep the real ones' count, timing and rough distance but sit where no supply zone is
  let seed = 12345 + n;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const fake = fvg.map((q) => {
    const px = q.price + (rnd() < 0.5 ? -1 : 1) * (1 + rnd()) * a[q.conf];
    let tap = n; for (let j = q.conf + 1; j < n; j++) if (c[j].high >= px) { tap = j; break; }
    return { price: px, conf: q.conf, end: tap };
  });
  return { bsl, fvg, fake };
}
// the nearest live level at bar t at or above `floor`
const nearest = (list, t, floor) => { let best = Infinity; for (const q of list) if (q.conf <= t && q.end > t && q.price >= floor && q.price < best) best = q.price; return isFinite(best) ? best : null; };

// cfg.exit:  'scale3R' (shipped) | 'half' (half at the SMC target, else at +3R) | 'all' (everything at the target, else shipped)
// cfg.k:     with 'scale3R', the fixed multiple (default 3) — the distance-matched control for an SMC target
// cfg.src:   'bsl' | 'fvg' | 'poi' (nearer of the two) — where the target comes from, fixed at entry
// cfg.minR:  a target closer than entry + minR·R is skipped for the next one up (0 = take the nearest)
// cfg.draw:  CONTROL for 'half'/'all' — a function returning a target distance in R (null = no level), used
//            instead of the chart: fed the same coin's SMC distances shuffled, it keeps how far the targets
//            sit but drops WHERE the structure is
// cfg.react: '' | 'sweep' (rest also exits on a close back below a BSL level that bar wicked through)
//                | 'reject' (rest also exits on a close back below a major bearish FVG that bar traded into)
//                | 'placebo' ('reject' on the fake levels: same count and timing, 1–2 ATR away from any real FVG)
// fills are honest as in liqbrk_lab: next bar's open ± slippage, 0.1% fee a side; stop checked first
function simulate(c, ind, lv, cfg = {}) {
  const { a, loE, sig, warm, p } = ind, n = c.length;
  const slip = cfg.slip ?? 0.0005, fee = 0.001, exit = cfg.exit || 'scale3R', minR = cfg.minR ?? 0;
  const trades = []; let pos = null;
  const sellPx = (px) => px * (1 - slip);
  const done = (i, px, why) => {
    const legs = pos.legs.concat([{ w: pos.w, px, i }]);
    const gross = legs.reduce((s, l) => s + l.w * l.px, 0) / pos.entry;
    const net = legs.reduce((s, l) => s + l.w * (l.px * (1 - fee)) / (pos.entry * (1 + fee)), 0) - 1;
    trades.push({ entryIdx: pos.entryIdx, exitIdx: i, fee, entry: pos.entry, stop: pos.stop0, exit: px, why, ret: net, gross: gross - 1,
      R: (gross * pos.entry - pos.entry) / (pos.entry - pos.stop0), legs, target: pos.target, hiC: pos.hiC });
    pos = null;
  };
  const target = (t, entry, R) => {
    const floor = entry + minR * R;
    const b = cfg.src === 'fvg' ? null : nearest(lv.bsl, t, Math.max(floor, entry * 1.000001));
    const f = cfg.src === 'bsl' ? null : nearest(lv.fvg, t, Math.max(floor, entry * 1.000001));
    return b == null ? f : f == null ? b : Math.min(b, f);
  };
  for (let i = warm; i < n; i++) {
    const b = c[i];
    if (pos && i >= pos.entryIdx) {
      if (pos.pendingExit) { done(i, sellPx(b.open), pos.pendingExit); continue; }
      if (b.close > pos.hiC) pos.hiC = b.close;
      if (b.low <= pos.stop) { done(i, sellPx(Math.min(b.open, pos.stop)), 'STOP'); continue; }
      const T = exit === 'scale3R' ? pos.entry + (cfg.k || 3) * pos.R : (pos.target != null ? pos.target : pos.entry + 3 * pos.R);   // no level: shipped
      if (T != null && pos.w === 1 && b.high >= T) {
        const px = sellPx(Math.max(b.open, T));
        if (exit === 'all' && pos.target != null) { done(i, px, 'TARGET'); continue; }
        pos.legs.push({ w: 0.5, px, i }); pos.w = 0.5;
      }
      let why = null;
      if (b.close < loE[i]) why = 'TRAIL';
      if (!why && cfg.react === 'sweep') {            // wicked through resting BSL above the entry, closed back below it
        for (const q of lv.bsl) if (q.conf < i && q.end === i && q.price > pos.entry && b.close < q.price) { why = 'SWEEP'; break; }
      }
      if (!why && (cfg.react === 'reject' || cfg.react === 'placebo')) {   // traded up into a fresh supply FVG, closed back below it
        for (const q of (cfg.react === 'placebo' ? lv.fake : lv.fvg)) if (q.conf < i && q.end === i && q.price > pos.entry && b.close < q.price) { why = 'REJECT'; break; }
      }
      if (why) { if (i + 1 < n) pos.pendingExit = why; else done(i, sellPx(b.close), why); }
    } else if (!pos && sig[i] && (!cfg.veto || cfg.veto[i]) && i + 1 < n) {
      const e = c[i + 1].open * (1 + slip), stop = e - p.lbStop * a[i];
      pos = { entry: e, stop, stop0: stop, R: e - stop, entryIdx: i + 1, hiC: e, w: 1, legs: [] };
      const k = cfg.draw && exit !== 'scale3R' ? cfg.draw() : undefined;
      pos.target = exit === 'scale3R' ? null : k !== undefined ? (k == null ? null : e + k * pos.R)
        : target(i, e, pos.R);                                         // the draw on liquidity, as known at the signal close
    }
  }
  return { trades, open: pos ? { ...pos } : null };
}

// the bot's 4h coins (signals/watchlist.json)
const alertCoins = () => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'signals', 'watchlist.json'))).watch
  .filter((w) => w.tf === '4h').map((w) => w.symbol.replace(/USDT$/, ''));

// with exit 'scale3R' this simulator must be liqbrk_lab's shipped exit on honest fills, trade for trade
function parity() {
  const BTC = load4h('BTC'), diff = [];
  let total = 0;
  for (const coin of alertCoins()) {
    const c = load4h(coin); if (!c || c.length < 400) continue;
    const ind = L.indicators(c), veto = L.marketGate(c, BTC);
    const ref = L.simulate(c, ind, { fill: 'next', exit: 'scale3R', veto }).trades;
    const mine = simulate(c, ind, levels(c, ind.a), { exit: 'scale3R', veto }).trades;
    const ok = ref.length === mine.length && ref.every((r, k) => r.entryIdx === mine[k].entryIdx && r.exitIdx === mine[k].exitIdx && Math.abs(r.ret - mine[k].ret) < 1e-12);
    total++; if (!ok) diff.push(`${coin}: lab ${ref.length}, here ${mine.length}`);
  }
  return { total, diff };
}

module.exports = { load4h, levels, simulate, parity, alertCoins, L };

if (require.main === module && process.argv[2] === 'parity') {
  const { total, diff } = parity();
  diff.forEach((d) => console.log('DIFF ' + d));
  console.log(diff.length ? `${diff.length}/${total} DIFFER` : `PARITY OK — ${total} alert coins (4h, honest fills): same trades as liqbrk_lab's shipped exit`);
}
