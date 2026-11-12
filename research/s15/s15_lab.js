/*
 * 15m strategy search (Nov 2026, user request: "there must be some strategy which actually makes money on 15m").
 * RESEARCH ONLY: detector.js, the webapp and the bot are unchanged.
 *
 *   node research/s15/s15_lab.js selftest     # the 15m indicator builder reproduces liqbrk_lab's shipped indicators
 *   node research/s15/s15_lab.js run          # every strategy × every coin → research/cache/s15/run.json
 *   node research/s15/s15_report.js > research/s15/RESULTS_s15_2026-11.md
 *
 * Data: research/cache/lb15 (research/liqbrk15m/fetch15.js): the user's 103 coins, full Binance 15m history.
 * Stats: the Compare tab's own pathStats (via research/liqbrk15m/lab15.js), fills at the signal close, 0.1% a side;
 * "after slippage" adds 0.05% a side.
 *
 * Hypothesis behind family L: liqbrk is weak on 15m because three of its pieces are counted in CANDLES, not days,
 * so on 15m they are different, much jumpier rules than the 4h ones that carry the edge:
 *   - the 149-candle MA      = 25 days on 4h, but 37 hours on 15m
 *   - the stop and the decisive-break size use ATR(14 candles): 4h ranges on 4h, 15m ranges on 15m (a far tighter stop)
 *   - the volume test compares ONE candle with its daily average: a 4h candle on 4h, a single 15m candle on 15m
 * "L4" converts all three to their 4h meaning while still deciding on every 15m close.
 */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const { SMC, indicators, simulate } = require('../liqbrk_lab.js').useRules('2026-10');   // the rules this study measured (Oct 2026: leader rescue, no stop limit)
const L15 = require('../liqbrk15m/lab15.js');
const { load, btcStates, alignIdx, leadArr, toDet, netOf, windowStats, pathStats, LIST } = L15;
const P = SMC.DEFAULTS;
const OUT = path.join(ROOT, 'research', 'cache', 's15');

// ---------------------------------------------------------------- candles
// UTC-aligned buckets of `sec` seconds built from 15m candles (Binance's own bucketing); `last[i]` = for each 15m
// candle, the index of the newest bucket that is COMPLETE at that candle's close (-1 if none yet): no lookahead.
function agg(c, sec) {
  const out = [], last = new Int32Array(c.length);
  for (let i = 0; i < c.length; i++) {
    const b = c[i], k = Math.floor(b.time / sec) * sec, o = out[out.length - 1];
    if (o && o.time === k) { if (b.high > o.high) o.high = b.high; if (b.low < o.low) o.low = b.low; o.close = b.close; o.volume += b.volume; }
    else out.push({ time: k, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume });
    const closesBucket = (b.time + 900) % sec === 0;
    last[i] = closesBucket ? out.length - 1 : out.length - 2;
  }
  return { bars: out, last };
}

// ---------------------------------------------------------------- liqbrk indicators on 15m, with each candle-counted piece switchable
// o.ma: 'bars' = SMA(149 candles) as shipped | '4h' = SMA(149×16 = 2384 candles) = the 4h chart's 149 MA (≈25 days)
// o.atr: '15m' = ATR(14) of 15m candles as shipped | '4h' = ATR(14) of the last CLOSED 4h candle
// o.vol: '15m' = this candle's volume vs its 1-day average as shipped | '4h' = the last 4 hours' volume vs the day's average 4h
function ind15(c, o = {}) {
  const p = { ...P, ...(o.p || {}) }, n = c.length;
  const dt = n > 1 ? Math.max(60, c[1].time - c[0].time) : 86400, bpd = 86400 / dt;
  const S = (d) => Math.max(2, Math.round(d * bpd));
  const closes = c.map((b) => b.close);
  const sma = (len) => { const r = new Array(n).fill(NaN); let s = 0;
    for (let i = 0; i < n; i++) { s += closes[i]; if (i >= len) s -= closes[i - len]; if (i >= len - 1) r[i] = s / len; } return r; };
  let a;
  if (o.atr === '4h') {
    const { bars, last } = agg(c, 14400), a4 = SMC.atr(bars, p.atrLen);
    a = Array.from({ length: n }, (_, i) => (last[i] >= 0 ? a4[last[i]] : NaN));
  } else a = SMC.atr(c, p.atrLen);
  const bL = S(p.lbBreak), eL = S(p.lbExit), vL = Math.max(2, S(1));
  // prior n-day extremes with monotonic deques (same values as the shipped O(n·L) loops)
  const hiB = new Array(n).fill(Infinity), loE = new Array(n).fill(-Infinity);
  { const dq = []; for (let i = 1; i < n; i++) { const j = i - 1; while (dq.length && c[dq[dq.length - 1]].high <= c[j].high) dq.pop(); dq.push(j);
      while (dq[0] < i - bL) dq.shift(); hiB[i] = c[dq[0]].high; } }
  { const dq = []; for (let i = 1; i < n; i++) { const j = i - 1; while (dq.length && c[dq[dq.length - 1]].low >= c[j].low) dq.pop(); dq.push(j);
      while (dq[0] < i - eL) dq.shift(); loE[i] = c[dq[0]].low; } }
  const rv = new Array(n).fill(1);
  if (o.vol === '4h') {
    // volume of the last W candles (W = 16: 4 hours) vs the day's average volume over W candles (96 candles × W/96)
    const W = o.volW || 16; let sW = 0, s96 = 0;
    for (let i = 0; i < n; i++) { const v = c[i].volume || 0; sW += v; s96 += v; if (i >= W) sW -= c[i - W].volume || 0; if (i >= 96) s96 -= c[i - 96].volume || 0;
      const avg = s96 / Math.min(i + 1, 96) * W; rv[i] = avg > 0 ? sW / avg : 1; }
  } else {
    let vs = 0;
    for (let i = 0; i < n; i++) { const v = c[i].volume || 0; vs += v; if (i >= vL) vs -= (c[i - vL].volume || 0);
      const avg = vs / Math.min(i + 1, vL); rv[i] = avg > 0 ? v / avg : 1; }
  }
  const maT = sma(S(p.lbTrend)), mab = o.ma === '4h' ? 149 * 16 : Math.max(0, Math.round(p.lbMaBars || 0));
  const maBars = mab >= 2 ? sma(mab) : null;
  const warm = Math.max(S(p.lbTrend), S(p.lbBreak), S(1), mab) + 2;
  const sig = new Array(n).fill(false);
  for (let i = warm; i < n; i++) {
    const px = closes[i];
    sig[i] = px > hiB[i] && closes[i - 1] <= hiB[i - 1] && px > maT[i] && rv[i] >= p.lbRelVol
      && (!maBars || px > maBars[i]) && (!(p.lbBrkExt > 0) || (px - hiB[i]) >= p.lbBrkExt * a[i]) && isFinite(a[i]);
  }
  return { a, hiB, loE, rv, maT, maBars, sig, warm, bpd, p };
}

// ---------------------------------------------------------------- a liqbrk-style position machine for 15m with the exit timing switchable
// o.stopA: the ATR array the stop is sized from (default ind.a) · o.exit4h: judge the trail only at 15m candles that
// CLOSE a 4h candle, against the low of the six 4h candles before it (exactly the 4h chart's rule) · o.veto: entry gate.
// The stop stays a price touch on every 15m candle (a real stop order), filled at the stop; half goes at +3R when a high touches it.
function sim15(c, ind, o = {}) {
  const n = c.length, sig = o.sig || ind.sig, A = o.stopA || ind.a, kS = o.kStop ?? ind.p.lbStop, out = [];
  let lo4 = null, closes4 = null;
  if (o.exit4h) {
    const E = o.exitSec || 14400, nb = Math.round(86400 / E);       // judged at E-second closes, against the prior day's low
    const { bars } = agg(c, E); lo4 = new Array(n).fill(-Infinity); closes4 = new Array(n).fill(false);
    const lowPrev = bars.map((_, k) => { let m = Infinity; for (let q = Math.max(0, k - nb); q < k; q++) if (bars[q].low < m) m = bars[q].low; return k ? m : -Infinity; });
    let k = -1;
    for (let i = 0; i < n; i++) {
      const t = Math.floor(c[i].time / E) * E; if (k < 0 || bars[k].time !== t) k++;
      if ((c[i].time + 900) % E === 0) { closes4[i] = true; lo4[i] = lowPrev[k]; }
    }
  }
  let pos = null;
  const close = (i, px, why) => {
    const ex = pos.scale ? pos.scale.w * pos.scale.px + (1 - pos.scale.w) * px : px;
    out.push({ entryIdx: pos.entryIdx, exitIdx: i, entry: pos.entry, stop: pos.stop, exitPrice: ex, scale: pos.scale, outcome: (ex - pos.entry) / (pos.entry - pos.stop) >= 0 ? 'win' : 'loss', frac: 1, why });
    pos = null;
  };
  for (let i = ind.warm; i < n; i++) {
    const px = c[i].close;
    if (pos) {
      if (c[i].low <= pos.stop) close(i, pos.stop, 'STOP');
      else {
        if (!pos.scale && c[i].high >= pos.tp) pos.scale = { idx: i, px: pos.tp, w: 0.5 };
        if (o.exit4h ? (closes4[i] && px < lo4[i]) : px < ind.loE[i]) close(i, px, 'TRAIL');
      }
    } else if (sig[i] && (!o.veto || o.veto[i]) && isFinite(A[i]) && A[i] > 0) {
      const stop = px - kS * A[i];
      pos = { entry: px, stop, entryIdx: i, tp: px + 3 * (px - stop), scale: null };
    }
  }
  if (pos) { const last = c[n - 1].close; out.push({ entryIdx: pos.entryIdx, exitIdx: n - 1, entry: pos.entry, stop: pos.stop,
    exitPrice: pos.scale ? 0.5 * pos.scale.px + 0.5 * last : last, scale: pos.scale, outcome: 'open', frac: 1, why: 'OPEN' }); }
  return out;
}
// entry on the FIRST 15m close above a trigger set k×ATR above the 2-day high (on 4h the first close through the high
// usually clears it decisively already; on 15m the first close through it almost never does, so the two rules differ)
function trigSig(c, ind, atrArr, k, extra) {
  const n = c.length, sig = new Array(n).fill(false);
  for (let i = ind.warm; i < n; i++) {
    const T = ind.hiB[i] + k * atrArr[i], Tp = ind.hiB[i - 1] + k * atrArr[i - 1], px = c[i].close;
    sig[i] = isFinite(T) && px > T && !(c[i - 1].close > Tp) && extra(i);
  }
  return sig;
}

// ---------------------------------------------------------------- the 4h system, run on 15m candles
// Every rule is the shipped 4h one (2-day high of 4h candles, 5-day and 149×4h MAs, 4h volume vs its day, 1×ATR(4h)
// decisive break, 4×ATR(4h) stop, ½ at +3R, trail at 4h closes under the prior day's low, BTC's 4h 50-day gate or a
// 30-day leader). The only switch is WHEN a buy may happen:
//   'close4h' — only at a 15m close that is also a 4h close: must reproduce the 4h chart (the check on this machine)
//   'early'   — at ANY 15m close where the 4h candle forming so far already meets every rule: the 4h edge, entered early
// Exits are always the 4h ones (a stop is a price touch on any 15m candle; the trail is judged at 4h closes).
function simH4(c, btc4, mode, o = {}) {
  const n = c.length, p = P, { bars } = agg(c, 14400), K = bars.length;
  const hi = bars.map((b) => b.high), lo = bars.map((b) => b.low), cl = bars.map((b) => b.close), vo = bars.map((b) => b.volume);
  const a4 = SMC.atr(bars, p.atrLen);
  const hiB = new Array(K).fill(Infinity), loE = new Array(K).fill(-Infinity);
  for (let k = 1; k < K; k++) { let h = -Infinity, l = Infinity;
    for (let q = Math.max(0, k - 12); q < k; q++) if (hi[q] > h) h = hi[q];
    for (let q = Math.max(0, k - 6); q < k; q++) if (lo[q] < l) l = lo[q];
    hiB[k] = h; loE[k] = l; }
  const cs = [0]; for (let k = 0; k < K; k++) cs.push(cs[k] + cl[k]);       // prefix sums of 4h closes
  const vs = [0]; for (let k = 0; k < K; k++) vs.push(vs[k] + vo[k]);
  // BTC's gate on 4h candles: close above its 300-candle (50-day) MA, read from the last BTC 4h candle CLOSED by now
  const up = new Map(); { let s = 0; const L = 300;
    for (let j = 0; j < btc4.length; j++) { s += btc4[j].close; if (j >= L) s -= btc4[j - L].close; if (j >= L - 1) up.set(btc4[j].time, btc4[j].close > s / L); } }
  const warm = Math.max(30, 12, 6, 149) + 2, kS = o.kStop ?? p.lbStop, out = [];
  let pos = null, pend = null, k = -1, f = null, entered = -1, exitedK = -1;
  const close = (i, px, why) => {
    const ex = pos.scale ? pos.scale.w * pos.scale.px + (1 - pos.scale.w) * px : px;
    out.push({ entryIdx: pos.entryIdx, exitIdx: i, entry: pos.entry, stop: pos.stop, exitPrice: ex, scale: pos.scale, outcome: (ex - pos.entry) / (pos.entry - pos.stop) >= 0 ? 'win' : 'loss', frac: 1, why });
    pos = null; exitedK = k;                     // like the 4h chart: no new buy in the 4h candle a position closed in
  };
  for (let i = 0; i < n; i++) {
    const b = c[i], t = Math.floor(b.time / 14400) * 14400;
    if (k < 0 || bars[k].time !== t) { k++; f = { open: b.open, high: b.high, low: b.low, volume: 0 }; }
    if (b.high > f.high) f.high = b.high; if (b.low < f.low) f.low = b.low; f.volume += b.volume;
    const closes4 = (b.time + 900) % 14400 === 0, px = b.close;
    if (pos) {
      if (b.low <= pos.stop) close(i, pos.stop, 'STOP');
      else {
        if (!pos.scale && b.high >= pos.tp) pos.scale = { idx: i, px: pos.tp, w: 0.5 };
        if (closes4 && px < loE[k] && pos.entryIdx < i) close(i, px, 'TRAIL');
      }
      continue;
    }
    // 'retest': a signal leaves a limit buy at the broken level (+ retestK × ATR) for retestBars 15m candles
    if (pend) {
      if (b.low <= pend.stop || (closes4 && px < loE[k])) { pend = null; }               // setup broken before the fill
      else if (b.low <= pend.lim) {
        const fill = Math.min(b.open, pend.lim);
        pos = { entry: fill, stop: pend.stop, entryIdx: i, tp: fill + p.lbScaleR * (fill - pend.stop), scale: null }; pend = null; entered = k;
        continue;
      } else if (i - pend.i >= (o.retestBars || 96)) {
        if (o.retestMiss === 'market') { pos = { entry: px, stop: pend.stop, entryIdx: i, tp: px + p.lbScaleR * (px - pend.stop), scale: null }; entered = k; }
        pend = null; continue;
      } else continue;
    }
    if (k < warm || entered === k || exitedK === k || ((mode === 'close4h' || mode === 'retest') && !closes4)) continue;
    // the 4h candle as it stands at this 15m close
    const tr = Math.max(f.high - f.low, Math.abs(f.high - cl[k - 1]), Math.abs(f.low - cl[k - 1]));
    const atrF = (a4[k - 1] * (p.atrLen - 1) + tr) / p.atrLen;
    const sma = (L) => (cs[k] - cs[k - L + 1] + px) / L;
    const avgV = (vs[k] - vs[k - 5] + f.volume) / 6;
    const prevUp = up.get(t - 14400);                                         // BTC's last CLOSED 4h candle
    const lead = px >= (1 + p.lbLeadPump) * cl[k - 180];
    const ok = px > hiB[k] && cl[k - 1] <= hiB[k - 1] && px > sma(30) && f.volume / avgV >= p.lbRelVol && px > sma(149)
      && (px - hiB[k]) >= p.lbBrkExt * atrF && ((closes4 ? up.get(t) : prevUp) === true || lead);
    if (ok) {
      const stop = px - kS * atrF;
      if (mode === 'retest') { pend = { lim: hiB[k] + (o.retestK ?? 0) * atrF, stop, i }; entered = k; }
      else { pos = { entry: px, stop, entryIdx: i, tp: px + p.lbScaleR * (px - stop), scale: null }; entered = k; }
    }
  }
  if (pos) { const last = c[n - 1].close; out.push({ entryIdx: pos.entryIdx, exitIdx: n - 1, entry: pos.entry, stop: pos.stop,
    exitPrice: pos.scale ? 0.5 * pos.scale.px + 0.5 * last : last, scale: pos.scale, outcome: 'open', frac: 1, why: 'OPEN' }); }
  return out;
}

// ---------------------------------------------------------------- SR: the prior day's low swept and reclaimed, in an uptrend
// Mirror of the breakout idea: sell-side liquidity (stops under yesterday's low) is taken, price closes back above it,
// and the trade aims at the buy-side liquidity above (the 2-day high). Uptrend = close over its 25-day MA, which is rising
// over the last day; the market gate is the shipped one. Stop under the sweep's low (−¼ ATR of 4h), target the 2-day high
// (skipped if it is less than 1R away), 2-day time stop.
function simSR(c, ind, A4, veto, o = {}) {
  const n = c.length, out = [], L25 = 2384, closes = c.map((b) => b.close);
  const ma = new Array(n).fill(NaN); { let s = 0; for (let i = 0; i < n; i++) { s += closes[i]; if (i >= L25) s -= closes[i - L25]; if (i >= L25 - 1) ma[i] = s / L25; } }
  const minR = o.minR ?? 1, hold = o.hold ?? 192;
  let pos = null, lastIn = -Infinity;
  const close = (i, px, why) => { out.push({ entryIdx: pos.entryIdx, exitIdx: i, entry: pos.entry, stop: pos.stop, exitPrice: px, scale: null,
    outcome: px >= pos.entry ? 'win' : 'loss', frac: 1, why }); pos = null; };
  for (let i = Math.max(ind.warm, L25 + 96); i < n; i++) {
    const b = c[i];
    if (pos) {
      if (b.low <= pos.stop) close(i, Math.min(b.open, pos.stop), 'STOP');
      else if (b.high >= pos.tgt) close(i, Math.max(b.open, pos.tgt), 'TARGET');
      else if (i - pos.entryIdx >= hold) close(i, b.close, 'TIME');
      continue;
    }
    if (i - lastIn < 16 || (veto && !veto[i]) || !(isFinite(A4[i]) && A4[i] > 0)) continue;
    const up = b.close > ma[i] && ma[i] > ma[i - 96];
    const L = ind.loE[i], swept = (b.low < L && b.close > L) || (c[i - 1].low < ind.loE[i - 1] && c[i - 1].close <= ind.loE[i - 1] && b.close > L);
    if (!up || !swept || !(b.close > b.open)) continue;
    let lo = Infinity; for (let q = i - 3; q <= i; q++) if (c[q].low < lo) lo = c[q].low;
    const stop = lo - 0.25 * A4[i], tgt = ind.hiB[i], R = b.close - stop;
    if (!(R > 0) || tgt - b.close < minR * R) continue;
    pos = { entry: b.close, stop, tgt, entryIdx: i }; lastIn = i;
  }
  if (pos) out.push({ entryIdx: pos.entryIdx, exitIdx: n - 1, entry: pos.entry, stop: pos.stop, exitPrice: c[n - 1].close, scale: null, outcome: 'open', frac: 1, why: 'OPEN' });
  return out;
}

const PS2 = (() => { const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), i = html.indexOf('function pathStats(');
  let j = html.indexOf('{', i), d = 0; for (; j < html.length; j++) { if (html[j] === '{') d++; else if (html[j] === '}' && --d === 0) break; }
  const src = html.slice(i, j + 1).replace('r[t.exitIdx]-=f*0.002;', 'r[t.exitIdx]-=f*0.004;');
  if (!src.includes('f*0.004')) throw new Error('pathStats changed: update the 0.10% slippage patch');
  return new Function('SMC', src + '\nreturn pathStats;')(SMC); })();
// net P/L with 0.10% slippage a side, on the same sub-window rules as windowStats
function slip2(c, T, a, b) {
  let i0 = 0; while (i0 < c.length && c[i0].time < a) i0++; let i1 = i0; while (i1 < c.length && c[i1].time < b) i1++;
  const sub = c.slice(i0, i1), TT = T.filter((t) => t.entryIdx >= i0 && t.exitIdx < i1).map((t) => ({ ...t, entryIdx: t.entryIdx - i0, exitIdx: t.exitIdx - i0, scale: t.scale ? { ...t.scale, idx: t.scale.idx - i0 } : null }));
  return PS2(TT, sub).net;
}

module.exports = { agg, ind15, sim15, trigSig, simH4, simSR };

const mode = require.main === module ? process.argv[2] : null;
const iso = (t) => new Date(t * 1000).toISOString().slice(0, 10);

if (mode === 'selftest') {
  // with every switch on "shipped", ind15 must give liqbrk_lab's indicators exactly, and the trades must match
  let bad = 0, n = 0;
  for (const sym of ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'INJUSDT', 'PEPEUSDT', 'ZECUSDT']) {
    const c = load(sym); if (!c) continue;
    const A = indicators(c), B = ind15(c);
    const sameSig = A.sig.every((x, i) => x === B.sig[i]), sameA = A.a.every((x, i) => x === B.a[i]), sameLo = A.loE.every((x, i) => x === B.loE[i]);
    const ta = toDet(simulate(c, A, { fill: 'close', exit: 'scale3R' }), c), tb = toDet(simulate(c, B, { fill: 'close', exit: 'scale3R' }), c);
    const sameT = ta.length === tb.length && ta.every((t, i) => t.entryIdx === tb[i].entryIdx && t.exitIdx === tb[i].exitIdx && t.exitPrice === tb[i].exitPrice);
    const tc = sim15(c, B), sameS = ta.length === tc.length && ta.every((t, i) => t.entryIdx === tc[i].entryIdx && t.exitIdx === tc[i].exitIdx && t.exitPrice === tc[i].exitPrice && t.outcome === tc[i].outcome);
    n++; if (!(sameSig && sameA && sameLo && sameT && sameS)) { bad++; console.log(`MISMATCH ${sym}: sig ${sameSig} atr ${sameA} trail ${sameLo} trades ${sameT} sim15 ${sameS}`); }
    // the 4h ATR must only ever use a 4h candle that has closed
    const { bars, last } = agg(c, 14400);
    for (let i = 0; i < c.length; i++) if (last[i] >= 0 && bars[last[i]].time + 14400 > c[i].time + 900) { bad++; console.log(`LOOKAHEAD ${sym} @${i}`); break; }
  }
  console.log(bad ? `${bad} PROBLEMS` : `SELFTEST OK: ind15 and sim15 = liqbrk_lab's indicators and trades on ${n} coins; 4h ATR never reads an open 4h candle`);
}

if (mode === 'run') {
  fs.mkdirSync(OUT, { recursive: true });
  const PER = [['all', 0, Infinity], ['2018–20', Date.UTC(2018, 0, 1) / 1e3, Date.UTC(2021, 0, 1) / 1e3], ['2021–22', Date.UTC(2021, 0, 1) / 1e3, Date.UTC(2023, 0, 1) / 1e3],
    ['2023–24', Date.UTC(2023, 0, 1) / 1e3, Date.UTC(2025, 0, 1) / 1e3], ['2025–26', Date.UTC(2025, 0, 1) / 1e3, Infinity], ['last 4y', Date.UTC(2022, 9, 28) / 1e3, Infinity]];
  const BTC = load('BTCUSDT'), S = btcStates(BTC), BTC4 = agg(BTC, 14400).bars;
  const ENDT = BTC[BTC.length - 1].time + 900;
  const gate = (s, j, L) => (j >= 0 && s.ma(50)[j]) || L;                              // the shipped market gate
  const gateBoth149 = (s, j, L) => (j >= 0 && s.ma(50)[j] && s.maBars(149)[j]) || L;      // + BTC above its 149-bar MA
  // strategies: [key, label, tf, build(c) → trades]
  const vt = (x, g) => x.veto(g);
  const STRATS = [
    ['L0', 'shipped liqbrk on 15m', '15m', (c, x) => toDet(simulate(c, x.ind0, { fill: 'close', exit: 'scale3R', veto: vt(x, gate) }), c)],
    ['V', '15m, volume test over the last 4 hours (else shipped)', '15m', (c, x) => sim15(c, x.V(), { veto: vt(x, gate) })],
    ['Vs', 'V + stop 4×ATR of 4h candles', '15m', (c, x) => sim15(c, x.V(), { veto: vt(x, gate), stopA: x.A4() })],
    ['Vx', 'V + trail judged only at 4h closes', '15m', (c, x) => sim15(c, x.V(), { veto: vt(x, gate), exit4h: true })],
    ['Vsx', 'V + 4h-ATR stop + trail at 4h closes', '15m', (c, x) => sim15(c, x.V(), { veto: vt(x, gate), stopA: x.A4(), exit4h: true })],
    ['T', '15m, first close above 2-day high + 1×ATR(4h); 4h volume; 4h-ATR stop', '15m', (c, x) => sim15(c, x.V(), { veto: vt(x, gate), stopA: x.A4(), sig: x.T() })],
    ['Tx', 'T + trail judged only at 4h closes', '15m', (c, x) => sim15(c, x.V(), { veto: vt(x, gate), stopA: x.A4(), sig: x.T(), exit4h: true })],
    ['Vsxb', 'Vsx + BTC above its 149-bar MA', '15m', (c, x) => sim15(c, x.V(), { veto: vt(x, gateBoth149), stopA: x.A4(), exit4h: true })],
    ['H4c', 'the 4h system on 15m candles, buying only at 4h closes (must ≈ H4)', '15m', (c, x) => simH4(c, x.btc4, 'close4h')],
    ['H4e', 'the 4h system on 15m candles, buying at the first 15m close the forming 4h candle qualifies', '15m', (c, x) => simH4(c, x.btc4, 'early')],
    ['H4r', 'the 4h signal, bought on a 15m retest of the broken level within 24h (else skipped)', '15m', (c, x) => simH4(c, x.btc4, 'retest', { retestK: 0 })],
    ['H4rh', 'the 4h signal, limit halfway back (level + ½ATR) within 24h (else skipped)', '15m', (c, x) => simH4(c, x.btc4, 'retest', { retestK: 0.5 })],
    ['H4rm', 'as H4rh, but bought at market if no retest in 24h', '15m', (c, x) => simH4(c, x.btc4, 'retest', { retestK: 0.5, retestMiss: 'market' })],
    ['SR', 'prior-day low swept and reclaimed in an uptrend → target the 2-day high', '15m', (c, x) => simSR(c, x.ind0, x.A4(), vt(x, gate))],
    ['H4', 'shipped liqbrk on 4h candles (the reference)', '4h', null],
  ];
  if (process.env.ROBUST) {          // nudge every setting of Vsxb both ways (a plateau or a lucky cell?)
    const vb = (o2, volW) => (c, x) => sim15(c, x.ind('bars', '15m', '4h', volW), { veto: vt(x, gateBoth149), stopA: x.A4(), exit4h: true, ...o2 });
    STRATS.splice(0, STRATS.length,
      ['Vsxb', 'Vsxb as above', '15m', vb({})],
      ['Vsxb-v8', 'volume over 2 hours', '15m', vb({}, 8)], ['Vsxb-v32', 'volume over 8 hours', '15m', vb({}, 32)],
      ['Vsxb-s3', 'stop 3×ATR(4h)', '15m', vb({ kStop: 3 })], ['Vsxb-s5', 'stop 5×ATR(4h)', '15m', vb({ kStop: 5 })],
      ['Vsxb-x2h', 'trail judged at 2h closes', '15m', vb({ exitSec: 7200 })], ['Vsxb-x8h', 'trail judged at 8h closes', '15m', vb({ exitSec: 28800 })],
      ['H4e', 'the 4h system, early 15m entries', '15m', (c, x) => simH4(c, x.btc4, 'early')],
      ['H4e-s3', 'H4e, stop 3×ATR(4h)', '15m', (c, x) => simH4(c, x.btc4, 'early', { kStop: 3 })], ['H4e-s5', 'H4e, stop 5×ATR(4h)', '15m', (c, x) => simH4(c, x.btc4, 'early', { kStop: 5 })],
      ['H4', 'shipped liqbrk on 4h candles (the reference)', '4h', null]);
  }
  const rows = [], trades = [], BK = {};
  for (const [p, a, b] of PER) if (!['all', 'last 4y'].includes(p)) BK[p] = { a, b: Math.min(b, ENDT), coins: 0, sum: {} };
  const t0 = Date.now();
  for (const [idx, sym] of LIST.entries()) {
    const c = load(sym); if (!c || c.length < 3000) continue;
    const jIdx = alignIdx(c, S), lead = leadArr(c), cache = {};
    const x = {
      ind0: indicators(c),
      ind: (ma, atr, vol, volW) => cache[ma + atr + vol + (volW || '')] || (cache[ma + atr + vol + (volW || '')] = ind15(c, { ma, atr, vol, volW })),
      veto: (g) => cache['g' + g.name] || (cache['g' + g.name] = Array.from({ length: c.length }, (_, i) => !!g(S, jIdx[i], lead[i]))),
    };
    x.V = () => x.ind('bars', '15m', '4h');
    x.A4 = () => x.ind('bars', '4h', '4h').a;
    x.T = () => cache.T || (cache.T = (() => { const v = x.V(), a4 = x.A4();
      return trigSig(c, v, a4, P.lbBrkExt, (i) => c[i].close > v.maT[i] && v.rv[i] >= P.lbRelVol && (!v.maBars || c[i].close > v.maBars[i])); })());
    const c4 = agg(c, 14400).bars, btc4 = sym === 'BTCUSDT' ? c4 : BTC4;
    x.btc4 = btc4;
    for (const [k, , tf, build] of STRATS) {
      let T, cc;
      if (tf === '4h') { cc = c4; T = SMC.detectAll(c4, { strategy: 'liqbrk', longOnly: true, useLiq: false, btc: btc4 }).trades; }
      else { cc = c; T = build(c, x); }
      for (const [p, a, b] of PER) {
        const e = windowStats(cc, T, a, b), es = e && windowStats(cc, T, a, b, true), es2 = e && slip2(cc, T, a, b);
        if (!e) continue;
        let dd4 = e.dd;
        if (tf === '15m') { let i0 = 0; while (cc[i0].time < a) i0++; let pk = 0; dd4 = 0;
          for (let q = 0; q < e.eq.length; q++) if ((cc[i0 + q].time + 900) % 14400 === 0) { const v = e.eq[q]; if (v > pk) pk = v; else if (pk > 0) dd4 = Math.max(dd4, (pk - v) / pk); } }
        rows.push({ sym: sym.replace('USDT', ''), k, p, net: e.net, bh: e.bh, edge: e.edge, dd: e.dd, dd4, n: e.n, wr: e.wr, pf: e.pf, expo: e.expo, yrs: e.yrs, pos: e.pos, netSlip: es.net, netSlip2: es2, from: c[0].time });
        if (BK[p] && c[0].time <= a - 31 * 86400) {
          const B = BK[p], eq = e.eq; let i0 = 0; while (cc[i0].time < a) i0++;
          const days = Math.ceil((B.b - a) / 86400), arr = B.sum[k] || (B.sum[k] = new Array(days).fill(0));
          let q = 0, last = 1;
          for (let d = 0; d < arr.length; d++) { const tEnd = a + (d + 1) * 86400; while (i0 + q < cc.length && cc[i0 + q].time < tEnd && q < eq.length) { last = eq[q]; q++; } arr[d] += last; }
          if (k === 'L0') B.coins++;
        }
      }
      for (const t of T) if (t.outcome !== 'open') trades.push({ sym: sym.replace('USDT', ''), k, t: cc[t.entryIdx].time, h: (cc[t.exitIdx].time - cc[t.entryIdx].time) / 3600, net: +netOf(t).toFixed(5) });
    }
    process.stderr.write(`${idx + 1}/${LIST.length} ${sym} · ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
  }
  const basket = {};
  for (const [p, B] of Object.entries(BK)) basket[p] = { coins: B.coins, from: B.a, eq: Object.fromEntries(Object.entries(B.sum).map(([k, s]) => [k, s.map((v) => +(v / B.coins).toFixed(5))])) };
  fs.writeFileSync(path.join(OUT, process.env.ROBUST ? 'robust.json' : 'run.json'), JSON.stringify({ at: new Date().toISOString(), strats: STRATS.map(([k, l, tf]) => [k, l, tf]), rows, trades, basket }));
  console.log(`wrote ${rows.length} rows, ${trades.length} trades · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

if (mode === 'scenario') {
  // the user's case: Compare in date mode on 15m, last 3 months, today's Top 50 gainers (research/cache/lb15/gainers.json)
  const G = JSON.parse(fs.readFileSync(path.join(ROOT, 'research', 'cache', 'lb15', 'gainers.json')));
  const FROM = Date.UTC(2026, 7, 5) / 1e3, TO = Date.UTC(2026, 10, 5, 16) / 1e3, BTCall = load('BTCUSDT');
  const out = [];
  for (const sym of G.syms) {
    const full = load(sym, path.join(ROOT, 'research', 'cache', 'lb15', 'recent')) || load(sym);
    const c = full ? full.filter((b) => b.time >= FROM && b.time < TO) : [];
    if (c.length < 3000) { out.push({ sym, short: c.length }); continue; }
    const refFrom = Math.min(FROM, TO - 10000 * 900), btc = BTCall.filter((b) => b.time >= refFrom - 201 * 86400 && b.time < TO);
    const S = btcStates(btc), jIdx = alignIdx(c, S), lead = leadArr(c);
    const veto = (g) => Array.from({ length: c.length }, (_, i) => !!g(S, jIdx[i], lead[i]));
    const gate = (s, j, L) => (j >= 0 && s.ma(50)[j]) || L, both = (s, j, L) => (j >= 0 && s.ma(50)[j] && s.maBars(149)[j]) || L;
    const btc4 = sym === 'BTCUSDT' ? agg(c, 14400).bars : agg(btc, 14400).bars, c4 = agg(c, 14400).bars;
    const runs = {
      L0: [c, toDet(simulate(c, indicators(c), { fill: 'close', exit: 'scale3R', veto: veto(gate) }), c)],
      Vsxb: [c, sim15(c, ind15(c, { ma: 'bars', atr: '15m', vol: '4h' }), { veto: veto(both), stopA: ind15(c, { atr: '4h' }).a, exit4h: true })],
      H4e: [c, simH4(c, btc4, 'early')],
      H4: [c4, SMC.detectAll(c4, { strategy: 'liqbrk', longOnly: true, useLiq: false, btc: btc4 }).trades],
    };
    const res = { sym: sym.replace('USDT', ''), g: {} };
    for (const [k, [cc, T]] of Object.entries(runs)) { const e = pathStats(T, cc);
      res.g[k] = { net: e.net, edge: e.edge, dd: e.dd, n: e.n, wr: e.wr, pf: e.pf, pos: e.pos, tr: T.filter((t) => t.outcome !== 'open').map((t) => +netOf(t).toFixed(4)) }; }
    out.push(res);
  }
  fs.writeFileSync(path.join(OUT, 'scenario.json'), JSON.stringify({ list: G, from: FROM, to: TO, out }));
  const ok = out.filter((r) => r.g), med = (v) => { const s = v.slice().sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  for (const k of ['L0', 'Vsxb', 'H4e', 'H4']) {
    const G2 = ok.map((r) => r.g[k]), T = G2.flatMap((x) => x.tr), w = T.filter((x) => x > 0), gp = w.reduce((s, x) => s + x, 0), gl = -T.filter((x) => x <= 0).reduce((s, x) => s + x, 0);
    console.log(`${k.padEnd(5)} coins profitable ${G2.filter((x) => x.net > 0).length}/${G2.length} · trades ${T.length} · WR ${(w.length / Math.max(1, T.length) * 100).toFixed(0)}% · PF ${(gp / gl).toFixed(2)} · avg coin ${(G2.reduce((s, x) => s + x.net, 0) / G2.length * 100).toFixed(1)}% · median coin ${(med(G2.map((x) => x.net)) * 100).toFixed(1)}%`);
  }
  console.log(`skipped: ${out.filter((r) => !r.g).map((r) => r.sym.replace('USDT', '') + ' ' + r.short).join(', ') || 'none'}`);
}
