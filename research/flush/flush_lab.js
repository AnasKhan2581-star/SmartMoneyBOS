/*
 * BTC flush → alt bounce (Nov 2026, user idea): "in bad market conditions BTC suddenly drops hard (big red 15m
 * candles), then from a POI it jumps a little, and smaller coins and recent gainers jump up more".
 * RESEARCH ONLY: detector.js, the webapp and the bot are unchanged.
 *
 *   node research/flush/flush_lab.js events            # list the BTC flush events the rules find
 *   node research/flush/flush_lab.js run [grid]        # event study + strategy, every alt → research/cache/flush/*.json
 *   node research/flush/flush_report.js > research/flush/RESULTS_flush_2026-11.md
 *
 * Data: research/cache/lb15 (research/liqbrk15m/fetch15.js), the user's 103 coins, full Binance 15m history.
 *
 * THE SETUP (fixed from the trading logic before any result was seen; the grid only nudges it):
 *   bad market  BTC's close is under its 50-day MA when the drop starts (also reported for every market)
 *   flush       BTC falls ≥ k × its daily ATR (default 1.0: a full day's range) from the highest high of the last
 *               2 hours to this 15m candle's low, the candle is red, and the biggest 15m volume of those 2 hours is
 *               ≥ v × (default 3) the average 15m volume of the day before
 *   POI         the flush low takes out the lowest low of the previous 3 days (the sell stops under it)
 *   trigger     within 2 hours of the low (6 hours at most from the first flush candle; a lower low restarts the
 *               2 hours), the first GREEN 15m candle that closes above the previous candle's high and at least
 *               25% of the way back up the drop. Entry at that close, on every coin at once.
 *   exit        stop under each coin's own flush low (−0.2%), sold after 4 hours at the latest
 *   costs       0.1% fee + 0.15% slippage a side on alts (0.05% on BTC)
 */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const { load, btcStates, LIST } = require('../liqbrk15m/lab15.js');
const OUT = path.join(ROOT, 'research', 'cache', 'flush');
const DAY = 86400, BAR = 900;

// ---------------------------------------------------------------- BTC context
function btcContext(B) {
  const n = B.length, S = btcStates(B);
  // daily candles (UTC) and Wilder ATR(14) of them; each 15m candle reads the last COMPLETED day
  const days = [], dayIdx = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const d = Math.floor(B[i].time / DAY), o = days[days.length - 1];
    if (o && o.d === d) { if (B[i].high > o.high) o.high = B[i].high; if (B[i].low < o.low) o.low = B[i].low; o.close = B[i].close; }
    else days.push({ d, high: B[i].high, low: B[i].low, close: B[i].close });
    dayIdx[i] = days.length - 1;
  }
  const atr = new Array(days.length).fill(NaN);
  for (let k = 1; k < days.length; k++) {
    const tr = Math.max(days[k].high - days[k].low, Math.abs(days[k].high - days[k - 1].close), Math.abs(days[k].low - days[k - 1].close));
    atr[k] = k < 15 ? (isFinite(atr[k - 1]) ? (atr[k - 1] * (k - 1) + tr) / k : tr) : (atr[k - 1] * 13 + tr) / 14;
  }
  const atrD = (i) => (dayIdx[i] >= 1 ? atr[dayIdx[i] - 1] : NaN);
  const below50 = (i) => !S.ma(50)[i];                      // ma(50)[i] = close > 50-day MA (false while warming up)
  const warm50 = (i) => i >= 4800;
  return { S, atrD, below50, warm50 };
}

// ---------------------------------------------------------------- the flush detector
// o: { k, v, poiDays (0 = off), retrace, trigWin, maxWin, regime: 'bad'|'good'|'any', gap (bars after an entry) }
function findEvents(B, ctx, o = {}) {
  const k = o.k ?? 1.0, v = o.v ?? 3, poiDays = o.poiDays ?? 3, rt = o.retrace ?? 0.25, tw = o.trigWin ?? 8, mw = o.maxWin ?? 24;
  const regime = o.regime ?? 'bad', gap = o.gap ?? 16, n = B.length, ev = [];
  const avgVol = (i) => { let s = 0; for (let q = i - 96; q < i; q++) s += B[q].volume; return s / 96; };
  for (let i = 5000; i < n - 2; i++) {
    const b = B[i]; if (!(b.close < b.open)) continue;
    const A = ctx.atrD(i); if (!(A > 0)) continue;
    let H = -Infinity, hIdx = -1, vmax = 0;
    for (let q = i - 8; q <= i; q++) { if (B[q].high > H) { H = B[q].high; hIdx = q; } if (B[q].volume > vmax) vmax = B[q].volume; }
    if (H - b.low < k * A) continue;
    const s0 = i - 8;                                                       // the drop window starts here
    if (vmax < v * avgVol(s0)) continue;
    const bad = ctx.below50(s0) && ctx.warm50(s0);
    if (regime === 'bad' && !bad) continue;
    if (regime === 'good' && (bad || !ctx.warm50(s0))) continue;
    if (poiDays > 0) { let L = Infinity; for (let q = s0 - poiDays * 96; q < s0; q++) if (B[q].low < L) L = B[q].low; if (!(b.low < L)) continue; }
    // wait for the bounce trigger
    let lowIdx = i, lowPx = b.low, trig = -1;
    for (let j = i + 1; j < n && j - i <= mw; j++) {
      if (B[j].low < lowPx) { lowPx = B[j].low; lowIdx = j; continue; }    // the flush goes on: a new low, restart the clock
      if (j - lowIdx > tw) break;
      const c = B[j];
      if (c.close > c.open && c.close > B[j - 1].high && c.close >= lowPx + rt * (H - lowPx)) { trig = j; break; }
    }
    if (trig < 0) { i += 1; continue; }
    ev.push({ i: trig, t: B[trig].time, flushStart: B[hIdx].time, s0t: B[s0].time, lowT: B[lowIdx].time, H, lowPx, entry: B[trig].close,
      dropPct: lowPx / H - 1, dropAtr: (H - lowPx) / A, bad, back: (B[trig].close - lowPx) / (H - lowPx) });
    i = trig + gap;                                                         // one event at a time
  }
  return ev;
}

// ---------------------------------------------------------------- "bid the wick": arm DURING the flush, no confirmation
// The confirmation version comes too late (the bounce happens between the low and the trigger), so this arms at the
// close of the 15m candle where BTC's flush is first seen and rests limit bids under each coin's price.
function findArms(B, ctx, o = {}) {
  const k = o.k ?? 1.0, v = o.v ?? 3, poiDays = o.poiDays ?? 3, regime = o.regime ?? 'bad', gap = o.gap ?? 24, n = B.length, ev = [];
  const avgVol = (i) => { let s = 0; for (let q = i - 96; q < i; q++) s += B[q].volume; return s / 96; };
  for (let i = 5000; i < n - 2; i++) {
    const b = B[i]; if (!(b.close < b.open)) continue;
    const A = ctx.atrD(i); if (!(A > 0)) continue;
    let H = -Infinity, vmax = 0;
    for (let q = i - 8; q <= i; q++) { if (B[q].high > H) H = B[q].high; if (B[q].volume > vmax) vmax = B[q].volume; }
    if (H - b.close < k * A) continue;                                     // judged at the CLOSE: known when we act
    const s0 = i - 8;
    if (vmax < v * avgVol(s0)) continue;
    const bad = ctx.below50(s0) && ctx.warm50(s0);
    if (regime === 'bad' && !bad) continue;
    if (regime === 'good' && (bad || !ctx.warm50(s0))) continue;
    if (poiDays > 0) { let L = Infinity; for (let q = s0 - poiDays * 96; q < s0; q++) if (B[q].low < L) L = B[q].low; if (!(b.low < L)) continue; }
    ev.push({ i, t: B[i].time, s0t: B[s0].time, flushStart: B[s0].time, entry: b.close, dropAtr: (H - b.close) / A, bad });
    i += gap;                                                               // the bid window + the trade window
  }
  return ev;
}
// per coin daily ATR (Wilder 14) as a fraction of price, read from the last COMPLETED day before time t
function dailyAtrPct(c) {
  const days = [], at = new Map();
  for (const b of c) { const d = Math.floor(b.time / 86400), o = days[days.length - 1];
    if (o && o.d === d) { if (b.high > o.high) o.high = b.high; if (b.low < o.low) o.low = b.low; o.close = b.close; }
    else days.push({ d, high: b.high, low: b.low, close: b.close }); }
  let a = NaN;
  for (let k = 1; k < days.length; k++) {
    const tr = Math.max(days[k].high - days[k].low, Math.abs(days[k].high - days[k - 1].close), Math.abs(days[k].low - days[k - 1].close));
    a = k < 15 ? (isFinite(a) ? (a * (k - 1) + tr) / k : tr) : (a * 13 + tr) / 14;
    at.set(days[k].d + 1, a / days[k].close);                               // usable from the NEXT day on
  }
  return (t) => at.get(Math.floor(t / 86400));
}
// one coin at one arm: a limit bid m × daily ATR under the arm close, valid W bars; then TP / stop / time
// m = 0 is the control: buy at market at the arm close. Worst case inside the fill candle: if it also reaches the
// stop, the trade is stopped there; the target can only fill from the next candle on.
// Fills are kept honest: a resting bid fills at ITS price (never at a lower open), and only once price trades `margin`
// THROUGH it (queue position); a take-profit limit fills at its price; a stop fills at the stop or at a worse open.
function bidTrade(c, i, P, atrP, m, o = {}) {
  const W = o.W ?? 8, hold = o.hold ?? 16, tpA = o.tp ?? 0.5, slA = o.sl ?? 1.0, margin = o.margin ?? 0;
  let f = -1, entry = P;
  if (m === 0) f = i;
  else { const L = P * (1 - m * atrP); for (let q = i + 1; q <= i + W && q < c.length; q++) if (c[q].low <= L * (1 - margin)) { f = q; entry = L; break; } }
  if (f < 0) return { filled: false };
  const tp = entry * (1 + tpA * atrP), sl = entry * (1 - slA * atrP);
  if (m > 0 && c[f].low <= sl) return { filled: true, entry, ex: Math.min(c[f].close, sl), why: 'STOP', maker: true, f, x: f };
  for (let q = f + 1; q < c.length && q <= f + hold; q++) {
    const b = c[q];
    if (b.low <= sl) return { filled: true, entry, ex: Math.min(b.open, sl), why: 'STOP', maker: m > 0, f, x: q };
    if (b.high >= tp) return { filled: true, entry, ex: tp, why: 'TP', maker: m > 0, f, x: q };
    if (q === f + hold) return { filled: true, entry, ex: b.close, why: 'TIME', maker: m > 0, f, x: q };
  }
  return { filled: false };
}

module.exports = { btcContext, findEvents, findArms, dailyAtrPct, bidTrade };

// ---------------------------------------------------------------- per coin, per event: entry, features, outcomes
const HZ = [4, 8, 16, 32, 96];                                              // fixed horizons in 15m bars: 1h 2h 4h 8h 24h
function outcomes(c, at, e, o = {}) {
  const i = at.get(e.t); if (i == null || i < 2900) return null;
  const s = at.get(e.s0t) ?? at.get(e.flushStart); if (s == null || s < 2900) return null;
  const entry = c[i].close; if (!(entry > 0)) return null;
  let low = Infinity, hiPre = -Infinity;
  for (let q = s; q <= i; q++) if (c[q].low < low) low = c[q].low;
  for (let q = s - 8; q <= s; q++) if (c[q].high > hiPre) hiPre = c[q].high;
  let dv = 0; for (let q = s - 2880; q < s; q++) dv += c[q].volume * c[q].close; dv /= 30;      // average $ volume a day, last 30 days
  const r7 = c[s].close / c[s - 672].close - 1, r1 = c[s].close / c[s - 96].close - 1;
  const fwd = HZ.map((h) => (c[i + h] && c[i + h].time === e.t + h * BAR ? c[i + h].close / entry - 1 : null));
  // the trade: stop under the coin's own flush low, out after `hold` bars; optional target in R
  const hold = o.hold ?? 16, stop = low * (1 - 0.002), R = entry - stop, tgtR = o.tgtR ?? 0;
  let ex = null, why = 'TIME';
  for (let q = i + 1; q < c.length && q <= i + hold; q++) {
    const b = c[q];
    if (b.low <= stop) { ex = Math.min(b.open, stop); why = 'STOP'; break; }
    if (tgtR > 0 && b.high >= entry + tgtR * R) { ex = Math.max(b.open, entry + tgtR * R); why = 'TARGET'; break; }
    if (q === i + hold) ex = b.close;
  }
  if (ex == null) return null;
  return { entry, low, fall: low / hiPre - 1, r7, r1, dv, fwd, ret: ex / entry - 1, why, risk: R / entry };
}

const mode = require.main === module ? process.argv[2] : null;
const iso = (t) => new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' ');

if (mode === 'events') {
  const B = load('BTCUSDT'), ctx = btcContext(B);
  for (const regime of ['bad', 'any']) {
    const ev = findEvents(B, ctx, { regime });
    const by = {}; for (const e of ev) { const y = iso(e.t).slice(0, 4); by[y] = (by[y] || 0) + 1; }
    console.log(`${regime}: ${ev.length} events · by year ${Object.entries(by).map(([y, n]) => `${y}:${n}`).join(' ')}`);
    if (regime === 'bad') for (const e of ev.slice(-12)) console.log(`  ${iso(e.t)} UTC  drop ${(e.dropPct * 100).toFixed(1)}% (${e.dropAtr.toFixed(1)} ATR)  low ${iso(e.lowT)}  back ${(e.back * 100).toFixed(0)}%`);
  }
}

if (mode === 'run') {
  fs.mkdirSync(OUT, { recursive: true });
  const B = load('BTCUSDT'), ctx = btcContext(B);
  // configurations: the pre-registered one first, then single nudges (each changes ONE thing)
  const base = { k: 1.0, v: 3, poiDays: 3, retrace: 0.25, regime: 'bad' };
  const CFG = [['base', base]];
  if (process.argv[3] === 'grid') CFG.push(
    ['any', { ...base, regime: 'any' }], ['good', { ...base, regime: 'good' }],
    ['k0.75', { ...base, k: 0.75 }], ['k1.5', { ...base, k: 1.5 }], ['v2', { ...base, v: 2 }], ['v5', { ...base, v: 5 }],
    ['noPOI', { ...base, poiDays: 0 }], ['poi7', { ...base, poiDays: 7 }], ['rt0', { ...base, retrace: 0 }], ['rt50', { ...base, retrace: 0.5 }],
  );
  const EV = {}; for (const [name, o] of CFG) EV[name] = findEvents(B, ctx, o);
  // placebo: random 15m times in the same market (BTC under its 50-day MA), away from any flush, same coins, same rules
  const rnd = require('../rng.js').mulberry32(4242);
  const flushT = new Set(); for (const e of EV.base) for (let q = -96; q <= 96; q++) flushT.add(e.t + q * BAR);
  const PL = [];
  while (PL.length < 1500) {
    const i = 5000 + Math.floor(rnd() * (B.length - 5200));
    if (!ctx.below50(i - 8) || !ctx.warm50(i - 8) || flushT.has(B[i].time)) continue;
    PL.push({ i, t: B[i].time, s0t: B[i - 8].time, flushStart: B[i - 8].time, entry: B[i].close, placebo: true });
  }
  const recs = [];
  const sets = [...Object.entries(EV), ['placebo', PL]];
  const btcAt = new Map(B.map((b, i) => [b.time, i]));
  const t0 = Date.now();
  for (const [idx, sym] of LIST.entries()) {
    const c = sym === 'BTCUSDT' ? B : load(sym); if (!c) continue;
    const at = sym === 'BTCUSDT' ? btcAt : new Map(c.map((b, i) => [b.time, i]));
    for (const [set, ev] of sets) for (const [ei, e] of ev.entries()) {
      const r = outcomes(c, at, e); if (!r) continue;
      recs.push({ set, ei, sym: sym.replace('USDT', ''), ...r, fwd: r.fwd.map((x) => (x == null ? null : +x.toFixed(5))) });
    }
    process.stderr.write(`${idx + 1}/${LIST.length} ${sym} · ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
  }
  fs.writeFileSync(path.join(OUT, 'run.json'), JSON.stringify({ at: new Date().toISOString(), cfg: CFG, events: EV, placebo: PL.length, recs }));
  console.log(`events ${Object.entries(EV).map(([k, v]) => `${k}:${v.length}`).join(' ')} · placebo ${PL.length} · records ${recs.length} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

if (mode === 'bidgrid') {
  // base: bad market, flush k 1.0 / vol 3× / 3-day POI, bids 0.75 daily ATR down for 2h, TP +0.5 ATR, stop −1 ATR, 4h hold
  fs.mkdirSync(OUT, { recursive: true });
  const B = load('BTCUSDT'), ctx = btcContext(B);
  const AB = { regime: 'bad' }, TB = { m: 0.75 };
  // GOOD=1: the good-market leg (buy at market during the flush), every setting nudged once
  const GB = { regime: 'good' }, GM = { m: 0 };
  const VG = [['g·base', GB, GM], ['g·k0.75', { ...GB, k: 0.75 }, GM], ['g·k1.5', { ...GB, k: 1.5 }, GM], ['g·v2', { ...GB, v: 2 }, GM], ['g·v5', { ...GB, v: 5 }, GM],
    ['g·noPOI', { ...GB, poiDays: 0 }, GM], ['g·poi7', { ...GB, poiDays: 7 }, GM], ['g·tp0.3', GB, { ...GM, tp: 0.3 }], ['g·tp0.75', GB, { ...GM, tp: 0.75 }], ['g·tp1.0', GB, { ...GM, tp: 1.0 }],
    ['g·sl0.75', GB, { ...GM, sl: 0.75 }], ['g·sl1.5', GB, { ...GM, sl: 1.5 }], ['g·hold8', GB, { ...GM, hold: 8 }], ['g·hold32', GB, { ...GM, hold: 32 }], ['g·bid0.25', GB, { m: 0.25 }]];
  const V = process.env.GOOD ? VG : [['base', AB, TB], ['m0.5', AB, { m: 0.5 }], ['m0.6', AB, { m: 0.6 }], ['m0.9', AB, { m: 0.9 }], ['m1.0', AB, { m: 1.0 }], ['m1.25', AB, { m: 1.25 }],
    ['tp0.3', AB, { ...TB, tp: 0.3 }], ['tp0.75', AB, { ...TB, tp: 0.75 }], ['tp1.0', AB, { ...TB, tp: 1.0 }], ['sl0.75', AB, { ...TB, sl: 0.75 }], ['sl1.5', AB, { ...TB, sl: 1.5 }],
    ['W4', AB, { ...TB, W: 4 }], ['W16', AB, { ...TB, W: 16 }], ['hold8', AB, { ...TB, hold: 8 }], ['hold32', AB, { ...TB, hold: 32 }],
    ['through0.1', AB, { ...TB, margin: 0.001 }], ['through0.3', AB, { ...TB, margin: 0.003 }],
    ['k0.75', { ...AB, k: 0.75 }, TB], ['k1.5', { ...AB, k: 1.5 }, TB], ['v2', { ...AB, v: 2 }, TB], ['v5', { ...AB, v: 5 }, TB], ['noPOI', { ...AB, poiDays: 0 }, TB],
    ['any', { regime: 'any' }, TB], ['good', { regime: 'good' }, TB], ['good·mkt', { regime: 'good' }, { m: 0 }], ['bad·mkt', AB, { m: 0 }]];
  const armsOf = {}; for (const [, a] of V) { const key = JSON.stringify(a); if (!armsOf[key]) armsOf[key] = findArms(B, ctx, a); }
  const recs = [], t0 = Date.now();
  // UNIV=dead adds the delisted / collapsed coins (research/cache/lb15dead), so a coin that died mid-flush counts too.
  // LUNA keeps only the original coin (its ticker was reused for LUNA 2.0 on 2022-05-31).
  const DEAD = path.join(ROOT, 'research', 'cache', 'lb15dead');
  const UNIVERSE = LIST.map((s) => [s, null]).concat(process.env.UNIV === 'dead' && fs.existsSync(DEAD)
    ? fs.readdirSync(DEAD).filter((f) => f.endsWith('_15m.json')).map((f) => [f.replace('_15m.json', ''), DEAD]) : []);
  const TRUNC = { LUNAUSDT: Date.UTC(2022, 4, 14) / 1e3 };
  for (const [idx, [sym, dir]] of UNIVERSE.entries()) {
    let c = dir ? load(sym, dir) : load(sym); if (!c) continue;
    if (TRUNC[sym]) c = c.filter((b) => b.time < TRUNC[sym]);
    const at = new Map(c.map((b, i) => [b.time, i])), atrOf = dailyAtrPct(c);
    for (const [vk, a, tb] of V) { const ev = armsOf[JSON.stringify(a)];
      for (const [ei, e] of ev.entries()) {
        const i = at.get(e.t), s = at.get(e.s0t); if (i == null || s == null || s < 2900 || i + 60 >= c.length) continue;
        const P = c[i].close, atrP = atrOf(e.t); if (!(P > 0) || !(atrP > 0)) continue;
        let dv = 0; for (let q = s - 2880; q < s; q++) dv += c[q].volume * c[q].close; dv /= 30;
        if (dv < 1e6) continue;
        let hi = -Infinity; for (let q = s; q <= i; q++) if (c[q].high > hi) hi = c[q].high;
        const r = bidTrade(c, i, P, atrP, tb.m, tb);
        recs.push({ v: vk, t: e.t, sym: sym.replace('USDT', ''), dead: !!dir, dv: Math.round(dv), fell: +(P / hi - 1).toFixed(4), r7: +(c[s].close / c[s - 672].close - 1).toFixed(4),
          f: r.filled ? 1 : 0, ret: r.filled ? +(r.ex / r.entry - 1).toFixed(5) : null, why: r.filled ? r.why : null, mk: tb.m > 0 });
      }
    }
    process.stderr.write(`${idx + 1}/${UNIVERSE.length} ${sym} · ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
  }
  fs.writeFileSync(path.join(OUT, (process.env.GOOD ? 'goodgrid' : 'bidgrid') + (process.env.UNIV === 'dead' ? '_dead' : '') + '.json'), JSON.stringify({ at: new Date().toISOString(), variants: V.map(([k, a, tb]) => [k, a, tb]),
    arms: Object.fromEntries(V.map(([k, a]) => [k, armsOf[JSON.stringify(a)].map((e) => e.t)])), recs }));
  console.log(`variants ${V.length} · records ${recs.length} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

if (mode === 'bid') {
  // the wick bid on every coin, at five depths, for the flush arms and for random bad-market times (the control)
  fs.mkdirSync(OUT, { recursive: true });
  const B = load('BTCUSDT'), ctx = btcContext(B);
  const SETS = { bad: findArms(B, ctx, { regime: 'bad' }), any: findArms(B, ctx, { regime: 'any' }), good: findArms(B, ctx, { regime: 'good' }) };
  const rnd = require('../rng.js').mulberry32(99);
  const near = new Set(); for (const e of SETS.any) for (let q = -96; q <= 96; q++) near.add(e.t + q * BAR);
  const PL = [];
  while (PL.length < 1500) { const i = 5000 + Math.floor(rnd() * (B.length - 5200));
    if (!ctx.below50(i - 8) || !ctx.warm50(i - 8) || near.has(B[i].time)) continue; PL.push({ i, t: B[i].time, s0t: B[i - 8].time, flushStart: B[i - 8].time }); }
  SETS.placebo = PL;
  // the same control for the good-market leg: random 15m times with BTC OVER its 50-day MA, away from any flush
  const PG = [];
  while (PG.length < 1500) { const i = 5000 + Math.floor(rnd() * (B.length - 5200));
    if (ctx.below50(i - 8) || !ctx.warm50(i - 8) || near.has(B[i].time)) continue; PG.push({ i, t: B[i].time, s0t: B[i - 8].time, flushStart: B[i - 8].time }); }
  SETS.placeboGood = PG;
  const DEPTH = [0, 0.25, 0.5, 0.75, 1.0], recs = [], t0 = Date.now();
  for (const [idx, sym] of LIST.entries()) {
    const c = load(sym); if (!c) continue;
    const at = new Map(c.map((b, i) => [b.time, i])), atrOf = dailyAtrPct(c);
    for (const [set, ev] of Object.entries(SETS)) for (const [ei, e] of ev.entries()) {
      const i = at.get(e.t), s = at.get(e.s0t); if (i == null || s == null || s < 2900 || i + 40 >= c.length) continue;
      const P = c[i].close, atrP = atrOf(e.t); if (!(P > 0) || !(atrP > 0)) continue;
      let hi = -Infinity; for (let q = s; q <= i; q++) if (c[q].high > hi) hi = c[q].high;
      let dv = 0; for (let q = s - 2880; q < s; q++) dv += c[q].volume * c[q].close; dv /= 30;
      const rec = { set, ei, sym: sym.replace('USDT', ''), atrP: +atrP.toFixed(5), dv, r7: c[s].close / c[s - 672].close - 1, fallSoFar: P / hi - 1, d: [] };
      for (const m of DEPTH) { const r = bidTrade(c, i, P, atrP, m); rec.d.push(r.filled ? { ret: +(r.ex / r.entry - 1).toFixed(5), why: r.why, maker: r.maker } : null); }
      recs.push(rec);
    }
    process.stderr.write(`${idx + 1}/${LIST.length} ${sym} · ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
  }
  fs.writeFileSync(path.join(OUT, 'bid.json'), JSON.stringify({ at: new Date().toISOString(), depth: DEPTH, sets: Object.fromEntries(Object.entries(SETS).map(([k, v]) => [k, v.map((e) => ({ t: e.t, dropAtr: e.dropAtr }))])), recs }));
  console.log(`arms ${Object.entries(SETS).map(([k, v]) => `${k}:${v.length}`).join(' ')} · records ${recs.length} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
