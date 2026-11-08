/*
 * The layered BTC-flush strategy, run as a real portfolio (Nov 2026, user request: "a deep logical layered strategy
 * like a world-class trader would, not a basic one, and actual backtested results"). RESEARCH ONLY.
 *
 *   node research/flush/pro_lab.js prep        # extract every coin's features and price windows around each flush
 *   node research/flush/pro_lab.js run         # the strategy, its ablations and robustness → research/cache/flush/pro.json
 *
 * THE LAYERS (every number set from the trading logic before the run; the ablations switch each layer off):
 *  1 REGIME     BTC over its 50-day MA → mode A (risk-on); under it → mode B (risk-off)
 *  2 EVENT      a liquidation flush: BTC's 15m close ≥ 1 daily ATR under its 2-hour high, red candle, a 15m volume
 *               ≥ 3× the day's average, the 3-day low swept (flush_lab.js findArms)
 *  3 SELECTION  the 5 most DISLOCATED liquid coins: drop − β × BTC's drop, β from 30 days of hourly returns; a coin that
 *               fell > 3× what its β predicts is skipped (its own news, not the flush); ≥ $1M a day; no stablecoins
 *  4 EXECUTION  a ladder of 3 equal orders per coin. A: ⅓ at market, bids ½ and 1 daily ATR down. B: bids ¾, 1 and 1¼
 *               ATR down, no market buy. Bids live 2 hours.
 *  5 RISK       each coin sized so its stop costs 1% of the pot (A) or 0.75% (B); ≤ 25% of the pot in a coin, ≤ 100% total
 *  6 EXITS      stop 1 ATR (A) / 1¼ ATR (B) under the average fill; half sold at +½ ATR, then the stop goes to breakeven
 *               and the unfilled bids are cancelled; the rest at +1 ATR, or sold 6 hours after the first fill
 *  7 KILL       a BTC 15m close one more daily ATR under the flush low: sell everything, cancel every bid
 * EXECUTION MODEL: a limit order fills at its own price once traded (never better); within a 15m candle the stop is
 * assumed to come first; a take-profit cannot fill on the candle that added to the position; fees 0.1% a side, plus
 * 0.15% slippage on market orders, stops and timed exits. The portfolio is marked to market every 15 minutes.
 */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const { load, LIST } = require('../liqbrk15m/lab15.js');
const { btcContext, findArms, dailyAtrPct } = require('./flush_lab.js');
const OUT = path.join(ROOT, 'research', 'cache', 'flush');
const DEADDIR = path.join(ROOT, 'research', 'cache', 'lb15dead');
const BAR = 900, WIN = 48;                                   // a flush is followed for at most 12 hours
const TRUNC = { LUNAUSDT: Date.UTC(2022, 4, 14) / 1e3 };     // the original LUNA only (the ticker was reused)
const STABLE = /USD|^(DAI|PAX|UST|EUR|GBP|AUD|TRY|BRL|IDRT|BIDR)$/;

function universe(withDead) {
  const U = LIST.map((s) => [s, null]);
  if (withDead && fs.existsSync(DEADDIR)) for (const f of fs.readdirSync(DEADDIR).sort()) if (f.endsWith('_15m.json')) U.push([f.replace('_15m.json', ''), DEADDIR]);
  return U;
}
// close of every hour (its last 15m candle), keyed by the hour's start
function hourly(c) { const m = new Map(); for (const b of c) if ((b.time + BAR) % 3600 === 0) m.set(b.time + BAR - 3600, b.close); return m; }
function betaOf(hc, hb, t0, t1) {
  let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let h = Math.ceil(t0 / 3600) * 3600 + 3600; h < t1; h += 3600) {          // hour-aligned keys (hourly() keys hour starts)
    const c1 = hc.get(h), c0 = hc.get(h - 3600), b1 = hb.get(h), b0 = hb.get(h - 3600);
    if (!(c1 > 0 && c0 > 0 && b1 > 0 && b0 > 0)) continue;
    const y = Math.log(c1 / c0), x = Math.log(b1 / b0); n++; sx += x; sy += y; sxx += x * x; sxy += x * y;
  }
  if (n < 360) return NaN;                                    // at least 15 days of hourly data
  const vx = sxx / n - (sx / n) ** 2;
  return vx > 0 ? (sxy / n - (sx / n) * (sy / n)) / vx : NaN;
}

// ---------------------------------------------------------------- PREP: features + 12-hour windows for every coin at every arm
function prepare(arms, U, B) {
  const hb = hourly(B), at = new Map(B.map((b, i) => [b.time, i])), btcAtr = dailyAtrPct(B);
  for (const e of arms) {
    const i = at.get(e.t), s = at.get(e.s0t);
    let hi = -Infinity, lo = Infinity; for (let q = s; q <= i; q++) { if (B[q].high > hi) hi = B[q].high; if (B[q].low < lo) lo = B[q].low; }
    e.btc = { P: B[i].close, drop: B[i].close / hi - 1, L0: lo, atrP: btcAtr(e.t), closes: Array.from({ length: WIN + 1 }, (_, k) => (B[i + k] ? B[i + k].close : null)) };
    e.coins = [];
  }
  const t0 = Date.now();
  for (const [idx, [sym, dir]] of U.entries()) {
    const base = sym.replace(/USDT$/, '');
    if (STABLE.test(base)) continue;
    let c = dir ? load(sym, dir) : load(sym); if (!c) continue;
    if (TRUNC[sym]) c = c.filter((b) => b.time < TRUNC[sym]);
    const ci = new Map(c.map((b, i) => [b.time, i])), atrOf = dailyAtrPct(c), hc = hourly(c);
    for (const e of arms) {
      const i = ci.get(e.t), s = ci.get(e.s0t); if (i == null || s == null || s < 2900) continue;
      let dv = 0; for (let q = s - 2880; q < s; q++) dv += c[q].volume * c[q].close; dv /= 30;
      if (dv < 1e6) continue;
      const atrP = atrOf(e.t); if (!(atrP > 0)) continue;
      let hi = -Infinity; for (let q = s; q <= i; q++) if (c[q].high > hi) hi = c[q].high;
      const w = [];
      for (let k = 0; k <= WIN; k++) { const q = ci.get(e.t + k * BAR); w.push(q == null ? null : [c[q].open, c[q].high, c[q].low, c[q].close]); }
      e.coins.push({ sym: base, dead: !!dir, P: c[i].close, drop: c[i].close / hi - 1, dv: Math.round(dv), atrP: +atrP.toFixed(5),
        beta: +(betaOf(hc, hb, e.s0t - 30 * 86400, e.s0t) || NaN).toFixed(3), r7: +(c[s].close / c[s - 672].close - 1).toFixed(4), w });
    }
    if (idx % 20 === 0) process.stderr.write(`prep ${idx + 1}/${U.length} ${sym} · ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
  }
  return arms;
}

// ---------------------------------------------------------------- THE PORTFOLIO SIMULATOR
const FEE = 0.001;
const BASE = {
  name: 'layered',
  regime: true,                          // 1: modes by BTC's 50-day MA (false: mode A everywhere; 'B': mode B everywhere)
  select: 'dislocation', K: 5, idio: 3,  // 3
  A: { ladder: [0, 0.5, 1.0], sl: 1.0, risk: 0.010 },
  B: { ladder: [0.75, 1.0, 1.25], sl: 1.25, risk: 0.0075 },
  sizing: 'risk', capCoin: 0.25, capAll: 1.0, equalW: 0.2,   // 5
  tp1: 0.5, tp1Frac: 0.5, tp2: 1.0, breakeven: true, hold: 24, W: 8,   // 6
  kill: 1.0,                             // 7 (0 = off)
  slip: 0.0015, margin: 0, seed: 7,
};
function pick(e, cfg) {
  const L = e.coins.filter((x) => x.w[0] && isFinite(x.P) && x.P > 0 && !(cfg.noDead && x.dead));
  const news = (x) => cfg.idio > 0 && isFinite(x.beta) && x.drop < cfg.idio * x.beta * e.btc.drop && x.drop < -0.05;   // fell > idio× its β: its own news
  if (cfg.select === 'fell') return L.filter((x) => !news(x)).sort((a, b) => a.drop - b.drop).slice(0, cfg.K);
  if (cfg.select === 'random') { const r = require('../rng.js').mulberry32(cfg.seed + Math.round(e.t / 900));
    return L.map((x) => [r(), x]).sort((a, b) => a[0] - b[0]).slice(0, cfg.K).map((p) => p[1]); }
  const bd = e.btc.drop;
  const ok = L.filter((x) => isFinite(x.beta) && x.beta > 0.2 && (!(cfg.idio > 0) || !(x.drop < cfg.idio * x.beta * bd && x.drop < -0.05)));
  return ok.map((x) => [x.drop - x.beta * bd, x]).sort((a, b) => a[0] - b[0]).slice(0, cfg.K).map((p) => p[1]);
}
function simulate(arms, cfg0) {
  const cfg = { ...BASE, ...cfg0, A: { ...BASE.A, ...(cfg0.A || {}) }, B: { ...BASE.B, ...(cfg0.B || {}) } };
  let cash = 1, busyUntil = -Infinity, peak = 1, dd = 0;
  const curve = [[arms.length ? arms[0].t - 86400 : 0, 1]], events = [], trades = [];
  for (const e of arms) {
    if (e.t < busyUntil) { events.push({ t: e.t, skipped: 'busy' }); continue; }
    const mode = cfg.regime === true ? (e.bad ? 'B' : 'A') : cfg.regime === 'B' ? 'B' : 'A';
    const M = cfg[mode], cands = pick(e, cfg);
    if (!cands.length) { events.push({ t: e.t, mode, skipped: 'no coin' }); continue; }
    const E0 = cash;
    let P = cands.map((x) => ({ x, notional: Math.min(cfg.capCoin * E0, cfg.sizing === 'risk' ? M.risk * E0 / (M.sl * x.atrP) : cfg.equalW * E0) }));
    const tot = P.reduce((s, p) => s + p.notional, 0); if (tot > cfg.capAll * E0) for (const p of P) p.notional *= cfg.capAll * E0 / tot;
    for (const p of P) {
      p.tr = M.ladder.map((d) => ({ d, lvl: p.x.P * (1 - d * p.x.atrP), cash: p.notional / M.ladder.length, done: false }));
      p.qty = 0; p.cost = 0; p.first = -1; p.half = false; p.closed = false; p.spent = 0; p.got = 0; p.fills = 0; p.why = []; p.last = p.x.P;
    }
    let kNow = 0;
    const buy = (p, px, money, taker) => { const f = FEE + (taker ? cfg.slip : 0); p.qty += money / (px * (1 + f)); p.cost += money / (1 + f); p.spent += money; cash -= money; p.fills++;
      if (cfg.log) (p.log = p.log || []).push({ k: kNow, side: 'buy', px, money: money / E0, how: taker ? 'market' : 'limit' }); };
    const sell = (p, px, q, taker, why) => { const f = FEE + (taker ? cfg.slip : 0); const v = q * px * (1 - f); if (cfg.log) (p.log = p.log || []).push({ k: kNow, side: 'sell', px, money: v / E0, how: why });
      p.qty -= q; cash += v; p.got += v; p.why.push(why); if (p.qty <= 1e-12) { p.qty = 0; p.closed = true; } };
    const levels = (p) => { const avg = p.cost / p.qty; p.avg = avg; if (!p.half) { p.stop = avg * (1 - M.sl * p.x.atrP); p.tp1 = avg * (1 + cfg.tp1 * p.x.atrP); p.tp2 = avg * (1 + cfg.tp2 * p.x.atrP); } };
    const cancel = (p) => { for (const t of p.tr) t.done = true; };
    // the arm candle itself: market tranches fill at its close
    for (const p of P) for (const t of p.tr) if (t.d === 0) { buy(p, p.x.P, t.cash, true); t.done = true; p.first = 0; levels(p); }
    const killPx = cfg.kill > 0 ? e.btc.L0 * (1 - cfg.kill * e.btc.atrP) : -Infinity;
    let k = 1, killed = false, minEq = E0, endT = e.t; const path = [];
    for (; k <= WIN; k++) {
      const T = e.t + k * BAR; kNow = k;
      for (const p of P) {
        if (p.closed) continue;
        const b = p.x.w[k]; if (!b) continue;
        const [o, h, l, cl] = b; let added = false;
        if (p.qty > 0 && l <= p.stop) { sell(p, Math.min(o, p.stop), p.qty, true, p.half ? 'BE' : 'STOP'); cancel(p); }
        if (!p.closed) for (const t of p.tr) {                                   // bids, shallowest first, while they live
          if (t.done || k > cfg.W) continue;
          if (l <= t.lvl * (1 - cfg.margin)) { buy(p, t.lvl, t.cash, false); t.done = true; added = true; if (p.first < 0) p.first = k; levels(p); }
        }
        if (added && p.qty > 0 && l <= p.stop) { sell(p, p.stop, p.qty, true, 'STOP'); cancel(p); }       // worst case in the fill candle
        if (!p.closed && p.qty > 0 && !added) {
          if (!p.half && h >= p.tp1) { sell(p, p.tp1, p.qty * cfg.tp1Frac, false, 'TP1'); p.half = true; cancel(p);
            if (cfg.breakeven && !p.closed) p.stop = p.avg * (1 + 2 * FEE); }
          if (!p.closed && p.half && cfg.tp1Frac < 1 && h >= p.tp2) sell(p, p.tp2, p.qty, false, 'TP2');
        }
        if (!p.closed && p.qty > 0 && p.first >= 0 && k - p.first >= cfg.hold) { sell(p, cl, p.qty, true, 'TIME'); cancel(p); }
        if (!p.closed && p.qty === 0 && p.tr.every((t) => t.done || k >= cfg.W)) { p.closed = true; cancel(p); }  // bids expired unfilled
        p.last = cl;
      }
      const bc = e.btc.closes[k];
      if (!killed && bc != null && bc < killPx) { killed = true; for (const p of P) if (!p.closed) { if (p.qty > 0) sell(p, p.last, p.qty, true, 'KILL'); cancel(p); p.closed = true; } }
      const eq = cash + P.reduce((s, p) => s + p.qty * p.last, 0);
      curve.push([T, eq]); path.push(+(eq / E0).toFixed(6)); if (eq < minEq) minEq = eq; if (eq > peak) peak = eq; dd = Math.max(dd, (peak - eq) / peak);
      endT = T;
      if (P.every((p) => p.closed)) break;
    }
    for (const p of P) if (p.qty > 0) { sell(p, p.last, p.qty, true, 'END'); p.closed = true; }
    busyUntil = endT;
    const eqEnd = cash;
    curve.push([endT + 1, eqEnd]); if (eqEnd > peak) peak = eqEnd; dd = Math.max(dd, (peak - eqEnd) / peak);
    const filled = P.filter((p) => p.spent > 0);
    for (const p of filled) trades.push({ t: e.t, mode, sym: p.x.sym, dead: p.x.dead, fills: p.fills, spent: p.spent / E0, ret: p.got / p.spent - 1, pnl: (p.got - p.spent) / E0, why: p.why.join('+'),
      ...(cfg.log ? { P: p.x.P, atrP: p.x.atrP, drop: p.x.drop, log: p.log } : {}) });
    path.push(+(eqEnd / E0).toFixed(6));
    events.push({ t: e.t, mode, coins: P.map((p) => p.x.sym), filled: filled.length, ret: eqEnd / E0 - 1, minRet: minEq / E0 - 1, used: filled.reduce((s, p) => s + p.spent, 0) / E0, killed, bars: k, path });
  }
  return { cfg, final: cash, maxDD: dd, curve, events, trades };
}
// the pot through a list of flushes, marked every 15 minutes: each event's path is its equity relative to the pot at the
// flush, so a high reached inside a trade counts as a peak and the drawdown is the one a 15-minute statement would show
function walkPaths(ev) {
  let eq = 1, pk = 1, dd = 0;
  for (const e of ev) { for (const p of e.path || [1 + e.minRet, 1 + e.ret]) { const v = eq * p; if (v > pk) pk = v; dd = Math.max(dd, 1 - v / pk); } eq *= 1 + e.ret; if (eq > pk) pk = eq; }
  return { eq, dd };
}
function stats(R, from = -Infinity, to = Infinity) {
  const ev = R.events.filter((e) => !e.skipped && e.t >= from && e.t < to), tr = R.trades.filter((t) => t.t >= from && t.t < to);
  const { eq, dd } = walkPaths(ev);
  const span = ((Math.min(to, Date.UTC(2026, 10, 5) / 1e3)) - Math.max(from, Date.UTC(2017, 8, 1) / 1e3)) / 31557600;
  const w = tr.filter((t) => t.ret > 0), g = w.reduce((s, t) => s + t.pnl, 0), l = -tr.filter((t) => t.ret <= 0).reduce((s, t) => s + t.pnl, 0);
  return { events: ev.length, active: ev.filter((e) => e.filled).length, trades: tr.length, mult: eq, cagr: eq ** (1 / span) - 1, maxDD: dd, wr: tr.length ? w.length / tr.length : NaN,
    pf: l > 0 ? g / l : Infinity, avgTrade: tr.length ? tr.reduce((s, t) => s + t.ret, 0) / tr.length : NaN, evWin: ev.filter((e) => e.filled).length ? ev.filter((e) => e.filled && e.ret > 0).length / ev.filter((e) => e.filled).length : NaN,
    worstEv: Math.min(0, ...ev.map((e) => e.ret)), bestEv: Math.max(0, ...ev.map((e) => e.ret)), used: ev.filter((e) => e.filled).length ? ev.filter((e) => e.filled).reduce((s, e) => s + e.used, 0) / ev.filter((e) => e.filled).length : 0 };
}
module.exports = { prepare, simulate, stats, walkPaths, BASE, universe };

const mode = require.main === module ? process.argv[2] : null;
if (mode === 'prep') {
  fs.mkdirSync(OUT, { recursive: true });
  const B = load('BTCUSDT'), ctx = btcContext(B);
  const arms = findArms(B, ctx, { regime: 'any', gap: 24 });
  // the control: random 15m closes in either market, ≥ 1 day from any flush
  const rnd = require('../rng.js').mulberry32(31337);
  const near = new Set(); for (const e of arms) for (let q = -96; q <= 96; q++) near.add(e.t + q * BAR);
  const PL = [];
  while (PL.length < 400) { const i = 5000 + Math.floor(rnd() * (B.length - 5200));
    if (!ctx.warm50(i - 8) || near.has(B[i].time)) continue; PL.push({ i, t: B[i].time, s0t: B[i - 8].time, flushStart: B[i - 8].time, bad: ctx.below50(i - 8), placebo: true }); }
  PL.sort((a, b) => a.t - b.t);
  const U = universe(true);
  prepare(arms, U, B); prepare(PL, U, B);
  fs.writeFileSync(path.join(OUT, 'pro_prep.json'), JSON.stringify({ at: new Date().toISOString(), arms, placebo: PL }));
  console.log(`prep: ${arms.length} flush arms (${arms.filter((e) => e.bad).length} bad market), ${PL.length} placebo times, coins per arm ~${Math.round(arms.reduce((s, e) => s + e.coins.length, 0) / arms.length)}`);
}

if (mode === 'run') {
  const D = JSON.parse(fs.readFileSync(path.join(OUT, 'pro_prep.json')));
  const arms = D.arms, PL = D.placebo;
  const V = [
    ['layered', 'the layered strategy (all 7 layers)', {}],
    ['simple', 'last round\'s simple playbook (5 that fell most, 20% each, one order, TP +½ for all, stop −1, 4h)',
      { select: 'fell', idio: 0, A: { ladder: [0], sl: 1.0 }, B: { ladder: [0.75], sl: 1.0 }, sizing: 'equal', equalW: 0.2, tp1Frac: 1, hold: 16, kill: 0, breakeven: false }],
    ['−regime A', 'layer 1 off: mode A (buy-at-market ladder) in every market', { regime: false }],
    ['−regime B', 'layer 1 off: mode B (deep bids only) in every market', { regime: 'B' }],
    ['−dislocation', 'layer 3: the 5 that fell most, not the most dislocated vs β', { select: 'fell' }],
    ['random coins', 'layer 3 off: 5 random liquid coins', { select: 'random' }],
    ['−news filter', 'layer 3: keep coins that fell > 3× their β', { idio: 0 }],
    ['−ladder', 'layer 4 off: one order per coin (A: market, B: bid ¾ ATR)', { A: { ladder: [0] }, B: { ladder: [0.75] } }],
    ['−risk sizing', 'layer 5 off: 20% of the pot per coin', { sizing: 'equal' }],
    ['−scale-out', 'layer 6: sell everything at +½ ATR', { tp1Frac: 1 }],
    ['−breakeven', 'layer 6: keep the first stop after the half is sold', { breakeven: false }],
    ['−kill', 'layer 7 off: no kill switch', { kill: 0 }],
    ['slip 0.5%', 'stress: 0.5% slippage on every market order, stop and timed exit', { slip: 0.005 }],
    ['through 0.1%', 'stress: a bid fills only once price trades 0.1% through it', { margin: 0.001 }],
    ['hold 4h', 'nudge: sell 4h after the first fill', { hold: 16 }],
    ['hold 8h', 'nudge: sell 8h after the first fill', { hold: 32 }],
    ['103 only', 'universe: the user\'s 103 coins, no dead coins', { noDead: true }],
  ];
  const res = {};
  for (const [k, desc, c] of V) { const R = simulate(arms, c); res[k] = { desc, stats: stats(R), half1: stats(R, -Infinity, Date.UTC(2022, 0, 1) / 1e3), half2: stats(R, Date.UTC(2022, 0, 1) / 1e3), modeA: stats({ events: R.events.filter((e) => e.mode === 'A'), trades: R.trades.filter((t) => t.mode === 'A') }), modeB: stats({ events: R.events.filter((e) => e.mode === 'B'), trades: R.trades.filter((t) => t.mode === 'B') }) };
    if (k === 'layered' || k === 'simple') { res[k].curve = R.curve.map(([t, v]) => [t, +v.toFixed(5)]); res[k].events = R.events; res[k].trades = R.trades; } }
  const P = simulate(PL, {}); res.placebo = { desc: 'the layered strategy at 400 random times (no flush)', stats: stats(P), events: P.events.length };
  // bootstrap: resample the layered strategy's events (with replacement) 2,000 times
  const ev = res.layered.events.filter((e) => !e.skipped);
  const rnd = require('../rng.js').mulberry32(2026);
  const span = (Date.UTC(2026, 10, 5) - Date.UTC(2017, 8, 1)) / 31557600e3, C = [], DD = [];
  for (let r = 0; r < 2000; r++) { const S = walkPaths(Array.from(ev, () => ev[Math.floor(rnd() * ev.length)])); C.push(S.eq ** (1 / span) - 1); DD.push(S.dd); }
  const pc = (a, q) => a.slice().sort((x, y) => x - y)[Math.floor(q * (a.length - 1))];
  res.bootstrap = { cagr: [pc(C, 0.05), pc(C, 0.5), pc(C, 0.95)], maxDD: [pc(DD, 0.05), pc(DD, 0.5), pc(DD, 0.95)], losing: C.filter((x) => x < 0).length / C.length };
  // BTC buy & hold over the same span, for scale
  const B = load('BTCUSDT'); const b0 = B.find((b) => b.time >= Date.UTC(2017, 8, 1) / 1e3), b1 = B[B.length - 1]; let pk = 0, dd = 0; for (const b of B) { if (b.time < b0.time) continue; if (b.close > pk) pk = b.close; dd = Math.max(dd, (pk - b.close) / pk); }
  res.btcHold = { mult: b1.close / b0.close, cagr: (b1.close / b0.close) ** (1 / span) - 1, maxDD: dd };
  fs.writeFileSync(path.join(OUT, 'pro.json'), JSON.stringify({ at: new Date().toISOString(), base: BASE, res }));
  const f = (x, d = 1) => (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(d) + '%';
  console.log('variant         active trades  avg/tr  win   PF   ev+  | pot ×   CAGR   maxDD | 2017-21  2022-26 | worst ev  used');
  for (const [k] of [...V, ['placebo']]) { const s = res[k].stats, h1 = res[k].half1, h2 = res[k].half2;
    console.log(k.padEnd(15), String(s.active).padStart(5), String(s.trades).padStart(5), f(s.avgTrade, 2).padStart(7), (s.wr * 100).toFixed(0).padStart(4) + '%', s.pf.toFixed(2).padStart(5), (s.evWin * 100).toFixed(0).padStart(4) + '%', '|', ('×' + s.mult.toFixed(2)).padStart(6), f(s.cagr).padStart(7), ('−' + (s.maxDD * 100).toFixed(1) + '%').padStart(7), '|', h1 ? ('×' + h1.mult.toFixed(2)).padStart(6) : '', h2 ? ('×' + h2.mult.toFixed(2)).padStart(7) : '', '|', f(s.worstEv).padStart(7), (s.used * 100).toFixed(0).padStart(4) + '%'); }
  const L = res.layered; console.log(`\nmode A (good market): ×${L.modeA.mult.toFixed(2)} on ${L.modeA.active} flushes · mode B (bad market): ×${L.modeB.mult.toFixed(2)} on ${L.modeB.active}`);
  console.log(`bootstrap CAGR 5/50/95%: ${res.bootstrap.cagr.map((x) => f(x)).join(' / ')} · max DD ${res.bootstrap.maxDD.map((x) => '−' + (x * 100).toFixed(1) + '%').join(' / ')} · losing paths ${(res.bootstrap.losing * 100).toFixed(1)}%`);
  console.log(`BTC buy & hold, same span: ×${res.btcHold.mult.toFixed(1)} (${f(res.btcHold.cagr)} a year), max DD −${(res.btcHold.maxDD * 100).toFixed(0)}%`);
}

if (mode === 'walk') {
  // A desk's way to choose layers without hindsight: start from the simple playbook, add ONE layer at a time, judge
  // each on 2017–2021 only, keep a layer only if it improves BOTH the average trade and CAGR / max drawdown there, then
  // run the final combination blind on 2022–2026.
  const D = JSON.parse(fs.readFileSync(path.join(OUT, 'pro_prep.json'))), arms = D.arms;
  const H = Date.UTC(2022, 0, 1) / 1e3;
  const S = { select: 'fell', idio: 0, A: { ladder: [0], sl: 1.0, risk: 0.02 }, B: { ladder: [0.75], sl: 1.0, risk: 0.015 }, sizing: 'equal', equalW: 0.2,
    tp1: 0.5, tp1Frac: 1, tp2: 1.0, hold: 16, kill: 0, breakeven: false };
  const LAYERS = [
    ['news filter', 'skip a coin that fell > 3× what its β predicts (its own news)', { idio: 3 }],
    ['dislocation', 'rank by drop − β × BTC drop instead of the raw drop', { select: 'dislocation', idio: 0 }],
    ['ladder', 'three orders per coin (A: market, ½, 1 ATR down; B: ¾, 1, 1¼ ATR down)', { A: { ladder: [0, 0.5, 1.0] }, B: { ladder: [0.75, 1.0, 1.25] } }],
    ['scale-out', 'half at +½ ATR, stop to breakeven, the rest at +1 ATR', { tp1Frac: 0.5, breakeven: true }],
    ['wider stop in B', 'risk-off stop 1¼ ATR', { B: { sl: 1.25 } }],
    ['6h hold', 'sell 6h after the first fill instead of 4h', { hold: 24 }],
    ['kill switch', 'sell all if BTC closes 1 more daily ATR under the flush low', { kill: 1.0 }],
    ['risk sizing', 'size each coin so its stop costs 2% (A) / 1.5% (B) of the pot', { sizing: 'risk' }],
  ];
  const merge = (a, b) => ({ ...a, ...b, A: { ...a.A, ...(b.A || {}) }, B: { ...a.B, ...(b.B || {}) } });
  const mar = (x) => x.maxDD > 0 ? x.cagr / x.maxDD : Infinity;
  const run = (c) => { const R = simulate(arms, c); return { h1: stats(R, -Infinity, H), h2: stats(R, H), all: stats(R), R }; };
  const base = run(S), rows = [['simple playbook (start)', '', base, null]];
  let cfg = S; const kept = [];
  for (const [name, desc, add] of LAYERS) {
    const r = run(merge(cfg, add)), cur = run(cfg);
    const keep = r.h1.avgTrade > cur.h1.avgTrade && mar(r.h1) > mar(cur.h1);
    rows.push([name, desc, r, keep]);
    if (keep) { cfg = merge(cfg, add); kept.push(name); }
  }
  const fin = run(cfg);
  const f = (x, d = 1) => (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(d) + '%';
  const line = (x) => `${String(x.active).padStart(3)} flushes ${String(x.trades).padStart(4)} trades ${f(x.avgTrade, 2).padStart(7)} a trade, win ${(x.wr * 100).toFixed(0)}%, ×${x.mult.toFixed(2)} (${f(x.cagr)}/yr) DD −${(x.maxDD * 100).toFixed(1)}% MAR ${mar(x).toFixed(2)}`;
  console.log('ADDED ONE AT A TIME, judged on 2017–2021 (in-sample):');
  for (const [name, , r, keep] of rows) console.log(`${(keep === null ? '  ' : keep ? '✓ ' : '✗ ') + name.padEnd(24)} 2017-21: ${line(r.h1)}`);
  console.log(`\nKEPT: ${kept.join(', ') || 'none'}`);
  console.log(`FINAL on 2017–2021 (chosen here): ${line(fin.h1)}`);
  console.log(`FINAL on 2022–2026 (never seen):  ${line(fin.h2)}`);
  console.log(`simple on 2022–2026 (for compare): ${line(base.h2)}`);
  console.log(`FINAL, whole span:                 ${line(fin.all)}`);
  fs.writeFileSync(path.join(OUT, 'walk.json'), JSON.stringify({ at: new Date().toISOString(), split: H, start: S, layers: LAYERS, kept, final: cfg,
    rows: rows.map(([n, d, r, k]) => ({ n, d, keep: k, h1: r.h1, h2: r.h2, all: r.all })), fin: { h1: fin.h1, h2: fin.h2, all: fin.all, curve: fin.R.curve.map(([t, v]) => [t, +v.toFixed(5)]), events: fin.R.events, trades: fin.R.trades },
    simple: { h1: base.h1, h2: base.h2, all: base.all, curve: base.R.curve.map(([t, v]) => [t, +v.toFixed(5)]) } }));
}

if (mode === 'final') {
  // the chosen strategy (walk.json's final config) under every stress, plus the year-by-year and real trade logs
  const D = JSON.parse(fs.readFileSync(path.join(OUT, 'pro_prep.json'))), W = JSON.parse(fs.readFileSync(path.join(OUT, 'walk.json')));
  const F = W.final, merge = (a, b) => ({ ...a, ...b, A: { ...a.A, ...(b.A || {}) }, B: { ...a.B, ...(b.B || {}) } });
  const R = simulate(D.arms, { ...F, log: true }), out = { cfg: F, stats: stats(R), stress: {} };
  for (const [k, c] of [['slip 0.5%', { slip: 0.005 }], ['slip 1%', { slip: 0.01 }], ['fill only 0.1% through', { margin: 0.001 }], ['103 coins only', { noDead: true }], ['10% a coin', { equalW: 0.1 }], ['30% a coin (capped at 100%)', { equalW: 0.3 }]])
    out.stress[k] = stats(simulate(D.arms, merge(F, c)));
  out.stress['placebo (random times)'] = stats(simulate(D.placebo, F));
  const ev = R.events.filter((e) => !e.skipped); const rnd = require('../rng.js').mulberry32(99);
  const span = (Date.UTC(2026, 10, 5) - Date.UTC(2017, 8, 1)) / 31557600e3, C = [], DD = [];
  for (let r = 0; r < 5000; r++) { const S = walkPaths(Array.from(ev, () => ev[Math.floor(rnd() * ev.length)])); C.push(S.eq ** (1 / span) - 1); DD.push(S.dd); }
  const pc = (a, q) => a.slice().sort((x, y) => x - y)[Math.floor(q * (a.length - 1))];
  out.bootstrap = { cagr: [pc(C, 0.05), pc(C, 0.5), pc(C, 0.95)], maxDD: [pc(DD, 0.05), pc(DD, 0.5), pc(DD, 0.95)], losing: C.filter((x) => x < 0).length / C.length };
  const Y = {}; for (const e of ev) { const y = new Date(e.t * 1000).getUTCFullYear(); Y[y] = Y[y] || { m: 1, n: 0, A: 0, B: 0 }; Y[y].m *= 1 + e.ret; if (e.filled) { Y[y].n++; Y[y][e.mode]++; } }
  out.years = Y; out.events = R.events; out.trades = R.trades; out.curve = R.curve.map(([t, v]) => [t, +v.toFixed(5)]);
  out.btc = D.arms.map((e) => ({ t: e.t, drop: e.btc.drop, bad: e.bad, P: e.btc.P, atrP: e.btc.atrP }));
  fs.writeFileSync(path.join(OUT, 'final.json'), JSON.stringify(out));
  const f = (x, d = 1) => (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(d) + '%';
  const s0 = out.stats; console.log(`FINAL: ${s0.active} flushes, ${s0.trades} trades, ${f(s0.avgTrade, 2)} a trade, win ${(s0.wr * 100).toFixed(0)}%, PF ${s0.pf.toFixed(2)}, ×${s0.mult.toFixed(2)} (${f(s0.cagr)}/yr), max DD −${(s0.maxDD * 100).toFixed(1)}%, worst flush ${f(s0.worstEv)}, best ${f(s0.bestEv)}`);
  for (const [k, x] of Object.entries(out.stress)) console.log(`  ${k.padEnd(28)} ${String(x.trades).padStart(4)} trades ${f(x.avgTrade, 2).padStart(7)} a trade · ×${x.mult.toFixed(2)} (${f(x.cagr)}/yr) DD −${(x.maxDD * 100).toFixed(1)}%`);
  console.log(`  bootstrap CAGR 5/50/95%: ${out.bootstrap.cagr.map((x) => f(x)).join(' / ')} · max DD ${out.bootstrap.maxDD.map((x) => '−' + (x * 100).toFixed(1) + '%').join(' / ')} · losing paths ${(out.bootstrap.losing * 100).toFixed(2)}%`);
  console.log('  years: ' + Object.entries(Y).map(([y, v]) => `${y} ${f(v.m - 1, 0)} (${v.n})`).join(' · '));
}
