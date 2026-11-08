/*
 * The flush playbook (research/flush/pro_lab.js, its walk-forward final) against the shipped 4h liqbrk run the way the
 * bot's trading book runs it: one pot, 5 slots, each trade 20% of the book (or what cash is left), the highest relative
 * volume first when several signal together, one position per coin (ALGORITHM.md "The trading book"). Nov 2026, user
 * request: "compare this with our 4H liqbrk". RESEARCH ONLY: detector.js, the webapp and the bot are unchanged.
 *
 *   node research/flush/vs_liqbrk4h.js parity   # this file's book must reproduce research/v2's portfolio() on its data
 *   node research/flush/vs_liqbrk4h.js run      # → research/cache/flush/vs_liqbrk4h.json + the tables
 *   node research/flush/vs_liqbrk4h.js report > research/flush/RESULTS_vs_liqbrk4h_2026-11.md
 *
 * liqbrk is research/liqbrk_lab.js (parity-checked against detector.js trade for trade): the shipped rules (2-day-high
 * break by ≥ 1 ATR, 5-day SMA, 149-bar MA, 1.3× volume; BTC over its 50-day MA on the same 4h candles, or the coin
 * +50% in 30 days; 4×ATR stop, ½ at +3R, the rest out on a close under the 1-day low), signal at a 4h close, filled at
 * the next open. Two universes:
 *   flush universe  the flush study's 274 coins (the user's 103 + 171 dead), 4h candles built from the same 15m files,
 *                   1 Sep 2017 → 5 Nov 2026: the like-for-like comparison
 *   alert list      the 65 liqbrk 4h coins on signals/watchlist.json today (Binance 4h files to 24 Oct 2026); picked
 *                   in 2026, so it carries hindsight
 * Costs: 0.1% fee a side plus slippage on every fill: 0.05% (the v2 study's honest fill) and 0.15% (the flush's).
 */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const L = require('../liqbrk_lab.js');
const { load: load15, LIST } = require('../liqbrk15m/lab15.js');
const PRO = require('./pro_lab.js');
const CACHE = path.join(ROOT, 'research', 'cache'), OUT = path.join(CACHE, 'flush'), DEADDIR = path.join(CACHE, 'lb15dead');
const FEE = 0.001, H4 = 14400, DAY = 86400;
const S0 = Date.UTC(2017, 8, 1) / 1e3, SPLIT = Date.UTC(2022, 0, 1) / 1e3, END15 = Date.UTC(2026, 10, 5, 16) / 1e3;
const TRUNC = { LUNAUSDT: Date.UTC(2022, 4, 14) / 1e3 };     // as the flush study: the original LUNA only
const STABLE = /USD|^(DAI|PAX|UST|EUR|GBP|AUD|TRY|BRL|IDRT|BIDR)$/;

// ---------------------------------------------------------------- data
// 15m → 4h, UTC-aligned like Binance; a last bucket that is not yet complete is dropped
function to4h(c15) {
  const out = []; let cur = null, cnt = 0;
  for (const b of c15) {
    const k = Math.floor(b.time / H4) * H4;
    if (!cur || cur.time !== k) { if (cur) out.push(cur); cur = { time: k, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume }; cnt = 1; }
    else { if (b.high > cur.high) cur.high = b.high; if (b.low < cur.low) cur.low = b.low; cur.close = b.close; cur.volume += b.volume; cnt++; }
  }
  if (cur && (cnt === 16 || c15[c15.length - 1].time - cur.time >= H4 - 900)) out.push(cur);
  return out;
}
function flushUniverse() {
  const U = LIST.map((s) => [s, null]);
  for (const f of fs.readdirSync(DEADDIR).sort()) if (f.endsWith('_15m.json')) U.push([f.replace('_15m.json', ''), DEADDIR]);
  return U.filter(([s]) => !STABLE.test(s.replace(/USDT$/, '')));
}
const load4hCache = (coin) => { const f = path.join(CACHE, `${coin}_4h.json`); if (!fs.existsSync(f)) return null;
  return JSON.parse(fs.readFileSync(f)).map((r) => ({ time: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] })); };

// ---------------------------------------------------------------- shipped liqbrk on one coin (honest fills)
// the flush study's liquidity floor, applied the same way: a buy needs ≥ minTurn a day (30-day average) at the signal
function turnover30(c) {
  const n = c.length, out = new Float64Array(n).fill(NaN), W = Math.round(30 * DAY / Math.max(60, c[1].time - c[0].time)); let s = 0;
  for (let i = 0; i < n; i++) { s += c[i].volume * c[i].close; if (i >= W) s -= c[i - W].volume * c[i - W].close; if (i >= W - 1) out[i] = s / 30; }
  return out;
}
function liqbrk(c, btc, slip, warmMin = 0, minTurn = 0) {
  const ind = L.indicators(c); if (warmMin) ind.warm = Math.max(ind.warm, warmMin);
  let veto = L.marketGate(c, btc);
  if (minTurn > 0) { const T = turnover30(c); veto = veto.map((g, i) => g && T[i] >= minTurn); }
  const r = L.simulate(c, ind, { fill: 'next', slip, exit: 'scale3R', veto });
  return r.trades.map((t) => ({ ...t, tIn: c[t.entryIdx].time, tOut: c[t.exitIdx].time, rv: ind.rv[t.sigIdx] }));
}

// ---------------------------------------------------------------- the book: one pot, N slots (research/v2's portfolio())
// overlay (optional): flush events {t0, t1, ret, used} traded with the cash liqbrk is not using. At the first 4h mark
// at or after the flush candle's close the flush takes min(cash, used × book); its result (ret per full-size flush,
// scaled down when cash was short) is paid back at the first mark after its last exit. 4h marks only.
function book(trades, ser, axis, N, start, end = Infinity, overlay = null) {
  const ents = new Map();
  for (const x of trades) if (x.tIn >= start && x.tIn < end) { let a = ents.get(x.tIn); if (!a) ents.set(x.tIn, (a = [])); a.push(x); }
  const times = axis.filter((t) => t >= start && t < end);
  let cash = 1, open = [], pk = 1, dd = 0, inv = 0, busy = 0, oi = 0, fl = null; const curve = [], taken = [], flushes = [];
  const OV = overlay ? overlay.filter((e) => e.t0 >= start && e.t0 < end).sort((a, b) => a.t0 - b.t0) : [];
  for (const T of times) {
    for (let k = open.length - 1; k >= 0; k--) if (open[k].x.tOut <= T) { cash += open[k].alloc * (1 + open[k].x.t.ret); open.splice(k, 1); }
    if (fl && fl.t1 <= T) { cash += fl.lock + fl.pnl; flushes.push(fl); fl = null; }
    while (!fl && oi < OV.length && OV[oi].t0 <= T) {
      const e = OV[oi++]; if (e.t1 <= T - H4) continue;                  // fell inside a gap in the 4h axis
      const E = cash + open.reduce((s, o) => s + o.val, 0), need = e.used * E, lock = Math.min(cash, need), sc = need > 0 ? lock / need : 0;
      cash -= lock; fl = { t1: e.t1, lock, pnl: sc * e.ret * E, scale: sc };
    }
    for (const x of (ents.get(T) || []).sort((a, b) => b.t.rv - a.t.rv)) {
      if (open.length >= N || open.some((o) => o.x.coin === x.coin)) continue;
      const E = cash + open.reduce((s, o) => s + o.val, 0) + (fl ? fl.lock : 0), alloc = Math.min(cash, E / N); if (alloc <= 1e-12) continue;
      cash -= alloc; open.push({ x, alloc, val: alloc }); taken.push({ coin: x.coin, tIn: x.tIn, tOut: x.tOut, ret: x.t.ret, w: alloc / E });
    }
    for (const o of open) {
      const s = ser[o.x.coin], i = s.idx.get(T); if (i === undefined) continue;
      let v = 0, w = 1; for (const l of o.x.t.legs.slice(0, -1)) if (l.i <= i) { v += l.w * l.px * (1 - FEE); w -= l.w; }
      v += w * s.c[i].close * (1 - FEE); o.val = o.alloc * v / (o.x.t.entry * (1 + FEE));
    }
    const iv = open.reduce((s, o) => s + o.val, 0), E = cash + iv + (fl ? fl.lock : 0);
    inv += E > 0 ? iv / E : 0; if (open.length) busy++; pk = Math.max(pk, E); dd = Math.max(dd, (pk - E) / pk); curve.push([T, E]);
  }
  return { E: curve[curve.length - 1][1], dd, curve, taken, flushes, inv: inv / times.length, busy: busy / times.length, total: [...ents.values()].reduce((s, a) => s + a.length, 0) };
}

// ---------------------------------------------------------------- statistics on an equity curve [[t, E]], same for both
function curveStats(curve, from, to) {
  const pts = curve.filter(([t]) => t >= from && t < to); if (!pts.length) return null;
  const before = curve.filter(([t]) => t < from), e0 = before.length ? before[before.length - 1][1] : 1;
  let pk = e0, dd = 0; for (const [, e] of pts) { pk = Math.max(pk, e); dd = Math.max(dd, 1 - e / pk); }
  const mult = pts[pts.length - 1][1] / e0, yrs = (Math.min(to, pts[pts.length - 1][0]) - from) / 31557600;
  return { mult, cagr: mult ** (1 / yrs) - 1, dd };
}
const eqAt = (curve) => { let j = 0; return (t) => { while (j + 1 < curve.length && curve[j + 1][0] <= t) j++; return curve[j][0] <= t ? curve[j][1] : 1; }; };
function yearly(curve, from, to) {
  const Y = {}; for (let y = new Date(from * 1000).getUTCFullYear(); y <= new Date(to * 1000).getUTCFullYear(); y++) {
    const a = Math.max(from, Date.UTC(y, 0, 1) / 1e3), b = Math.min(to, Date.UTC(y + 1, 0, 1) / 1e3), at = eqAt(curve), e0 = at(a - 1), e1 = at(b - 1);
    Y[y] = e1 / e0 - 1; }
  return Y;
}
function monthly(curve, from, to) {
  const at = eqAt(curve), out = []; let prev = at(from - 1);
  for (let y = new Date(from * 1000).getUTCFullYear(), m = new Date(from * 1000).getUTCMonth(); ; m++) {
    if (m === 12) { m = 0; y++; } const b = Date.UTC(y, m + 1, 1) / 1e3, e = at(Math.min(b, to) - 1); out.push([Date.UTC(y, m, 1) / 1e3, e / prev - 1]); prev = e; if (b >= to) break; }
  return out;
}
const corr = (a, b) => { const n = a.length, ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n;
  let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; } return sab / Math.sqrt(saa * sbb); };
// half the pot in each, put back to 50/50 at every month start; marked daily
function split5050(cA, cB, from, to) {
  const A = eqAt(cA), B = eqAt(cB); let a = 0.5, b = 0.5, pa = A(from - 1), pb = B(from - 1), pk = 1, dd = 0, month = -1; const curve = [];
  for (let t = from + DAY; t <= to + DAY; t += DAY) {
    const ea = A(t - 1), eb = B(t - 1); a *= ea / pa; b *= eb / pb; pa = ea; pb = eb;
    const E = a + b; pk = Math.max(pk, E); dd = Math.max(dd, 1 - E / pk); curve.push([t, E]);
    const m = new Date(t * 1000).getUTCMonth(); if (m !== month) { month = m; a = E / 2; b = E / 2; }
  }
  return { curve, dd };
}
const tradeStats = (tr) => { const w = tr.filter((x) => x.ret > 0), g = w.reduce((s, x) => s + x.ret, 0), l = -tr.filter((x) => x.ret <= 0).reduce((s, x) => s + x.ret, 0);
  return { n: tr.length, wr: w.length / tr.length, pf: g / l, avg: tr.reduce((s, x) => s + x.ret, 0) / tr.length }; };

// ---------------------------------------------------------------- parity: this book vs research/v2's portfolio() on the v2 data
const mode = require.main === module ? process.argv[2] : null;
if (mode === 'parity') {
  const V2 = require('../v2/v2_lab.js'), BTC2 = L.load('BTC', '2h'), BTC4 = V2.load4h('BTC'), A0 = Date.UTC(2020, 0, 1) / 1e3;
  const ser = {}, trades = [];
  for (const coin of V2.COINS) {
    const c = V2.load4h(coin); if (!c || c.length <= 320 + 200) continue;
    ser[coin] = { c, idx: new Map(c.map((b, i) => [b.time, i])) };
    for (const t of liqbrk(c, BTC2, 0.0005, 320)) trades.push({ coin, t, tIn: t.tIn, tOut: t.tOut });
  }
  for (const N of [5, 10]) {
    const mine = book(trades, ser, BTC4.map((b) => b.time), N, A0), ref = V2.portfolio('v1', V2.COINS, N, A0);
    const ok = Math.abs(mine.E - ref.E) < 1e-9 && Math.abs(mine.dd - ref.dd) < 1e-12 && mine.taken.length === ref.taken;
    console.log(`${N} slots from 2020: this book ×${mine.E.toFixed(4)} DD −${(mine.dd * 100).toFixed(2)}% taken ${mine.taken.length} · v2 portfolio() ×${ref.E.toFixed(4)} DD −${(ref.dd * 100).toFixed(2)}% taken ${ref.taken} → ${ok ? 'IDENTICAL' : 'DIFFERENT'}`);
  }
}

if (mode === 'run') {
  const t00 = Date.now(), res = {};
  // ---- the flush playbook, both cost levels (pro_lab's simulator on its cached flush windows)
  const prep = JSON.parse(fs.readFileSync(path.join(OUT, 'pro_prep.json'))), walk = JSON.parse(fs.readFileSync(path.join(OUT, 'walk.json')));
  for (const [k, slip, noDead] of [['flush', 0.0015, false], ['flush·slip0.05', 0.0005, false], ['flush·103 only', 0.0015, true]]) {
    const R = PRO.simulate(prep.arms, { ...walk.final, slip, noDead });
    const ev = R.events.filter((e) => !e.skipped && e.filled);
    res[k] = { curve: R.curve, trades: R.trades.map((t) => ({ ret: t.ret, tIn: t.t })), inMkt: ev.reduce((s, e) => s + e.bars, 0) * 900 / (END15 - S0), events: ev.length, end: END15,
      ov: ev.map((e) => ({ t0: e.t + 900, t1: e.t + 900 + e.bars * 900, ret: e.ret, used: e.used })) };
  }
  // ---- liqbrk on the flush universe (4h from the same 15m files)
  const btc4 = to4h(load15('BTCUSDT')), axis15 = btc4.map((b) => b.time);
  { const ser = {}, T15 = [], T05 = [], T103 = [], dead = new Set();
    for (const [sym, dir] of flushUniverse()) {
      let c15 = dir ? load15(sym, dir) : load15(sym); if (!c15 || c15.length < 3000) continue;
      if (TRUNC[sym]) c15 = c15.filter((b) => b.time < TRUNC[sym]);
      const c = sym === 'BTCUSDT' ? btc4 : to4h(c15); if (c.length < 400) continue;
      ser[sym] = { c, idx: new Map(c.map((b, i) => [b.time, i])) }; if (dir) dead.add(sym);
      for (const t of liqbrk(c, btc4, 0.0015, 0, 1e6)) { T15.push({ coin: sym, t, tIn: t.tIn, tOut: t.tOut }); if (!dir) T103.push({ coin: sym, t, tIn: t.tIn, tOut: t.tOut }); }
      for (const t of liqbrk(c, btc4, 0.0005, 0, 1e6)) T05.push({ coin: sym, t, tIn: t.tIn, tOut: t.tOut });
    }
    res.deadShare = T15.filter((x) => dead.has(x.coin)).length / T15.length;
    const ovr = { 'one pot: liqbrk (103) + flush on idle cash': [T103, res['flush·103 only'].ov], 'one pot: liqbrk (274) + flush on idle cash': [T15, res.flush.ov] };
    for (const [k, [trades, ov]] of Object.entries(ovr)) { const b = book(trades, ser, axis15, 5, S0, END15, ov);
      res[k] = { curve: b.curve, trades: b.taken, inMkt: b.busy, invested: b.inv, end: END15, coins: Object.keys(ser).length, flushScale: b.flushes.reduce((s, f) => s + f.scale, 0) / Math.max(1, b.flushes.length) }; }
    for (const [k, trades] of [['liqbrk', T15], ['liqbrk·slip0.05', T05], ['liqbrk·103 only', T103]]) {
      const b = book(trades, ser, axis15, 5, S0, END15);
      res[k] = { curve: b.curve, trades: b.taken, inMkt: b.busy, invested: b.inv, signals: b.total, end: END15, coins: Object.keys(ser).length };
    }
    process.stderr.write(`liqbrk: ${Object.keys(ser).length} coins · ${((Date.now() - t00) / 1000).toFixed(0)}s\n`); }
  // ---- liqbrk on today's alert list (Binance 4h files)
  const watch = require(path.join(ROOT, 'signals', 'watchlist.json')).watch.filter((x) => (x.strategy || 'liqbrk') === 'liqbrk' && x.tf === '4h').map((x) => x.symbol.replace(/USDT$/, ''));
  const btcC = load4hCache('BTC'), END4 = btcC[btcC.length - 1].time + H4;
  { const ser = {}, trades = [];
    for (const coin of watch) { const c = load4hCache(coin); if (!c || c.length < 400) continue; ser[coin] = { c, idx: new Map(c.map((b, i) => [b.time, i])) };
      for (const t of liqbrk(c, btcC, 0.0015, 0, 1e6)) trades.push({ coin, t, tIn: t.tIn, tOut: t.tOut }); }
    const b = book(trades, ser, btcC.map((x) => x.time), 5, S0, END4);
    res['liqbrk·alert list'] = { curve: b.curve, trades: b.taken, inMkt: b.busy, invested: b.inv, signals: b.total, end: END4, coins: Object.keys(ser).length };
    const o = book(trades, ser, btcC.map((x) => x.time), 5, S0, END4, res.flush.ov);
    res['one pot: liqbrk (alert list) + flush on idle cash'] = { curve: o.curve, trades: o.taken, inMkt: o.busy, invested: o.inv, end: END4, coins: Object.keys(ser).length, flushScale: o.flushes.reduce((s, f) => s + f.scale, 0) / Math.max(1, o.flushes.length) }; }
  // ---- BTC held, same span
  { let pk = 0, dd = 0; const xs = btc4.filter((x) => x.time >= S0), curve = xs.map((x) => [x.time + H4, x.close / xs[0].open]);
    res['BTC held'] = { curve, trades: [], inMkt: 1, end: END15 }; }
  // ---- summary
  const rows = {};
  for (const [k, r] of Object.entries(res)) {
    if (!r.curve) continue;
    const all = curveStats(r.curve, S0, r.end), h1 = curveStats(r.curve, S0, SPLIT), h2 = curveStats(r.curve, SPLIT, r.end);
    rows[k] = { all, h1, h2, years: yearly(r.curve, S0, r.end), trades: r.trades.length && !k.startsWith('one pot') ? tradeStats(r.trades) : null, inMkt: r.inMkt, invested: r.invested, signals: r.signals, coins: r.coins, end: r.end, flushScale: r.flushScale };
  }
  const mF = monthly(res.flush.curve, S0, END15), mL = monthly(res.liqbrk.curve, S0, END15), mB = monthly(res['BTC held'].curve, S0, END15);
  const c = { flush_liqbrk: corr(mF.map((x) => x[1]), mL.map((x) => x[1])), flush_btc: corr(mF.map((x) => x[1]), mB.map((x) => x[1])), liqbrk_btc: corr(mL.map((x) => x[1]), mB.map((x) => x[1])) };
  for (const [k, lk, fk] of [['50/50 flush + liqbrk (274)', 'liqbrk', 'flush'], ['50/50 flush + liqbrk (103)', 'liqbrk·103 only', 'flush·103 only'], ['50/50 flush + liqbrk (alert list)', 'liqbrk·alert list', 'flush']]) {
    const end = Math.min(res[lk].end, res[fk].end), sp = split5050(res[lk].curve, res[fk].curve, S0, end);
    rows[k] = { all: { ...curveStats(sp.curve, S0, end), dd: sp.dd }, h1: curveStats(sp.curve, S0, SPLIT), h2: curveStats(sp.curve, SPLIT, end), years: yearly(sp.curve, S0, end) };
  }
  // the months each one lost most, and how the other did then
  const worst = (m, o) => m.map((x, i) => [x[0], x[1], o[i][1]]).sort((a, b) => a[1] - b[1]).slice(0, 5).map(([t, a, b]) => ({ month: new Date(t * 1000).toISOString().slice(0, 7), self: a, other: b }));
  const mA = monthly(res['liqbrk·alert list'].curve, S0, res['liqbrk·alert list'].end);
  c.flush_alertlist = corr(mF.slice(0, mA.length).map((x) => x[1]), mA.map((x) => x[1]));
  const out = { at: new Date().toISOString(), rows, corr: c, deadShare: res.deadShare, worstMonths: { liqbrk: worst(mL, mF), flush: worst(mF, mL), alertList: worst(mA, mF.slice(0, mA.length)) }, monthsUp: { flush: mF.filter((x) => x[1] > 0).length, liqbrk: mL.filter((x) => x[1] > 0).length, flat: mF.filter((x) => x[1] === 0).length, n: mF.length } };
  fs.writeFileSync(path.join(OUT, 'vs_liqbrk4h.json'), JSON.stringify(out));
  const f = (x, d = 1) => (x == null || !Number.isFinite(x) ? '—' : (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(d) + '%');
  console.log('\n                        pot ×   a year  max DD  | 2017-21 ×  DD     | 2022-26 ×  DD     | trades  win   PF    avg     | in mkt  coins');
  for (const [k, r] of Object.entries(rows)) console.log(`${k.padEnd(22)} ${('×' + r.all.mult.toFixed(2)).padStart(7)} ${f(r.all.cagr).padStart(7)} ${('−' + (r.all.dd * 100).toFixed(1) + '%').padStart(7)} | ${('×' + r.h1.mult.toFixed(2)).padStart(7)} ${('−' + (r.h1.dd * 100).toFixed(0) + '%').padStart(5)} | ${('×' + r.h2.mult.toFixed(2)).padStart(7)} ${('−' + (r.h2.dd * 100).toFixed(0) + '%').padStart(5)} | ${r.trades ? String(r.trades.n).padStart(5) + ' ' + (r.trades.wr * 100).toFixed(0).padStart(3) + '% ' + r.trades.pf.toFixed(2).padStart(5) + ' ' + f(r.trades.avg, 2).padStart(7) : '                         '} | ${r.inMkt != null ? (r.inMkt * 100).toFixed(1).padStart(5) + '%' : '      '} ${r.coins || ''}`);
  console.log('\nyears:'); for (const [k, r] of Object.entries(rows)) console.log(`${k.padEnd(22)} ${Object.entries(r.years).map(([y, v]) => y.slice(2) + ' ' + f(v, 0)).join('  ')}`);
  console.log(`\nmonthly correlation: flush–liqbrk ${c.flush_liqbrk.toFixed(2)} · flush–liqbrk(alert list) ${c.flush_alertlist.toFixed(2)} · flush–BTC ${c.flush_btc.toFixed(2)} · liqbrk–BTC ${c.liqbrk_btc.toFixed(2)} · liqbrk signals on dead coins ${(res.deadShare * 100).toFixed(0)}%`);
  console.log('liqbrk worst months (flush that month):', out.worstMonths.liqbrk.map((x) => `${x.month} ${f(x.self)} (${f(x.other)})`).join(' · '));
  console.log('liqbrk alert-list worst months (flush that month):', out.worstMonths.alertList.map((x) => `${x.month} ${f(x.self)} (${f(x.other)})`).join(' · '));
  for (const [k, r] of Object.entries(rows)) if (r.flushScale != null) console.log(`${k}: the flush got ${(r.flushScale * 100).toFixed(0)}% of its full size on average`);
  console.log('flush worst months (liqbrk that month):', out.worstMonths.flush.map((x) => `${x.month} ${f(x.self)} (${f(x.other)})`).join(' · '));
  console.log(`months up: flush ${out.monthsUp.flush} (flat ${out.monthsUp.flat}), liqbrk ${out.monthsUp.liqbrk}, of ${out.monthsUp.n} · ${((Date.now() - t00) / 1000).toFixed(0)}s`);
}
if (mode === 'report') {
  const J = JSON.parse(fs.readFileSync(path.join(OUT, 'vs_liqbrk4h.json'))), R = J.rows;
  const f = (x, d = 1) => (x == null || !Number.isFinite(x) ? '—' : (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(d) + '%');
  const m = (x) => (x >= 10 ? '×' + x.toFixed(1) : '×' + x.toFixed(2)), dd = (x) => '−' + (x * 100).toFixed(0) + '%';
  const o = []; const p = (s = '') => o.push(s);
  const ratio = (x) => (x < 0 ? '−' : '') + Math.abs(x).toFixed(2);
  const row = (lab, k) => { const r = R[k]; return `| ${lab} | ${m(r.all.mult)} | ${f(r.all.cagr)} | ${dd(r.all.dd)} | ${ratio(r.all.cagr / r.all.dd)} | ${m(r.h1.mult)} (${dd(r.h1.dd)}) | ${m(r.h2.mult)} (${dd(r.h2.dd)}) | ${r.trades ? r.trades.n : '—'} | ${r.trades ? (r.trades.wr * 100).toFixed(0) + '%' : '—'} | ${r.trades ? f(r.trades.avg, 2) : '—'} | ${r.inMkt != null ? (r.inMkt * 100).toFixed(1) + '%' : '—'} |`; };
  p('# The flush playbook vs the 4h liqbrk book (Nov 2026)');
  p();
  p('Generated by `research/flush/vs_liqbrk4h.js report`. **Research only: detector.js, the webapp and the bot are unchanged.** User request: "compare this with our 4H liqbrk".');
  p();
  p('**Both run as one pot, 1 Sep 2017 → 5 Nov 2026** (the alert list to 24 Oct 2026), costs on every fill.');
  p('- **Flush playbook:** research/flush/pro_lab.js, the walk-forward final strategy.');
  p('- **liqbrk:** the shipped rules (research/liqbrk_lab.js, parity-checked against detector.js), run the way the bot\'s trading book runs it:');
  p('  - 5 slots, each trade 20% of the book.');
  p('  - When several coins signal together, the highest relative volume goes first; one position per coin.');
  p('  - Signal at a 4h close, filled at the next open.');
  p('  - This book reproduces the v2 study\'s one-pot result exactly (×13.52, −66.2%, 1,068 trades from 2020; `parity` mode).');
  p('- **Same floor for both:** a buy needs ≥ $1M a day of turnover (30-day average).');
  p('- **Costs:** 0.1% fee a side plus 0.15% slippage on market orders.');
  p('- **Return per unit of drawdown** = a year ÷ max drawdown.');
  p();
  p('| | pot | a year | max drawdown | return ÷ drawdown | 2017–21 | 2022–26 | trades | win | a trade | in the market |');
  p('|---|---|---|---|---|---|---|---|---|---|---|');
  p(row('**Flush playbook** (274 coins, the dead ones included)', 'flush'));
  p(row('Flush playbook, your 103 coins only', 'flush·103 only'));
  p(row('**4h liqbrk, your 65 alert coins** (picked in 2026)', 'liqbrk·alert list'));
  p(row('4h liqbrk, your 103 Compare coins', 'liqbrk·103 only'));
  p(row('4h liqbrk, every coin that traded (incl. the 171 that died later)', 'liqbrk'));
  p(row('BTC held', 'BTC held'));
  p(row('**One pot: liqbrk (alert list) + the flush on its idle cash**', 'one pot: liqbrk (alert list) + flush on idle cash'));
  p(row('One pot: liqbrk (103) + the flush on its idle cash', 'one pot: liqbrk (103) + flush on idle cash'));
  p(row('Half in each, rebalanced monthly (alert list)', '50/50 flush + liqbrk (alert list)'));
  p(row('Half in each, rebalanced monthly (103)', '50/50 flush + liqbrk (103)'));
  p();
  p('## What it says');
  p();
  p(`1. **liqbrk makes more money; the flush loses far less.** On your alert list liqbrk grows the pot ${m(R['liqbrk·alert list'].all.mult)} (${f(R['liqbrk·alert list'].all.cagr)} a year) against the flush's ${m(R.flush.all.mult)} (${f(R.flush.all.cagr)}). It falls ${dd(R['liqbrk·alert list'].all.dd)} on the way against ${dd(R.flush.all.dd)}. Per unit of drawdown the flush earns about three times as much (${(R.flush.all.cagr / R.flush.all.dd).toFixed(2)} vs ${(R['liqbrk·alert list'].all.cagr / R['liqbrk·alert list'].all.dd).toFixed(2)}). liqbrk wins ${(R['liqbrk·alert list'].trades.wr * 100).toFixed(0)}% of trades and the flush ${(R.flush.trades.wr * 100).toFixed(0)}%.`);
  p(`2. **liqbrk depends on the coin list; the flush doesn't.**`);
  p(`   - On your alert list liqbrk makes ${m(R['liqbrk·alert list'].all.mult)}, and on your 103 Compare coins ${m(R['liqbrk·103 only'].all.mult)}. Both lists were picked in 2026 from coins that are still alive, and its big years come from a few runners (2023: CFX +166%, SUPER +114%, ARK +109% a trade, each in a 20% slot).`);
  p(`   - On every coin that was tradeable at the time, including the 171 that later died, the same book ends at ${m(R.liqbrk.all.mult)}: ${f(R.liqbrk.years['2022'], 0)} in 2022, ${f(R.liqbrk.years['2023'], 0)} in 2023, ${f(R.liqbrk.years['2024'], 0)} in 2024.`);
  p(`   - Why: ${(J.deadShare * 100).toFixed(0)}% of its signals came from coins that later died, and the book takes the loudest breakout first. A dying coin's pump is loud.`);
  p(`   - The flush barely notices the dead coins (${m(R.flush.all.mult)} with them, ${m(R['flush·103 only'].all.mult)} without): it buys a capitulation dip for hours, not a breakout for days.`);
  p(`   - So liqbrk\'s real-world result rests on choosing coins that survive, and the ${m(R['liqbrk·alert list'].all.mult)} carries hindsight.`);
  p(`3. **They hardly overlap.** Monthly correlation ${J.corr.flush_alertlist.toFixed(2)} with the alert-list book (${J.corr.flush_liqbrk.toFixed(2)} on all coins); the flush\'s correlation with BTC is ${J.corr.flush_btc.toFixed(2)}, liqbrk\'s ${J.corr.liqbrk_btc.toFixed(2)}. In liqbrk\'s five worst months (alert list) the flush ${(() => { const W = J.worstMonths.alertList, z = W.filter((x) => x.other === 0).length, rest = W.filter((x) => x.other !== 0); return `had no trade in ${z}${rest.length ? ' and made ' + rest.map((x) => f(x.other)).join(', ') + ' in the other' + (rest.length > 1 ? 's' : '') : ''}`; })()}.`);
  p(`4. **Run together in one pot, the flush adds its return on money that would sit idle.** liqbrk is in the market ${(R['liqbrk·alert list'].inMkt * 100).toFixed(0)}% of the time; when a flush comes it got ${(R['one pot: liqbrk (alert list) + flush on idle cash'].flushScale * 100).toFixed(0)}% of its full size on average. The alert-list pot goes from ${m(R['liqbrk·alert list'].all.mult)} to ${m(R['one pot: liqbrk (alert list) + flush on idle cash'].all.mult)} (${f(R['one pot: liqbrk (alert list) + flush on idle cash'].all.cagr)} a year) at a max drawdown of ${dd(R['one pot: liqbrk (alert list) + flush on idle cash'].all.dd)} instead of ${dd(R['liqbrk·alert list'].all.dd)}. Splitting the money 50/50 instead cuts the drawdown to ${dd(R['50/50 flush + liqbrk (alert list)'].all.dd)} but earns less (${m(R['50/50 flush + liqbrk (alert list)'].all.mult)}), because half of it waits for flushes.`);
  p();
  p('Year by year:');
  p();
  const ks = [['Flush', 'flush'], ['liqbrk, alert list', 'liqbrk·alert list'], ['liqbrk, 103 coins', 'liqbrk·103 only'], ['liqbrk, all 274', 'liqbrk'], ['One pot (alert list)', 'one pot: liqbrk (alert list) + flush on idle cash'], ['BTC held', 'BTC held']];
  const yrs = Object.keys(R.flush.years);
  p(`| | ${yrs.map((y) => (y === '2017' ? '2017 (from Sep)' : y === '2026' ? '2026 (to Nov)' : y)).join(' | ')} |`);
  p(`|---|${yrs.map(() => '---').join('|')}|`);
  for (const [lab, k] of ks) p(`| ${lab} | ${yrs.map((y) => f(R[k].years[y], 0)).join(' | ')} |`);
  p();
  p('Limits:');
  p('- The one-pot overlay books each flush at 4h marks (the flush\'s own drawdown is read every 15 minutes in its own row).');
  p('- The flush needs action within minutes of a 15m close; GitHub\'s scheduler starts the bot hours late, so it would need the punctual outside trigger.');
  p('- The alert list and the 103 coins are lists of survivors.');
  p('- Everything here is a backtest.');
  process.stdout.write(o.join('\n') + '\n');
}
module.exports = { to4h, liqbrk, book, curveStats };
