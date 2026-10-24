/*
 * Version-2 research: five breakout/momentum swing strategies on 4h spot, from very simple to "pro",
 * judged against the shipped liqbrk (v1). RESEARCH ONLY — the app, the bot and the alerts are not touched.
 *
 *   python research/fetch_klines.py 4h --file research/v2/universe.txt     (full 4h history, 61 alert coins)
 *   python research/fetch_klines.py 4h BTC ; python research/fetch_klines.py 2h BTC
 *   node research/v2/v2_lab.js parity       # the generic engine must reproduce liqbrk_lab (v1) trade-for-trade
 *   node research/v2/v2_lab.js > research/v2/RESULTS_v2_2026-10.md
 *
 * Everything trades the same way: signal at a 4h CLOSE, entry at the NEXT open + 0.05% slippage, stops fill at
 * min(open, stop) − 0.05%, take-profit tiers at max(open, target) − 0.05%, close-based exits at the next open
 * − 0.05%, 0.1% fee per side. One position per coin, all-in per coin (the app's exposure model); the portfolio
 * section shares one pot across coins.
 */
'use strict';
const fs = require('fs'), path = require('path');
const L = require('../liqbrk_lab.js');
const SMC = L.SMC;
const CACHE = path.join(__dirname, '..', 'cache');
const FEE = 0.001;
let SLIP = 0.0005;                                    // per side; setSlip() for the cost check
const BPD = 6;                                         // 4h bars per day
const D = (days) => Math.round(days * BPD);
const A0 = Date.UTC(2020, 0, 1) / 1000, B0 = Date.UTC(2023, 0, 1) / 1000;
const COMMON_WARM = 320;                               // every strategy is judged from the same first bar

// ------------------------------------------------------------------ data
const load4h = (coin) => {
  const f = path.join(CACHE, `${coin}_4h.json`);
  if (!fs.existsSync(f)) return null;
  return JSON.parse(fs.readFileSync(f)).map(r => ({ time: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] }));
};
const COINS = fs.readFileSync(path.join(__dirname, 'universe.txt'), 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
const BTC4 = load4h('BTC');
const BTC2 = L.load('BTC', '2h');
const btcIdx = new Map(BTC4.map((b, i) => [b.time, i]));

// ------------------------------------------------------------------ indicators
const sma = (x, n) => { const o = new Array(x.length).fill(NaN); let s = 0;
  for (let i = 0; i < x.length; i++) { s += x[i]; if (i >= n) s -= x[i - n]; if (i >= n - 1) o[i] = s / n; } return o; };
const ema = (x, n) => { const o = new Array(x.length).fill(NaN), k = 2 / (n + 1); let e = NaN, s = 0;
  for (let i = 0; i < x.length; i++) { if (isNaN(e)) { s += x[i]; if (i === n - 1) { e = s / n; o[i] = e; } } else { e = x[i] * k + e * (1 - k); o[i] = e; } } return o; };
const stdev = (x, n) => { const m = sma(x, n), o = new Array(x.length).fill(NaN);
  for (let i = n - 1; i < x.length; i++) { let s = 0; for (let j = i - n + 1; j <= i; j++) s += (x[j] - m[i]) ** 2; o[i] = Math.sqrt(s / n); } return o; };
const maxPrior = (x, n) => { const o = new Array(x.length).fill(Infinity);
  for (let i = 1; i < x.length; i++) { let m = -Infinity; for (let j = Math.max(0, i - n); j < i; j++) if (x[j] > m) m = x[j]; o[i] = m; } return o; };
const minPrior = (x, n) => { const o = new Array(x.length).fill(-Infinity);
  for (let i = 1; i < x.length; i++) { let m = Infinity; for (let j = Math.max(0, i - n); j < i; j++) if (x[j] < m) m = x[j]; o[i] = m; } return o; };
function adx(c, n = 14) {
  const N = c.length, out = new Array(N).fill(NaN);
  let trS = 0, pS = 0, mS = 0, a = NaN; const dxs = [];
  for (let i = 1; i < N; i++) {
    const up = c[i].high - c[i - 1].high, dn = c[i - 1].low - c[i].low;
    const pdm = up > dn && up > 0 ? up : 0, mdm = dn > up && dn > 0 ? dn : 0;
    const tr = Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close));
    if (i <= n) { trS += tr; pS += pdm; mS += mdm; if (i < n) continue; }
    else { trS += tr - trS / n; pS += pdm - pS / n; mS += mdm - mS / n; }
    const pdi = trS ? 100 * pS / trS : 0, mdi = trS ? 100 * mS / trS : 0;
    const dx = pdi + mdi ? 100 * Math.abs(pdi - mdi) / (pdi + mdi) : 0;
    if (isNaN(a)) { dxs.push(dx); if (dxs.length === n) a = dxs.reduce((s, v) => s + v, 0) / n; } else a = (a * (n - 1) + dx) / n;
    out[i] = a;
  }
  return out;
}
// BTC on the coin's own bars: the BTC 4h candle that closes at the same moment (both are UTC-aligned)
function btcOn(c) {
  const bc = BTC4.map(b => b.close), ma50 = sma(bc, D(50)), r30 = bc.map((v, i) => i >= D(30) ? v / bc[i - D(30)] - 1 : NaN);
  let last = -1;
  const j = c.map(b => { const k = btcIdx.get(b.time); if (k !== undefined) last = k; return last; });
  return {
    close: j.map(k => k >= 0 ? bc[k] : NaN),
    above50: j.map(k => k >= 0 && bc[k] > ma50[k]),
    ma50rising: j.map(k => k >= D(10) && ma50[k] > ma50[k - D(10)]),
    r30: j.map(k => k >= 0 ? r30[k] : NaN),
  };
}

// ------------------------------------------------------------------ the generic engine
// S = { warm, sig[], strength[], stop(i, entry), targets:[{R, frac}], trail:{type:'low'|'chand'|'ema', arr|k}, atr[] }
function simulate(c, S) {
  const n = c.length, trades = []; let pos = null;
  const sell = (px) => px * (1 - SLIP);
  const close = (j, px, why) => {
    const legs = pos.legs.concat([{ w: pos.w, px, i: j }]);
    const ret = legs.reduce((s, l) => s + l.w * l.px * (1 - FEE), 0) / (pos.entry * (1 + FEE)) - 1;
    const gross = legs.reduce((s, l) => s + l.w * l.px, 0);
    trades.push({ entryIdx: pos.entryIdx, sigIdx: pos.sigIdx, exitIdx: j, entry: pos.entry, stop: pos.stop0, ret, legs, why,
      R: isFinite(pos.risk) && pos.risk > 0 ? (gross - pos.entry) / pos.risk : NaN, strength: pos.strength });
    pos = null;
  };
  for (let i = S.warm; i < n; i++) {
    const b = c[i];
    if (pos && i >= pos.entryIdx) {
      if (pos.pending) { close(i, sell(b.open), pos.pending); continue; }        // decided at the last close
      if (b.close > pos.hiC) pos.hiC = b.close;
      if (b.low <= pos.stop) { close(i, sell(Math.min(b.open, pos.stop)), 'STOP'); continue; }
      for (const t of pos.tiers) if (!t.done && b.high >= t.px) {
        t.done = true; pos.legs.push({ w: t.frac, px: sell(Math.max(b.open, t.px)), i }); pos.w -= t.frac;
      }
      let why = null;
      const tr = S.trail;
      if (tr.type === 'low' && b.close < tr.arr[i]) why = 'TRAIL';
      else if (tr.type === 'chand' && b.close < pos.hiC - tr.k * S.atr[i]) why = 'CHAND';
      else if (tr.type === 'ema' && b.close < tr.arr[i]) why = 'EMA';
      if (why) { if (i + 1 < n) pos.pending = why; else close(i, sell(b.close), why); }
    } else if (!pos && S.sig[i]) {
      if (i + 1 >= n) continue;
      const e = c[i + 1].open * (1 + SLIP);
      const stop = S.stop(i, e);
      const risk = e - stop;
      pos = { entry: e, stop, stop0: stop, risk, entryIdx: i + 1, sigIdx: i, hiC: e, w: 1, legs: [], strength: S.strength[i],
        tiers: (S.targets || []).map(t => ({ px: e + t.R * risk, frac: t.frac, done: false })) };
    }
  }
  return { trades, open: pos };
}

// ------------------------------------------------------------------ strategies
// Each builder returns the S object for simulate(). All lookbacks are on 4h bars; D(days) converts days.
function features(c) {
  const close = c.map(b => b.close), high = c.map(b => b.high), low = c.map(b => b.low), vol = c.map(b => b.volume || 0);
  const atr = SMC.atr(c, 14);
  const rv = vol.map((v, i) => { let s = 0, k = 0; for (let j = Math.max(0, i - 5); j <= i; j++) { s += vol[j]; k++; } const a = s / k; return a > 0 ? v / a : 1; });
  const rpos = c.map(b => b.high > b.low ? (b.close - b.low) / (b.high - b.low) : 0.5);
  return { close, high, low, vol, atr, rv, rpos, btc: btcOn(c) };
}

const STRATS = {};
// v1 — the shipped liqbrk (BTC 50d gate or 30-day leader, ½ at 3R), built from the parity-checked lab pieces
STRATS.v1 = { name: 'v1 — current liqbrk (shipped)', level: 'reference', build(c, F) {
  const ind = L.indicators(c), gate = L.marketGate(c, BTC2);
  return { warm: ind.warm, sig: ind.sig.map((s, i) => s && gate[i]), strength: ind.rv, atr: ind.a,
    stop: (i, e) => e - ind.p.lbStop * ind.a[i], targets: [{ R: 3, frac: 0.5 }], trail: { type: 'low', arr: ind.loE } };
} };
// S1 — very simple: a 20-bar channel breakout, out on a 10-bar low. One entry rule, one exit rule.
STRATS.s1 = { name: 'S1 — Simple breakout', level: '1 (simplest)', rules: [
  'BUY: 4h close above the highest high of the previous 20 candles (≈3.3 days)',
  'SELL: 4h close below the lowest low of the previous 10 candles', 'no stop, no filters, no take-profit'],
  build(c, F) {
    const hi = maxPrior(F.high, 20), lo = minPrior(F.low, 10);
    return { warm: 25, sig: F.close.map((x, i) => x > hi[i]), strength: F.close.map((x, i) => x / hi[i] - 1), atr: F.atr,
      stop: () => -Infinity, targets: [], trail: { type: 'low', arr: lo } };
  } };
// S2 — simple + trend: the same breakout, only above the 50-day EMA, with a volatility stop
STRATS.s2 = { name: 'S2 — Trend breakout', level: '2', rules: [
  'BUY: close above the 20-candle high AND above the 50-day EMA', 'SELL: close below the 10-candle low',
  'STOP: 2.5×ATR below entry'],
  build(c, F) {
    const hi = maxPrior(F.high, 20), lo = minPrior(F.low, 10), e50 = ema(F.close, D(50));
    return { warm: D(50) + 2, sig: F.close.map((x, i) => x > hi[i] && x > e50[i]), strength: F.close.map((x, i) => x / hi[i] - 1),
      atr: F.atr, stop: (i, e) => e - 2.5 * F.atr[i], targets: [], trail: { type: 'low', arr: lo } };
  } };
// S3 — medium: momentum breakout confirmed by volume, candle strength, a rising trend and BTC
STRATS.s3 = { name: 'S3 — Volume momentum', level: '3', rules: [
  'BUY: close above the prior 3-day high, volume ≥ 2× its 1-day average, close in the top 30% of the candle,',
  '     20-day EMA rising (vs 1 day ago), BTC above its 50-day MA',
  'STOP: 3×ATR · TAKE ⅓ at +2R · rest trails 3×ATR below the highest close (chandelier)'],
  build(c, F) {
    const hi = maxPrior(F.high, D(3)), e20 = ema(F.close, D(20));
    const sig = F.close.map((x, i) => i > D(1) && x > hi[i] && F.rv[i] >= 2 && F.rpos[i] >= 0.7 && e20[i] > e20[i - D(1)] && F.btc.above50[i]);
    return { warm: D(20) + D(1) + 2, sig, strength: F.rv, atr: F.atr, stop: (i, e) => e - 3 * F.atr[i],
      targets: [{ R: 2, frac: 1 / 3 }], trail: { type: 'chand', k: 3 } };
  } };
// S4 — advanced: volatility squeeze (Bollinger inside Keltner) that fires upward, in a trend, with BTC
STRATS.s4 = { name: 'S4 — Squeeze breakout', level: '4', rules: [
  'SETUP: Bollinger(20, 2σ) inside Keltner(20, 1.5×ATR) on at least one of the previous 6 candles (squeeze)',
  'BUY: close above the upper Bollinger band AND above the prior 2-day high, volume ≥ 1.5×, close above the 50-day EMA,',
  '     BTC above its 50-day MA',
  'STOP: the squeeze-box low (12-candle low) or 3×ATR, whichever is closer, never closer than 1×ATR',
  'TAKE ½ at +2.5R · rest exits on a close below the 20-candle EMA (Bollinger mid-line)'],
  build(c, F) {
    const bb = sma(F.close, 20), sd = stdev(F.close, 20), kc = ema(F.close, 20), atr20 = SMC.atr(c, 20);
    const squeeze = F.close.map((_, i) => (bb[i] + 2 * sd[i]) < (kc[i] + 1.5 * atr20[i]) && (bb[i] - 2 * sd[i]) > (kc[i] - 1.5 * atr20[i]));
    const recent = squeeze.map((_, i) => { for (let j = Math.max(0, i - 6); j < i; j++) if (squeeze[j]) return true; return false; });
    const hi2 = maxPrior(F.high, D(2)), box = minPrior(F.low, 12), e50 = ema(F.close, D(50));
    const sig = F.close.map((x, i) => recent[i] && x > bb[i] + 2 * sd[i] && x > hi2[i] && F.rv[i] >= 1.5 && x > e50[i] && F.btc.above50[i]);
    return { warm: D(50) + 2, sig, strength: F.rv, atr: F.atr,
      stop: (i, e) => { let s = Math.max(box[i], e - 3 * F.atr[i]); if (e - s < F.atr[i]) s = e - F.atr[i]; return s; },
      targets: [{ R: 2.5, frac: 0.5 }], trail: { type: 'ema', arr: kc } };
  } };
// S5 — pro: risk-on regime + trend stack + relative strength + pullback-then-breakout + trend strength + candle quality
STRATS.s5 = { name: 'S5 — Pro multi-factor', level: '5 (toughest)', rules: [
  'REGIME: BTC above its 50-day MA AND that MA rising over 10 days',
  'TREND: 10-day EMA > 20-day EMA > 50-day EMA, price above the 10-day EMA',
  'STRENGTH: coin beat BTC over 30 days AND its coin/BTC ratio is within 3% of a 20-day high',
  'SETUP: in the last 3 days the price pulled back to within 1×ATR of the 10-day EMA',
  'TRIGGER: close above the prior 2-day high, volume ≥ 1.5×, close in the top 25% of the candle, ADX(14) ≥ 20',
  'STOP: 3-day swing low or 3×ATR, whichever is closer, never closer than 1×ATR',
  'TAKE ⅓ at +2R and ⅓ at +4R · last ⅓ trails 3×ATR below the highest close'],
  build(c, F) {
    const e10 = ema(F.close, D(10)), e20 = ema(F.close, D(20)), e50 = ema(F.close, D(50)), ax = adx(c, 14);
    const r30 = F.close.map((x, i) => i >= D(30) ? x / F.close[i - D(30)] - 1 : NaN);
    const ratio = F.close.map((x, i) => x / F.btc.close[i]), rmax = maxPrior(ratio, D(20));
    const touched = F.close.map((_, i) => { for (let j = Math.max(0, i - D(3)); j < i; j++) if (F.low[j] - e10[j] <= F.atr[j]) return true; return false; });
    const hi2 = maxPrior(F.high, D(2)), sw = minPrior(F.low, D(3));
    const sig = F.close.map((x, i) => F.btc.above50[i] && F.btc.ma50rising[i]
      && e10[i] > e20[i] && e20[i] > e50[i] && x > e10[i]
      && r30[i] - F.btc.r30[i] > 0 && ratio[i] >= 0.97 * rmax[i]
      && touched[i] && x > hi2[i] && F.rv[i] >= 1.5 && F.rpos[i] >= 0.75 && ax[i] >= 20);
    return { warm: D(50) + 2, sig, strength: F.rv, atr: F.atr,
      stop: (i, e) => { let s = Math.max(sw[i], e - 3 * F.atr[i]); if (e - s < F.atr[i]) s = e - F.atr[i]; return s; },
      targets: [{ R: 2, frac: 1 / 3 }, { R: 4, frac: 1 / 3 }], trail: { type: 'chand', k: 3 } };
  } };

// ------------------------------------------------------------------ statistics
function stats(c, warm, trades) {
  const n = c.length, eq = new Array(n).fill(1), byEntry = new Map(trades.map(t => [t.entryIdx, t]));
  let e = 1, cur = null, e0 = 1, held = 0;
  for (let i = 0; i < n; i++) {
    if (!cur && byEntry.has(i)) { cur = byEntry.get(i); e0 = e; }
    if (cur) {
      held++;
      if (i >= cur.exitIdx) { e = e0 * (1 + cur.ret); cur = null; }
      else {
        let v = 0, w = 1;
        for (const l of cur.legs.slice(0, -1)) if (l.i <= i) { v += l.w * l.px * (1 - FEE); w -= l.w; }
        v += w * c[i].close * (1 - FEE); e = e0 * v / (cur.entry * (1 + FEE));
      }
    }
    eq[i] = e;
  }
  const net = trades.reduce((m, t) => m * (1 + t.ret), 1) - 1;
  let pk = 1, dd = 0; for (let i = warm; i < n; i++) { pk = Math.max(pk, eq[i]); dd = Math.max(dd, (pk - eq[i]) / pk); }
  const wins = trades.filter(t => t.ret > 0), gp = wins.reduce((s, t) => s + t.ret, 0), gl = -trades.filter(t => t.ret <= 0).reduce((s, t) => s + t.ret, 0);
  const top3 = trades.slice().sort((a, b) => b.ret - a.ret).slice(0, 3), rest = trades.filter(t => !top3.includes(t));
  const gp3 = rest.filter(t => t.ret > 0).reduce((s, t) => s + t.ret, 0), gl3 = -rest.filter(t => t.ret <= 0).reduce((s, t) => s + t.ret, 0);
  const bh = c[n - 1].close / c[warm].close - 1;
  const W = Math.max(50, Math.round((n - warm) * 0.35)), step = Math.max(1, Math.round(W / 8));
  let wn = 0, wp = 0; for (let s = warm; s + W < n; s += step) { wn++; if (eq[s + W] > eq[s]) wp++; }
  const cyc = (lo, hi) => { const ts = trades.filter(t => c[t.entryIdx].time >= lo && c[t.entryIdx].time < hi);
    return { n: ts.length, net: ts.reduce((m, t) => m * (1 + t.ret), 1) - 1 }; };
  return { n: trades.length, wr: trades.length ? wins.length / trades.length : 0, pf: gl > 0 ? gp / gl : (gp > 0 ? Infinity : 0),
    pf3: gl3 > 0 ? gp3 / gl3 : (gp3 > 0 ? Infinity : 0), net, bh, edge: (1 + net) / (1 + bh) - 1, dd, stab: wn ? wp / wn : NaN,
    expo: held / Math.max(1, n - warm), yrs: (c[n - 1].time - c[warm].time) / 31557600,
    A: cyc(A0, B0), B: cyc(B0, Infinity), first: c[warm].time };
}
function pooled(rows) {
  const t = rows.flatMap(r => r.trades);
  const pf = (ts) => { const gp = ts.filter(x => x.ret > 0).reduce((s, x) => s + x.ret, 0), gl = -ts.filter(x => x.ret <= 0).reduce((s, x) => s + x.ret, 0); return gl > 0 ? gp / gl : Infinity; };
  const top = t.slice().sort((a, b) => b.ret - a.ret).slice(0, Math.max(1, Math.round(t.length * 0.02)));
  return { n: t.length, wr: t.filter(x => x.ret > 0).length / Math.max(1, t.length), pf: pf(t), pfTop: pf(t.filter(x => !top.includes(x))),
    avg: t.reduce((s, x) => s + x.ret, 0) / Math.max(1, t.length) };
}

// ------------------------------------------------------------------ run one strategy on one coin
const DATA = {};
function runOne(key, coin, warmOverride) {
  if (!DATA[coin]) { const c = load4h(coin); DATA[coin] = c && c.length > COMMON_WARM + 200 ? { c, F: features(c) } : null; }
  const d = DATA[coin]; if (!d) return null;
  const S = STRATS[key].build(d.c, d.F);
  S.warm = warmOverride != null ? warmOverride : Math.max(S.warm, COMMON_WARM);
  const r = simulate(d.c, S);
  return { coin, key, trades: r.trades, open: r.open, ...stats(d.c, S.warm, r.trades) };
}

// ------------------------------------------------------------------ portfolio: one pot, N slots, all coins competing
function portfolio(key, coins, N, start) {
  const ents = new Map(), ser = {}; let total = 0;
  for (const coin of coins) {
    const r = runOne(key, coin); if (!r) continue;
    const c = DATA[coin].c; ser[coin] = { c, idx: new Map(c.map((b, i) => [b.time, i])) };
    for (const t of r.trades) { const tIn = c[t.entryIdx].time; if (tIn < start) continue; total++;
      (ents.get(tIn) || ents.set(tIn, []).get(tIn)).push({ coin, t, tOut: c[t.exitIdx].time }); }
  }
  const times = BTC4.map(b => b.time).filter(t => t >= start);
  let cash = 1, open = [], taken = 0, pk = 1, dd = 0, inv = 0; const curve = [];
  for (const T of times) {
    for (let k = open.length - 1; k >= 0; k--) if (open[k].x.tOut <= T) { cash += open[k].alloc * (1 + open[k].x.t.ret); open.splice(k, 1); }
    for (const x of (ents.get(T) || []).sort((a, b) => b.t.strength - a.t.strength)) {
      if (open.length >= N || open.some(o => o.x.coin === x.coin)) continue;
      const E = cash + open.reduce((s, o) => s + o.val, 0), alloc = Math.min(cash, E / N); if (alloc <= 1e-12) continue;
      cash -= alloc; open.push({ x, alloc, val: alloc }); taken++;
    }
    for (const o of open) { const s = ser[o.x.coin], i = s.idx.get(T); if (i === undefined) continue;
      let v = 0, w = 1; for (const l of o.x.t.legs.slice(0, -1)) if (l.i <= i) { v += l.w * l.px * (1 - FEE); w -= l.w; }
      v += w * s.c[i].close * (1 - FEE); o.val = o.alloc * v / (o.x.t.entry * (1 + FEE)); }
    const iv = open.reduce((s, o) => s + o.val, 0), E = cash + iv;
    inv += E > 0 ? iv / E : 0; pk = Math.max(pk, E); dd = Math.max(dd, (pk - E) / pk); curve.push([T, E]);
  }
  const E = curve[curve.length - 1][1], yrs = (times[times.length - 1] - times[0]) / 31557600;
  const yearly = {}; let prev = 1, py = new Date(times[0] * 1000).getUTCFullYear();
  for (const [T, e] of curve) { const y = new Date(T * 1000).getUTCFullYear(); if (y !== py) { prev = yearly[py] !== undefined ? prev * (1 + yearly[py]) : prev; py = y; } yearly[py] = e / prev - 1; }
  return { E, cagr: Math.pow(E, 1 / yrs) - 1, dd, taken, skipped: total - taken, expo: inv / times.length, yearly, curve };
}
function btcHold(start) {
  const xs = BTC4.filter(b => b.time >= start); let pk = 0, dd = 0; for (const b of xs) { pk = Math.max(pk, b.close); dd = Math.max(dd, (pk - b.close) / pk); }
  const E = xs[xs.length - 1].close / xs[0].open, yrs = (xs[xs.length - 1].time - xs[0].time) / 31557600;
  const yearly = {}; for (let y = new Date(start * 1000).getUTCFullYear(); y <= new Date().getUTCFullYear(); y++) {
    const z = xs.filter(b => new Date(b.time * 1000).getUTCFullYear() === y); if (z.length) yearly[y] = z[z.length - 1].close / z[0].open - 1; }
  return { E, cagr: Math.pow(E, 1 / yrs) - 1, dd, yearly };
}

const setSlip = (x) => { SLIP = x; };
module.exports = { STRATS, simulate, runOne, stats, pooled, portfolio, btcHold, setSlip, COINS, DATA, load4h };

// ------------------------------------------------------------------ parity: the generic engine vs the parity-checked lab
if (require.main === module && process.argv[2] === 'parity') {
  let bad = 0, total = 0;
  for (const coin of COINS) {
    const c = load4h(coin); if (!c || c.length < 400) continue;
    const ind = L.indicators(c), gate = L.marketGate(c, BTC2);
    const ref = L.simulate(c, ind, { fill: 'next', slip: SLIP, exit: 'scale3R', veto: gate }).trades;
    const mine = runOne('v1', coin, ind.warm).trades;
    const same = ref.length === mine.length && ref.every((r, k) => r.entryIdx === mine[k].entryIdx && r.exitIdx === mine[k].exitIdx && Math.abs(r.ret - mine[k].ret) < 1e-12);
    total++; if (!same) { bad++; console.log(`MISMATCH ${coin}: lab ${ref.length} trades, generic ${mine.length}`); }
  }
  console.log(bad ? `${bad}/${total} MISMATCHED` : `PARITY OK — the generic engine reproduces liqbrk_lab (v1, honest fills) on ${total} coins trade-for-trade`);
}
