/*
 * liqbrk after INIT's −41.7% stop-out (Nov 2026, user report: "The last trade … got stopped out at -41%, no trader
 * would trade like that, there are things still wrong in the strategy"). The study changed nothing; its two proposed
 * rules were then approved and SHIPPED (Nov 2026: lbLeadPump 0, lbMaxStop 0.25). "Shipped" in this lab and its report
 * means the Oct 2026 rules the study measured: the lab pins them with L.useRules('2026-10').
 *
 *   NODE_USE_ENV_PROXY=1 node research/latelead/latelead_lab.js fetch     # the alert list's 4h candles to now (shared cache)
 *   node research/stopcap/stopcap_lab.js run                              # → research/cache/stopcap/run.json + the tables
 *   node research/stopcap/stopcap_lab.js report > research/stopcap/RESULTS_stopcap_2026-11.md
 *
 * THE TRADE. INIT 4h, bought at the 21:30 IST close of 10 Nov 2026 at 0.273, after +120% in three days. Two rules let
 * it happen:
 *   the entry   BTC was under its 50-day MA, so only a "leader" (+50% over 30 days) could buy. INIT was +131%, all of
 *               it from the two-day pump: a day earlier it was +10%.
 *   the stop    4 × ATR. After the pump the ATR was 10.4% of the price, so the stop sat 41.6% under the entry. Nothing
 *               in the rules limits that distance.
 * It was stopped a day later at −41.6%.
 *
 * THE TEST: the shipped rules (research/liqbrk_lab.js, parity-checked against detector.js) with one change each:
 *   leader a day earlier   the +50%/30-day test must also have held one day before (research/latelead's proposal)
 *   skip over K            no buy when the stop (4 × ATR) would be more than K of the price away (K = 15/20/25/30%)
 *   clamp at K             the trade is taken, but its stop is never further than K away
 *   size to K              the trade is taken with the shipped stop, but smaller: K ÷ the stop's distance of a slot, so a
 *                          stop-out costs at most K of a slot. Its result is counted in slot units (size × return).
 *   and the rules together.
 * First of all, the shipped trades are simply sorted by how far away their stop was: do the wide ones pay?
 *
 * Set-up as research/latelead: signal at a 4h close, bought at the next open; 0.1% fee a side, 0.15% slippage; the 65
 * liqbrk 4h alert coins (Binance 4h candles to now), the 103-coin list, the 103 plus 171 delisted coins (4h from the 15m
 * files to 5 Nov 2026, $1M-a-day floor). A change is judged by the trades it DROPS and ADDS, and by the tail: how many
 * trades lose more than 20% and 30%, and the worst one.
 */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const L = require('../liqbrk_lab.js').useRules('2026-10');   // "shipped" in this study = the Oct 2026 rules (leader rescue, no stop limit)
const LL = require('../latelead/latelead_lab.js');
const OUT = path.join(ROOT, 'research', 'cache', 'stopcap');
const H4 = 14400, DAY = 86400, SLIP = 0.0015;
const SPLIT = Date.UTC(2022, 0, 1) / 1e3, S0 = Date.UTC(2017, 8, 1) / 1e3, JOURNAL0 = Date.UTC(2026, 9, 24) / 1e3;   // the bot's journal began 24 Oct 2026
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);

// v: { held, norescue, cap (skip when the stop is further than this), clamp (the stop is never further than this), size (buy smaller: this ÷ the stop's distance of a slot) }
const VARIANTS = [
  ['shipped', {}],
  ['leader a day earlier', { held: true }],
  ['skip over 15%', { cap: 0.15 }], ['skip over 20%', { cap: 0.2 }], ['skip over 25%', { cap: 0.25 }], ['skip over 30%', { cap: 0.3 }],
  ['clamp at 15%', { clamp: 0.15 }], ['clamp at 20%', { clamp: 0.2 }], ['clamp at 25%', { clamp: 0.25 }],
  ['leader a day earlier + skip over 20%', { held: true, cap: 0.2 }], ['leader a day earlier + skip over 25%', { held: true, cap: 0.25 }],
  ['leader a day earlier + clamp at 20%', { held: true, clamp: 0.2 }],
  ['no leader rescue', { norescue: true }], ['no leader rescue + skip over 20%', { norescue: true, cap: 0.2 }],
  ['no leader rescue + skip over 25%', { norescue: true, cap: 0.25 }], ['no leader rescue + skip over 30%', { norescue: true, cap: 0.3 }],
  ['size to 10%', { size: 0.1 }], ['size to 15%', { size: 0.15 }], ['size to 20%', { size: 0.2 }], ['no leader rescue + size to 15%', { norescue: true, size: 0.15 }],
];
const BUCKETS = [[0, 0.08], [0.08, 0.12], [0.12, 0.16], [0.16, 0.2], [0.2, 0.25], [0.25, 0.3], [0.3, 9]];
function turnover30(c) {
  const n = c.length, out = new Float64Array(n).fill(NaN), W = Math.round(30 * DAY / Math.max(60, c[1].time - c[0].time)); let s = 0;
  for (let i = 0; i < n; i++) { s += c[i].volume * c[i].close; if (i >= W) s -= c[i - W].volume * c[i - W].close; if (i >= W - 1) out[i] = s / 30; }
  return out;
}
function runCoin(coin, c, btc, v, minTurn = 0) {
  const ind = L.indicators(c), n = c.length, closes = c.map((b) => b.close), B = Math.max(1, Math.round(ind.bpd)), L30 = Math.max(2, Math.round(30 * ind.bpd));
  const g0 = L.marketGate(c, btc), btcOk = L.marketGate(c, btc, L.P.lbBtcMaDays, 0), lead = (i) => i >= L30 && closes[i] >= (1 + L.P.lbLeadPump) * closes[i - L30];
  const dist = (i) => L.P.lbStop * ind.a[i] / closes[i];                          // the stop's distance as the engine sets it: 4 × ATR under the close
  const T = minTurn > 0 ? turnover30(c) : null, g = new Array(n);
  for (let i = 0; i < n; i++) { let x = v.norescue ? btcOk[i] : v.held ? btcOk[i] || (lead(i) && i >= B && lead(i - B)) : g0[i];
    if (x && v.cap && dist(i) > v.cap) x = false; if (x && T && !(T[i] >= minTurn)) x = false; g[i] = x; }
  const r = L.simulate(c, ind, { fill: 'next', slip: SLIP, exit: 'scale3R', veto: g, stopCap: v.clamp });
  return { ind, btcOk, lead, B, trades: r.trades.map((t) => ({ coin, t: { ...t, rv: ind.rv[t.sigIdx] }, tIn: c[t.entryIdx].time, tOut: c[t.exitIdx].time, sig: t.sigIdx, sigT: c[t.sigIdx].time, ret: t.ret, size: v.size ? Math.min(1, v.size / dist(t.sigIdx)) : 1,
    dist: (t.entry - t.stop) / t.entry, why: t.why, viaLead: !btcOk[t.sigIdx], pump: !btcOk[t.sigIdx] && !(t.sigIdx >= B && lead(t.sigIdx - B)), run3: closes[t.sigIdx] / closes[Math.max(0, t.sigIdx - 3 * B)] - 1 })) };
}
// the tail of a set of trades
function tail(tr) {
  const r = tr.map((x) => x.ret), losses = r.filter((x) => x <= 0);
  return { lose20: r.filter((x) => x <= -0.2).length, lose30: r.filter((x) => x <= -0.3).length, worst: r.length ? Math.min(...r) : NaN, avgLoss: mean(losses), avgWin: mean(r.filter((x) => x > 0)),
    p5: r.length ? r.slice().sort((a, b) => a - b)[Math.floor(r.length * 0.05)] : NaN };
}

const mode = require.main === module ? process.argv[2] : null;
const iso = (t) => new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' ');
const pc = (x, d = 2) => (x == null || !Number.isFinite(x) ? '—' : (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(d) + '%');

if (mode === 'run') {
  const t00 = Date.now(), U = LL.universes(), { book, curveStats } = require('../flush/vs_liqbrk4h.js'), res = {};
  for (const [uk, u] of Object.entries(U)) {
    const ser = {}, axis = u.btc.map((b) => b.time), end = axis[axis.length - 1] + H4, R = {};
    for (const [coin, c] of u.coins) ser[coin] = { c, idx: new Map(c.map((b, i) => [b.time, i])) };
    for (const [name, v] of VARIANTS) { const trades = []; for (const [coin, c] of u.coins) trades.push(...runCoin(coin, c, u.btc, v, u.minTurn).trades); R[name] = trades; }
    const base = R.shipped, coinNet = (tr) => { const m = {}; for (const x of tr) m[x.coin] = (m[x.coin] ?? 1) * (1 + x.ret); return m; }, bn = coinNet(base);
    // 1. shipped trades by how far away the stop was
    const buckets = BUCKETS.map(([a, b]) => { const tr = base.filter((x) => x.dist >= a && x.dist < b); return { a, b, ...LL.tstats(tr), ...tail(tr), stops: tr.filter((x) => x.why === 'STOP').length, pump: tr.filter((x) => x.pump).length,
      h1: LL.tstats(tr.filter((x) => x.sigT < SPLIT)), h2: LL.tstats(tr.filter((x) => x.sigT >= SPLIT)) }; });
    // 2. every variant
    const rnd = require('../rng.js').mulberry32(20261112), rows = {};
    const key = (x) => x.coin + '|' + x.sig, bm = new Map(base.map((x) => [key(x), x]));
    for (const [name, tr0] of Object.entries(R)) {
      const tr = tr0.map((x) => (x.size < 1 ? { ...x, ret: x.ret * x.size } : x));          // a smaller buy counts in slot units
      const diffs = []; for (const x of tr) { const b = bm.get(key(x)); if (b && Math.abs(x.ret - b.ret) > 1e-9) diffs.push(x.ret - b.ret); }   // the same trade, ending differently
      const d = LL.compare(base, tr), net = coinNet(tr), coins = u.coins.map(([c]) => c), nets = coins.map((c) => (net[c] ?? 1) - 1).sort((a, b) => a - b);
      const bk = book(tr0, ser, axis, 5, S0, end), cs = curveStats(bk.curve, S0, end);
      let odds = null; if (name !== 'shipped') { const a = d.added.map((x) => x.ret), r = d.removed.map((x) => x.ret); let ge = 0;
        for (let b = 0; b < 10000; b++) { let s = 0; for (let q = 0; q < a.length; q++) s += a[Math.floor(rnd() * a.length)]; for (let q = 0; q < r.length; q++) s -= r[Math.floor(rnd() * r.length)]; for (let q = 0; q < diffs.length; q++) s += diffs[Math.floor(rnd() * diffs.length)]; if (s >= 0) ge++; } odds = ge / 10000; }
      rows[name] = { all: LL.tstats(tr), h1: LL.tstats(tr.filter((x) => x.sigT < SPLIT)), h2: LL.tstats(tr.filter((x) => x.sigT >= SPLIT)), tail: tail(tr), added: LL.tstats(d.added), removed: LL.tstats(d.removed),
        removedH1: LL.tstats(d.removed.filter((x) => x.sigT < SPLIT)), removedH2: LL.tstats(d.removed.filter((x) => x.sigT >= SPLIT)), odds,
        changed: { n: diffs.length, avg: mean(diffs), up: diffs.filter((q) => q > 0).length }, used: mean(tr0.map((x) => x.size)), total: tr.reduce((q, x) => q + x.ret, 0),
        medCoin: nets[nets.length >> 1], better: coins.filter((c) => (net[c] ?? 1) > (bn[c] ?? 1) * 1.0001).length, worse: coins.filter((c) => (net[c] ?? 1) < (bn[c] ?? 1) * 0.9999).length,
        book: { mult: cs.mult, cagr: cs.cagr, dd: cs.dd, taken: bk.taken.length }, perYear: tr.length / ((end - Math.max(S0, Math.min(...u.coins.map(([, c]) => c[0].time)))) / 31557600) };
    }
    // 3. the worst shipped trades, and what each change does with them
    const worst = base.slice().sort((a, b) => a.ret - b.ret).slice(0, 12).map((x) => ({ coin: x.coin, t: x.sigT + H4, ret: x.ret, dist: x.dist, viaLead: x.viaLead, pump: x.pump, run3: x.run3, why: x.why,
      held: !R['leader a day earlier'].some((y) => y.coin === x.coin && y.sig === x.sig), cap20: !R['skip over 20%'].some((y) => y.coin === x.coin && y.sig === x.sig), cap25: !R['skip over 25%'].some((y) => y.coin === x.coin && y.sig === x.sig) }));
    res[uk] = { coins: u.coins.length, to: iso(end), buckets, rows, worst };
    if (uk === 'alert') {
      const has = (k) => { const S = new Set(R[k].map((x) => x.coin + '|' + x.sig)); return (x) => S.has(x.coin + '|' + x.sig); };
      const H = { held: has('leader a day earlier'), nores: has('no leader rescue'), c30: has('skip over 30%'), c25: has('skip over 25%'), c20: has('skip over 20%') };
      res.recent = base.filter((x) => x.sigT + H4 >= JOURNAL0).sort((a, b) => a.sigT - b.sigT).map((x) => ({ coin: x.coin, t: x.sigT + H4, dist: x.dist, run3: x.run3, ret: x.ret, why: x.why, viaLead: x.viaLead, pump: x.pump,
        skip: { held: !H.held(x), nores: !H.nores(x), c30: !H.c30(x), c25: !H.c25(x), c20: !H.c20(x) } }));
      const b = u.btc, ok = L.marketGate(b, b, L.P.lbBtcMaDays, 0); let j = b.length - 1; while (j > 0 && !ok[j]) j--;
      res.btcUnder = { since: b[j].time + H4, days: (b[b.length - 1].time - b[j].time) / DAY, now: ok[b.length - 1] };
      const lead = base.filter((x) => x.viaLead), Y = {}; for (const x of lead) { const y = new Date(x.sigT * 1000).getUTCFullYear(); (Y[y] = Y[y] || []).push(x.ret); }
      res.leadYears = Object.fromEntries(Object.entries(Y).map(([y, a]) => [y, { n: a.length, avg: mean(a), wins: a.filter((q) => q > 0).length }]));
      res.leadAll = { ...LL.tstats(lead), ...tail(lead) };
    }
    console.log(`\n=== ${uk}: ${u.coins.length} coins → ${iso(end)} · ${base.length} shipped trades`);
    console.log('shipped trades by stop distance:  trades share  win    avg     median   PF  worst | hit the stop  pump-leader | <2022 avg (n)   2022+ avg (n)');
    for (const b of buckets) console.log(`  stop ${(b.a * 100).toFixed(0).padStart(2)}–${b.b > 1 ? '  ' : (b.b * 100).toFixed(0)}%${b.b > 1 ? '+' : ' '}                 ${String(b.n).padStart(6)} ${(b.n / base.length * 100).toFixed(0).padStart(4)}% ${b.n ? (b.wr * 100).toFixed(0).padStart(3) + '%' : '    '} ${pc(b.avg).padStart(8)} ${pc(b.med).padStart(8)} ${b.n ? b.pf.toFixed(2) : '    '} ${pc(b.worst, 0).padStart(5)} | ${String(b.stops).padStart(5)} (${b.n ? (b.stops / b.n * 100).toFixed(0) : 0}%) ${String(b.pump).padStart(6)} | ${pc(b.h1.avg).padStart(8)} (${b.h1.n || 0}) ${pc(b.h2.avg).padStart(8)} (${b.h2.n || 0})`);
    console.log('change                                   trades  win   avg/tr   PF  PF-2% | lose>20% lose>30%  worst  avg loss | DROPS n  win    avg | ADDS n   avg | no worse | med coin better/worse | pot ×    CAGR  maxDD');
    for (const [name, r] of Object.entries(rows)) { const a = r.all, t = r.tail;
      console.log(`${name.padEnd(40)} ${String(a.n).padStart(6)} ${(a.wr * 100).toFixed(0).padStart(3)}% ${pc(a.avg).padStart(8)} ${a.pf.toFixed(2)} ${a.pfx.toFixed(2).padStart(5)} | ${String(t.lose20).padStart(6)} ${String(t.lose30).padStart(8)} ${pc(t.worst, 0).padStart(6)} ${pc(t.avgLoss, 1).padStart(8)} | ${String(r.removed.n).padStart(5)} ${r.removed.n ? (r.removed.wr * 100).toFixed(0).padStart(3) + '%' : '    '} ${pc(r.removed.avg).padStart(7)} | ${String(r.added.n).padStart(4)} ${pc(r.added.avg).padStart(7)} | ${r.odds == null ? '    ' : (r.odds * 100).toFixed(0).padStart(3) + '%'}     | ${pc(r.medCoin, 0).padStart(6)} ${String(r.better).padStart(3)}/${String(r.worse).padEnd(3)} | ×${r.book.mult.toFixed(2).padStart(6)} ${pc(r.book.cagr, 1).padStart(7)} −${(r.book.dd * 100).toFixed(0)}%`); }
    console.log('the 12 worst shipped trades (blocked by: leader-a-day-earlier / skip over 20% / skip over 25%):');
    for (const x of worst) console.log(`  ${x.coin.padEnd(8)} ${iso(x.t).slice(0, 10)}  ${pc(x.ret, 1).padStart(7)}  stop ${(x.dist * 100).toFixed(0)}% away · +${(x.run3 * 100).toFixed(0)}% in 3 days before · ${x.pump ? 'pump-made leader' : x.viaLead ? 'leader' : 'BTC ok'} · ${x.why} · ${x.held ? 'Y' : '-'} / ${x.cap20 ? 'Y' : '-'} / ${x.cap25 ? 'Y' : '-'}`);
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'run.json'), JSON.stringify({ at: new Date().toISOString(), slip: SLIP, res }));
  process.stderr.write(`${((Date.now() - t00) / 1000).toFixed(0)}s\n`);
}

// ---------------------------------------------------------------- report
if (mode === 'report') {
  const D = JSON.parse(fs.readFileSync(path.join(OUT, 'run.json'))), R = D.res, o = [], p = (x = '') => o.push(x);
  const UK = ['alert', 'u103', 'u274'], UN = { alert: 'the 65 alert coins', u103: 'the 103-coin list', u274: 'the 103 + 171 delisted' };
  const cell = (s) => (s && s.n ? `${s.n} · ${(s.wr * 100).toFixed(0)}% · ${pc(s.avg)}` : '0');
  const istF = (t) => { const d = new Date((t + 19800) * 1000); return `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
  const day = (t) => new Date(t * 1000).toISOString().slice(0, 10), cap = (s) => s[0].toUpperCase() + s.slice(1), per = (f) => UK.map(f).join(' / ');
  const HELD = 'leader a day earlier', NORES = 'no leader rescue', PKG = 'no leader rescue + skip over 25%', PKG2 = 'leader a day earlier + skip over 25%', PKG3 = 'no leader rescue + skip over 30%';
  const init = R.recent.find((x) => x.coin === 'INIT' && x.ret < -0.3), W = R.alert.worst;
  p('# The Breakout rule after INIT\'s −41.7% stop-out: pump entries and a stop with no limit (Nov 2026)');
  p();
  p('Generated by `research/stopcap/stopcap_lab.js report`. The study itself changed nothing. **Both proposed rules were then approved by the user and shipped (Nov 2026):** no leader exception, and no buy when the stop would be more than 25% under the entry. In the tables below, "shipped" means the rules the study measured: the Oct 2026 rules, with the leader exception and no stop limit.');
  p();
  p('**The report (user):** "The last trade that happened actually got stopped out at -41%, no trader would trade like that, there are things still wrong in the strategy."');
  p();
  p('**Short answer: two rule gaps, both measurable.**');
  p('- **The entry.** While BTC is weak, the only buys allowed are "leaders" (+50% in 30 days). A two-day pump makes a coin a leader, so the rule ends up buying the top of pumps.');
  p('- **The stop.** It is 4 × ATR, with no upper limit. After a pump that is 30–45% of the price.');
  p(`- Skipping those trades improves the average trade on all three coin sets (${per((u) => `${pc(R[u].rows.shipped.all.avg)} → ${pc(R[u].rows[PKG].all.avg)}`)}), and no trade in the history then loses more than about 25%.`);
  p(`- A tighter stop on the same trades does not help. A smaller buy caps the loss too, but earns less per trade than skipping on all three sets (${per((u) => `${pc(R[u].rows['no leader rescue + size to 15%'].all.avg)} against ${pc(R[u].rows[PKG].all.avg)}`)}).`);
  p();
  p('## The trade');
  p();
  p(`INIT 4h, alerted by the bot. Bought at the ${istF(init.t)} IST close at 0.273, after ${pc(init.run3, 0)} in three days.`);
  p('- BTC was under its 50-day average. INIT was +131% over 30 days, all of it from the two-day pump: a day earlier it was +10%.');
  p(`- The ATR was 10.4% of the price, so the stop sat ${(init.dist * 100).toFixed(0)}% under the entry.`);
  p('- A day later it was stopped out. The journal has −41.7%.');
  p();
  p('## The alerts since the journal began');
  p();
  p(`BTC last closed above its 50-day average on ${day(R.btcUnder.since)}, ${R.btcUnder.days.toFixed(0)} days before this run. So every Breakout buy since the journal began (24 Oct 2026) came through the leader exception. Results are this lab's (bought at the next open with 0.15% slippage), a little under the journal's.`);
  p();
  p('| coin | signal close (IST) | why the filter was open | stop below entry | 3 days before | result | exit | skipped by: leader a day earlier | …no leader exception | …stop over 25% | …stop over 30% |');
  p('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const x of R.recent) p(`| ${x.coin} | ${istF(x.t)} | ${x.pump ? 'leader through a pump' : x.viaLead ? 'leader, also a day earlier' : 'BTC over its 50-day'} | ${(x.dist * 100).toFixed(0)}% | ${pc(x.run3, 0)} | **${pc(x.ret, 1)}** | ${x.why === 'STOP' ? 'stop' : 'trail'} | ${x.skip.held ? 'yes' : 'no'} | ${x.skip.nores ? 'yes' : 'no'} | ${x.skip.c25 ? 'yes' : 'no'} | ${x.skip.c30 ? 'yes' : 'no'} |`);
  p();
  p(`All ${R.recent.length} lost. In a weak market the rule only trades its worst kind of trade.`);
  p();
  p('## 1. The leader exception, on all history');
  p();
  { const a = R.leadAll, ys = Object.keys(R.leadYears).sort();
    p(`On the 65 alert coins the exception let in ${a.n} trades over all history: ${(a.wr * 100).toFixed(0)}% won, ${pc(a.avg)} a trade.`);
    p();
    p('| year | ' + ys.join(' | ') + ' |'); p('|---|' + ys.map(() => '---').join('|') + '|');
    p('| trades | ' + ys.map((y) => R.leadYears[y].n).join(' | ') + ' |');
    p('| average | ' + ys.map((y) => pc(R.leadYears[y].avg, 1)).join(' | ') + ' |');
    p(); }
  p('What each change drops (trades · winners · average per trade):');
  p();
  p('| change | ' + UK.map((u) => UN[u]).join(' | ') + ' |');
  p('|---|---|---|---|');
  p(`| Leader must also have been one a day earlier | ${UK.map((u) => cell(R[u].rows[HELD].removed)).join(' | ')} |`);
  p(`| No leader exception at all | ${UK.map((u) => cell(R[u].rows[NORES].removed)).join(' | ')} |`);
  p();
  const hc = (s) => (s && s.n ? `${pc(s.avg)} (${s.n})` : '—'), HH = '| | ' + UK.map((u) => `${UN[u]}: before 2022 | from 2022`).join(' | ') + ' |', HS = '|---|' + UK.map(() => '---|---').join('|') + '|';
  p('The same by half of history (average per trade dropped, trades in brackets):');
  p();
  p(HH); p(HS);
  p(`| Leader must also have been one a day earlier | ${UK.map((u) => `${hc(R[u].rows[HELD].removedH1)} | ${hc(R[u].rows[HELD].removedH2)}`).join(' | ')} |`);
  p(`| No leader exception at all | ${UK.map((u) => `${hc(R[u].rows[NORES].removedH1)} | ${hc(R[u].rows[NORES].removedH2)}`).join(' | ')} |`);
  p(`| For scale: every shipped trade | ${UK.map((u) => `${hc(R[u].rows.shipped.h1)} | ${hc(R[u].rows.shipped.h2)}`).join(' | ')} |`);
  p();
  { const below = UK.reduce((q, u) => q + ['h1', 'h2'].filter((h) => R[u].rows[NORES][h === 'h1' ? 'removedH1' : 'removedH2'].avg < R[u].rows.shipped[h].avg - 0.005).length, 0);
    p(`- **From 2022 the leader trades lose on all three sets** (${per((u) => pc(R[u].rows[NORES].removedH2.avg))}). Before 2022 they were about break-even (${per((u) => pc(R[u].rows[NORES].removedH1.avg))}).`);
    p(`- They are clearly worse than the rule's other trades in ${below} of the 6 halves, and never clearly better.`);
    p('- The first change drops the pump-made leaders, the worse part. The second also drops the leaders that were already leaders a day earlier, which are about break-even on the two live lists and lose with the delisted coins.'); }
  p('- The exception was added in Oct 2026 to catch early-cycle leaders (FET Jan 2023, ZEC Sep 2025). It does catch a few (2023 above), and loses more on the rest.');
  p();
  p('## 2. Does a far-away stop pay? Shipped trades by stop distance');
  p();
  p('Cells are: trades · winners · average per trade.');
  p();
  p('| stop below the entry | ' + UK.map((u) => UN[u]).join(' | ') + ' |');
  p('|---|---|---|---|');
  BUCKETS.forEach(([a, b], i) => p(`| ${b > 1 ? `over ${(a * 100).toFixed(0)}%` : `${(a * 100).toFixed(0)}–${(b * 100).toFixed(0)}%`} | ${UK.map((u) => cell(R[u].buckets[i])).join(' | ')} |`));
  p();
  p('The same by half of history (average per trade, trades in brackets):');
  p();
  p(HH.replace('| |', '| stop below the entry |')); p(HS);
  BUCKETS.forEach(([a, b], i) => p(`| ${b > 1 ? `over ${(a * 100).toFixed(0)}%` : `${(a * 100).toFixed(0)}–${(b * 100).toFixed(0)}%`} | ${UK.map((u) => `${hc(R[u].buckets[i].h1)} | ${hc(R[u].buckets[i].h2)}`).join(' | ')} |`));
  p();
  { const wr = (i) => UK.map((u) => R[u].buckets[i].wr * 100), lo = (a) => Math.min(...a).toFixed(0), hi = (a) => Math.max(...a).toFixed(0), n30 = UK.map((u) => R[u].buckets[6].n + R[u].buckets[5].n), nAll = UK.map((u) => R[u].rows.shipped.all.n), sh = n30.map((x, k) => x / nAll[k] * 100);
    p(`- **The tightest stops are the best trades.** A stop within 8% means a calm coin breaking out: ${lo(wr(0))}–${hi(wr(0))}% winners and ${per((u) => pc(R[u].buckets[0].avg))} a trade, positive in every half.`);
    p('- **From 8% to 25% there is no steady slope** on the two live lists: those trades make money at every distance. With the delisted coins they fade from 12% up, and lose from 2022.');
    const neg = (i) => UK.reduce((q, u) => q + ['h1', 'h2'].filter((h) => R[u].buckets[i][h].avg < 0).length, 0);
    p(`- **Over 30% away loses on all three sets** (${per((u) => pc(R[u].buckets[6].avg))}), with ${lo(wr(6))}–${hi(wr(6))}% winners, and in ${neg(6)} of the 6 halves.`);
    p(`- **25–30% is undecided:** ${per((u) => pc(R[u].buckets[5].avg))}. The alert coins lose in both halves and the 103-coin list wins in both. The two lists disagree, so this band carries no reliable signal.`);
    p(`- Trades with a stop over 25% away are few (${lo(sh)}–${hi(sh)}% of all) and swing a lot, so single bands are noisy. The pattern across them is what counts.`); }
  p();
  { const far = W.filter((x) => x.dist > 0.25).length, minRun = Math.min(...W.map((x) => x.run3)), btcN = W.filter((x) => !x.viaLead).length;
    p(`**The ${W.length} worst trades on the alert coins.** ${far === W.length ? 'Every one' : `${far} of them`} had a stop more than 25% away, after a 3-day run of ${pc(minRun, 0)} or more.`);
    p();
    p('| coin | signal day (UTC) | result | stop below entry | 3 days before | why the filter was open | exit |');
    p('|---|---|---|---|---|---|---|');
    for (const x of W) p(`| ${x.coin} | ${day(x.t)} | ${pc(x.ret, 1)} | ${(x.dist * 100).toFixed(0)}% | ${pc(x.run3, 0)} | ${x.pump ? 'leader through a pump' : x.viaLead ? 'leader, also a day earlier' : 'BTC over its 50-day'} | ${x.why === 'STOP' ? 'stop' : 'trail'} |`);
    p();
    p(`${btcN} of the ${W.length} came with BTC over its 50-day average, so fixing the leader exception alone does not remove them.`); }
  p();
  p('## 3. Skipping trades: the changes side by side');
  p();
  p('"Drops" is: trades · winners · average per trade. "No worse" is how often the change comes out no worse than shipped when the trades it adds and drops are resampled 10,000 times. The pot is the bot\'s book (5 slots, 20% each); it is noisy, so read it last.');
  p();
  const ROWS = [['shipped', 'Shipped'], [HELD, 'Leader must also have been one a day earlier'], [NORES, 'No leader exception'], ['skip over 30%', 'Skip a buy whose stop is over 30% away'], ['skip over 25%', '…over 25%'], ['skip over 20%', '…over 20%'], ['skip over 15%', '…over 15%'],
    [PKG2, 'Leader a day earlier + skip over 25%'], [PKG, '**No leader exception + skip over 25%**'], [PKG3, 'No leader exception + skip over 30%'], ['no leader rescue + skip over 20%', 'No leader exception + skip over 20%']];
  for (const u of UK) {
    p(`**${cap(UN[u])}** (${R[u].coins} coins, to ${R[u].to.slice(0, 10)}).`);
    p();
    p('| | trades | win | avg per trade | PF | PF without the best 2% | lose over 20% | lose over 30% | worst | drops | no worse | pot | max DD |');
    p('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const [k, lab] of ROWS) { const r = R[u].rows[k], a = r.all, t = r.tail;
      p(`| ${lab} | ${a.n} | ${(a.wr * 100).toFixed(0)}% | ${pc(a.avg)} | ${a.pf.toFixed(2)} | ${a.pfx.toFixed(2)} | ${t.lose20} | ${t.lose30} | ${pc(t.worst, 0)} | ${k === 'shipped' ? '—' : cell(r.removed)} | ${r.odds == null ? '—' : (r.odds * 100).toFixed(0) + '%'} | ×${r.book.mult.toFixed(2)} | −${(r.book.dd * 100).toFixed(0)}% |`); }
    p();
  }
  { const g = (k) => UK.map((u) => `${pc(R[u].rows.shipped.all.avg)} → ${pc(R[u].rows[k].all.avg)}`).join(', ');
    const tot = (u, k) => R[u].rows[k].total / R[u].rows.shipped.total - 1;
    p(`- **Skipping over 30%** drops losing trades on all three sets (${per((u) => pc(R[u].rows['skip over 30%'].removed.avg))}). It is the cut with no cost on any set.`);
    p(`- **Skipping over 25%** drops ${per((u) => pc(R[u].rows['skip over 25%'].removed.avg))}: right on the alert coins and with the delisted ones, a small cost on the 103-coin list. The worst trade is then about −25%.`);
    p(`- **25% or 30%?** With no leader exception, the sum of all trade results changes by ${per((u) => pc(tot(u, PKG), 0))} at 25% and by ${per((u) => pc(tot(u, PKG3), 0))} at 30%. So 25% does better on the alert coins and with the delisted ones, and a little worse on the 103-coin list. The worst trade is about −25% or about −30%.`);
    p(`- **Skipping over 20% or 15%** starts to drop good trades on the 103-coin list (${pc(R.u103.rows['skip over 20%'].removed.avg)} and ${pc(R.u103.rows['skip over 15%'].removed.avg)} a trade dropped). Too tight.`);
    p(`- **Together** (no leader exception + skip over 25%): the average trade goes ${g(PKG)}; trades losing more than 20% go ${UK.map((u) => `${R[u].rows.shipped.tail.lose20} → ${R[u].rows[PKG].tail.lose20}`).join(', ')}; the worst trade ${UK.map((u) => `${pc(R[u].rows.shipped.tail.worst, 0)} → ${pc(R[u].rows[PKG].tail.worst, 0)}`).join(', ')}.`); }
  p();
  p('## 4. Keeping the trade: a tighter stop, or a smaller buy');
  p();
  p('Two things a trader might do instead of skipping.');
  p('- **A tighter stop.** Every trade is taken, but its stop is never more than 20% (or 25%) under the entry.');
  p('- **A smaller buy.** The stop stays where it is, and the buy shrinks so that a stop-out costs at most 10% (15%, 20%) of a slot. With a 30% stop and a 15% limit, half a slot is bought.');
  p();
  p('Results are in slot units (size × return), so a half-size trade that loses 30% counts as −15%. "End differently" is: trades whose result changes · the average change. "Slot used" is the average size bought.');
  p();
  const KEEP = [['shipped', 'Shipped'], ['clamp at 20%', 'Stop never over 20% away'], ['clamp at 25%', 'Stop never over 25% away'], ['size to 20%', 'Smaller buy: a stop-out costs at most 20% of a slot'], ['size to 15%', '…at most 15%'], ['size to 10%', '…at most 10%'],
    ['no leader rescue + size to 15%', 'No leader exception + at most 15%'], [PKG, 'For comparison: no leader exception + skip over 25%']];
  for (const u of UK) {
    p(`**${cap(UN[u])}.**`);
    p();
    p('| | trades | slot used | avg per trade | PF | lose over 20% | worst | end differently | no worse | pot | max DD |');
    p('|---|---|---|---|---|---|---|---|---|---|---|');
    for (const [k, lab] of KEEP) { const r = R[u].rows[k], a = r.all, t = r.tail, ch = r.changed;
      p(`| ${lab} | ${a.n} | ${(r.used * 100).toFixed(0)}% | ${pc(a.avg)} | ${a.pf.toFixed(2)} | ${t.lose20} | ${pc(t.worst, 0)} | ${k === 'shipped' || !ch.n ? '—' : `${ch.n} · ${pc(ch.avg)}`} | ${r.odds == null ? '—' : (r.odds * 100).toFixed(0) + '%'} | ×${r.book.mult.toFixed(2)} | −${(r.book.dd * 100).toFixed(0)}% |`); }
    p();
  }
  { const g = (k) => UK.map((u) => `${pc(R[u].rows.shipped.all.avg)} → ${pc(R[u].rows[k].all.avg)}`).join(', '), c20 = 'clamp at 20%', s15 = 'size to 15%';
    p(`- **A tighter stop changes nothing in the money** (${g(c20)}) and more trades end in a big loss (${UK.map((u) => `${R[u].rows.shipped.tail.lose20} → ${R[u].rows[c20].tail.lose20}`).join(', ')} lose over 20%). A coin that moves 10% a candle touches a 20% stop easily. The trade is the problem, not where its stop sits.`);
    p(`- **A smaller buy** caps the worst loss by construction (at most 15% of a slot: ${per((u) => pc(R[u].rows[s15].tail.worst, 0))}). Per trade it earns ${g(s15)} of a slot, with ${per((u) => (R[u].rows[s15].used * 100).toFixed(0) + '%')} of a slot in use on average.`);
    p(`- **Against skipping** (the last two rows): the smaller buy has the smaller worst loss (−15% of a slot against about −25%), and earns less per trade on all three sets (${per((u) => `${pc(R[u].rows['no leader rescue + size to 15%'].all.avg)} against ${pc(R[u].rows[PKG].all.avg)}`)}). Trades with a stop over 30% away lose on every set, so keeping a fraction of them keeps a fraction of the loss.`);
    p('- A smaller buy also changes what the bot has to say: every alert would carry a size, and the book on the Portfolio would have to size each slot by it. Skipping changes nothing the user sees except fewer alerts.'); }
  p();
  p('## Proposal (items 1 and 2 shipped in Nov 2026, as written)');
  p();
  p('1. **In a weak market, no Breakout buys.** Drop the leader exception: a breakout is bought only while BTC is over its 50-day average.');
  p('   - Milder alternative: keep the exception only for coins that were already leaders a day earlier. Over history it does about the same; of the four recent losers it would have skipped two, not all four.');
  p('2. **No buy when the stop would be more than 25% under the entry.** The stop stays 4 × ATR; when that is more than 25% of the price, the signal is skipped.');
  p('   - This is a risk rule more than a profit rule. Over 30% the trades lose. Between 25% and 30% the coin sets disagree.');
  p('   - Alternative: 30%. It costs nothing on any set, and leaves a worst trade near −30%.');
  p('3. **Not proposed now: the smaller buy** (section 4). It is the stricter risk rule (no stop-out costs more than 15% of a slot) for a little less money, and it needs sizes in the alerts and the book. It can be added on top later.');
  p();
  p('**Limits.**');
  p('- Both ideas come from looking at losing trades, INIT\'s first. The cut-offs were tried next to their neighbours (30%, 20%, 15%), and both halves of history were in view, so none of this is an untouched test.');
  p('- Wide-stop trades are few and fat-tailed. Skipping them gives up the occasional pump that keeps running: on the 103-coin list the 25–30% band made money.');
  p('- The rule still loses on about 6 trades in 10 and the pot still draws down more than 50%. This removes the worst kind of trade, not the drawdowns.');
  p('- A stop can be jumped: a candle that opens under the stop fills at the open. No trade in this history did that after the 25% limit, but it can happen.');
  p('- One strategy, 4h candles. Trend Follow, Turtle and the Cycle have their own exits and are not touched.');
  process.stdout.write(o.join('\n') + '\n');
}

module.exports = { VARIANTS, runCoin, tail, BUCKETS };
