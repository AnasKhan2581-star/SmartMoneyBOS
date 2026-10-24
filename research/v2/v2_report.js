// Version-2 study report.   node research/v2/v2_report.js > research/v2/RESULTS_v2_2026-10.md
'use strict';
const V = require('./v2_lab.js');
const { STRATS, runOne, pooled, portfolio, btcHold, COINS, DATA, load4h } = V;

const pc = x => !isFinite(x) ? '—' : (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(0) + '%';
const pp = x => !isFinite(x) ? '—' : (x * 100).toFixed(0) + '%';
const f2 = x => !isFinite(x) ? '∞' : x.toFixed(2);
const med = a => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN; };
const row = c => '| ' + c.join(' | ') + ' |';
const head = c => row(c) + '\n' + row(c.map(() => '---'));
const out = []; const say = s => out.push(s);
const day = t => new Date(t * 1000).toISOString().slice(0, 10);

// ---- the 5 random coins: seeded, from alert coins with 4h history since before mid-2021 (so both cycles exist)
const SEED = 20261024;
const rnd = (() => { let a = SEED; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; })();
const OLD = COINS.filter(c => { const d = load4h(c); return d && d[0].time <= Date.UTC(2021, 5, 1) / 1000; });
const pool = OLD.slice(), PICK = [];
while (PICK.length < 5) PICK.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);

const KEYS = ['s1', 's2', 's3', 's4', 's5', 'v1'];
say(`# Version 2 research — five new swing strategies vs the current liqbrk (${new Date().toISOString().slice(0, 10)})\n`);
say(`**Research only — nothing in the app, the bot or the alerts changed.** All strategies run on 4h candles, spot, long only, `
  + `signal at a candle close, entry at the next open, 0.05% slippage + 0.1% fee per side, all-in per coin. Every strategy is judged from `
  + `the same first candle of each coin (after a common warm-up). The engine used here reproduces the shipped liqbrk trade-for-trade `
  + `(\`node research/v2/v2_lab.js parity\`). Cycle A = trades entered 2020-01-01 → 2022-12-31 (bull + the 2022 bear), cycle B = 2023 → today.\n`);

say(`## 1. The five strategies (simplest → toughest)\n`);
for (const k of ['s1', 's2', 's3', 's4', 's5']) {
  say(`**${STRATS[k].name}** — level ${STRATS[k].level}`);
  for (const r of STRATS[k].rules) say(`- ${r}`);
  say('');
}
say(`**v1 — current liqbrk (reference):** close above the prior 2-day high by ≥ 1×ATR, above the 5-day SMA and the 149-candle MA, volume ≥ 1.3×, `
  + `BTC above its 50-day MA (or coin +50% in 30 days) · stop 4×ATR · ½ at +3R · rest exits on a close below the prior 1-day low.\n`);

say(`## 2. The test coins\n`);
say(`5 coins drawn at random (seed ${SEED}) from the ${OLD.length} alert coins whose 4h history starts before June 2021 — a coin listed last year `
  + `would give each strategy a handful of trades and no bear market to survive. **Drawn: ${PICK.join(', ')}.**\n`);

say(`## 3. How "most consistent" is decided (fixed before running)\n`);
say(`Five measures, each ranked across the five new strategies (1 = best); the lowest average rank wins, ties go to M2. A strategy needs `
  + `**at least 30 trades pooled over the 5 coins** to be eligible — fewer cannot show consistency.\n`);
say(`- **M1** share of coin × cycle cells that did not lose money (net ≥ 0) — consistent across coins AND across bull/bear`);
say(`- **M2** pooled profit factor after removing the best 2% of trades — does it make money without its jackpots`);
say(`- **M3** median window stability — share of sliding 35% windows that were profitable`);
say(`- **M4** median max drawdown (smaller is better)`);
say(`- **M5** the worst coin's total return (higher is better)\n`);

// ---- run everything on the 5 coins
const R = {};
for (const k of KEYS) R[k] = PICK.map(c => runOne(k, c)).filter(Boolean);
say(`## 4. Results on the 5 coins\n`);
say(head(['strategy', 'trades', 'win rate', 'PF', 'PF w/o top 2%', 'median net', 'median vs B&H', 'median max DD', 'median stable', 'cells not losing (M1)', 'worst coin', 'avg days held']));
const M = {};
for (const k of KEYS) {
  const rows = R[k], p = pooled(rows);
  const cells = rows.flatMap(r => [r.A, r.B].filter(x => x.n > 0 || true).map(x => x.net >= 0));
  const cellsWithData = rows.flatMap(r => [r.first < Date.UTC(2023, 0, 1) / 1000 ? r.A : null, r.B].filter(Boolean));
  const m1 = cellsWithData.filter(x => x.net >= 0).length / cellsWithData.length;
  const held = rows.flatMap(r => r.trades.map(t => (t.exitIdx - t.entryIdx) / 6));
  M[k] = { m1, m2: p.pfTop, m3: med(rows.map(r => r.stab)), m4: med(rows.map(r => r.dd)), m5: Math.min(...rows.map(r => r.net)), n: p.n };
  say(row([STRATS[k].name, p.n, pp(p.wr), f2(p.pf), f2(p.pfTop), pc(med(rows.map(r => r.net))), pc(med(rows.map(r => r.edge))),
    pc(-M[k].m4), pp(M[k].m3), `${cellsWithData.filter(x => x.net >= 0).length}/${cellsWithData.length}`, pc(M[k].m5), med(held).toFixed(1)]));
}
say(`\n**Per coin** (net return over the coin's history · trades · max drawdown)\n`);
say(head(['strategy', ...PICK]));
for (const k of KEYS) say(row([STRATS[k].name, ...PICK.map(c => { const r = R[k].find(x => x.coin === c); return r ? `${pc(r.net)} · ${r.n} · ${pc(-r.dd)}` : '—'; })]));
say(`\n**Per coin and cycle** (net return in cycle A / cycle B)\n`);
say(head(['strategy', ...PICK]));
for (const k of KEYS) say(row([STRATS[k].name, ...PICK.map(c => { const r = R[k].find(x => x.coin === c); return r ? `${r.first < Date.UTC(2023, 0, 1) / 1000 ? pc(r.A.net) : '—'} / ${pc(r.B.net)}` : '—'; })]));

// ---- ranks
const NEW = ['s1', 's2', 's3', 's4', 's5'];
const elig = NEW.filter(k => M[k].n >= 30);
const rankOf = (key, better) => { const vals = elig.map(k => M[k][key]); return Object.fromEntries(elig.map(k => [k, 1 + vals.filter(v => better(v, M[k][key])).length])); };
const RK = { m1: rankOf('m1', (a, b) => a > b), m2: rankOf('m2', (a, b) => a > b), m3: rankOf('m3', (a, b) => a > b), m4: rankOf('m4', (a, b) => a < b), m5: rankOf('m5', (a, b) => a > b) };
const avgRank = Object.fromEntries(elig.map(k => [k, (RK.m1[k] + RK.m2[k] + RK.m3[k] + RK.m4[k] + RK.m5[k]) / 5]));
const order = elig.slice().sort((a, b) => avgRank[a] - avgRank[b] || M[b].m2 - M[a].m2);
const WIN = order[0];
say(`\n## 5. Consistency ranking\n`);
say(head(['strategy', 'trades', 'M1 cells not losing', 'M2 PF w/o top 2%', 'M3 stability', 'M4 max DD', 'M5 worst coin', 'average rank']));
for (const k of NEW) {
  const e = elig.includes(k);
  say(row([STRATS[k].name, M[k].n, `${pp(M[k].m1)}${e ? ` (#${RK.m1[k]})` : ''}`, `${f2(M[k].m2)}${e ? ` (#${RK.m2[k]})` : ''}`, `${pp(M[k].m3)}${e ? ` (#${RK.m3[k]})` : ''}`,
    `${pc(-M[k].m4)}${e ? ` (#${RK.m4[k]})` : ''}`, `${pc(M[k].m5)}${e ? ` (#${RK.m5[k]})` : ''}`, e ? `**${avgRank[k].toFixed(1)}**` : 'not eligible (< 30 trades)']));
}
say(`\nFor comparison, v1 on the same coins: M1 ${pp(M.v1.m1)}, M2 ${f2(M.v1.m2)}, M3 ${pp(M.v1.m3)}, M4 ${pc(-M.v1.m4)}, M5 ${pc(M.v1.m5)} (${M.v1.n} trades).\n`);
say(`**Most consistent: ${STRATS[WIN].name}** → this becomes **version 2**.\n`);

// ---- version 2 on all coins
say(`## 6. Version 2 (${STRATS[WIN].name}) on all ${COINS.length} alert coins, next to v1\n`);
const all2 = COINS.map(c => runOne(WIN, c)).filter(Boolean), all1 = COINS.map(c => runOne('v1', c)).filter(Boolean);
const P2 = pooled(all2), P1 = pooled(all1);
const A = (rows, sel) => rows.map(r => r[sel]);
say(head(['', 'coins', 'trades', 'win rate', 'PF', 'PF w/o top 2%', 'median net', 'median vs B&H', 'median max DD', 'median stable', 'coins net > 0', 'cycle A cells not losing', 'cycle B cells not losing']));
for (const [nm, rows, P] of [['**version 2**', all2, P2], ['v1 (current)', all1, P1]]) {
  const aCells = rows.filter(r => r.first < Date.UTC(2023, 0, 1) / 1000);
  say(row([nm, rows.length, P.n, pp(P.wr), f2(P.pf), f2(P.pfTop), pc(med(A(rows, 'net'))), pc(med(A(rows, 'edge'))), pc(-med(A(rows, 'dd'))), pp(med(A(rows, 'stab'))),
    `${rows.filter(r => r.net > 0).length}/${rows.length}`, `${aCells.filter(r => r.A.net >= 0).length}/${aCells.length}`, `${rows.filter(r => r.B.net >= 0).length}/${rows.length}`]));
}
const both = all2.map(r => ({ r2: r, r1: all1.find(x => x.coin === r.coin) })).filter(x => x.r1);
say(`\nHead-to-head per coin: version 2 made more money on **${both.filter(x => x.r2.net > x.r1.net).length}/${both.length}** coins and had the smaller max drawdown on **${both.filter(x => x.r2.dd < x.r1.dd).length}/${both.length}**.\n`);
say(head(['coin', 'listed', 'v2 trades', 'v2 net', 'v2 vs B&H', 'v2 max DD', 'v2 stable', '│', 'v1 trades', 'v1 net', 'v1 vs B&H', 'v1 max DD', 'v1 stable']));
for (const { r2, r1 } of both.sort((a, b) => b.r2.net - a.r2.net))
  say(row([r2.coin, day(r2.first), r2.n, pc(r2.net), pc(r2.edge), pc(-r2.dd), pp(r2.stab), '│', r1.n, pc(r1.net), pc(r1.edge), pc(-r1.dd), pp(r1.stab)]));

// ---- portfolio: one pot, all coins competing for N slots
say(`\n## 7. One pot of money across all ${COINS.length} coins (what an account would have done)\n`);
say(`Each new trade gets equity ÷ N if a slot is free (otherwise skipped; ties go to the stronger signal), marked to market every 4h. `
  + `**Hindsight warning:** this coin list was assembled in October 2026 from coins that recently ran or ranked well, so every row here is flattered; `
  + `compare the rows with each other, not with what to expect.\n`);
say(head(['strategy', 'from', 'slots N', 'trades taken', 'skipped (slots full)', 'end value', 'CAGR', 'max DD', 'avg % invested', 'worst year']));
const PR = {};
for (const [nm, k] of [['version 2', WIN], ['v1 (current)', 'v1']]) for (const start of [Date.UTC(2020, 0, 1) / 1000, Date.UTC(2023, 0, 1) / 1000]) for (const N of [5, 10]) {
  const r = portfolio(k, COINS, N, start); PR[`${k}|${start}|${N}`] = r;
  const w = Object.entries(r.yearly).sort((a, b) => a[1] - b[1])[0];
  say(row([nm, day(start).slice(0, 4), N, r.taken, r.skipped, r.E.toFixed(1) + '×', pc(r.cagr), pc(-r.dd), pp(r.expo), `${w[0]} ${pc(w[1])}`]));
}
for (const start of [Date.UTC(2020, 0, 1) / 1000, Date.UTC(2023, 0, 1) / 1000]) { const b = btcHold(start);
  say(row(['BTC buy & hold', day(start).slice(0, 4), '—', '—', '—', b.E.toFixed(1) + '×', pc(b.cagr), pc(-b.dd), '100%', (() => { const w = Object.entries(b.yearly).sort((x, y) => x[1] - y[1])[0]; return `${w[0]} ${pc(w[1])}`; })()])); }
say(`\n**Year by year (from 2020, 10 slots)**\n`);
const bh = btcHold(Date.UTC(2020, 0, 1) / 1000), y2 = PR[`${WIN}|${Date.UTC(2020, 0, 1) / 1000}|10`].yearly, y1 = PR[`v1|${Date.UTC(2020, 0, 1) / 1000}|10`].yearly;
say(head(['year', 'version 2', 'v1 (current)', 'BTC buy & hold']));
for (const y of Object.keys(bh.yearly)) say(row([y, pc(y2[y]), pc(y1[y]), pc(bh.yearly[y])]));

// ---- costs
say(`\n## 8. Cost check — version 2 with 0.2% slippage per side (small coins, market orders)\n`);
V.setSlip(0.002);
const c2 = COINS.map(c => runOne(WIN, c)).filter(Boolean), c1 = COINS.map(c => runOne('v1', c)).filter(Boolean);
say(head(['', 'PF', 'PF w/o top 2%', 'median net', 'coins net > 0']));
say(row(['version 2 @ 0.2%', f2(pooled(c2).pf), f2(pooled(c2).pfTop), pc(med(A(c2, 'net'))), `${c2.filter(r => r.net > 0).length}/${c2.length}`]));
say(row(['v1 @ 0.2%', f2(pooled(c1).pf), f2(pooled(c1).pfTop), pc(med(A(c1, 'net'))), `${c1.filter(r => r.net > 0).length}/${c1.length}`]));
V.setSlip(0.0005);
// ---- improvement checks
say(`\n## 9. Two improvement checks\n`);
say(`**a) Does coin age matter?** Coins listed before 2023 (they have lived through a bear market) vs coins listed since.\n`);
say(head(['strategy', 'group', 'coins', 'trades', 'PF', 'PF w/o top 2%', 'median net', 'median max DD', 'coins net > 0']));
const OLDC = new Set(COINS.filter(c => load4h(c)[0].time < Date.UTC(2023, 0, 1) / 1000));
for (const [nm, rows] of [['version 2', all2], ['v1 (current)', all1]]) for (const [g, f] of [['listed before 2023', r => OLDC.has(r.coin)], ['listed 2023 or later', r => !OLDC.has(r.coin)]]) {
  const rs = rows.filter(f), p = pooled(rs);
  say(row([nm, g, rs.length, p.n, f2(p.pf), f2(p.pfTop), pc(med(A(rs, 'net'))), pc(-med(A(rs, 'dd'))), `${rs.filter(r => r.net > 0).length}/${rs.length}`]));
}
say(`\n**b) Run both, half the money each.** v1 and version 2 were strong in different years (section 7), so two independent half-pots `
  + `(10 slots each, never rebalanced) may be steadier than either alone.\n`);
say(head(['book', 'from', 'end value', 'CAGR', 'max DD', 'worst year']));
for (const start of [Date.UTC(2020, 0, 1) / 1000, Date.UTC(2023, 0, 1) / 1000]) {
  const a = PR[`${WIN}|${start}|10`], b = PR[`v1|${start}|10`];
  const m = new Map(b.curve.map(([t, e]) => [t, e]));
  const comb = a.curve.map(([t, e]) => [t, 0.5 * e + 0.5 * (m.get(t) ?? 1)]);
  let pk = 0, dd = 0; for (const [, e] of comb) { pk = Math.max(pk, e); dd = Math.max(dd, (pk - e) / pk); }
  const E = comb[comb.length - 1][1], yrs = (comb[comb.length - 1][0] - comb[0][0]) / 31557600;
  const yr = {}; let prevE = 1, py = new Date(comb[0][0] * 1000).getUTCFullYear(), lastE = 1;
  for (const [t, e] of comb) { const y = new Date(t * 1000).getUTCFullYear(); if (y !== py) { prevE = lastE; py = y; } yr[y] = e / prevE - 1; lastE = e; }
  const w = Object.entries(yr).sort((x, y) => x[1] - y[1])[0];
  for (const [nm, r] of [['version 2 alone', a], ['v1 alone', b]]) { const ww = Object.entries(r.yearly).sort((x, y) => x[1] - y[1])[0];
    say(row([nm, day(start).slice(0, 4), r.E.toFixed(1) + '×', pc(r.cagr), pc(-r.dd), `${ww[0]} ${pc(ww[1])}`])); }
  say(row(['**half v1 + half version 2**', day(start).slice(0, 4), E.toFixed(1) + '×', pc(Math.pow(E, 1 / yrs) - 1), pc(-dd), `${w[0]} ${pc(w[1])}`]));
}

console.log(out.join('\n'));
