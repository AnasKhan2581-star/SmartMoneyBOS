/*
 * liqbrk's market gate on the WEEKLY chart (Nov 2026, user request: "Instead of btc daily MA rule, backtest if we
 * change condition to above 9MA on weekly chart"). RESEARCH ONLY: detector.js, the webapp and the bot are unchanged.
 *
 *   NODE_USE_ENV_PROXY=1 node research/latelead/latelead_lab.js fetch     # the alert list's 4h candles to now (shared cache)
 *   node research/weekgate/weekgate_lab.js run                            # → research/cache/weekgate/run.json + the tables
 *   node research/weekgate/weekgate_lab.js report > research/weekgate/RESULTS_weekgate_2026-11.md
 *
 * SHIPPED: a breakout is bought only if BTC closes above its 50-day MA, OR the coin is +50% over 30 days (the leader
 * rescue). THE CHANGE: the BTC part becomes "BTC above the 9 MA on its weekly chart"; everything else stays.
 *
 * The weekly 9 MA, read without looking ahead. Weeks run Monday 00:00 UTC, as on Binance. Two readings:
 *   live     what the chart shows: the MA(9) line includes the week still forming. BTC's last closed 4h price p against
 *            (p + the last 8 closed weekly closes) / 9, which is the same as p > the average of those 8 closes.
 *   closed   only finished weeks: the last weekly close against the MA of the last 9 weekly closes. It changes once a
 *            week, at Monday 00:00 UTC.
 * Also run: other lengths (5, 7, 12, 20 weeks: is 9 a plateau or a lucky number?), the daily analog (BTC over its 63-day
 * MA), both gates at once and either one, the COIN's own weekly 9 MA in place of any BTC rule (the other way to read
 * the request) and in place of the leader rescue, the gates without the leader rescue, and no gate.
 *
 * The rest is research/latelead's set-up: research/liqbrk_lab.js (parity-checked against detector.js) for the chart
 * rules and exits; signal at a 4h close, bought at the next open; 0.1% fee a side, 0.15% slippage; three coin sets (the
 * 65 liqbrk 4h alert coins on Binance 4h candles to now, the 103-coin list, the 103 plus 171 delisted coins, the last
 * two from the 15m files to 5 Nov 2026 with a $1M-a-day floor). A change is judged by the trades it ADDS and DROPS.
 */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const L = require('../liqbrk_lab.js').useRules('2026-10');   // the rules this study measured (Oct 2026: leader rescue, no stop limit)
const LL = require('../latelead/latelead_lab.js');
const OUT = path.join(ROOT, 'research', 'cache', 'weekgate');
const H4 = 14400, DAY = 86400, WK = 604800, MON0 = 345600, SLIP = 0.0015;      // 1970-01-05 00:00 UTC was a Monday
const SPLIT = Date.UTC(2022, 0, 1) / 1e3, S0 = Date.UTC(2017, 8, 1) / 1e3;
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);

// ---------------------------------------------------------------- the weekly MA of any 4h (or finer) series
// For every bar: is its close above the N-week MA? `live` counts the forming week at the bar's own close; otherwise only
// finished weeks count (a bar that ends its week makes that week a finished one). False until enough weeks exist. A
// week the data joins midway still has its true close, so it counts. Nothing later than the bar's own close is read.
function weeklyAbove(c, N, live) {
  const n = c.length, dt = n > 1 ? Math.max(60, c[1].time - c[0].time) : H4, out = new Array(n).fill(false);
  const wk = (t) => Math.floor((t - MON0) / WK), closes = [];                    // finished weekly closes, oldest first
  let cur = n ? wk(c[0].time) : 0;
  for (let i = 0; i < n; i++) {
    const w = wk(c[i].time);
    if (w !== cur) { closes.push(c[i - 1].close); cur = w; }                    // the week before this bar's has finished
    if (live) {                                                                 // (this close + the N−1 finished weeks) / N
      if (closes.length >= N - 1) { let s = 0; for (let k = closes.length - (N - 1); k < closes.length; k++) s += closes[k]; out[i] = c[i].close > (s + c[i].close) / N; }
    } else {
      const fin = wk(c[i].time + dt) !== w ? closes.concat([c[i].close]) : closes;   // this bar's close is its week's close
      if (fin.length >= N) { let s = 0; for (let k = fin.length - N; k < fin.length; k++) s += fin[k]; out[i] = fin[fin.length - 1] > s / N; }
    }
  }
  return out;
}
// a per-BTC-bar flag carried onto a coin's bars: the last BTC bar CLOSED by the coin bar's close (as marketGate does)
function onto(c, btc, flag) {
  const n = c.length, dt = n > 1 ? Math.max(60, c[1].time - c[0].time) : H4, dB = btc[1].time - btc[0].time, out = new Array(n).fill(false); let j = -1;
  for (let i = 0; i < n; i++) { while (j + 1 < btc.length && btc[j + 1].time + dB <= c[i].time + dt) j++; out[i] = j >= 0 && flag[j]; }
  return out;
}

// ---------------------------------------------------------------- variants: what may open the gate
// btc: 'd50' (shipped) | 'd63' | ['w', N, live] | 'both' (d50 AND w9 live) | 'either' | 'none' (no BTC rule) · own: the
// coin's own weekly MA [N, live] · rescue: the +50%/30-day leader rule
const VARIANTS = [
  ['shipped: BTC over its 50-day MA', { btc: 'd50', rescue: true }],
  ['BTC over the weekly 9 MA (live)', { btc: ['w', 9, true], rescue: true }],
  ['BTC over the weekly 9 MA (finished weeks only)', { btc: ['w', 9, false], rescue: true }],
  ['BTC over the weekly 5 MA', { btc: ['w', 5, true], rescue: true }],
  ['BTC over the weekly 7 MA', { btc: ['w', 7, true], rescue: true }],
  ['BTC over the weekly 12 MA', { btc: ['w', 12, true], rescue: true }],
  ['BTC over the weekly 20 MA', { btc: ['w', 20, true], rescue: true }],
  ['BTC over its 63-day MA (9 weeks, read daily)', { btc: 'd63', rescue: true }],
  ['BTC over BOTH the 50-day and the weekly 9', { btc: 'both', rescue: true }],
  ['BTC over EITHER the 50-day or the weekly 9', { btc: 'either', rescue: true }],
  ['the COIN over its own weekly 9 MA (no BTC rule)', { btc: 'none', own: [9, true], rescue: false }],
  ['BTC over its 50-day MA OR the coin over its own weekly 9', { btc: 'd50', own: [9, true], rescue: false }],
  ['BTC over the weekly 9 AND the coin over its own', { btc: ['w', 9, true], own: [9, true], and: true, rescue: true }],
  ['shipped without the leader rescue', { btc: 'd50', rescue: false }],
  ['weekly 9 without the leader rescue', { btc: ['w', 9, true], rescue: false }],
  ['no gate', { btc: 'open', rescue: false }],
];
const SHIPPED = VARIANTS[0][0], W9 = VARIANTS[1][0];
const btcFlagCache = new WeakMap();
function btcFlag(btc, spec) {                                                   // per BTC bar
  let m = btcFlagCache.get(btc); if (!m) btcFlagCache.set(btc, (m = {}));
  const k = JSON.stringify(spec); if (m[k]) return m[k];
  let f;
  if (spec === 'd50' || spec === 'd63') { const days = spec === 'd50' ? L.P.lbBtcMaDays : 63, dB = btc[1].time - btc[0].time, Ln = Math.round(days * DAY / dB); let s = 0; f = btc.map((b, j) => { s += b.close; if (j >= Ln) s -= btc[j - Ln].close; return j >= Ln - 1 && b.close > s / Ln; }); }
  else if (Array.isArray(spec)) f = weeklyAbove(btc, spec[1], spec[2]);
  else if (spec === 'both' || spec === 'either') { const a = btcFlag(btc, 'd50'), b = btcFlag(btc, ['w', 9, true]); f = a.map((x, j) => (spec === 'both' ? x && b[j] : x || b[j])); }
  else f = btc.map(() => spec === 'open');
  return (m[k] = f);
}
function gateOf(c, ind, btc, v, minTurn = 0) {
  const n = c.length, closes = c.map((b) => b.close), L30 = Math.max(2, Math.round(30 * ind.bpd));
  const lead = (i) => i >= L30 && closes[i] >= (1 + L.P.lbLeadPump) * closes[i - L30];
  const bt = v.btc === 'none' ? null : onto(c, btc, btcFlag(btc, v.btc)), own = v.own ? weeklyAbove(c, v.own[0], v.own[1]) : null;
  let g = new Array(n);
  for (let i = 0; i < n; i++) { const base = bt && own ? (v.and ? bt[i] && own[i] : bt[i] || own[i]) : bt ? bt[i] : own[i]; g[i] = base || (v.rescue && lead(i)); }
  if (minTurn > 0) { const T = turnover30(c); g = g.map((x, i) => x && T[i] >= minTurn); }
  return g;
}
function turnover30(c) {
  const n = c.length, out = new Float64Array(n).fill(NaN), W = Math.round(30 * DAY / Math.max(60, c[1].time - c[0].time)); let s = 0;
  for (let i = 0; i < n; i++) { s += c[i].volume * c[i].close; if (i >= W) s -= c[i - W].volume * c[i - W].close; if (i >= W - 1) out[i] = s / 30; }
  return out;
}
function runCoin(coin, c, btc, v, minTurn = 0) {
  const ind = L.indicators(c), g = gateOf(c, ind, btc, v, minTurn);
  const r = L.simulate(c, ind, { fill: 'next', slip: SLIP, exit: 'scale3R', veto: g });
  return { ind, g, trades: r.trades.map((t) => ({ coin, t: { ...t, rv: ind.rv[t.sigIdx] }, tIn: c[t.entryIdx].time, tOut: c[t.exitIdx].time, sig: t.sigIdx, sigT: c[t.sigIdx].time, ret: t.ret })) };
}

const mode = require.main === module ? process.argv[2] : null;
const iso = (t) => new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' ');
const pc = (x, d = 2) => (x == null || !Number.isFinite(x) ? '—' : (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(d) + '%');

// ---------------------------------------------------------------- self-check: the shipped row must be liqbrk_lab's own gate
function selfCheck(U) {
  let bad = 0, n = 0;
  for (const [, c] of U.alert.coins.slice(0, 12)) { const ind = L.indicators(c), mine = gateOf(c, ind, U.alert.btc, VARIANTS[0][1]), ref = L.marketGate(c, U.alert.btc);
    for (let i = ind.warm; i < c.length; i++) { n++; if (mine[i] !== ref[i]) bad++; } }
  return { bad, n };
}

if (mode === 'run') {
  const t00 = Date.now(), U = LL.universes(), { book, curveStats } = require('../flush/vs_liqbrk4h.js'), res = {};
  const sc = selfCheck(U); console.log(`self-check: this lab's shipped gate against liqbrk_lab.marketGate on 12 alert coins: ${sc.bad ? sc.bad + ' candles DIFFER' : 'identical on ' + sc.n + ' candles'}`);
  if (sc.bad) process.exit(1);
  // the BTC gate itself: how often open, how often it disagrees with the 50-day one (alert-list BTC, 4h candles from 2018)
  const B = U.alert.btc, d50 = btcFlag(B, 'd50'), from = B.findIndex((b) => b.time >= Date.UTC(2018, 0, 1) / 1e3), gateStats = {};
  for (const [name, v] of VARIANTS) { if (v.btc === 'none' || v.btc === 'open' || v.own) continue; const f = btcFlag(B, v.btc); let open = 0, diff = 0, flips = 0, tot = 0;
    for (let j = from; j < B.length; j++) { tot++; if (f[j]) open++; if (f[j] !== d50[j]) diff++; if (j > from && f[j] !== f[j - 1]) flips++; }
    gateStats[name] = { open: open / tot, differs: diff / tot, flipsPerYear: flips / ((B[B.length - 1].time - B[from].time) / 31557600) }; }
  for (const [uk, u] of Object.entries(U)) {
    const ser = {}, axis = u.btc.map((b) => b.time), end = axis[axis.length - 1] + H4, R = {};
    for (const [coin, c] of u.coins) ser[coin] = { c, idx: new Map(c.map((b, i) => [b.time, i])) };
    for (const [name, v] of VARIANTS) { const trades = []; for (const [coin, c] of u.coins) trades.push(...runCoin(coin, c, u.btc, v, u.minTurn).trades); R[name] = trades; }
    const base = R[SHIPPED], rows = {};
    const coinNet = (tr) => { const m = {}; for (const x of tr) m[x.coin] = (m[x.coin] ?? 1) * (1 + x.ret); return m; }, bn = coinNet(base);
    for (const [name, tr] of Object.entries(R)) {
      const d = LL.compare(base, tr), net = coinNet(tr), coins = u.coins.map(([c]) => c), nets = coins.map((c) => (net[c] ?? 1) - 1).sort((a, b) => a - b);
      const bk = book(tr, ser, axis, 5, S0, end), cs = curveStats(bk.curve, S0, end);
      const yr = (list) => { const Y = {}; for (const x of list) { const y = new Date(x.sigT * 1000).getUTCFullYear(); (Y[y] = Y[y] || []).push(x.ret); } return Object.fromEntries(Object.entries(Y).map(([y, a]) => [y, { n: a.length, avg: mean(a), sum: a.reduce((s, x) => s + x, 0) }])); };
      // the pot by calendar year
      const lastE = {}, potY = {}; for (const [t, e] of bk.curve) lastE[new Date(t * 1000).getUTCFullYear()] = e;
      { let p = 1; for (const y of Object.keys(lastE).sort()) { potY[y] = lastE[y] / p - 1; p = lastE[y]; } }
      rows[name] = { all: LL.tstats(tr), h1: LL.tstats(tr.filter((x) => x.sigT < SPLIT)), h2: LL.tstats(tr.filter((x) => x.sigT >= SPLIT)),
        added: LL.tstats(d.added), addedH1: LL.tstats(d.added.filter((x) => x.sigT < SPLIT)), addedH2: LL.tstats(d.added.filter((x) => x.sigT >= SPLIT)),
        removed: LL.tstats(d.removed), removedH1: LL.tstats(d.removed.filter((x) => x.sigT < SPLIT)), removedH2: LL.tstats(d.removed.filter((x) => x.sigT >= SPLIT)),
        years: yr(tr), addedYears: yr(d.added), removedYears: yr(d.removed), potYears: potY,
        medCoin: nets[nets.length >> 1], better: coins.filter((c) => (net[c] ?? 1) > (bn[c] ?? 1) * 1.0001).length, worse: coins.filter((c) => (net[c] ?? 1) < (bn[c] ?? 1) * 0.9999).length,
        book: { mult: cs.mult, cagr: cs.cagr, dd: cs.dd, taken: bk.taken.length } };
    }
    // bootstrap on the swap itself: (sum of added) − (sum of removed) per resample, 10,000 draws
    const rnd = require('../rng.js').mulberry32(20261111), odds = {};
    for (const name of [W9, 'BTC over the weekly 9 MA (finished weeks only)', 'the COIN over its own weekly 9 MA (no BTC rule)']) { const d = LL.compare(base, R[name]), a = d.added.map((x) => x.ret), r = d.removed.map((x) => x.ret); let ge = 0;
      for (let b = 0; b < 10000; b++) { let s = 0; for (let q = 0; q < a.length; q++) s += a[Math.floor(rnd() * a.length)]; for (let q = 0; q < r.length; q++) s -= r[Math.floor(rnd() * r.length)]; if (s >= 0) ge++; }
      odds[name] = ge / 10000; }
    res[uk] = { coins: u.coins.length, to: iso(end), rows, odds };
    console.log(`\n=== ${uk}: ${u.coins.length} coins → ${iso(end)}`);
    console.log('gate                                               trades  win   avg/tr   PF  PF-2% | <2022 avg (n)    2022+ avg (n)   | ADDS n  win    avg | DROPS n  win    avg | med coin better/worse | 5-slot pot ×  CAGR   maxDD');
    for (const [name, r] of Object.entries(rows)) { const a = r.all;
      console.log(`${name.slice(0, 50).padEnd(50)} ${String(a.n).padStart(6)} ${(a.wr * 100).toFixed(0).padStart(3)}% ${pc(a.avg).padStart(8)} ${a.pf.toFixed(2)} ${a.pfx.toFixed(2).padStart(5)} | ${pc(r.h1.avg).padStart(7)} (${String(r.h1.n || 0).padStart(4)}) ${pc(r.h2.avg).padStart(8)} (${String(r.h2.n || 0).padStart(4)}) | ${String(r.added.n).padStart(5)} ${r.added.n ? (r.added.wr * 100).toFixed(0).padStart(3) + '%' : '    '} ${pc(r.added.avg).padStart(7)} | ${String(r.removed.n).padStart(5)} ${r.removed.n ? (r.removed.wr * 100).toFixed(0).padStart(3) + '%' : '    '} ${pc(r.removed.avg).padStart(7)} | ${pc(r.medCoin, 0).padStart(6)} ${String(r.better).padStart(3)}/${String(r.worse).padEnd(3)} | ×${r.book.mult.toFixed(2).padStart(7)} ${pc(r.book.cagr, 1).padStart(7)} −${(r.book.dd * 100).toFixed(0)}%`); }
    console.log(`chance the swap to the weekly 9 (live) is no worse than shipped, trade for trade: ${(odds[W9] * 100).toFixed(0)}% · finished weeks: ${(odds['BTC over the weekly 9 MA (finished weeks only)'] * 100).toFixed(0)}% · the coin's own: ${(odds['the COIN over its own weekly 9 MA (no BTC rule)'] * 100).toFixed(0)}%`);
    const yrs = Object.keys(rows[SHIPPED].years).sort();
    console.log('by year, every trade (n · avg):   ' + yrs.map((y) => y.padStart(14)).join(''));
    for (const name of [SHIPPED, W9]) console.log(`  ${name.slice(0, 31).padEnd(31)} ` + yrs.map((y) => { const q = rows[name].years[y]; return (q ? `${q.n} · ${pc(q.avg, 1)}` : '—').padStart(14); }).join(''));
    console.log('  the pot by year:                ' + yrs.map((y) => `${pc(rows[SHIPPED].potYears[y], 0)} / ${pc(rows[W9].potYears[y], 0)}`.padStart(14)).join(''));
  }
  console.log('\nthe BTC gate itself, 4h candles from 2018 (open share · differs from the 50-day gate · flips a year):');
  for (const [k, g] of Object.entries(gateStats)) console.log(`  ${k.padEnd(48)} ${(g.open * 100).toFixed(0)}% · ${(g.differs * 100).toFixed(0)}% · ${g.flipsPerYear.toFixed(0)}`);
  // where the gates stand now, and at INIT's blocked breakout (10 Nov 01:30 IST = the 4h candle opening 9 Nov 16:00 UTC)
  const now = {}; { const j = B.length - 1, tI = Date.UTC(2026, 10, 9, 16) / 1e3, jI = B.findIndex((b) => b.time === tI), init = LL.load4h('INITUSDT');
    const wkCloses = (c, i) => { const out = []; let cur = null; for (let k = 0; k <= i; k++) { const w = Math.floor((c[k].time - MON0) / WK); if (cur !== null && w !== cur) out.push(c[k - 1].close); cur = w; } return out; };
    const read = (c, i) => { const w = wkCloses(c, i).slice(-8), ma = (w.reduce((s, x) => s + x, 0) + c[i].close) / 9; let s = 0; const Ln = 300; for (let k = i - Ln + 1; k <= i; k++) s += c[k].close; return { px: c[i].close, w9: ma, vsW9: c[i].close / ma - 1, d50: s / Ln, vsD50: c[i].close / (s / Ln) - 1 }; };
    now.btcNow = { t: iso(B[j].time + H4), ...read(B, j) }; if (jI > 0) now.btcAtInit = { t: iso(B[jI].time + H4), ...read(B, jI) };
    if (init) { const iI = init.findIndex((b) => b.time === tI); if (iI > 0) { const w = wkCloses(init, iI).slice(-8), ma = (w.reduce((s, x) => s + x, 0) + init[iI].close) / 9; now.initAtBreakout = { px: init[iI].close, w9: ma, vsW9: init[iI].close / ma - 1, weeks: w.length }; } }
    console.log('\nBTC now:', JSON.stringify(now.btcNow), '\nBTC at INIT\'s blocked breakout:', JSON.stringify(now.btcAtInit), '\nINIT at its breakout, own weekly 9:', JSON.stringify(now.initAtBreakout)); }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'run.json'), JSON.stringify({ at: new Date().toISOString(), slip: SLIP, res, gateStats, now }));
  process.stderr.write(`${((Date.now() - t00) / 1000).toFixed(0)}s\n`);
}

// ---------------------------------------------------------------- report
if (mode === 'report') {
  const D = JSON.parse(fs.readFileSync(path.join(OUT, 'run.json'))), R = D.res, G = D.gateStats, N = D.now, o = [], p = (x = '') => o.push(x);
  const UK = ['alert', 'u103', 'u274'], UN = { alert: 'the 65 alert coins', u103: 'the 103-coin list', u274: 'the 103 + 171 delisted' };
  const cell = (s) => (s && s.n ? `${s.n} · ${(s.wr * 100).toFixed(0)}% · ${pc(s.avg)}` : '0');
  const W9F = 'BTC over the weekly 9 MA (finished weeks only)', OWN = 'the COIN over its own weekly 9 MA (no BTC rule)', OWNR = 'BTC over its 50-day MA OR the coin over its own weekly 9';
  const usd = (x) => Math.round(x).toLocaleString('en-US');
  p('# The Breakout market filter on the weekly chart: BTC over its 9 MA (Nov 2026)');
  p();
  p('Generated by `research/weekgate/weekgate_lab.js report`. **Research only: detector.js, the webapp and the bot are unchanged.**');
  p();
  p('**The ask (user):** "Instead of btc daily MA rule, backtest if we change condition to above 9MA on weekly chart."');
  p();
  p('**Short answer: no gain. Keep the 50-day rule.**');
  p(`- The weekly 9 MA is almost the same filter: the two disagree on ${(G[W9].differs * 100).toFixed(0)}% of 4h candles since 2018.`);
  p('- Where they disagree, the 50-day rule does better on two of the three coin sets and the same on the third.');
  p(`- It would not have let INIT through: at INIT's breakout BTC was ${pc(N.btcAtInit.vsW9, 1)} against its weekly 9 MA.`);
  p('- Read the other way (the COIN over its own weekly 9 MA), it lets INIT in, and loses clearly on all three sets.');
  p();
  p('## What was tested');
  p();
  p('- **Shipped:** a breakout is bought only if BTC closes above its 50-day average, or the coin is +50% over 30 days (the "leader" exception).');
  p('- **The change:** the BTC part becomes "BTC above the 9 MA on its weekly chart". The leader exception, the chart rules and the exits stay.');
  p('- **The weekly 9 MA, two readings.** Weeks run Monday 00:00 UTC, as on Binance.');
  p('  - *Live:* what the chart shows. The MA line includes the week still forming, so BTC\'s price is compared with (price + the last 8 weekly closes) ÷ 9.');
  p('  - *Finished weeks only:* the last weekly close against the MA of the last 9 weekly closes. It changes once a week.');
  p('- **Set-up:** as in `research/latelead/`. Signal at a 4h close, bought at the next open; 0.1% fee a side, 0.15% slippage. Three coin sets: the 65 liqbrk 4h alert coins (Binance 4h candles to ' + R.alert.to.slice(0, 10) + '), the 103-coin list, and the 103 plus 171 delisted coins (to 5 Nov 2026).');
  p('- **How to read it.** Both filters keep most trades in common. What decides is the trades a change ADDS and the trades it DROPS. Cells are: trades · winners · average per trade. The 5-slot pot is shown but it is noisy: which trades find a free slot changes it a lot.');
  p();
  p('## Where BTC stands');
  p();
  p('| | BTC | weekly 9 MA (live) | against it | 50-day MA | against it |');
  p('|---|---|---|---|---|---|');
  p(`| now (${N.btcNow.t} UTC) | ${usd(N.btcNow.px)} | ${usd(N.btcNow.w9)} | ${pc(N.btcNow.vsW9, 1)} | ${usd(N.btcNow.d50)} | ${pc(N.btcNow.vsD50, 1)} |`);
  p(`| at INIT's blocked breakout (${N.btcAtInit.t} UTC) | ${usd(N.btcAtInit.px)} | ${usd(N.btcAtInit.w9)} | ${pc(N.btcAtInit.vsW9, 1)} | ${usd(N.btcAtInit.d50)} | ${pc(N.btcAtInit.vsD50, 1)} |`);
  p();
  p(`Both filters were shut for INIT. INIT itself was ${pc(N.initAtBreakout.vsW9, 0)} above its own weekly 9 MA.`);
  p();
  p('## 1. BTC over the weekly 9 MA instead of the 50-day MA');
  p();
  for (const u of UK) {
    p(`**${UN[u][0].toUpperCase() + UN[u].slice(1)}** (${R[u].coins} coins).`);
    p();
    p('| filter | trades | win | avg per trade | PF | PF without the best 2% | adds | drops | coins better / worse | pot | max DD |');
    p('|---|---|---|---|---|---|---|---|---|---|---|');
    for (const k of [SHIPPED, W9, W9F]) { const r = R[u].rows[k], a = r.all;
      p(`| ${k === SHIPPED ? 'Shipped: BTC over its 50-day MA' : k === W9 ? '**BTC over the weekly 9 MA (live)**' : 'BTC over the weekly 9 MA (finished weeks only)'} | ${a.n} | ${(a.wr * 100).toFixed(0)}% | ${pc(a.avg)} | ${a.pf.toFixed(2)} | ${a.pfx.toFixed(2)} | ${k === SHIPPED ? '—' : cell(r.added)} | ${k === SHIPPED ? '—' : cell(r.removed)} | ${k === SHIPPED ? '—' : `${r.better} / ${r.worse}`} | ×${r.book.mult.toFixed(2)} | −${(r.book.dd * 100).toFixed(0)}% |`); }
    p();
  }
  p(`- **Live reading:** the average trade goes ${UK.map((u) => `${pc(R[u].rows[SHIPPED].all.avg)} → ${pc(R[u].rows[W9].all.avg)}`).join(', ')}. It adds trades averaging ${UK.map((u) => pc(R[u].rows[W9].added.avg)).join(' / ')} and drops trades averaging ${UK.map((u) => pc(R[u].rows[W9].removed.avg)).join(' / ')}.`);
  p(`- **How sure:** resampling the added and dropped trades 10,000 times, the swap comes out no worse than shipped in ${UK.map((u) => (R[u].odds[W9] * 100).toFixed(0) + '%').join(' / ')} of draws. Worse on the alert coins and with the delisted coins; a coin flip on the 103-coin list.`);
  p(`- **Finished weeks only** is worse: it reacts up to a week late, so it drops ${UK.map((u) => R[u].rows[W9F].removed.n).join(' / ')} trades averaging ${UK.map((u) => pc(R[u].rows[W9F].removed.avg)).join(' / ')} (no worse than shipped in ${UK.map((u) => (R[u].odds[W9F] * 100).toFixed(0) + '%').join(' / ')} of draws).`);
  p('- **Likely why:** a 9-week average is slower than a 50-day (7-week) one. After a fall, BTC gets back over the 50-day first, and the breakouts in that gap were the good ones it drops. After a rise, BTC falls under the 50-day first, and the breakouts the weekly 9 still lets through are the poor ones it adds.');
  p();
  p('## 2. Is 9 special? Other lengths');
  p();
  p('Average per trade, every trade (the leader exception kept).');
  p();
  p('| BTC filter | open | differs from the 50-day | flips a year | ' + UK.map((u) => UN[u]).join(' | ') + ' |');
  p('|---|---|---|---|---|---|---|');
  for (const k of ['BTC over the weekly 5 MA', 'BTC over the weekly 7 MA', SHIPPED, W9, 'BTC over its 63-day MA (9 weeks, read daily)', 'BTC over the weekly 12 MA', 'BTC over the weekly 20 MA', 'BTC over BOTH the 50-day and the weekly 9', 'BTC over EITHER the 50-day or the weekly 9']) {
    const g = G[k]; p(`| ${k === SHIPPED ? '**Shipped: BTC over its 50-day MA**' : k} | ${(g.open * 100).toFixed(0)}% | ${(g.differs * 100).toFixed(0)}% | ${g.flipsPerYear.toFixed(0)} | ${UK.map((u) => pc(R[u].rows[k].all.avg)).join(' | ')} |`); }
  p();
  p('- The 50-day rule and the weekly 7 MA (the same length) sit at the top. Shorter (5 weeks) flips too often; longer (9, 12, 20 weeks) reacts too late. A flat top around 7 weeks, with 9 just past it.');
  p('- The differences are small: at most about 0.4 points a trade across the whole table.');
  p('- Asking for both, or either, changes nothing worth having.');
  p();
  p('## 3. The other reading: the COIN over its own weekly 9 MA');
  p();
  p('| filter | ' + UK.map((u) => `${UN[u]}: avg per trade`).join(' | ') + ' | adds | drops |');
  p('|---|---|---|---|---|---|');
  for (const [k, lab] of [[SHIPPED, 'Shipped'], [OWN, 'The coin over its own weekly 9 MA, no BTC rule'], [OWNR, 'BTC over its 50-day MA, or the coin over its own weekly 9 (in place of the leader exception)'], ['BTC over the weekly 9 AND the coin over its own', 'BTC over the weekly 9 MA and the coin over its own']])
    p(`| ${lab} | ${UK.map((u) => pc(R[u].rows[k].all.avg)).join(' | ')} | ${k === SHIPPED ? '—' : UK.map((u) => cell(R[u].rows[k].added)).join(' / ')} | ${k === SHIPPED ? '—' : UK.map((u) => cell(R[u].rows[k].removed)).join(' / ')} |`);
  p();
  p(`- **A coin above its own weekly 9 MA while BTC is weak is not a buy.** Those are the trades this reading adds, and they average ${UK.map((u) => pc(R[u].rows[OWNR].added.avg)).join(' / ')}. It is the rule that lets INIT in, and it loses on all three sets (no worse than shipped in ${UK.map((u) => (R[u].odds[OWN] * 100).toFixed(0) + '%').join(' / ')} of draws for the no-BTC form).`);
  p('- This repeats two earlier findings: an own-asset trend filter amplifies the bear loss (ALGORITHM.md, REJECTED), and breakouts the BTC filter blocks lose as a group (`research/latelead/`).');
  p('- Asking for both (BTC and the coin over their weekly 9) is better on the 103-coin list and worse with the delisted coins: not consistent.');
  p();
  p('## 4. By year');
  p();
  p('Every trade: trades · average. Shipped / weekly 9 (live).');
  p();
  for (const u of UK) { const ys = Object.keys(R[u].rows[SHIPPED].years).sort();
    p(`**${UN[u][0].toUpperCase() + UN[u].slice(1)}.** ` + ys.map((y) => { const a = R[u].rows[SHIPPED].years[y], b = R[u].rows[W9].years[y]; return `${y}: ${a.n} · ${pc(a.avg, 1)} / ${b ? `${b.n} · ${pc(b.avg, 1)}` : '—'}`; }).join(' · '));
    p(); }
  p(`No year separates them by much. By half, shipped → weekly 9: before 2022 ${UK.map((u) => `${pc(R[u].rows[SHIPPED].h1.avg)} → ${pc(R[u].rows[W9].h1.avg)}`).join(', ')}; from 2022 ${UK.map((u) => `${pc(R[u].rows[SHIPPED].h2.avg)} → ${pc(R[u].rows[W9].h2.avg)}`).join(', ')}. So the two were level before 2022, and the 50-day is ahead on all three sets since.`);
  p();
  p('## Verdict');
  p();
  p('- **Don\'t swap.** The weekly 9 MA is the 50-day rule made slightly slower, and slower is slightly worse here.');
  p('- **It does not solve the INIT case.** BTC was under both lines. Only the coin\'s own weekly MA would have opened, and that rule loses.');
  p(`- **What tested better, again, is on the other side of the filter:** without the leader exception the average trade goes ${pc(R.alert.rows[SHIPPED].all.avg)} → ${pc(R.alert.rows['shipped without the leader rescue'].all.avg)} on the alert coins, ${pc(R.u103.rows[SHIPPED].all.avg)} → ${pc(R.u103.rows['shipped without the leader rescue'].all.avg)} on the 103 coins and ${pc(R.u274.rows[SHIPPED].all.avg)} → ${pc(R.u274.rows['shipped without the leader rescue'].all.avg)} with the delisted ones. That is the open proposal from \`research/latelead/\` (10 Nov 2026), a separate question.`);
  p('- **Limits.**');
  p('  - One strategy, 4h candles.');
  p('  - The 50-day length was chosen in Oct 2026 on part of this same history (32 coins), so some of its small lead is hindsight. That is a reason not to read the gap as proof, not a reason to switch.');
  p('  - The pot figures move a lot for small reasons, so the per-trade columns carry the verdict.');
  process.stdout.write(o.join('\n') + '\n');
}

module.exports = { weeklyAbove, onto, btcFlag, gateOf, runCoin, VARIANTS };
