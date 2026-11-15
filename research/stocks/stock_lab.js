/*
 * Four long-only stock strategies, each read as CONTEXT (daily, the same for every chart) + TRIGGER (the chart's own
 * candles: 1h, 1d or 1w). Backtesting only: nothing here runs in the app or the bot.
 *
 *   NODE_USE_ENV_PROXY=1 node research/stocks/fetch.js          # prices (Yahoo), once
 *   node research/stocks/stock_lab.js design                    # US 2000-2013: the few rule variants, side by side
 *   node research/stocks/stock_lab.js design-cost               # the dip rule again, at India's costs (still US data)
 *   node research/stocks/stock_lab.js run                       # everything -> research/cache/stocks/run.json
 *   node research/stocks/stock_report.js > research/stocks/RESULTS_stocks_2026-11.md
 *
 * CONTEXT, as of the last finished day (an hourly candle reads yesterday's close, so nothing looks ahead):
 *   M  market    the index (S&P 500 / Sensex) is above its 200-day average
 *   T  trend     the stock is above its own 200-day average
 *   R  strength  the stock's 6-month return is in the top half of its market's list
 *   S  sector    the stock's sector is in the top half of sectors by 3-month return (sector = the list's own stocks)
 *
 * TRIGGERS, counted in candles of the chart, so the same rule is a different horizon on each timeframe:
 *   trend     hold while the 50-candle average is over the 200-candle average and the close is over the 200.
 *             Stop 25% under the entry.
 *   breakout  the first close above the high of the last 50 candles (on 1d and 1w also 1.5x the usual volume).
 *             Stop 3 x ATR under the entry, out on a close under the low of the last 50 candles.
 *   pullback  2-candle RSI under 10. Out on the first close above the 5-candle average, or after 10 candles.
 *             Stop 5 x ATR under the entry (a gap can still jump it).
 *   leaders   (no chart) each period hold the top fifth of the list by 12-month return skipping the last month.
 *
 * FILLS AND COSTS. A signal is read at a candle's close and filled at the NEXT candle's open. A stop fills at the
 * stop, or at the open if the candle opens beyond it. Costs per side: US 0.05%, India 0.2% (stock_data.js).
 * THE BOOK. 10 equal slots; when more signals arrive than slots are free, the stronger stock (R) goes first.
 */
'use strict';
const fs = require('fs'), path = require('path');
const D = require('./stock_data.js');
const { mulberry32 } = require('../rng.js');
const OUT = path.join(__dirname, '..', 'cache', 'stocks');
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const barsOf = (s, tf) => (tf === '1h' ? s.h1 : tf === '1d' ? s.d1 : s.w1);

// ---------------------------------------------------------------- context, per candle of a chart
const ctxCache = new Map();
function ctxArr(M, s, tf) {
  const k = `${M.mk}|${s.key}|${tf}`; if (ctxCache.has(k)) return ctxCache.get(k);
  const b = barsOf(s, tf), out = new Array(b.length); let lastD = null, last = null;
  for (let i = 0; i < b.length; i++) { const d = tf === '1h' ? M.prevDay(b[i].d) : b[i].d;
    if (d !== lastD) { lastD = d; last = d ? M.ctx(s.key, d) : null; } out[i] = last; }
  ctxCache.set(k, out); return out;
}
// mask: any of the letters M T R S; a part that cannot be read yet counts as not met
function ctxOk(c, mask) {
  if (!mask) return true; if (!c) return false;
  for (const ch of mask) { if (ch === 'M' && c.bull !== true) return false; if (ch === 'T' && c.above !== true) return false;
    if (ch === 'R' && !(c.rs >= 0.5)) return false; if (ch === 'S' && c.sec !== true) return false; }
  return true;
}

// ---------------------------------------------------------------- the three chart strategies
const STRATS = {
  trend: { name: 'Trend', def: { fast: 50, slow: 200, ctx: 'MR', ctxExit: '', maxLoss: 0.25 },
    prep(b, P) { const c = b.map((x) => x.c); return { c, f: D.sma(c, P.fast), s: D.sma(c, P.slow), warm: P.slow }; },
    entry(I, i) { return I.f[i] > I.s[i] && I.c[i] > I.s[i]; },
    exit(I, i, pos, P, cx) { if (!(I.f[i] > I.s[i])) return 'TREND'; if (P.ctxExit && !ctxOk(cx, P.ctxExit)) return 'CONTEXT'; return null; },
    stop(I, i, px, P) { return P.maxLoss > 0 ? px * (1 - P.maxLoss) : null; } },
  breakout: { name: 'Breakout', def: { n: 50, out: 50, atr: 3, vol: 1.5, ctx: 'MTR' },
    prep(b, P, tf) { const c = b.map((x) => x.c), v = b.map((x) => x.v);
      return { c, v, hi: D.prevHigh(b, P.n), lo: D.prevLow(b, P.out), a: D.atr(b, 14), va: D.sma(v, 50), useVol: tf !== '1h' && P.vol > 0, warm: Math.max(P.n, 50) + 1 }; },
    entry(I, i, P) { return I.c[i] > I.hi[i] && I.c[i - 1] <= I.hi[i - 1] && (!I.useVol || I.v[i] >= P.vol * I.va[i - 1]); },
    exit(I, i) { return I.c[i] < I.lo[i] ? 'TRAIL' : null; },
    stop(I, i, px, P) { return P.atr > 0 ? px - P.atr * I.a[i] : null; } },
  pullback: { name: 'Pullback', def: { rsi: 10, len: 2, ma: 5, max: 10, atr: 5, ctx: 'MT' },
    prep(b, P) { const c = b.map((x) => x.c); return { c, r: D.rsi(c, P.len), m: D.sma(c, P.ma), a: D.atr(b, 14), warm: 20 }; },
    entry(I, i, P) { return I.r[i] < P.rsi; },
    exit(I, i, pos, P) { return I.c[i] > I.m[i] ? 'BOUNCE' : i - pos.iIn + 1 >= P.max ? 'TIME' : null; },
    stop(I, i, px, P) { return P.atr > 0 ? px - P.atr * I.a[i] : null; } },
  // a candidate from the design step (daily candles only): a gap up that holds, on heavy volume, the footprint of good news
  gap: { name: 'Gap', def: { k: 1.5, vol: 2, hold: 40, ctx: 'M', stopLow: true },
    prep(b, P) { return { b, v: b.map((x) => x.v), a: D.atr(b, 14), va: D.sma(b.map((x) => x.v), 50), warm: 60 }; },
    entry(I, i, P) { const x = I.b[i]; return x.o - I.b[i - 1].c >= P.k * I.a[i - 1] && x.c >= x.o && x.c >= (x.h + x.l) / 2 && x.v >= P.vol * I.va[i - 1]; },
    exit(I, i, pos, P) { return i - pos.iIn + 1 >= P.hold ? 'TIME' : null; },
    stop(I, i, px, P) { return P.stopLow ? Math.min(I.b[i].l, px * 0.999) : null; } },
};

// One stock, one chart, one strategy -> its trades. The system STARTS on `from`: nothing is bought before that day, and
// a stock that is already in a buy state then is bought at the first open on or after it. So every test window is a
// fresh start, and a slow chart is not handicapped by positions that began before the window and were never counted.
function simulate(M, s, tf, name, prm = {}, from = '0000') {
  const b = barsOf(s, tf); if (!b || b.length < 60) return [];
  const S = STRATS[name], P = { ...S.def, ...prm }, I = S.prep(b, P, tf), cx = ctxArr(M, s, tf), cost = P.cost ?? M.cfg.cost, n = b.length, out = [];
  const day0 = (x) => x.d0 || x.d;                    // the day a candle opens (a weekly candle's `d` is its last day)
  let pos = null, pendIn = false, pendOut = null;
  // atOpen: the exit filled at the candle's open (a signal exit); a stop fills somewhere inside the candle
  const close = (i, px, why, atOpen) => { out.push({ key: s.key, sector: s.sector, tf, iIn: pos.iIn, iOut: i, dIn: day0(b[pos.iIn]), dOut: atOpen ? day0(b[i]) : b[i].d, tIn: b[pos.iIn].t, tOut: b[i].t, entry: pos.entry, exit: px,
    ret: px * (1 - cost) / (pos.entry * (1 + cost)) - 1, why, bars: i - pos.iIn, rs: pos.rs, dip: pos.dip, stopDist: pos.stop != null ? 1 - pos.stop / pos.entry : null }); pos = null; };
  for (let i = I.warm; i < n; i++) {
    if (pendIn) { pendIn = false; const px = b[i].o; pos = { iIn: i, entry: px, stop: S.stop(I, i - 1, px, P), rs: cx[i - 1] ? cx[i - 1].rs : null, dip: I.r ? I.r[i - 1] : null }; }
    if (pendOut) { close(i, b[i].o, pendOut, true); pendOut = null; }
    if (pos) {
      if (pos.stop != null && b[i].l <= pos.stop) close(i, Math.min(b[i].o, pos.stop), 'STOP', false);
      else { const why = S.exit(I, i, pos, P, cx[i]); if (why) { if (i + 1 < n) pendOut = why; else close(i, b[i].c, why, false); } }
    } else if (!pendOut && i + 1 < n && day0(b[i + 1]) >= from && S.entry(I, i, P) && ctxOk(cx[i], P.ctx)) pendIn = true;
  }
  if (pos) close(n - 1, b[n - 1].c, 'OPEN', false);
  return out;
}
function runAll(M, tf, name, prm, from, to = '9999') {
  const tr = []; for (const s of M.stocks) for (const t of simulate(M, s, tf, name, prm, from)) if (t.dIn >= from && t.dIn <= to) tr.push(t);
  return tr;
}

// ---------------------------------------------------------------- statistics on a list of trades
function tstats(tr) {
  const r = tr.map((x) => x.ret), n = r.length; if (!n) return { n: 0 };
  const g = r.filter((x) => x > 0).reduce((s, x) => s + x, 0), l = -r.filter((x) => x <= 0).reduce((s, x) => s + x, 0);
  const so = r.slice().sort((a, b) => b - a), cut = so.slice(Math.ceil(n * 0.02));
  const g2 = cut.filter((x) => x > 0).reduce((s, x) => s + x, 0), l2 = -cut.filter((x) => x <= 0).reduce((s, x) => s + x, 0);
  return { n, wr: r.filter((x) => x > 0).length / n, avg: mean(r), med: so[n >> 1], pf: l > 0 ? g / l : Infinity, pfx: l2 > 0 ? g2 / l2 : Infinity,
    days: mean(tr.map((x) => (x.tOut - x.tIn) / 86400)), worst: so[n - 1], best: so[0], lose10: r.filter((x) => x <= -0.1).length };
}
// how many stocks ended ahead on their own trades
function byStock(M, tr) {
  const m = new Map(); for (const t of tr) m.set(t.key, (m.get(t.key) ?? 1) * (1 + t.ret));
  const v = [...m.values()].map((x) => x - 1).sort((a, b) => a - b);
  return { traded: v.length, ahead: v.filter((x) => x > 0).length, median: v.length ? v[v.length >> 1] : NaN };
}

// ---------------------------------------------------------------- the book: equal slots, marked every day
function curveStats(curve) {
  if (curve.length < 2) return null; let pk = curve[0][1], pkD = curve[0][0], dd = 0, ddFrom = null, ddTo = null;
  for (const [d, e] of curve) { if (e > pk) { pk = e; pkD = d; } const x = 1 - e / pk; if (x > dd) { dd = x; ddFrom = pkD; ddTo = d; } }   // the worst fall, peak to trough
  const yrs = (Date.parse(curve[curve.length - 1][0]) - Date.parse(curve[0][0])) / 31557600e3, mult = curve[curve.length - 1][1] / curve[0][1];
  return { mult, cagr: yrs > 0 ? mult ** (1 / yrs) - 1 : NaN, dd, yrs, ddFrom, ddTo };
}
// `rank`: which of several signals on one day takes a free slot first (default: the stronger stock)
function book(M, trades, slots, from, to = '9999', rank = (a, b) => (b.rs ?? 0) - (a.rs ?? 0)) {
  const ins = new Map(); for (const t of trades) { let a = ins.get(t.dIn); if (!a) ins.set(t.dIn, (a = [])); a.push(t); }
  const px = new Map(M.stocks.map((s) => [s.key, new Map(s.d1.map((b) => [b.d, b.c]))]));
  let cash = 1, open = [], inv = 0, days = 0, taken = 0; const curve = [];
  for (const d of M.dates) { if (d < from || d > to) continue;
    for (let k = open.length - 1; k >= 0; k--) if (open[k].t.dOut <= d) { cash += open[k].alloc * (1 + open[k].t.ret); open.splice(k, 1); }
    for (const t of (ins.get(d) || []).sort(rank)) {
      if (open.length >= slots || open.some((o) => o.t.key === t.key)) continue;
      const E = cash + open.reduce((s, o) => s + o.val, 0), alloc = Math.min(cash, E / slots); if (alloc <= 1e-12) continue;
      taken++; if (t.dOut <= d) { cash += alloc * t.ret; continue; }                    // in and out inside one day
      cash -= alloc; open.push({ t, alloc, val: alloc });
    }
    for (const o of open) { const c = px.get(o.t.key).get(d); if (c !== undefined) o.val = o.alloc * c / o.t.entry * (1 - M.cfg.cost) / (1 + M.cfg.cost); }
    const iv = open.reduce((s, o) => s + o.val, 0), E = cash + iv; inv += iv / E; days++; curve.push([d, E]);
  }
  const cs = curveStats(curve); return cs ? { ...cs, expo: inv / days, taken, curve } : null;
}

// ---------------------------------------------------------------- benchmarks: holding the whole list
// equal weight across the stocks that are listed, rebalanced daily, no costs; `regime` holds it only on bull days
function basket(M, from, to = '9999', regime = false) {
  const idx = M.stocks.map((s) => new Map(s.d1.map((b, i) => [b.d, i]))); let e = 1, inv = 0, days = 0; const curve = [];
  for (let k = 1; k < M.dates.length; k++) { const d = M.dates[k]; if (d < from || d > to) continue;
    let s = 0, c = 0; M.stocks.forEach((st, j) => { const i = idx[j].get(d); if (i > 0 && st.d1[i - 1].d === M.dates[k - 1]) { s += st.d1[i].c / st.d1[i - 1].c - 1; c++; } });
    const on = !regime || M.bull[k - 1] === true; if (c && on) { e *= 1 + s / c; inv++; } days++; curve.push([d, e]); }
  const cs = curveStats(curve); return cs ? { ...cs, expo: inv / days, curve } : null;
}
function indexHold(M, from, to = '9999') { const curve = M.idx.filter((b) => b.d >= from && b.d <= to).map((b) => [b.d, b.c]); return curveStats(curve); }

// ---------------------------------------------------------------- leaders: the rotation (no chart)
// P: { look, skip (trading days), top (share of the list), every: 'W' | 'M' | 'Q', ctx: '' | 'M', own: need the stock above its 200-day, keep: hold while in the top `keep` x K }
const LEAD = { look: 252, skip: 21, top: 0.2, every: 'M', ctx: 'M', own: true, keep: 1.5 };
function leaders(M, prm, from, to = '9999') {
  const P = { ...LEAD, ...prm }, cost = M.cfg.cost, at = M.stocks.map((s) => new Map(s.d1.map((b, i) => [b.d, i])));
  const per = (d) => (P.every === 'W' ? Math.floor((Date.parse(d) / 864e5 + 3) / 7) : P.every === 'Q' ? d.slice(0, 4) + Math.floor((+d.slice(5, 7) - 1) / 3) : d.slice(0, 7));
  let cash = 1; const hold = new Map(); let target = null, inv = 0, days = 0, turn = 0, started = false; const curve = [], spells = [];
  // the list decided at the close of day k: the top of the ranking, each above its own 200-day average; nothing in a weak market
  const decide = (k) => { const d = M.dates[k]; if (P.ctx.includes('M') && M.bull[k] !== true) return new Set();
    const rows = []; let listed = 0;
    M.stocks.forEach((s, j) => { const i = at[j].get(d); if (i === undefined || i < P.look) return; listed++;
      const f = M.feats[j]; if (P.own && !(f.c[i] > f.m200[i])) return; rows.push([f.c[i - P.skip] / f.c[i - P.look] - 1, j]); });
    rows.sort((a, b) => b[0] - a[0]);
    const K = Math.max(3, Math.round(listed * P.top)), rank = new Map(rows.map(([, j], q) => [j, q])), t = new Set();
    for (const j of hold.keys()) if (rank.has(j) && rank.get(j) < K * P.keep && t.size < K) t.add(j);     // keep a holding that is still near the top
    for (const [, j] of rows) { if (t.size >= K) break; t.add(j); }
    P.minSlots = K; return t; };
  for (let k = 1; k < M.dates.length; k++) { const d = M.dates[k]; if (d < from || d > to) continue;
    if (!started) { started = true; target = decide(k - 1); }           // a fresh start: rank on the eve, buy at the first open
    // at the open: carry out the list decided at yesterday's close
    if (target) {
      for (const [j, h] of hold) { const i = at[j].get(d); if (i !== undefined) { h.val *= M.stocks[j].d1[i].o / h.last; h.last = M.stocks[j].d1[i].o; } }
      const E = cash + [...hold.values()].reduce((s, h) => s + h.val, 0), each = target.size ? E / Math.max(target.size, P.minSlots || 0, 1) : 0;
      let fee = 0;
      for (const [j, h] of [...hold]) if (!target.has(j) && at[j].get(d) !== undefined) { fee += h.val * cost; turn += h.val / E; cash += h.val;
        spells.push({ key: M.stocks[j].key, dIn: h.dIn, dOut: d, tIn: h.tIn, tOut: M.stocks[j].d1[at[j].get(d)].t, ret: h.last * (1 - cost) / (h.entry * (1 + cost)) - 1 }); hold.delete(j); }
      for (const j of target) { const i = at[j].get(d); if (i === undefined) continue; const cur = hold.get(j), dv = each - (cur ? cur.val : 0);
        fee += Math.abs(dv) * cost; turn += Math.abs(dv) / E; cash -= dv;
        if (cur) cur.val = each; else hold.set(j, { val: each, last: M.stocks[j].d1[i].o, entry: M.stocks[j].d1[i].o, dIn: d, tIn: M.stocks[j].d1[i].t }); }
      cash -= fee; target = null;
    }
    for (const [j, h] of hold) { const i = at[j].get(d); if (i !== undefined) { h.val *= M.stocks[j].d1[i].c / h.last; h.last = M.stocks[j].d1[i].c; } }
    const iv = [...hold.values()].reduce((s, h) => s + h.val, 0), E = cash + iv; inv += iv / E; days++; curve.push([d, E]);
    // at the close of a period's last day: rank, and decide the next list
    const next = M.dates[k + 1]; if (!next || per(next) === per(d)) continue;
    target = decide(k);
  }
  for (const [j, h] of hold) spells.push({ key: M.stocks[j].key, dIn: h.dIn, dOut: curve.length ? curve[curve.length - 1][0] : h.dIn, tIn: h.tIn, tOut: h.tIn + 1, ret: h.last / h.entry - 1, open: true });
  const cs = curveStats(curve); return cs ? { ...cs, expo: inv / days, turnover: turn / cs.yrs, spells, curve } : null;
}

// ---------------------------------------------------------------- control: the same context, the same holding lengths, random days
// For every trade: a random candle of the same stock, in the same window, where the context was met; hold as long.
function control(M, tf, trades, mask, from, to, draws = 20, seed = 20261112, costOv = null) {
  const rnd = mulberry32(seed), cost = costOv ?? M.cfg.cost, byKey = new Map(); for (const t of trades) { let a = byKey.get(t.key); if (!a) byKey.set(t.key, (a = [])); a.push(t); }
  const rets = [];
  for (const s of M.stocks) { const tr = byKey.get(s.key); if (!tr) continue; const b = barsOf(s, tf), cx = ctxArr(M, s, tf), ok = [];
    for (let i = 1; i < b.length - 1; i++) if (b[i].d >= from && b[i].d <= to && ctxOk(cx[i], mask)) ok.push(i);
    if (ok.length < 20) continue;
    for (const t of tr) for (let q = 0; q < draws; q++) { const i = ok[Math.floor(rnd() * ok.length)], a = i + 1, z = Math.min(b.length - 1, a + Math.max(1, t.bars));
      rets.push((t.bars === 0 ? b[a].c : b[z].o) * (1 - cost) / (b[a].o * (1 + cost)) - 1); } }
  return { n: rets.length, avg: mean(rets), wr: rets.filter((x) => x > 0).length / Math.max(1, rets.length) };
}

module.exports = { D, STRATS, LEAD, simulate, runAll, tstats, byStock, book, basket, indexHold, leaders, control, ctxArr, ctxOk, curveStats, barsOf, mean };

// ================================================================ command line
const mode = require.main === module ? process.argv[2] : null;
const pc = (x, d = 1) => (x == null || !Number.isFinite(x) ? '—' : (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(d) + '%');
const row = (label, tr, bk) => { const a = tstats(tr); if (!a.n) return `${label.padEnd(44)} no trades`;
  return `${label.padEnd(44)} ${String(a.n).padStart(6)} ${(a.wr * 100).toFixed(0).padStart(3)}% ${pc(a.avg, 2).padStart(8)} ${a.pf.toFixed(2).padStart(5)} ${a.pfx.toFixed(2).padStart(5)} ${a.days.toFixed(1).padStart(7)}d ${pc(a.worst, 0).padStart(5)}`
    + (bk ? ` | ${pc(bk.cagr).padStart(7)}/yr  DD −${(bk.dd * 100).toFixed(0).padStart(2)}%  in ${(bk.expo * 100).toFixed(0).padStart(3)}%` : ''); };
const slim = (b) => (b ? { cagr: b.cagr, dd: b.dd, ddFrom: b.ddFrom, ddTo: b.ddTo, expo: b.expo, mult: b.mult, yrs: b.yrs, taken: b.taken } : null);
// calendar-year results of an equity curve
function years(curve) { const o = {}; let prev = null; for (const [d, e] of curve) { const y = d.slice(0, 4); if (!o[y]) o[y] = { a: prev == null ? e : prev, b: e }; o[y].b = e; prev = e; }
  return Object.fromEntries(Object.entries(o).map(([y, v]) => [y, v.b / v.a - 1])); }
// one strategy on one chart over one window: its trades, the same holds on random context days, the stocks, the book
function evalSet(M, tf, name, prm, all, from, to) {
  const P = { ...STRATS[name].def, ...prm }, tr = all.filter((t) => t.dIn >= from && t.dIn <= to), t = tstats(tr); if (!t.n) return { t };
  const c = control(M, tf, tr, P.ctx, from, to, 20), r = tr.map((x) => x.ret), sd = Math.sqrt(mean(r.map((x) => (x - t.avg) ** 2)));
  const bk = book(M, tr, 10, from, to);
  return { t, c, edge: t.avg - c.avg, z: sd > 0 ? (t.avg - c.avg) / (sd / Math.sqrt(t.n)) : 0, st: byStock(M, tr), bk: slim(bk), yr: bk ? years(bk.curve) : null,
    stops: tr.filter((x) => x.why === 'STOP').length };
}
const HEAD = `${''.padEnd(44)} trades  win   avg/tr    PF  PF-2%    held worst | book: growth, max drawdown, time invested`;

if (mode === 'check') {
  for (const mk of ['us', 'in']) { const M = D.market(mk), from = M.cfg.start;
    const bh = basket(M, from), rg = basket(M, from, '9999', true), ix = indexHold(M, from);
    console.log(`\n== ${M.cfg.name} from ${from}: holding the list ${pc(bh.cagr)}/yr DD −${(bh.dd * 100).toFixed(0)}% | only on bull days ${pc(rg.cagr)}/yr DD −${(rg.dd * 100).toFixed(0)}% (in ${(rg.expo * 100).toFixed(0)}%) | index ${pc(ix.cagr)}/yr DD −${(ix.dd * 100).toFixed(0)}%`);
    console.log(HEAD);
    for (const name of ['trend', 'breakout', 'pullback']) for (const tf of ['1d', '1w']) { const tr = runAll(M, tf, name, {}, from); console.log(row(`${name} ${tf} (${STRATS[name].def.ctx})`, tr, book(M, tr, 10, from))); }
    const L = leaders(M, {}, from); console.log(`leaders monthly: ${pc(L.cagr)}/yr DD −${(L.dd * 100).toFixed(0)}% in ${(L.expo * 100).toFixed(0)}% turnover ${L.turnover.toFixed(1)}x/yr; spells ${L.spells.length}, ${(L.spells.filter((x) => x.ret > 0).length / L.spells.length * 100).toFixed(0)}% won`);
  }
}

// ---------------------------------------------------------------- design: US 2000-2013, daily candles, a few variants each
// The rules are chosen here and nowhere else. US 2014-2026, India and every hourly result never saw this step.
const DESIGN = { mk: 'us', from: '2000-01-01', to: '2013-12-31' };
const GRID = {
  trend: [['50/200, stop 25% under the entry (chosen)', {}], ['no stop (the first draft)', { maxLoss: 0 }], ['stop 15%', { maxLoss: 0.15 }], ['stop 20%', { maxLoss: 0.2 }], ['stop 30%', { maxLoss: 0.3 }],
    ['20/100', { fast: 20, slow: 100 }], ['100/200', { fast: 100, slow: 200 }], ['also out when the market turns', { ctxExit: 'M' }], ['no context', { ctx: '' }]],
  breakout: [['50 high, out 50 low (chosen)', {}], ['50 high, out 20 low (the first draft)', { out: 20 }], ['20 high, out 10 low', { n: 20, out: 10 }], ['100 high, out 20 low', { n: 100, out: 20 }], ['250 high, out 50 low', { n: 250, out: 50 }],
    ['no volume test', { vol: 0 }], ['stop 2 ATR', { atr: 2 }], ['no stop', { atr: 0 }], ['no context', { ctx: '' }]],
  pullback: [['RSI2 < 10, out over MA5, stop 5 ATR (chosen)', {}], ['no stop (the first draft)', { atr: 0 }], ['stop 3 ATR', { atr: 3 }], ['RSI2 < 5', { rsi: 5 }], ['RSI2 < 20', { rsi: 20 }], ['RSI3 < 15', { len: 3, rsi: 15 }],
    ['out over MA10', { ma: 10 }], ['hold up to 5', { max: 5 }], ['+ strong stocks only (MTR)', { ctx: 'MTR' }], ['no context', { ctx: '' }]],
  gap: [['gap 1.5 ATR, 2x volume, hold 40 (a fifth candidate, not kept)', {}], ['hold 20', { hold: 20 }], ['hold 60', { hold: 60 }], ['gap 1 ATR', { k: 1 }], ['gap 2.5 ATR', { k: 2.5 }], ['volume 1.5x', { vol: 1.5 }], ['volume 3x', { vol: 3 }],
    ['no stop', { stopLow: false }], ['+ stock in an uptrend (MT)', { ctx: 'MT' }], ['no context', { ctx: '' }]],
  leaders: [['12-1 months, monthly, top fifth (chosen)', {}], ['6-1 months', { look: 126 }], ['3 months, no skip', { look: 63, skip: 0 }], ['12 months, no skip', { skip: 0 }], ['top tenth', { top: 0.1 }], ['top third', { top: 0.33 }],
    ['weekly', { every: 'W' }], ['quarterly', { every: 'Q' }], ['no market test', { ctx: '' }], ['no own-trend test', { own: false }], ['no keep band', { keep: 1 }]],
};
if (mode === 'design') {
  const M = D.market(DESIGN.mk), { from, to } = DESIGN, bh = basket(M, from, to), rg = basket(M, from, to, true), save = { from, to, list: slim(bh), bull: slim(rg), rows: {} };
  console.log(`US ${from} → ${to}: holding the list ${pc(bh.cagr)}/yr DD −${(bh.dd * 100).toFixed(0)}% | only on bull days ${pc(rg.cagr)}/yr DD −${(rg.dd * 100).toFixed(0)}% (in ${(rg.expo * 100).toFixed(0)}%)`);
  for (const name of (process.argv[3] ? [process.argv[3]] : ['trend', 'breakout', 'pullback', 'gap'])) { console.log(`\n${name}\n${HEAD} | control avg | stocks ahead`);
    save.rows[name] = [];
    for (const [label, prm] of GRID[name]) { const P = { ...STRATS[name].def, ...prm }, tr = runAll(M, '1d', name, prm, from, to), c = control(M, '1d', tr, P.ctx, from, to, 10), st = byStock(M, tr), bk = book(M, tr, 10, from, to);
      const wt = tr.reduce((w, x) => (!w || x.ret < w.ret ? x : w), null);
      save.rows[name].push({ label, t: tstats(tr), c, st, bk: slim(bk), worstTrade: wt && { key: wt.key, dIn: wt.dIn, dOut: wt.dOut, ret: wt.ret, why: wt.why, entry: wt.entry, exit: wt.exit, stopDist: wt.stopDist } });
      console.log(row(label, tr, bk) + ` | ${pc(c.avg, 2).padStart(7)} | ${st.ahead}/${st.traded}`); } }
  console.log('\nleaders                                        growth   max DD  invested  turnover  spells  won');
  if (!process.argv[3]) save.rows.leaders = [];
  for (const [label, prm] of (process.argv[3] ? [] : GRID.leaders)) { const r = leaders(M, prm, from, to);
    save.rows.leaders.push({ label, bk: slim(r), turnover: r.turnover, spells: r.spells.length, won: r.spells.filter((x) => x.ret > 0).length / r.spells.length });
    console.log(`${label.padEnd(44)} ${pc(r.cagr).padStart(7)}/yr  −${(r.dd * 100).toFixed(0).padStart(2)}%  ${(r.expo * 100).toFixed(0).padStart(4)}%  ${r.turnover.toFixed(1).padStart(6)}x  ${String(r.spells.length).padStart(6)}  ${(r.spells.filter((x) => x.ret > 0).length / r.spells.length * 100).toFixed(0)}%`); }
  if (!process.argv[3]) { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'design.json'), JSON.stringify(save)); }
}

// ---------------------------------------------------------------- run: everything the report needs
const RECENT = '2024-02-01';                      // the window all three charts share: hourly candles reach back to Dec 2023
const MASKS = ['', 'M', 'T', 'R', 'S', 'MT', 'MR', 'MTR', 'MTRS'];
const DEEP = { rsi: 5 };                          // the dip rule for a high-cost market (chosen by `design-cost`)
if (mode === 'run') {
  const t00 = Date.now(), res = {};
  for (const mk of ['us', 'in']) {
    const M = D.market(mk), from = M.cfg.start, end = M.dates[M.dates.length - 1];
    const W = mk === 'us' ? { long: [from, end], design: [from, '2013-12-31'], judge: ['2014-01-01', end], recent: [RECENT, end] }
                          : { long: [from, end], h1: [from, '2017-12-31'], h2: ['2018-01-01', end], recent: [RECENT, end] };
    const R = { name: M.cfg.name, cost: M.cfg.cost, costNote: M.cfg.note, stocks: M.stocks.length, hourly: M.stocks.filter((s) => s.h1).length, end, windows: W, notes: M.notes,
      listedAtStart: M.stocks.filter((s) => s.d1[0].d <= from).length, hourlyFrom: M.stocks.filter((s) => s.h1).map((s) => s.h1[0].d).sort()[0], sectors: M.sectors.map((x) => [x, M.stocks.filter((s) => s.sector === x).length]),
      bullShare: M.bull.filter((x, k) => x === true && M.dates[k] >= from).length / M.dates.filter((d) => d >= from).length, base: {}, strat: {}, ablation: {}, leaders: {} };
    for (const [w, [a, b]] of Object.entries(W)) { const l = basket(M, a, b), g = basket(M, a, b, true); R.base[w] = { list: slim(l), bull: slim(g), index: indexHold(M, a, b), yr: w === 'long' ? years(l.curve) : undefined, yrBull: w === 'long' ? years(g.curve) : undefined }; }
    for (const name of ['trend', 'breakout', 'pullback']) { R.strat[name] = {};
      for (const tf of ['1h', '1d', '1w']) { R.strat[name][tf] = {};
        for (const [w, [a, b]] of Object.entries(W)) { if (tf === '1h' && w !== 'recent') continue; R.strat[name][tf][w] = evalSet(M, tf, name, {}, runAll(M, tf, name, {}, a, b), a, b); } }
      R.ablation[name] = {};
      for (const m of MASKS) R.ablation[name][m] = evalSet(M, '1d', name, { ctx: m }, runAll(M, '1d', name, { ctx: m }, W.long[0], W.long[1]), W.long[0], W.long[1]);
      process.stderr.write(`${mk} ${name} ${((Date.now() - t00) / 1000).toFixed(0)}s\n`);
    }
    // the deeper dip that `design-cost` chose for a market with India's costs
    R.deep = {}; for (const tf of ['1d', '1w']) { R.deep[tf] = {};
      for (const [w, [a, b]] of Object.entries(W)) R.deep[tf][w] = evalSet(M, tf, 'pullback', DEEP, runAll(M, tf, 'pullback', DEEP, a, b), a, b); }
    for (const [k, prm] of [['M', {}], ['W', { every: 'W' }], ['Q', { every: 'Q' }], ['M no market test', { ctx: '' }], ['M 6-1', { look: 126 }], ['M 3-0', { look: 63, skip: 0 }]]) { R.leaders[k] = {};
      for (const [w, [a, b]] of Object.entries(W)) { const r = leaders(M, prm, a, b); if (!r) continue; const sp = r.spells.filter((x) => !x.open);
        R.leaders[k][w] = { bk: slim(r), turnover: r.turnover, spells: sp.length, won: sp.length ? sp.filter((x) => x.ret > 0).length / sp.length : null, avg: mean(sp.map((x) => x.ret)),
          days: mean(sp.map((x) => (Date.parse(x.dOut) - Date.parse(x.dIn)) / 864e5)), yr: w === 'long' ? years(r.curve) : undefined }; } }
    res[mk] = R;
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'run.json'), JSON.stringify({ at: new Date().toISOString(), recent: RECENT, defs: Object.fromEntries(Object.entries(STRATS).map(([k, v]) => [k, v.def])), lead: LEAD, deep: DEEP, res }));
  // a compact view on the console
  for (const mk of ['us', 'in']) { const R = res[mk]; console.log(`\n================ ${R.name}`);
    for (const [w, [a, b]] of Object.entries(R.windows)) { const B = R.base[w]; console.log(`\n-- ${w} ${a} → ${b}: list ${pc(B.list.cagr)}/yr DD −${(B.list.dd * 100).toFixed(0)}% | bull days only ${pc(B.bull.cagr)}/yr DD −${(B.bull.dd * 100).toFixed(0)}% | index ${pc(B.index.cagr)}/yr`);
      console.log('strategy  tf   trades  win   avg/tr  control   edge    z    PF  PF-2%   held  worst | book growth   DD   in | stocks ahead');
      for (const name of ['trend', 'breakout', 'pullback']) for (const tf of ['1h', '1d', '1w']) { const x = R.strat[name][tf][w]; if (!x) continue; if (!x.t.n) { console.log(`${name.padEnd(9)} ${tf}  no trades`); continue; }
        console.log(`${name.padEnd(9)} ${tf} ${String(x.t.n).padStart(7)} ${(x.t.wr * 100).toFixed(0).padStart(3)}% ${pc(x.t.avg, 2).padStart(8)} ${pc(x.c.avg, 2).padStart(8)} ${pc(x.edge, 2).padStart(7)} ${x.z.toFixed(1).padStart(5)} ${x.t.pf.toFixed(2).padStart(5)} ${x.t.pfx.toFixed(2).padStart(5)} ${x.t.days.toFixed(1).padStart(7)}d ${pc(x.t.worst, 0).padStart(5)} | ${x.bk ? pc(x.bk.cagr).padStart(7) + '/yr −' + (x.bk.dd * 100).toFixed(0).padStart(2) + '% ' + (x.bk.expo * 100).toFixed(0).padStart(3) + '%' : ''} | ${x.st.ahead}/${x.st.traded}`); }
      for (const k of Object.keys(R.leaders)) { const x = R.leaders[k][w]; if (x) console.log(`leaders ${k.padEnd(18)} ${pc(x.bk.cagr).padStart(7)}/yr −${(x.bk.dd * 100).toFixed(0).padStart(2)}% in ${(x.bk.expo * 100).toFixed(0)}% turnover ${x.turnover.toFixed(1)}x spells ${x.spells} won ${x.won == null ? '—' : (x.won * 100).toFixed(0) + '%'}`); } }
    console.log('\n-- context on daily candles, long window (trades · avg · edge over random | book growth, DD)');
    for (const name of ['trend', 'breakout', 'pullback']) console.log(name.padEnd(9) + MASKS.map((m) => { const x = R.ablation[name][m]; return `${(m || 'none').padEnd(4)} ${String(x.t.n).padStart(5)} ${pc(x.t.avg, 2)} e${pc(x.edge, 2)} | ${pc(x.bk.cagr)} −${(x.bk.dd * 100).toFixed(0)}%`; }).join('  ||  '));
  }
  process.stderr.write(`${((Date.now() - t00) / 1000).toFixed(0)}s\n`);
}

// ---------------------------------------------------------------- design at India's costs (US 2000-2013 data, 0.2% a side)
// Dip-buying earns a fraction of a percent a trade, so a market that charges 0.4% a round trip needs a deeper dip.
// Which one is chosen HERE, on US design data priced at India's costs; India itself is then a clean test of it.
const GRID_COST = [['RSI2 < 10, out over MA5 (the US rule)', {}], ['RSI2 < 5', { rsi: 5 }], ['RSI2 < 3', { rsi: 3 }], ['RSI3 < 15', { len: 3, rsi: 15 }], ['RSI3 < 10', { len: 3, rsi: 10 }],
  ['RSI2 < 5, out over MA10', { rsi: 5, ma: 10 }], ['RSI2 < 5, strong stocks (MTR)', { rsi: 5, ctx: 'MTR' }], ['RSI2 < 5, strong stocks and sectors (MTRS)', { rsi: 5, ctx: 'MTRS' }],
  ['RSI2 < 5, out over MA10, MTR', { rsi: 5, ma: 10, ctx: 'MTR' }], ['RSI3 < 10, out over MA10, MTR', { len: 3, rsi: 10, ma: 10, ctx: 'MTR' }]];
if (mode === 'design-cost') {
  const M = D.market('us'), { from, to } = DESIGN, cost = D.MARKETS.in.cost, save = [];
  console.log(`US ${from} → ${to}, daily candles, costs ${(cost * 100).toFixed(2)}% a side (India's)\n${HEAD} | control avg | deepest dip first: book`);
  for (const [label, prm] of GRID_COST) { const P = { ...STRATS.pullback.def, ...prm, cost }, tr = runAll(M, '1d', 'pullback', { ...prm, cost }, from, to), c = control(M, '1d', tr, P.ctx, from, to, 10, 20261112, cost);
    const bk = book(M, tr, 10, from, to), bk2 = book(M, tr, 10, from, to, (a, b) => (a.dip ?? 50) - (b.dip ?? 50));
    save.push({ label, t: tstats(tr), c, bk: slim(bk), bkDip: slim(bk2) });
    console.log(row(label, tr, bk) + ` | ${pc(c.avg, 2).padStart(7)} | ${pc(bk2.cagr).padStart(7)}/yr DD −${(bk2.dd * 100).toFixed(0)}%`); }
  fs.writeFileSync(path.join(OUT, 'design_cost.json'), JSON.stringify({ from, to, cost, rows: save }));
}
