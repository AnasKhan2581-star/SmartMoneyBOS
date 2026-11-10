/*
 * liqbrk and sudden runs: the breakout the market gate blocks (Nov 2026, user report with INIT's +79% day: "no strategy
 * is able to detect, alert and trade these sudden runs"). RESEARCH ONLY: detector.js, the webapp and the bot are unchanged.
 *
 *   NODE_USE_ENV_PROXY=1 node research/latelead/latelead_lab.js fetch     # the alert list's 4h candles to now → research/cache/latelead
 *   node research/latelead/latelead_lab.js case INIT                      # one coin's last days, candle by candle, under every variant
 *   node research/latelead/latelead_lab.js run                            # → research/cache/latelead/run.json + the tables
 *   node research/latelead/latelead_lab.js report > research/latelead/RESULTS_latelead_2026-11.md
 *
 * WHAT HAPPENED ON INIT 4h (9–10 Nov 2026). The +30% breakout candle passed every chart rule at its close (0.169), but
 * BTC was 9% under its 50-day MA and INIT was +44% over 30 days, short of the +50% "leader" rescue, so the market gate
 * blocked the buy. One candle later INIT was a leader, but that close was no longer the FIRST close above the 2-day
 * high, so the fresh-breakout rule blocked it. The strategy saw the run and two rules, one after the other, kept it out.
 *
 * THE TEST: the shipped rules (research/liqbrk_lab.js, parity-checked against detector.js) with ONE entry change each,
 * exits unchanged (4×ATR stop, ½ at +3R, the rest out on a close under the 1-day low):
 *   late K    a breakout that passed every chart rule and was blocked ONLY by the market gate stays armed for K
 *             candles. The first close in that window with the gate open buys, if every close since the breakout held
 *             above the level it broke and that close is above both trend averages (5-day SMA, 149-bar MA).
 *   day X     the leader rescue also accepts a coin up ≥ X over the last 24 hours (the +50% over 30 days stays).
 *   no gate   reference: the market gate off.
 * And the opposite direction, after the first results (the shipped rescue already buys some sudden runs, late):
 *   rescue: leader a day earlier too   the +50%/30d test must also have held one day before the breakout
 *   rescue: not after a +X% day        the rescue is void when the last 24 hours alone are ≥ +X%
 *   no rescue (BTC only)               reference: the leader rescue off
 * Both ideas were written from the INIT case BEFORE any number here was seen. INIT's own run is in the alert-list data
 * (it ends today) and in neither of the long universes (they end 5 Nov 2026).
 *
 * Universes (4h): the 65 liqbrk 4h coins on signals/watchlist.json (Binance 4h candles to now); the user's 103 Compare
 * coins and the same plus 171 delisted or collapsed coins (4h built from the 15m files of research/liqbrk15m, 2017 → 5
 * Nov 2026; a buy there needs ≥ $1M a day, 30-day average, as in the flush comparison).
 * Fills: signal at a 4h close, bought at the next open + slippage; 0.1% fee a side; slippage 0.15% (stress: a buy made
 * one whole candle late, which is what a late bot does to a fast coin).
 */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const L = require('../liqbrk_lab.js');
const CACHE = path.join(ROOT, 'research', 'cache'), OUT = path.join(CACHE, 'latelead'), DEADDIR = path.join(CACHE, 'lb15dead');
const H4 = 14400, DAY = 86400, SLIP = 0.0015;
const SPLIT = Date.UTC(2022, 0, 1) / 1e3, S0 = Date.UTC(2017, 8, 1) / 1e3;
const STABLE = /USD|^(DAI|PAX|UST|EUR|GBP|AUD|TRY|BRL|IDRT|BIDR)$/;
const TRUNC = { LUNAUSDT: Date.UTC(2022, 4, 14) / 1e3 };
const alertCoins = () => require(path.join(ROOT, 'signals', 'watchlist.json')).watch
  .filter((x) => (x.strategy || 'liqbrk') === 'liqbrk' && x.tf === '4h').map((x) => x.symbol);

// ---------------------------------------------------------------- variants
const VARIANTS = [
  ['shipped', {}],
  // buy MORE of the sudden runs
  ['late 1', { late: 1 }], ['late 2', { late: 2 }], ['late 3', { late: 3 }], ['late 6', { late: 6 }],
  ['day +20%', { day: 0.2 }], ['day +30%', { day: 0.3 }],
  ['no gate', { nogate: true }],
  // buy FEWER: the leader rescue must not be the pump itself
  ['rescue: leader a day earlier too', { held: true }],
  ['rescue: not after a +15% day', { calm: 0.15 }], ['rescue: not after a +20% day', { calm: 0.2 }], ['rescue: not after a +30% day', { calm: 0.3 }],
  ['no rescue (BTC only)', { norescue: true }],
];
const sma = (x, len) => { const o = new Array(x.length).fill(NaN); let s = 0; for (let i = 0; i < x.length; i++) { s += x[i]; if (i >= len) s -= x[i - len]; if (i >= len - 1) o[i] = s / len; } return o; };
function turnover30(c) {
  const n = c.length, out = new Float64Array(n).fill(NaN), W = Math.round(30 * DAY / Math.max(60, c[1].time - c[0].time)); let s = 0;
  for (let i = 0; i < n; i++) { s += c[i].volume * c[i].close; if (i >= W) s -= c[i - W].volume * c[i - W].close; if (i >= W - 1) out[i] = s / 30; }
  return out;
}
// the entry side of one variant: sig = a buy is wanted at this close, veto = the market gate (and the liquidity floor)
function entries(c, ind, btc, v, minTurn = 0) {
  const n = c.length, closes = c.map((b) => b.close), gate0 = L.marketGate(c, btc), ma149 = sma(closes, 149);
  // the gate's two parts, as liqbrk_lab.marketGate reads them: BTC over its 50-day MA, or the coin +50% over 30 days
  const btcOk = L.marketGate(c, btc, L.P.lbBtcMaDays, 0), B = Math.max(1, Math.round(ind.bpd)), L30 = Math.max(2, Math.round(30 * ind.bpd));
  const lead = (i) => i >= L30 && closes[i] >= (1 + L.P.lbLeadPump) * closes[i - L30], dayUp = (i, x) => i >= B && closes[i] >= (1 + x) * closes[i - B];
  let g = gate0.slice();
  if (v.day) for (let i = B; i < n; i++) if (dayUp(i, v.day)) g[i] = true;
  if (v.nogate) g = g.map(() => true);
  if (v.held) g = g.map((x, i) => btcOk[i] || (lead(i) && i >= B && lead(i - B)));
  if (v.calm) g = g.map((x, i) => btcOk[i] || (lead(i) && !dayUp(i, v.calm)));
  if (v.norescue) g = btcOk.slice();
  const sig = ind.sig.slice(), late = new Map();
  if (v.late) for (let i = ind.warm; i < n; i++) {
    if (!ind.sig[i] || g[i]) continue;                               // a fresh breakout that only the gate blocked
    const lvl = ind.hiB[i];
    for (let j = i + 1; j <= Math.min(n - 1, i + v.late); j++) {
      if (!(closes[j] > lvl)) break;                                 // it fell back under the level it broke: over
      if (g[j]) { if (closes[j] > ind.maT[j] && closes[j] > ma149[j] && !sig[j]) { sig[j] = true; late.set(j, i); } break; }
    }
  }
  if (minTurn > 0) { const T = turnover30(c); g = g.map((x, i) => x && T[i] >= minTurn); }
  return { sig, veto: g, late, gate0, btcOk, lead, dayUp, B };
}
// run one coin under one variant; `delay` buys one candle later than the signal (a late bot)
function runCoin(coin, c, btc, v, minTurn = 0, delay = 0) {
  const ind = L.indicators(c), e = entries(c, ind, btc, v, minTurn);
  let sig = e.sig.map((s, i) => s && e.veto[i]), src = (i) => i;
  if (delay) { const sh = new Array(c.length).fill(false); for (let i = 0; i + delay < c.length; i++) if (sig[i]) sh[i + delay] = true; sig = sh; src = (i) => i - delay; }
  const r = L.simulate(c, { ...ind, sig }, { fill: 'next', slip: SLIP, exit: 'scale3R' });
  const tag = (t) => { const s = src(t.sigIdx); return { coin, t: { ...t, rv: ind.rv[s] }, tIn: c[t.entryIdx].time, tOut: c[t.exitIdx].time, sig: s, sigT: c[s].time, ret: t.ret,
    late: e.late.has(s), armedAt: e.late.has(s) ? c[e.late.get(s)].time : null, byDay: !!v.day && !e.gate0[s] }; };
  return { trades: r.trades.map(tag), open: r.open ? { entry: r.open.entry, stop: r.open.stop0, sigT: c[src(r.open.sigIdx)].time, tIn: c[r.open.entryIdx] ? c[r.open.entryIdx].time : null, late: e.late.has(src(r.open.sigIdx)) } : null, ind, e };
}

// ---------------------------------------------------------------- statistics
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
function tstats(tr) {
  const r = tr.map((x) => x.ret), n = r.length; if (!n) return { n: 0 };
  const g = r.filter((x) => x > 0).reduce((s, x) => s + x, 0), l = -r.filter((x) => x <= 0).reduce((s, x) => s + x, 0);
  const so = r.slice().sort((a, b) => b - a), cut = so.slice(Math.ceil(n * 0.02));
  const g2 = cut.filter((x) => x > 0).reduce((s, x) => s + x, 0), l2 = -cut.filter((x) => x <= 0).reduce((s, x) => s + x, 0);
  return { n, wr: r.filter((x) => x > 0).length / n, avg: mean(r), med: so[n >> 1], pf: l > 0 ? g / l : Infinity, pfx: l2 > 0 ? g2 / l2 : Infinity };
}
const key = (x) => `${x.coin}|${x.sig}`;
function compare(base, v) {                                           // what a variant adds to and takes from the shipped trades
  const B = new Set(base.map(key)), V = new Set(v.map(key));
  return { added: v.filter((x) => !B.has(key(x))), removed: base.filter((x) => !V.has(key(x))) };
}
const coinNet = (tr) => { const m = {}; for (const x of tr) m[x.coin] = (m[x.coin] ?? 1) * (1 + x.ret); return m; };

// shipped trades by WHY the market gate let them in
const GROUPS = ['BTC over its 50-day MA', 'leader: +50%/30d also held a day earlier', 'leader ONLY through the last day (a pump)', '  …the last 24h alone ≥ +20%', '  …the last 24h under +20%'];
function groupsOf(u) {
  const G = Object.fromEntries(GROUPS.map((k) => [k, []]));
  for (const [coin, c] of u.coins) { const r = runCoin(coin, c, u.btc, {}, u.minTurn), e = r.e;
    for (const x of r.trades) { const s = x.sig;
      if (e.btcOk[s]) { G[GROUPS[0]].push(x); continue; }
      if (s >= e.B && e.lead(s - e.B)) G[GROUPS[1]].push(x); else { G[GROUPS[2]].push(x); G[e.dayUp(s, 0.2) ? GROUPS[3] : GROUPS[4]].push(x); } } }
  // bootstrap (10,000 resamples): how often a group's average trade is ≥ 0, and ≥ the BTC-gated trades' average
  const rnd = require('../rng.js').mulberry32(20261110), base = G[GROUPS[0]].map((x) => x.ret), baseAvg = mean(base);
  const odds = (tr) => { const r = tr.map((x) => x.ret); if (r.length < 5) return null; let ge0 = 0, geB = 0;
    for (let b = 0; b < 10000; b++) { let s = 0; for (let q = 0; q < r.length; q++) s += r[Math.floor(rnd() * r.length)]; const m = s / r.length; if (m >= 0) ge0++; if (m >= baseAvg) geB++; }
    return { ge0: ge0 / 10000, geBase: geB / 10000 }; };
  return Object.fromEntries(Object.entries(G).map(([k, tr]) => [k, { all: tstats(tr), h1: tstats(tr.filter((x) => x.sigT < SPLIT)), h2: tstats(tr.filter((x) => x.sigT >= SPLIT)), odds: k === GROUPS[0] ? null : odds(tr) }]));
}
// shipped buys that come within a day AFTER a fresh breakout the gate blocked (INIT's pending alert is one of these)
function afterOf(u) {
  const all = [], big = [], list = [];
  for (const [coin, c] of u.coins) { const r = runCoin(coin, c, u.btc, {}, u.minTurn), ind = r.ind, e = r.e;
    for (const x of r.trades) { let j = -1; for (let k = x.sig - 1; k >= Math.max(ind.warm, x.sig - e.B); k--) if (ind.sig[k] && !e.gate0[k]) { j = k; break; }
      if (j < 0) continue; all.push(x);
      if (e.dayUp(j, 0.2)) { big.push(x); list.push({ coin, blocked: c[j].time + H4, day: c[j].close / c[j - e.B].close - 1, bought: x.sigT + H4, run: c[x.sig].close / c[j - e.B].close - 1, ret: x.ret }); } } }
  return { all: tstats(all), big: tstats(big), list };
}

// ---------------------------------------------------------------- data
const load4h = (sym) => { const f = path.join(OUT, `${sym}_4h.json`); if (!fs.existsSync(f)) return null;
  return JSON.parse(fs.readFileSync(f)).map((r) => ({ time: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] })); };
function universes() {
  const { load: load15, LIST } = require('../liqbrk15m/lab15.js'), { to4h } = require('../flush/vs_liqbrk4h.js');
  const btc15 = to4h(load15('BTCUSDT')), U = { alert: { btc: load4h('BTCUSDT'), coins: [], minTurn: 0 }, u103: { btc: btc15, coins: [], minTurn: 1e6 }, u274: { btc: btc15, coins: [], minTurn: 1e6 } };
  for (const sym of alertCoins()) { const c = load4h(sym); if (c && c.length >= 400) U.alert.coins.push([sym.replace(/USDT$/, ''), c]); }
  for (const sym of LIST) { if (STABLE.test(sym.replace(/USDT$/, ''))) continue; const c15 = load15(sym); if (!c15 || c15.length < 3000) continue;
    const c = sym === 'BTCUSDT' ? btc15 : to4h(c15); if (c.length < 400) continue; U.u103.coins.push([sym.replace(/USDT$/, ''), c]); U.u274.coins.push([sym.replace(/USDT$/, ''), c]); }
  for (const f of fs.readdirSync(DEADDIR).sort()) { if (!f.endsWith('_15m.json')) continue; const sym = f.replace('_15m.json', ''); if (STABLE.test(sym.replace(/USDT$/, ''))) continue;
    let c15 = load15(sym, DEADDIR); if (!c15 || c15.length < 3000) continue; if (TRUNC[sym]) c15 = c15.filter((b) => b.time < TRUNC[sym]);
    const c = to4h(c15); if (c.length < 400) continue; U.u274.coins.push([sym.replace(/USDT$/, '') + '†', c]); }
  return U;
}

const mode = require.main === module ? process.argv[2] : null;
const iso = (t) => new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' ');
const ist = (t) => new Date((t + 19800) * 1000).toISOString().slice(5, 16).replace('T', ' ');
const pc = (x, d = 2) => (x == null || !Number.isFinite(x) ? '—' : (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(d) + '%');

// ---------------------------------------------------------------- fetch: closed 4h candles, listing → now
if (mode === 'fetch') (async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const EP = ['https://data-api.binance.vision', 'https://api.binance.com'], syms = ['BTCUSDT', ...alertCoins().filter((s) => s !== 'BTCUSDT'), ...process.argv.slice(3).map((s) => s.toUpperCase() + (s.toUpperCase().endsWith('USDT') ? '' : 'USDT'))];
  const one = async (sym) => { let out = [], end;
    for (;;) { const qs = `symbol=${sym}&interval=4h&limit=1000` + (end ? `&endTime=${end}` : ''); let rows = null;
      for (const b of EP) { try { const r = await fetch(`${b}/api/v3/klines?${qs}`); if (r.ok) { rows = await r.json(); break; } } catch (e) { /* next endpoint */ } }
      if (!rows) throw new Error(sym + ': fetch failed'); if (!rows.length) break; out = rows.concat(out); end = rows[0][0] - 1; if (rows.length < 1000) break; }
    const now = Date.now(), seen = new Set(), c = out.filter((k) => k[6] <= now && !seen.has(k[0]) && seen.add(k[0])).map((k) => [Math.floor(k[0] / 1000), +k[1], +k[2], +k[3], +k[4], +k[5]]).sort((a, b) => a[0] - b[0]);
    fs.writeFileSync(path.join(OUT, `${sym}_4h.json`), JSON.stringify(c)); return c.length; };
  const q = [...new Set(syms)]; let done = 0;
  await Promise.all([0, 1, 2, 3].map(async () => { while (q.length) { const s = q.shift(); try { const n = await one(s); done++; if (done % 10 === 0) process.stderr.write(`${done} · ${s} ${n} candles\n`); } catch (e) { console.log('FAILED', e.message); } } }));
  const b = load4h('BTCUSDT'); console.log(`${done} coins → ${OUT} · BTC to ${iso(b[b.length - 1].time + H4)} UTC (the last closed candle's close)`);
})();

// ---------------------------------------------------------------- case: one coin's recent candles under every variant
function caseOf(sym, nBars = 12) {
  const c = load4h(sym), btc = load4h('BTCUSDT'); if (!c) return null;
  const last = c[c.length - 1], ind = L.indicators(c), e0 = entries(c, ind, btc, {}), ma149 = sma(c.map((b) => b.close), 149);
  const candles = []; for (let i = c.length - nBars; i < c.length; i++) candles.push({ close: c[i].time + H4, px: c[i].close, chg: c[i].close / c[i - 1].close - 1, chart: ind.sig[i], gate: e0.gate0[i], btcOk: e0.btcOk[i], lead: e0.lead(i),
    fresh: c[i - 1].close <= ind.hiB[i - 1], broke: c[i].close > ind.hiB[i], hi2: ind.hiB[i], lead30: c[i].close / c[i - Math.round(30 * ind.bpd)].close - 1, day: c[i].close / c[i - e0.B].close - 1 });
  const variants = VARIANTS.map(([name, v]) => { const r = runCoin(sym.replace(/USDT$/, ''), c, btc, v), o = r.open;
    return { name, recent: r.trades.filter((x) => x.sigT >= last.time - 20 * DAY).map((x) => ({ sig: x.sigT + H4, entry: x.t.entry, out: x.tOut + H4, ret: x.ret, late: x.late, byDay: x.byDay })),
      open: o ? { sig: o.sigT + H4, entry: o.entry, stop: o.stop, late: o.late, now: last.close / o.entry - 1 } : null }; });
  // what the NEXT close needs under the shipped rules (the engine's own read)
  const adv = L.SMC.detectAll(c, { strategy: 'liqbrk', longOnly: true, useLiq: false, btc }).advice;
  return { sym, to: last.time + H4, last: last.close, candles, variants, next: adv && adv.next ? { trig: adv.next.trig, gap: adv.next.gap, blocked: adv.next.blocked, vol: adv.next.vol } : null,
    btcGap: (() => { const m = sma(btc.map((b) => b.close), 300); return btc[btc.length - 1].close / m[m.length - 1] - 1; })() };
}
if (mode === 'case') {
  const K = caseOf((process.argv[3] || 'INIT').toUpperCase() + 'USDT');
  console.log(`${K.sym} 4h · closed candles to ${iso(K.to)} UTC · last close ${K.last} · BTC ${pc(K.btcGap, 1)} against its 50-day MA\n`);
  console.log('candle close (IST) |   close |   chg  | 24h    | 30 days | chart rules | market gate');
  for (const x of K.candles) console.log(`${ist(x.close)}        | ${x.px.toFixed(5)} | ${pc(x.chg, 1).padStart(6)} | ${pc(x.day, 0).padStart(5)}  | ${pc(x.lead30, 0).padStart(6)}  | ${x.chart ? 'ALL PASS   ' : x.broke && !x.fresh ? 'not fresh  ' : 'no         '} | ${x.gate ? 'open' + (x.btcOk ? '' : ' (leader)') : 'shut'}${x.chart && !x.gate ? '  ← blocked' : ''}`);
  console.log();
  for (const v of K.variants) console.log(`${v.name.padEnd(33)} | ${v.recent.map((x) => `signal ${ist(x.sig)} IST${x.late ? ' (late rescue)' : x.byDay ? ' (24h leader)' : ''} · in ${x.entry.toFixed(5)} → out ${ist(x.out)} ${pc(x.ret, 1)}`).join(' ; ') || 'no closed trade in the last 20 days'}${v.open ? ` ; OPEN: signal ${ist(v.open.sig)} IST · in ${v.open.entry.toFixed(5)} · stop ${v.open.stop.toFixed(5)} · now ${pc(v.open.now, 1)}` : ''}`);
  console.log('\nnext close, shipped rules:', JSON.stringify(K.next));
}

// ---------------------------------------------------------------- run
if (mode === 'run') {
  const t00 = Date.now(), U = universes(), { book, curveStats } = require('../flush/vs_liqbrk4h.js'), res = {};
  for (const [uk, u] of Object.entries(U)) {
    const ser = {}, axis = u.btc.map((b) => b.time), end = axis[axis.length - 1] + H4, R = {};
    for (const [coin, c] of u.coins) ser[coin] = { c, idx: new Map(c.map((b, i) => [b.time, i])) };
    for (const [name, v] of VARIANTS) {
      const trades = []; let armed = 0, blocked = 0;
      for (const [coin, c] of u.coins) { const r = runCoin(coin, c, u.btc, v, u.minTurn); trades.push(...r.trades);
        if (name === 'shipped') for (let i = r.ind.warm; i < c.length; i++) if (r.ind.sig[i] && !r.e.gate0[i]) blocked++; armed += r.e.late.size; }
      R[name] = { trades, armed, blocked };
    }
    // the same variants bought one whole candle late
    for (const name of ['shipped', 'late 1', 'day +30%', 'rescue: not after a +20% day']) { const v = VARIANTS.find((x) => x[0] === name)[1], trades = [];
      for (const [coin, c] of u.coins) trades.push(...runCoin(coin, c, u.btc, v, u.minTurn, 1).trades); R[name + ' · bought a candle late'] = { trades }; }
    const base = R.shipped.trades, baseNet = coinNet(base), rows = {};
    for (const [name, r] of Object.entries(R)) {
      const lateRow = name.includes('candle late'), ref = lateRow ? R['shipped · bought a candle late'].trades : base, d = compare(ref, r.trades), net = coinNet(r.trades), refNet = lateRow ? coinNet(ref) : baseNet;
      const coins = u.coins.map(([c]) => c), nets = coins.map((c) => (net[c] ?? 1) - 1).sort((a, b) => a - b);
      const bk = book(r.trades, ser, axis, 5, S0, end), cs = curveStats(bk.curve, S0, end), h1 = curveStats(bk.curve, S0, SPLIT), h2 = curveStats(bk.curve, SPLIT, end);
      const yrs = {}; for (const x of d.added) { const y = new Date(x.sigT * 1000).getUTCFullYear(); (yrs[y] = yrs[y] || []).push(x.ret); }
      rows[name] = { all: tstats(r.trades), h1: tstats(r.trades.filter((x) => x.sigT < SPLIT)), h2: tstats(r.trades.filter((x) => x.sigT >= SPLIT)),
        added: tstats(d.added), addedH1: tstats(d.added.filter((x) => x.sigT < SPLIT)), addedH2: tstats(d.added.filter((x) => x.sigT >= SPLIT)), removed: tstats(d.removed),
        addedYears: Object.fromEntries(Object.entries(yrs).map(([y, a]) => [y, { n: a.length, avg: mean(a) }])),
        addedTop: d.added.slice().sort((a, b) => b.ret - a.ret).slice(0, 5).map((x) => ({ coin: x.coin, t: iso(x.sigT + H4), ret: x.ret })),
        addedCoins: new Set(d.added.map((x) => x.coin)).size,
        medCoin: nets[nets.length >> 1], better: coins.filter((c) => (net[c] ?? 1) > (refNet[c] ?? 1) * 1.0001).length, worse: coins.filter((c) => (net[c] ?? 1) < (refNet[c] ?? 1) * 0.9999).length,
        book: { mult: cs.mult, cagr: cs.cagr, dd: cs.dd, h1: h1 && h1.mult, h2: h2 && h2.mult, taken: bk.taken.length }, armed: r.armed, blocked: r.blocked };
    }
    res[uk] = { coins: u.coins.length, from: iso(Math.min(...u.coins.map(([, c]) => c[0].time))), to: iso(end), rows,
      lists: { 'day +30% adds': compare(base, R['day +30%'].trades).added.map((x) => ({ coin: x.coin, t: x.sigT + H4, ret: x.ret })),
        'rescue: not after a +20% day removes': compare(base, R['rescue: not after a +20% day'].trades).removed.map((x) => ({ coin: x.coin, t: x.sigT + H4, ret: x.ret })) },
      groups: groupsOf(u), after: afterOf(u) };
    console.log(`\n=== ${uk}: ${u.coins.length} coins · ${res[uk].from} → ${res[uk].to} · gate-blocked fresh breakouts: ${R.shipped.blocked}`);
    console.log('shipped trades by why the market gate let them in:');
    for (const [k, g] of Object.entries(res[uk].groups)) console.log(`  ${k.padEnd(48)} n ${String(g.all.n).padStart(5)}  win ${g.all.n ? (g.all.wr * 100).toFixed(0).padStart(2) + '%' : ' —'}  avg ${pc(g.all.avg).padStart(8)}  median ${pc(g.all.med).padStart(8)}  PF ${g.all.n ? g.all.pf.toFixed(2) : '—'} | <2022 ${pc(g.h1.avg).padStart(8)} (${g.h1.n || 0})  2022+ ${pc(g.h2.avg).padStart(8)} (${g.h2.n || 0})${g.odds ? ` | chance avg ≥ 0: ${(g.odds.ge0 * 100).toFixed(0)}% · ≥ the BTC-gated avg: ${(g.odds.geBase * 100).toFixed(1)}%` : ''}`);
    console.log(`shipped buys within a day AFTER a breakout the gate blocked: ${res[uk].after.all.n} trades, win ${(res[uk].after.all.wr * 100).toFixed(0)}%, avg ${pc(res[uk].after.all.avg)} · after a blocked +20% day: ${res[uk].after.big.n} trades, avg ${pc(res[uk].after.big.avg)}`);
    console.log('variant                           trades  win   avg/tr   PF  PF-2% | <2022 avg (n)    2022+ avg (n)   | ADDED n  win    avg    PF | <2022 (n)       2022+ (n)       | removed n avg | med coin  better/worse | 5-slot pot ×  CAGR   maxDD');
    for (const [name, r] of Object.entries(rows)) {
      const a = r.all, ad = r.added;
      console.log(`${name.padEnd(33)} ${String(a.n).padStart(6)} ${(a.wr * 100).toFixed(0).padStart(3)}% ${pc(a.avg).padStart(8)} ${a.pf.toFixed(2)} ${a.pfx.toFixed(2).padStart(5)} | ${pc(r.h1.avg).padStart(7)} (${String(r.h1.n || 0).padStart(4)}) ${pc(r.h2.avg).padStart(8)} (${String(r.h2.n || 0).padStart(4)}) | ${String(ad.n).padStart(6)} ${ad.n ? (ad.wr * 100).toFixed(0).padStart(3) + '%' : '    '} ${pc(ad.avg).padStart(7)} ${ad.n ? ad.pf.toFixed(2).padStart(5) : '     '} | ${pc(r.addedH1.avg).padStart(7)} (${String(r.addedH1.n || 0).padStart(3)}) ${pc(r.addedH2.avg).padStart(8)} (${String(r.addedH2.n || 0).padStart(3)}) | ${String(r.removed.n).padStart(5)} ${pc(r.removed.avg).padStart(7)} | ${pc(r.medCoin, 0).padStart(6)}  ${String(r.better).padStart(3)}/${String(r.worse).padEnd(3)} | ×${r.book.mult.toFixed(2).padStart(7)} ${pc(r.book.cagr, 1).padStart(7)} −${(r.book.dd * 100).toFixed(0)}%`);
    }
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'run.json'), JSON.stringify({ at: new Date().toISOString(), slip: SLIP, res, case: caseOf('INITUSDT') }));
  process.stderr.write(`${((Date.now() - t00) / 1000).toFixed(0)}s\n`);
}

// ---------------------------------------------------------------- report
if (mode === 'report') {
  const D = JSON.parse(fs.readFileSync(path.join(OUT, 'run.json'))), R = D.res, K = D.case, o = [], p = (x = '') => o.push(x);
  const UN = { alert: 'the 65 alert coins', u103: 'the 103-coin list', u274: 'the 103 + 171 delisted' }, UK = ['alert', 'u103', 'u274'];
  const cell = (s) => (s && s.n ? `${s.n} · ${(s.wr * 100).toFixed(0)}% · ${pc(s.avg)}` : '0');
  const istF = (t) => { const d = new Date((t + 19800) * 1000); return `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
  const day = (t) => new Date(t * 1000).toISOString().slice(0, 10);
  p('# Sudden runs and the Breakout rule: INIT\'s +79% day (Nov 2026)');
  p();
  p('Generated by `research/latelead/latelead_lab.js report`. **Research only: detector.js, the webapp and the bot are unchanged.**');
  p();
  p('**The report (user, with INIT/USDT 4h at +79% in 24 hours):** "No strategy out of all still are able to detect and alerts and trade for these kind of sudden runs."');
  p();
  p('**Short answer.**');
  p('- The Breakout rule did detect INIT\'s run. The BTC filter kept it out, on purpose.');
  p('- Every way of buying such runs was tested on all history, and each adds losing trades.');
  p('- The rule already buys some sudden runs, late, through its "leader" exception. Those trades lose too. The data argues for buying fewer of them, not more.');
  p();
  p('## What happened on INIT');
  p();
  p(`INIT is on the alert list (4h, Liquidity Breakout). Candles are 4h; times are the candle's CLOSE in IST. BTC was ${pc(K.btcGap, 1)} against its 50-day average.`);
  p();
  p('| candle close (IST) | close | candle | last 24h | last 30 days | chart rules | market filter |');
  p('|---|---|---|---|---|---|---|');
  for (const x of K.candles.slice(-8)) p(`| ${istF(x.close)} | ${x.px.toFixed(4)} | ${pc(x.chg, 1)} | ${pc(x.day, 0)} | ${pc(x.lead30, 0)} | ${x.chart ? '**all pass**' : x.broke && !x.fresh ? 'not a fresh breakout' : 'no'} | ${x.gate ? (x.btcOk ? 'open' : 'open (leader)') : 'shut'}${x.chart && !x.gate ? ' → **blocked**' : ''} |`);
  p();
  const blk = K.candles.find((x) => x.chart && !x.gate);
  if (blk) {
    p(`1. **${istF(blk.close)} IST, close ${blk.px.toFixed(4)}.** The ${pc(blk.chg, 0)} candle passed every chart rule: over the 2-day high by more than 1 ATR, over the 5-day and 149-candle averages, volume over 1.3× the day's.`);
    p(`   - The market filter blocked it. BTC was under its 50-day average, and INIT was ${pc(blk.lead30, 0)} over 30 days, short of the +50% that makes a coin a "leader".`);
    p('2. **One candle later** INIT was a leader, so the filter opened. But that close was no longer the FIRST close above the 2-day high, and the rule only buys a fresh breakout.');
    p('3. **After that** the rule waits for a new breakout over the new 2-day high plus 1 ATR. It buys that one through the leader exception: a late buy, far above where the run began.');
  }
  p();
  p('The other strategies are slow by design and not built for this: Turtle buys a 55-day high, Trend Follow needs the 200-day average, the Cycle reads weekly averages.');
  p();
  p('## 1. Buy more of them? Every way of catching INIT, on all history');
  p();
  p('**The test.**');
  p('- The shipped rules with one entry change each; exits unchanged.');
  p('- Signal at a 4h close, bought at the next open. 0.1% fee a side, 0.15% slippage.');
  p('- Three coin sets: the 65 liqbrk 4h coins on the alert list (Binance 4h candles to today); the 103-coin Compare list; the same plus 171 delisted or collapsed coins (a buy needs ≥ $1M a day there). The last two end 5 Nov 2026.');
  p('- **What matters is the trades a change ADDS.** Each cell is: added trades · winners · average per trade.');
  p();
  p('| change | INIT this time | ' + UK.map((u) => UN[u]).join(' | ') + ' |');
  p('|---|---|---|---|---|');
  const MORE = [['late 1', 'Buy one candle later if the filter has opened by then'], ['late 2', '…within 2 candles'], ['late 3', '…within 3 candles'], ['late 6', '…within 6 candles (a day)'],
    ['day +20%', 'Count a +20% day as a leader'], ['day +30%', 'Count a +30% day as a leader'], ['no gate', 'No market filter at all']];
  for (const [k, lab] of MORE) { const v = K.variants.find((x) => x.name === k), op = v && v.open;
    p(`| ${lab} | ${op ? `in at ${op.entry.toFixed(4)} (${istF(op.sig)})` : '—'} | ${UK.map((u) => cell(R[u].rows[k].added)).join(' | ')} |`); }
  p();
  { const a = R.alert.rows, d30 = a['day +30%'].added, ng = a['no gate'].added;
    p(`- **Buying the breakout candle itself loses badly.** On the alert coins, a breakout after a +30% day with the filter shut happened ${d30.n} times: ${(d30.wr * 100).toFixed(0)}% won, ${pc(d30.avg)} a trade. INIT is one of the few that ran.`);
    p(`- **All ${ng.n} breakouts the filter blocked on the alert coins** made ${pc(ng.avg)} a trade as a group (${(ng.wr * 100).toFixed(0)}% winners). With the delisted coins: ${R.u274.rows['no gate'].added.n} trades at ${pc(R.u274.rows['no gate'].added.avg)}.`);
    p(`- **Buying one candle later** is positive on the alert coins (${a['late 1'].added.n} trades, ${pc(a['late 1'].added.avg)}) and negative on both wider sets (${pc(R.u103.rows['late 1'].added.avg)} and ${pc(R.u274.rows['late 1'].added.avg)}). The alert list was hand-picked in 2026, so the wider sets are the fairer judge.`);
    p('- A pump in a weak market has a 4×ATR stop that is 20–25% away, so each failure costs a lot.'); }
  p();
  p('## 2. The rule already buys some sudden runs, and those lose');
  p();
  p('The market filter lets a trade in for one of three reasons. Each cell is: trades · winners · average per trade (the shipped rules, all history).');
  p();
  p('| why the filter let it in | ' + UK.map((u) => UN[u]).join(' | ') + ' |');
  p('|---|---|---|---|');
  const GL = { 'BTC over its 50-day MA': 'BTC over its 50-day average', 'leader: +50%/30d also held a day earlier': 'Leader: +50% in 30 days, and already so a day earlier', 'leader ONLY through the last day (a pump)': '**Leader only through the last day\'s move (a pump)**', '  …the last 24h alone ≥ +20%': '…of those, the last 24h alone ≥ +20%', '  …the last 24h under +20%': '…of those, the last 24h under +20%' };
  for (const [k, lab] of Object.entries(GL)) p(`| ${lab} | ${UK.map((u) => cell(R[u].groups[k].all)).join(' | ')} |`);
  p();
  { const g = (u) => R[u].groups['leader ONLY through the last day (a pump)'];
    p(`- **A coin that becomes a "leader" through one day's pump is not a leader.** Those buys lose in all three sets (${UK.map((u) => pc(g(u).all.avg)).join(', ')} a trade).`);
    p(`- By period: before 2022 ${UK.map((u) => `${pc(g(u).h1.avg)} (${g(u).h1.n || 0})`).join(', ')}; from 2022 ${UK.map((u) => `${pc(g(u).h2.avg)} (${g(u).h2.n || 0})`).join(', ')}. The loss is all since 2022.`);
    p(`- **How sure:** resampling these trades 10,000 times, their average is at or above zero in ${UK.map((u) => (g(u).odds.ge0 * 100).toFixed(0) + '%').join(' / ')} of draws, and at or above the average of the ordinary (BTC-gated) trades in ${UK.map((u) => (g(u).odds.geBase * 100).toFixed(1) + '%').join(' / ')}. So "they lose outright" is likely but not certain; "they are worse than the ordinary trades" is firm.`); }
  p();
  p('**INIT\'s case exactly: a buy within a day after a breakout the filter blocked.**');
  p();
  p('| | ' + UK.map((u) => UN[u]).join(' | ') + ' |');
  p('|---|---|---|---|');
  p(`| every such buy | ${UK.map((u) => cell(R[u].after.all)).join(' | ')} |`);
  p(`| …when the blocked day was ≥ +20% | ${UK.map((u) => cell(R[u].after.big)).join(' | ')} |`);
  p();
  p('On the alert coins, the ≥ +20% cases:');
  for (const x of R.alert.after.list) p(`- ${x.coin}: blocked ${day(x.blocked)} (${pc(x.day, 0)} day), bought ${day(x.bought)} after ${pc(x.run, 0)} → **${pc(x.ret, 1)}**`);
  p();
  p('## 3. Buy fewer? Tightening the leader exception');
  p();
  p('Each row changes only the leader exception. "Drops" and "takes instead" are: trades · winners · average per trade. The pot is the bot\'s book: 5 slots, 20% each.');
  p();
  const FEW = [['shipped', 'Shipped'], ['rescue: leader a day earlier too', '**Leader must also have been one a day earlier**'], ['rescue: not after a +15% day', 'No leader exception after a +15% day'], ['rescue: not after a +20% day', '…after a +20% day'], ['rescue: not after a +30% day', '…after a +30% day'], ['no rescue (BTC only)', 'No leader exception at all']];
  for (const u of UK) {
    p(`**${UN[u][0].toUpperCase() + UN[u].slice(1)}** (${R[u].coins} coins, to ${R[u].to.slice(0, 10)}).`);
    p();
    p('| | drops | takes instead | every trade: avg | PF | PF without the best 2% | coins better / worse | pot | max DD |');
    p('|---|---|---|---|---|---|---|---|---|');
    for (const [k, lab] of FEW) { const r = R[u].rows[k];
      p(`| ${lab} | ${k === 'shipped' ? '—' : cell(r.removed)} | ${k === 'shipped' ? '—' : cell(r.added)} | ${pc(r.all.avg)} | ${r.all.pf.toFixed(2)} | ${r.all.pfx.toFixed(2)} | ${k === 'shipped' ? '—' : `${r.better} / ${r.worse}`} | ×${r.book.mult.toFixed(2)} | −${(r.book.dd * 100).toFixed(0)}% |`); }
    p();
  }
  { const h = (u) => R[u].rows['rescue: leader a day earlier too'];
    p(`- **"A leader a day earlier too" drops ${UK.map((u) => h(u).removed.n).join(' / ')} trades that averaged ${UK.map((u) => pc(h(u).removed.avg)).join(' / ')}.** The average trade, both profit factors and the pot improve in all three sets, and 3–5 times as many coins gain as lose.`);
    p('- It has no number to tune: it reads the same +50%/30-day test one day back.');
    p(`- **The pot figures are noisy.** Buying every shipped trade one candle late moves the alert-list pot from ×${R.alert.rows.shipped.book.mult.toFixed(1)} to ×${R.alert.rows['shipped · bought a candle late'].book.mult.toFixed(1)}, only because different trades find a free slot. The per-trade columns are the evidence.`);
    p('- Dropping the exception altogether does about as well. Leaders that were already leaders are roughly break-even: positive on the two lists, negative with the delisted coins.'); }
  p();
  p('## Verdict');
  p();
  p('- **The system saw INIT and stayed out because BTC was weak.** That filter is right on average: the breakouts it blocks lose as a group, and the pump-day ones lose most.');
  p('- **No rule that buys these runs earlier holds up** across the three coin sets.');
  p('- **One change is worth proposing, in the other direction:** the leader exception should need the coin to have been a leader a day earlier too. It stops the late chase after a one-day pump, which is what the rule would have done on INIT next.');
  p('- **Limits.** The dropped trades are 37–128 in nine years, so the gain per year is small. Both ideas were written after looking at INIT. The Oct 2026 study that shipped the leader exception used 32 coins; this one uses 65–272.');
  p('- **Nothing is changed.** ALGORITHM.md first, then the engine and the bot\'s rule version, only on approval.');
  process.stdout.write(o.join('\n') + '\n');
}

module.exports = { VARIANTS, entries, runCoin, tstats, compare, universes, load4h, alertCoins, groupsOf, afterOf };
