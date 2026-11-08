// Renders the 15m market-gate study from research/cache/lb15/run.json and scenario.json (see lab15.js).
//   node research/liqbrk15m/report15.js > research/liqbrk15m/RESULTS_liqbrk15m_2026-11.md
'use strict';
const fs = require('fs'), path = require('path');
const DATA = path.join(__dirname, '..', 'cache', 'lb15');
const R = JSON.parse(fs.readFileSync(path.join(DATA, 'run.json')));
const SC = fs.existsSync(path.join(DATA, 'scenario.json')) ? JSON.parse(fs.readFileSync(path.join(DATA, 'scenario.json'))) : null;
const GD = Object.fromEntries(R.gates), GATES = R.gates.map((g) => g[0]);
const MAIN = GATES.filter((g) => !g.startsWith('plc') && !g.startsWith('and')), PLC = GATES.filter((g) => g.startsWith('plc'));
const AND = ['ship', 'and96', 'both', 'and192', 'and288', 'and480'].filter((g) => GD[g]), APLC = GATES.filter((g) => g.startsWith('andplc'));
const LEN = { ship: '— (50-day gate only)', and96: '96 bars = 1 day', both: '149 bars ≈ 37h', and192: '192 bars = 2 days', and288: '288 bars = 3 days', and480: '480 bars = 5 days' };
const PER = { 'all': [0, Infinity], '2018–20': [Date.UTC(2018, 0, 1) / 1e3, Date.UTC(2021, 0, 1) / 1e3], '2021–22': [Date.UTC(2021, 0, 1) / 1e3, Date.UTC(2023, 0, 1) / 1e3],
  '2023–24': [Date.UTC(2023, 0, 1) / 1e3, Date.UTC(2025, 0, 1) / 1e3], '2025–26': [Date.UTC(2025, 0, 1) / 1e3, Infinity],
  'last 4y': [Date.UTC(2022, 9, 28) / 1e3, Infinity], 'last 3m': [Date.UTC(2026, 7, 5) / 1e3, Infinity] };
const BLOCKS = ['2018–20', '2021–22', '2023–24', '2025–26'];
for (const r of R.rows) if (r.pf == null) r.pf = Infinity;

// ---------------------------------------------------------------- helpers
const out = [], say = (s = '') => out.push(s), row = (a) => say('| ' + a.join(' | ') + ' |'), hr = (k) => row(Array(k).fill('---'));
const pct = (x, d = 1) => (x == null || Number.isNaN(x)) ? '—' : (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(d) + '%';
const big = (x) => { if (x == null || Number.isNaN(x)) return '—'; const v = Math.abs(x * 100); return (x >= 0 ? '+' : '−') + (v >= 1000 ? Math.round(v).toLocaleString('en-US') : v.toFixed(v >= 100 ? 0 : 1)) + '%'; };
const pp = (x) => (x == null || Number.isNaN(x)) ? '—' : (x * 100).toFixed(0) + '%';
const f2 = (x) => (x == null || Number.isNaN(x)) ? '—' : isFinite(x) ? x.toFixed(2) : '∞';
const med = (v) => { const s = v.filter((x) => x != null && !Number.isNaN(x)).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const inP = (t, p) => t >= PER[p][0] && t < PER[p][1];
function pooled(T) {
  const n = T.length; if (!n) return { n: 0 };
  const w = T.filter((t) => t.net > 0), gp = w.reduce((s, t) => s + t.net, 0), gl = -T.filter((t) => t.net <= 0).reduce((s, t) => s + t.net, 0);
  const srt = T.map((t) => t.net).sort((a, b) => b - a), cut = srt.slice(Math.ceil(n * 0.02));
  const gp2 = cut.filter((x) => x > 0).reduce((s, x) => s + x, 0), gl2 = -cut.filter((x) => x <= 0).reduce((s, x) => s + x, 0);
  return { n, wr: w.length / n, avg: T.reduce((s, t) => s + t.net, 0) / n, pf: gl > 0 ? gp / gl : Infinity, pf2: gl2 > 0 ? gp2 / gl2 : Infinity,
    logsum: T.reduce((s, t) => s + Math.log(1 + t.net), 0) };
}
const byG = {}; for (const t of R.trades) (byG[t.g] || (byG[t.g] = [])).push(t);
const rowsOf = (g, p) => R.rows.filter((r) => r.g === g && r.p === p);
const basketStats = (p, g) => {
  const B = R.basket[p]; if (!B || !B.eq[g]) return null;
  const e = B.eq[g]; let pk = 1, dd = 0; for (const v of e) { if (v > pk) pk = v; dd = Math.max(dd, (pk - v) / pk); }
  return { ret: e[e.length - 1] - 1, dd, coins: B.coins };
};
// per coin vs the no-gate run: geometric mean of (1+net_gate)/(1+net_none), and how many coins it helped
function vsNone(g, p) {
  const A = new Map(rowsOf('none', p).map((r) => [r.sym, r])), B = rowsOf(g, p).filter((r) => A.has(r.sym));
  if (!B.length) return null;
  const lr = B.map((r) => Math.log(1 + r.net) - Math.log(1 + A.get(r.sym).net));
  return { coins: B.length, ratio: Math.exp(lr.reduce((s, x) => s + x, 0) / lr.length) - 1, better: lr.filter((x) => x > 1e-9).length, worse: lr.filter((x) => x < -1e-9).length,
    ddBetter: B.filter((r) => r.dd < A.get(r.sym).dd - 1e-9).length };
}

function vsGate(g, base, p) {
  const A = new Map(rowsOf(base, p).map((r) => [r.sym, r])), B = rowsOf(g, p).filter((r) => A.has(r.sym));
  if (!B.length) return null;
  const lr = B.map((r) => Math.log(1 + r.net) - Math.log(1 + A.get(r.sym).net)), ls = B.map((r) => Math.log(1 + r.netSlip) - Math.log(1 + A.get(r.sym).netSlip));
  return { coins: B.length, ratio: Math.exp(lr.reduce((s, x) => s + x, 0) / lr.length) - 1, better: lr.filter((x) => x > 1e-9).length, worse: lr.filter((x) => x < -1e-9).length,
    ratioSlip: Math.exp(ls.reduce((s, x) => s + x, 0) / ls.length) - 1, ddBetter: B.filter((r) => r.dd < A.get(r.sym).dd - 1e-9).length, ddWorse: B.filter((r) => r.dd > A.get(r.sym).dd + 1e-9).length };
}
// label-shuffle test: among trades `inSet` keeps, does the group a rule would block do worse than chance allows?
// Labels are shuffled NSH times WITHIN each two-year block, so the market mix stays fixed.
const NSH = 5000;
let SEED = 12345;
function perm(inSet, blocked) {
  const rnd = require('../rng.js').mulberry32(SEED += 7919);
  const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  const trim = (a) => { const q = a.slice().sort((x, y) => x - y), k = Math.floor(q.length * 0.02); return mean(q.slice(k, q.length - k)); };
  const U = (byG.none || []).filter((t) => t.ctx && t.t >= PER['2018–20'][0] && inSet(t.ctx)), lab = U.map((t) => !!blocked(t.ctx));
  const idx = BLOCKS.map((p) => U.map((t, i) => (inP(t.t, p) ? i : -1)).filter((i) => i >= 0));
  const gap = (L, f) => { const k = [], b = []; U.forEach((t, i) => (L[i] ? b : k).push(t.net)); return f(k) - f(b); };
  const res = { n: U.length, nb: lab.filter(Boolean).length };
  for (const [nm, f] of [['mean', mean], ['trim', trim]]) {
    const g0 = gap(lab, f); let ge = 0;
    for (let r = 0; r < NSH; r++) {
      const L = lab.slice();
      for (const I of idx) for (let i = I.length - 1; i > 0; i--) { const j = I[Math.floor(rnd() * (i + 1))], a = I[i]; [L[a], L[j]] = [L[j], L[a]]; }
      if (gap(L, f) >= g0) ge++;
    }
    res[nm] = { gap: g0, p: ge / NSH };
  }
  res.blocks = BLOCKS.map((p) => { const k = [], b = []; U.forEach((t, i) => { if (inP(t.t, p)) (lab[i] ? b : k).push(t.net); }); return { p, k: mean(k), b: mean(b), nk: k.length, nb: b.length }; });
  const by = {}; U.forEach((t, i) => { const o = by[t.sym] || (by[t.sym] = { k: [], b: [] }); (lab[i] ? o.b : o.k).push(t.net); });
  const C = Object.values(by).filter((o) => o.k.length >= 5 && o.b.length >= 5);
  res.coins = { better: C.filter((o) => mean(o.k) > mean(o.b)).length, of: C.length };
  return res;
}
const PT = {
  A: ['the SHIPPED gate: BTC < 50-day MA and the coin not +50%/30d', 'every no-gate trade', perm(() => true, (c) => !c.b50 && !c.lead)],
  C: ['ON TOP of the shipped gate: also BTC < its 149-bar MA (≈37h)', 'trades the shipped gate keeps', perm((c) => c.b50 || c.lead, (c) => !c.lead && !c.b149)],
  D: ['ON TOP of the shipped gate: also BTC < its 5-day MA', 'trades the shipped gate keeps', perm((c) => c.b50 || c.lead, (c) => !c.lead && !c.b5)],
  F: ['INSTEAD of the 50-day gate: BTC < its 149-bar MA', 'every no-gate trade', perm(() => true, (c) => !c.lead && !c.b149)],
  E: ['the leader rescue: with BTC < 50-day MA, coins NOT +50%/30d (kept = the rescued leaders)', 'no-gate trades with BTC < 50-day MA', perm((c) => !c.b50, (c) => !c.lead)],
};
const nCoins = new Set(R.rows.filter((r) => r.p === 'all').map((r) => r.sym)).size;
const T0 = byG.none || [];
say(`# liqbrk on 15m: is "BTC above its 50-day MA" the right gate there? (Nov 2026)\n`);
say(`Generated by \`research/liqbrk15m/report15.js\` from \`lab15.js run\` (${R.at.slice(0, 16).replace('T', ' ')} UTC). **Research only: the app, detector.js and the bot are unchanged.**\n`);
say(`**Question (user, Nov 2026):** on 15m (Chart, Compare, e.g. "top 50 gainers, last 3 months", or Alerts) should Liquidity Breakout still need BTC above its 50-day MA? Is it logical there, and what would be?\n`);
say(`**Method.**`);
say(`- Data: the user's 103-coin Compare list (\`CMP_DEFAULT\`), full Binance 15m history for every coin (BTC and ETH from 2017-08-17), up to 2026-11-05 16:00 UTC. ${nCoins} coins ran; skipped: ${R.skipped.join(', ') || 'none'}.`);
say(`- Rules: the shipped ones. Signals = first close over the 2-day high + over the 5-day SMA + over the 149-bar MA + volume ≥ 1.3× its 1-day average + clearing the high by ≥ 1×ATR. Exits = 4×ATR stop, close under the prior 1-day low, half at +3R.`);
say(`- Each gate changes ONE thing: which candles a buy may be taken on. The replica that runs them reproduces detector.js trade for trade on every coin (\`lab15.js parity\`), for both the shipped gate and no gate.`);
say(`- Stats are the Compare tab's own \`pathStats\` (read out of index.html): all-in per trade, fills at the signal close, 0.1% fee a side. "After slippage" adds 0.05% a side.`);
say(`- Pooled rows put every closed trade of every coin together. "PF w/o top 2%" drops the best 2% of trades: an edge that lives only in a handful of moonshots shows up there.`);
say(`- Two-year blocks are separate markets: 2018–20 (2018 bear, 2020 crash), 2021–22 (bull, then the 2022 bear), 2023–24 (recovery, bull), 2025–26 (to date).`);
say(`- The basket puts equal money in every coin listed ≥ 31 days before the block (no rebalancing): it is what running the rule on the whole list would have done, drawdown included.\n`);

// ---------------------------------------------------------------- verdict (numbers from the sections below)
{
  const P = (g, p = 'all') => pooled((byG[g] || []).filter((t) => inP(t.t, p))), M = (g, k, p = 'all') => med(rowsOf(g, p).map((r) => r[k]));
  const n0 = P('none'), s0 = P('ship'), b0 = P('both'), v = vsNone('ship', 'all'), vb = vsGate('both', 'ship', 'all');
  const k21 = [basketStats('2021–22', 'none'), basketStats('2021–22', 'ship')], k25 = [basketStats('2025–26', 'none'), basketStats('2025–26', 'ship')];
  const A = PT.A[2], C = PT.C[2], E = PT.E[2], F = PT.F[2], pv = (x) => x.p < 1 / NSH ? `< ${(100 / NSH).toFixed(2)}%` : x.p < 0.01 ? (x.p * 100).toFixed(2) + '%' : (x.p * 100).toFixed(1) + '%';
  say(`## Verdict\n`);
  say(`1. **Yes, keep the 50-day BTC gate on 15m. It is logical there, and it is the biggest single improvement 15m has.** With no gate, 15m Liquidity Breakout is break-even: `
    + `${n0.n.toLocaleString('en-US')} trades, PF ${f2(n0.pf)}, ${pct(n0.avg, 2)} a trade, median coin ${big(M('none', 'net'))} at a ${'−' + pp(M('none', 'dd'))} median drawdown. `
    + `The trades the gate blocks average ${pct(A.blocks.reduce((x, b) => x + b.b * b.nb, 0) / A.nb, 2)}, against ${pct(A.blocks.reduce((x, b) => x + b.k * b.nk, 0) / (A.n - A.nb), 2)} for the ones it keeps; `
    + `chance gives a gap that large ${pv(A.mean)} of the time, and kept beat blocked on ${A.coins.better} of ${A.coins.of} coins. `
    + `With the gate: PF ${f2(s0.pf)}, ${pct(s0.avg, 2)} a trade, median coin ${big(M('ship', 'net'))}, more money than no gate on ${v.better} coins (less on ${v.worse}).`);
  say(`2. **Why it is logical even though a 15m trade lasts about a day:** the 50-day MA is not a timing signal, it is the market's regime, and a breakout's odds depend on the regime at any horizon. `
    + `It earns its keep in the markets where BTC is weak: 2021–22 basket ${big(k21[0].ret)} → ${big(k21[1].ret)} (max DD −${pp(k21[0].dd)} → −${pp(k21[1].dd)}), 2025–26 ${big(k25[0].ret)} → ${big(k25[1].ret)}. `
    + `In the 2023–24 bull it changes little, and in 2018–20 (thin data: ${R.basket['2018–20'].coins} coins in that basket) it cost money. A placebo, the same gate fed BTC's state from another year, does not reproduce the gain overall or in either weak-BTC block (section 5), and a label shuffle that removes the same number of trades never matches it (section 2b): it is BTC's state, not just trading less.`);
  say(`3. **The faster BTC reads alone are NOT better** (BTC over its 5-day MA, its 149-bar MA, or up on the day): they let the bear markets through. `
    + `On its own, "BTC over its 149-bar MA" still lets through trades that average ${pct(F.blocks[1].k, 2)} in 2021–22. Loosening the gate ("either": a BTC bounce opens it) is worse than the shipped gate in every block.`);
  say(`4. **The one 15m change that tested well: ALSO require BTC above its own 149-bar MA** (BTC must pass the same 149 MA the coin must pass, ≈37h on 15m) — \`both\`. `
    + `It blocks another ${pp(C.nb / C.n)} of the trades the gate keeps, and those were worse in all four blocks (gap ${pct(C.mean.gap, 2)} a trade; chance ${pv(C.mean)} on the mean, ${pv(C.trim)} on the trimmed mean). `
    + `Every short MA from 1 to 5 days improves the whole-history result (a plateau); the 1-day and 149-bar versions improve every block, the 2–5-day ones lose a little in 2021–22. Result: ${pct(b0.avg, 2)} a trade (shipped ${pct(s0.avg, 2)}), PF ${f2(b0.pf)}, median coin ${big(M('both', 'net'))}, `
    + `more money than the shipped gate on ${vb.better} coins and less on ${vb.worse} (${pct(vb.ratio)} per coin, ${pct(vb.ratioSlip)} after slippage). `
    + `Coin by coin the evidence is thinner: the trades it blocks were worse than the ones it keeps on ${C.coins.better} of ${C.coins.of} coins. The gain is real but small: weigh it as a refinement, not a fix.`);
  say(`5. **The "coin +50% in 30 days" rescue does nothing on 15m**: the ${E.n - E.nb} rescued trades are no better than the ones blocked (chance ${pv(E.mean)}). It came from 2h/4h, where leaders make the best trades. On 15m it is harmless, being so rare, but it is not why the gate works.`);
  say(`6. **Even the best 15m version is weak, by your own bar** (win rate ≥ 30%, drawdown, consistency): win rate ${pp(b0.wr)}, PF without the top 2% of trades ${f2(b0.pf2)} (below 1: the profit lives in a few big trades), `
    + `median coin max drawdown −${pp(M('both', 'dd'))}, and after 0.05% slippage the median coin makes ${big(M('both', 'netSlip'))}. The Oct 2026 study found 4h makes more on the same coins. `
    + `**Use 15m to look, 4h to trade.**`);
  if (SC) {
    const ok = SC.out.filter((r) => r.g), sc = (g) => { const G = ok.map((r) => r.g[g]), T = G.flatMap((x) => x.trades.filter((t) => !t.open)); return { pr: G.filter((x) => x.net > 0).length, n: G.length, st: pooled(T) }; };
    const gone = []; for (const r of ok) { const kept = new Set(r.g.ship.trades.map((t) => t.t)); for (const t of r.g.none.trades) if (!kept.has(t.t) && !t.open) gone.push(t); }
    const a = sc('none'), b = sc('ship'), c = sc('both'), gs = pooled(gone);
    say(`7. **Your case** (today's Top 50 gainers, 15m, last 3 months, section 7): the gate helped there too. No gate: ${a.pr}/${a.n} coins profitable, PF ${f2(a.st.pf)}. `
      + `Shipped gate: ${b.pr}/${b.n}, PF ${f2(b.st.pf)}; the ${gs.n} trades it took away averaged ${pct(gs.avg, 2)} (win rate ${pp(gs.wr)}), most of them in the last two weeks as BTC slid under its 50-day MA. `
      + `\`both\`: ${c.pr}/${c.n}, PF ${f2(c.st.pf)}. But 3 months is ~8 trades a coin, so no row clears the app's 12-trade ✓ floor on any gate, and single coins there are one or two trades.\n`);
  }
}

// ---------------------------------------------------------------- 1. how often BTC is "on"
say(`## 1. How often the gate is open\n`);
say(`Share of 15m candles on which each BTC state held (BTC's own history):\n`);
row(['period', 'BTC > 50-day MA', 'BTC > 149-bar MA (≈37h)', 'BTC > 5-day MA', 'BTC up over 24h']); hr(5);
for (const p of ['all', ...BLOCKS, 'last 3m']) { const s = R.share[p]; row([p, pp(s.ma50), pp(s.ma149b), pp(s.ma5), pp(s.up24)]); }
say();

// ---------------------------------------------------------------- 2. the diagnostic
say(`## 2. Are 15m breakouts worse while BTC is under its 50-day MA?\n`);
say(`Every trade the system takes with NO gate (${T0.length.toLocaleString('en-US')} closed trades), split by where BTC and the coin stood at the entry candle. `
  + `This is the direct test of the gate's logic: if the trades it would block are as good as the ones it keeps, it only throws trades away.\n`);
const bucket = (name, f) => [name, f];
const BUCK = [
  bucket('BTC > 50d MA', (c) => c.b50), bucket('BTC < 50d MA, coin +50%/30d (rescued)', (c) => !c.b50 && c.lead), bucket('BTC < 50d MA, not a leader (BLOCKED by the shipped gate)', (c) => !c.b50 && !c.lead),
];
row(['entry state', 'period', 'trades', 'win rate', 'avg net / trade', 'PF', 'PF w/o top 2%']); hr(7);
for (const [nm, f] of BUCK) for (const p of ['all', ...BLOCKS]) {
  const s = pooled(T0.filter((t) => t.ctx && inP(t.t, p) && f(t.ctx)));
  row([p === 'all' ? `**${nm}**` : '', p, s.n, pp(s.wr), pct(s.avg, 2), f2(s.pf), f2(s.pf2)]);
}
say();
say(`The same trades by BTC's SHORT-term state (the horizon a ~1-day trade lives in):\n`);
row(['entry state', 'trades', 'win rate', 'avg net / trade', 'PF', 'PF w/o top 2%', 'blocks where it helps (of 4)']); hr(7);
const SHORT = [
  ['BTC > its 149-bar MA', (c) => c.b149], ['BTC < its 149-bar MA', (c) => !c.b149],
  ['BTC > 5-day MA', (c) => c.b5], ['BTC < 5-day MA', (c) => !c.b5],
  ['BTC 24h: below −2%', (c) => c.r1 < -0.02], ['BTC 24h: −2% … 0', (c) => c.r1 >= -0.02 && c.r1 < 0], ['BTC 24h: 0 … +2%', (c) => c.r1 >= 0 && c.r1 < 0.02], ['BTC 24h: above +2%', (c) => c.r1 >= 0.02],
  ['BTC 30d < −10%', (c) => c.r30 < -0.10], ['BTC 30d ≥ −10%', (c) => !(c.r30 < -0.10)],
];
const allS = pooled(T0.filter((t) => t.ctx));
for (const [nm, f] of SHORT) {
  const s = pooled(T0.filter((t) => t.ctx && f(t.ctx)));
  const helps = BLOCKS.filter((p) => { const a = pooled(T0.filter((t) => t.ctx && inP(t.t, p) && f(t.ctx))), b = pooled(T0.filter((t) => t.ctx && inP(t.t, p))); return a.n >= 30 && a.avg > b.avg; }).length;
  row([nm, s.n, pp(s.wr), pct(s.avg, 2), f2(s.pf), f2(s.pf2), `${helps} (above the block's average)`]);
}
row(['*every no-gate trade*', allS.n, pp(allS.wr), pct(allS.avg, 2), f2(allS.pf), f2(allS.pf2), '']);
say();

say(`### 2b. Chance or real? Label-shuffle tests\n`);
say(`For each split, the "blocked" and "kept" labels are shuffled ${NSH.toLocaleString('en-US')} times inside each two-year block, so the market mix stays fixed. `
  + `"Chance" is how often a shuffle gives a gap at least as large: under 1% means BTC's state really separates worse trades from better ones. `
  + `The 2%-trimmed mean drops the top and bottom 2% of trades first, so one moonshot cannot carry it.\n`);
row(['rule: block a trade when…', 'base', 'trades', 'blocked', 'kept − blocked, a trade', 'chance', 'trimmed gap · chance', ...BLOCKS.map((p) => `${p}: kept · blocked`), 'coins kept > blocked']); hr(7 + BLOCKS.length + 1);
for (const [k, [nm, base, r]] of Object.entries(PT)) {
  const pv = (x) => x.p < 1 / NSH ? `< ${(100 / NSH).toFixed(2)}%` : x.p < 0.01 ? (x.p * 100).toFixed(2) + '%' : (x.p * 100).toFixed(1) + '%';
  row([`**${k}.** ${nm}`, base, r.n, `${r.nb} (${pp(r.nb / r.n)})`, pct(r.mean.gap, 2), pv(r.mean), `${pct(r.trim.gap, 2)} · ${pv(r.trim)}`,
    ...r.blocks.map((b) => `${pct(b.k, 2)} · ${pct(b.b, 2)}${b.nb < 50 ? ` (${b.nb})` : ''}`), `${r.coins.better}/${r.coins.of}`]);
}
say();
say(`Coins counted where each side has ≥ 5 trades. A blocked count in brackets means fewer than 50 trades: read that cell as noise.\n`);

// ---------------------------------------------------------------- 3. the gates
say(`## 3. Every gate, whole history\n`);
row(['gate', 'trades', 'win rate', 'avg net / trade', 'PF', 'PF w/o top 2%', 'median coin net', 'median vs B&H', 'median max DD', 'coins profitable', 'vs no gate, per coin', 'after slippage, median net']); hr(12);
for (const g of MAIN) {
  const s = pooled(byG[g] || []), rs = rowsOf(g, 'all'), v = vsNone(g, 'all');
  row([`**${g}**: ${GD[g]}`, s.n, pp(s.wr), pct(s.avg, 2), f2(s.pf), f2(s.pf2), big(med(rs.map((r) => r.net))), big(med(rs.map((r) => r.edge))), '−' + pp(med(rs.map((r) => r.dd))),
    `${rs.filter((r) => r.net > 0).length}/${rs.length}`, g === 'none' ? '—' : `${pct(v.ratio)} (better on ${v.better}, worse on ${v.worse})`, big(med(rs.map((r) => r.netSlip)))]);
}
say();
say(`"vs no gate, per coin" = the geometric mean, over coins, of how much more money the gate's row ended with than the no-gate row.\n`);

say(`## 4. Every gate, block by block (pooled trades and the equal-weight basket)\n`);
for (const p of BLOCKS) {
  const B0 = basketStats(p, 'none');
  say(`### ${p}${B0 ? ` (basket: ${B0.coins} coins)` : ''}\n`);
  row(['gate', 'trades', 'win rate', 'avg net / trade', 'PF', 'PF w/o top 2%', 'basket return', 'basket max DD', 'vs no gate, per coin']); hr(9);
  for (const g of MAIN) {
    const s = pooled((byG[g] || []).filter((t) => inP(t.t, p))), b = basketStats(p, g), v = vsNone(g, p);
    row([g, s.n, pp(s.wr), pct(s.avg, 2), f2(s.pf), f2(s.pf2), b ? big(b.ret) : '—', b ? '−' + pp(b.dd) : '—', g === 'none' || !v ? '—' : `${pct(v.ratio)} (${v.better}↑ ${v.worse}↓)`]);
  }
  say();
}

// ---------------------------------------------------------------- 5. placebo
say(`## 5. Placebo: is it BTC's state that matters, or just trading less?\n`);
say(`The shipped gate run with BTC's 50-day-MA state taken from a different year (±1, ±2, ±3 years, wrapping around BTC's history). `
  + `It is open as often and for as long as the real one, and the coin's own leader rescue stays real; only the link to the market the trade is in is broken. `
  + `If the real gate is no better than these, its effect on 15m is just "fewer trades".\n`);
row(['block', 'measure', 'no gate', 'shipped gate', 'placebos (median · range)', 'real beats placebos']); hr(6);
for (const p of ['all', ...BLOCKS]) {
  for (const [nm, f] of [['avg net / trade', (g) => pooled((byG[g] || []).filter((t) => inP(t.t, p))).avg], ['PF w/o top 2%', (g) => pooled((byG[g] || []).filter((t) => inP(t.t, p))).pf2],
    ...(p === 'all' ? [] : [['basket return', (g) => (basketStats(p, g) || {}).ret], ['basket max DD', (g) => -(basketStats(p, g) || {}).dd]])]) {
    const pv = PLC.map(f), real = f('ship');
    const fmt = nm.includes('PF') ? f2 : nm.includes('DD') ? (x) => '−' + pp(-x) : nm.includes('basket') ? big : (x) => pct(x, 2);
    row([nm === 'avg net / trade' ? `**${p}**` : '', nm, fmt(f('none')), fmt(real), `${fmt(med(pv))} · ${fmt(Math.min(...pv))} … ${fmt(Math.max(...pv))}`, `${pv.filter((x) => real > x).length}/${pv.length}`]);
  }
}
say();

// ---------------------------------------------------------------- 6. follow-up on `both`
if (AND.length > 2) {
  say(`## 6. Follow-up: the short-term BTC trend on top of the 50-day gate\n`);
  say(`Added AFTER the first run showed \`both\` (BTC > 50-day MA AND BTC > its 149-bar MA) ahead of the shipped gate in every block, to test it the way a lucky result would fail: `
    + `(a) the same AND with other short MA lengths, (b) a placebo that keeps the real 50-day gate but takes BTC's 149-bar state from another year, `
    + `(c) coin by coin against the SHIPPED gate, with slippage.\n`);
  say(`### 6a. Plateau: the short MA's length\n`);
  row(['BTC must also be above its…', 'measure', 'all', ...BLOCKS]); hr(3 + BLOCKS.length);
  for (const g of AND) {
    const cell = (p, f) => f(pooled((byG[g] || []).filter((t) => inP(t.t, p))));
    row([`**${LEN[g]}**`, 'avg net / trade', ...['all', ...BLOCKS].map((p) => pct(cell(p, (s) => s.avg), 2))]);
    row(['', 'PF w/o top 2%', ...['all', ...BLOCKS].map((p) => f2(cell(p, (s) => s.pf2)))]);
    row(['', 'basket return · max DD', '', ...BLOCKS.map((p) => { const b = basketStats(p, g); return b ? `${big(b.ret)} · −${pp(b.dd)}` : '—'; })]);
  }
  say();
  say(`### 6b. Placebo for the short-term part\n`);
  say(`Read with care: BTC's shifted 149-bar state is on about half the time and unrelated to the real one, so these placebos remove about half the trades the shipped gate keeps, `
    + `while the real check removes about a tenth (BTC is usually above both averages at once). Removing half the trades at random leaves the average trade where it was but widens its spread, so this is a loose control. `
    + `The count-matched control is the label shuffle in section 2b (test C).\n`);
  row(['block', 'measure', 'shipped gate', 'both (real 149-bar state)', 'placebos (median · range)', 'real beats placebos']); hr(6);
  for (const p of ['all', ...BLOCKS]) {
    for (const [nm, f] of [['trades', (g) => pooled((byG[g] || []).filter((t) => inP(t.t, p))).n], ['avg net / trade', (g) => pooled((byG[g] || []).filter((t) => inP(t.t, p))).avg], ['PF w/o top 2%', (g) => pooled((byG[g] || []).filter((t) => inP(t.t, p))).pf2],
      ...(p === 'all' ? [] : [['basket return', (g) => (basketStats(p, g) || {}).ret]])]) {
      const pv = APLC.map(f), real = f('both');
      const fmt = nm === 'trades' ? (x) => String(Math.round(x)) : nm.includes('PF') ? f2 : nm.includes('basket') ? big : (x) => pct(x, 2);
      if (nm === 'trades') { row([`**${p}**`, nm, fmt(f('ship')), fmt(real), `${fmt(med(pv))} · ${fmt(Math.min(...pv))} … ${fmt(Math.max(...pv))}`, '']); continue; }
      row(['', nm, fmt(f('ship')), fmt(real), `${fmt(med(pv))} · ${fmt(Math.min(...pv))} … ${fmt(Math.max(...pv))}`, `${pv.filter((x) => real > x).length}/${pv.length}`]);
    }
  }
  say();
  say(`### 6c. Coin by coin: \`both\` against the shipped gate\n`);
  row(['block', 'coins', 'more money', 'less money', 'per coin, average', 'per coin after slippage', 'shallower max DD', 'deeper max DD']); hr(8);
  for (const p of ['all', ...BLOCKS, 'last 4y']) {
    const v = vsGate('both', 'ship', p); if (!v) continue;
    row([p, v.coins, v.better, v.worse, pct(v.ratio), pct(v.ratioSlip), v.ddBetter, v.ddWorse]);
  }
  say();
}

// ---------------------------------------------------------------- 7. the user's scenario
if (SC) {
  const ok = SC.out.filter((r) => r.g), iso = (t) => new Date(t * 1000).toISOString().slice(0, 10);
  say(`## 7. The user's case: today's Top 50 gainers, 15m, last 3 months (Compare date mode)\n`);
  say(`List built exactly as the Compare tab's **Top 50 gainers** button does, at ${new Date(SC.list.at).toISOString().slice(0, 16).replace('T', ' ')} UTC: `
    + `${SC.list.syms.slice(0, 8).map((s, i) => s.replace('USDT', '') + ' ' + pct(SC.list.chg[i])).join(', ')} … down to ${pct(SC.list.chg[SC.list.chg.length - 1])} `
    + `(a red day: BTC itself was ${pct(SC.list.chg[SC.list.syms.indexOf('BTCUSDT')])} and only ${SC.list.chg.filter((x) => x > 0).length} of the 50 were up). `
    + `Window ${iso(SC.from)} → ${iso(SC.to)}; BTC was above its 50-day MA on **${pp(SC.btcShare.ma50)}** of those 15m candles. `
    + `${ok.length} coins ran${SC.out.length - ok.length ? ` (${SC.out.filter((r) => !r.g).map((r) => r.sym.replace('USDT', '') + (r.short != null ? ` only ${r.short} bars` : ' no data')).join(', ')} skipped)` : ''}; `
    + `the shipped gate's trades match detector.js on ${ok.filter((r) => r.parity).length}/${ok.length}.\n`);
  row(['gate', 'trades', 'win rate', 'avg net / trade', 'PF', 'coins profitable', 'average coin net', 'median coin net', 'median max DD', 'rows ✓ (app test)']); hr(10);
  for (const g of [...MAIN, ...AND.filter((g) => g !== 'ship' && g !== 'both')]) {
    if (!ok[0].g[g]) continue;
    const G = ok.map((r) => r.g[g]), T = G.flatMap((x) => x.trades.filter((t) => !t.open)), act = G.filter((x) => x.trades.length);
    const okRow = (e) => e.net > 0 && e.edge > 0 && e.pf >= 1.3 && e.wr >= 0.30 && e.dd <= 0.60 && e.n >= 12 && e.pos >= 0.70;
    const st = pooled(T);
    row([g, T.length, pp(st.wr), pct(st.avg, 2), f2(st.pf), `${G.filter((x) => x.net > 0).length}/${G.length}`, big(G.reduce((s, x) => s + x.net, 0) / G.length),
      big(med(G.map((x) => x.net))), '−' + pp(med(G.map((x) => x.dd))), G.filter(okRow).length]);
  }
  say();
  // the trades the shipped gate took away in these 3 months, and when
  const gone = []; for (const r of ok) { const kept = new Set(r.g.ship.trades.map((t) => t.t)); for (const t of r.g.none.trades) if (!kept.has(t.t) && !t.open) gone.push({ sym: r.sym, ...t }); }
  const days = {}; for (const t of gone) { const d = iso(t.t).slice(5); days[d] = (days[d] || 0) + 1; }
  const gs = pooled(gone);
  say(`The shipped gate took away **${gs.n} trades** in these 3 months; they averaged **${pct(gs.avg, 2)}** (win rate ${pp(gs.wr)}). They cluster where BTC was under its 50-day MA: `
    + Object.entries(days).sort().map(([d, n]) => `${d} (${n})`).join(', ') + `. `
    + `The 3-month window cannot rank coins: with ~8 trades a coin, a coin's row is one or two trades. Coins chosen for being today's gainers also flatter any rule that was long into today. Read the pooled rows, not single coins.\n`);
  say(`✓ = the app's own test (net > 0, beats holding, PF ≥ 1.3, win rate ≥ 30%, max DD ≤ 60%, ≥ 12 closed trades, ≥ 70% of windows profitable). `
    + `BTC's own row: the app hands BTC only its fetched candles as its gate input (about 12 days before a 3-month 15m window), so in the app BTC's row keeps its gate shut for the first ~38 days; here it has full history.\n`);
}

console.log(out.join('\n'));
