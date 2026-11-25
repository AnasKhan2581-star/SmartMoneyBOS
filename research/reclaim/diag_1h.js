// Checks on the one result that beat random times in both halves: the chosen rules on 1h, the 103-coin list.
//   node research/reclaim/diag_1h.js [gross|slip2]   → research/cache/reclaim/diag1h_<costs>.json (+ a summary on stdout)
'use strict';
const fs = require('fs'), path = require('path');
const L = require('./reclaim_lab.js');
const { loadTf, LIST103, DIR } = require('./data.js');
const COST = ['gross', 'slip2'].find((m) => process.argv.includes(m)) || 'spot';
const spot = JSON.parse(fs.readFileSync(path.join(DIR, 'run_spot.json')));
const FINAL = spot.choice.final, TF = '1h';
const BIG = new Set(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT', 'DOGEUSDT', 'ADAUSDT', 'TRXUSDT']);
const pct = (x) => (x * 100).toFixed(2) + '%';
function trades(P) {
  const out = [];
  for (const sym of LIST103()) {
    const raw = loadTf(sym, TF); if (!raw || raw.n < 400) continue;
    const S = L.prep(sym, TF, raw), tr = L.simulate(S, L.detect(S, P), P, sym);
    for (const t of tr) out.push({ sym, t: t.t, ret: t.ret, half: t.i0 < S.splitIdx ? 1 : 2, why: t.why, risk: t.risk, bars: t.i1 - t.i0 });
  }
  return out;
}
const st = (a) => { const p = L.pool(a.map((t) => t.ret)); return p.n ? `${String(p.n).padStart(4)} avg ${pct(p.avg).padStart(7)} med ${pct(p.med).padStart(7)} wr ${(p.wr * 100).toFixed(0)}% pf ${p.pf.toFixed(2)}` : '   0'; };
const trim = (a, q) => { const s = a.map((t) => t.ret).sort((x, y) => x - y), k = Math.floor(s.length * q); const r = s.slice(0, s.length - k); return r.reduce((x, y) => x + y, 0) / r.length; };
const tr = trades(FINAL), res = { cost: COST };
console.log(`chosen rules, 1h, 103 coins, ${COST}: all ${st(tr)}`);
for (const h of [1, 2]) console.log(`  half ${h}: ${st(tr.filter((t) => t.half === h))} · without the best 2%: ${pct(trim(tr.filter((t) => t.half === h), 0.02))}, best 5%: ${pct(trim(tr.filter((t) => t.half === h), 0.05))}`);
const yrs = {};
for (const t of tr) (yrs[new Date(t.t * 1000).getUTCFullYear()] = yrs[new Date(t.t * 1000).getUTCFullYear()] || []).push(t);
console.log('  by year:', Object.entries(yrs).map(([y, a]) => `${y} ${a.length}/${pct(L.pool(a.map((t) => t.ret)).avg)}`).join(' · '));
res.years = Object.fromEntries(Object.entries(yrs).map(([y, a]) => [y, L.pool(a.map((t) => t.ret))]));
console.log(`  big caps (${[...BIG].map((s) => s.replace('USDT', '')).join(' ')}): ${st(tr.filter((t) => BIG.has(t.sym)))} · the rest: ${st(tr.filter((t) => !BIG.has(t.sym)))}`);
const by = {};
for (const t of tr) (by[t.sym] = by[t.sym] || []).push(t.ret);
const sums = Object.entries(by).map(([s, a]) => [s, a.reduce((x, y) => x + y, 0), a.length]).sort((a, b) => b[1] - a[1]);
const tot = sums.reduce((s, x) => s + x[1], 0);
console.log(`  sum of trade returns ${pct(tot)}; top 5 coins ${sums.slice(0, 5).map(([s, v, n]) => `${s.replace('USDT', '')} ${pct(v)} (${n})`).join(', ')}; without them the avg is ${pct((tot - sums.slice(0, 5).reduce((s, x) => s + x[1], 0)) / (tr.length - sums.slice(0, 5).reduce((s, x) => s + x[2], 0)))}`);
console.log(`  coins with a positive sum: ${sums.filter((x) => x[1] > 0).length} of ${sums.length}`);
console.log('  exits:', Object.entries(tr.reduce((m, t) => ((m[t.why] = (m[t.why] || 0) + 1), m), {})).map(([k, v]) => `${k} ${v}`).join(', '), `· median hold ${tr.map((t) => t.bars).sort((a, b) => a - b)[tr.length >> 1]}h · median stop ${pct(tr.map((t) => t.risk).sort((a, b) => a - b)[tr.length >> 1])}`);
res.byCoin = sums; res.all = L.pool(tr.map((t) => t.ret));
// the neighbours: one rule moved at a time from the chosen rules
const NB = { 'chosen': {}, 'D 3': { D: 3 }, 'D 8': { D: 8 }, 'K 12': { K: 12 }, 'M 50': { M: 50 }, 'R 3×K': { Rx: 3 }, 'zone ⅓': { f: 1 / 3 }, 'T 100': { T: 100 },
  'unmitigated': { unmit: true }, 'no sweep': { sweep: false }, 'confirm': { entry: 'confirm' }, 'ride': { exit: 'ride' }, 'E 150': { E: 150 }, 'E 2000': { E: 2000 } };
res.nb = {};
for (const [nm, ov] of Object.entries(NB)) {
  const a = nm === 'chosen' ? tr : trades(Object.assign({}, FINAL, ov));
  res.nb[nm] = { h1: L.pool(a.filter((t) => t.half === 1).map((t) => t.ret)), h2: L.pool(a.filter((t) => t.half === 2).map((t) => t.ret)) };
  console.log(`  ${nm.padEnd(12)} half 1 ${st(a.filter((t) => t.half === 1))} | half 2 ${st(a.filter((t) => t.half === 2))}`);
}
fs.writeFileSync(path.join(DIR, `diag1h_${COST}.json`), JSON.stringify(res));
