// The 1h results split by the market: BTC's close at the fill against its 50-day average (the gate liqbrk ships with)
// and its 200-day average. Exploratory: both coin lists had already been seen when this split was added.
//   node research/reclaim/regime_1h.js   → research/cache/reclaim/regime1h.json (+ a summary)
'use strict';
const fs = require('fs'), path = require('path');
const L = require('./reclaim_lab.js');
const { loadTf, LIST103, DIR } = require('./data.js');
const spot = JSON.parse(fs.readFileSync(path.join(DIR, 'run_spot.json')));
const SETS = { final: spot.choice.final, big: Object.assign({}, spot.choice.final, { D: 8 }) };
const LISTS = { broad: LIST103(), fresh: JSON.parse(fs.readFileSync(path.join(DIR, 'fresh', 'list.json'))) };
const btc = loadTf('BTCUSDT', '1h', 'broad'), bt = new Map();
{ let s50 = 0, s200 = 0; for (let i = 0; i < btc.n; i++) {
  s50 += btc.C[i]; s200 += btc.C[i]; if (i >= 1200) s50 -= btc.C[i - 1200]; if (i >= 4800) s200 -= btc.C[i - 4800];
  bt.set(btc.T[i], { c: btc.C[i], m50: i >= 1199 ? s50 / 1200 : null, m200: i >= 4799 ? s200 / 4800 : null });
} }
const out = {};
for (const [ln, list] of Object.entries(LISTS)) for (const [sn, P] of Object.entries(SETS)) {
  const tr = [];
  for (const sym of list) {
    const raw = loadTf(sym, '1h', ln); if (!raw || raw.n < 400) continue;
    const S = L.prep(sym, '1h', raw);
    for (const t of L.simulate(S, L.detect(S, P), P, sym)) {
      const b = bt.get(t.t - 3600) || bt.get(t.t);                  // BTC's last closed hour before the fill candle
      if (!b || b.m200 === null) continue;
      tr.push({ y: new Date(t.t * 1000).getUTCFullYear(), ret: t.ret, up50: b.c > b.m50, up200: b.c > b.m200 });
    }
  }
  const st = (a) => { const p = L.pool(a.map((t) => t.ret)); return p.n ? { n: p.n, avg: p.avg, med: p.med, wr: p.wr, pf: p.pf } : { n: 0 }; };
  const f = (p) => (p.n ? `${p.n}/${(p.avg * 100).toFixed(2)}%` : '0');
  const row = { up50: st(tr.filter((t) => t.up50)), down50: st(tr.filter((t) => !t.up50)), up200: st(tr.filter((t) => t.up200)), down200: st(tr.filter((t) => !t.up200)), years: {} };
  for (const y of [...new Set(tr.map((t) => t.y))].sort()) row.years[y] = { up: st(tr.filter((t) => t.y === y && t.up50)), down: st(tr.filter((t) => t.y === y && !t.up50)) };
  out[`${ln}|${sn}`] = row;
  console.log(`${ln} ${sn}: BTC over 50d ${f(row.up50)} · under ${f(row.down50)} | over 200d ${f(row.up200)} · under ${f(row.down200)}`);
  console.log('   by year (over / under the 50d):', Object.entries(row.years).map(([y, v]) => `${y} ${f(v.up)} / ${f(v.down)}`).join(' · '));
}
fs.writeFileSync(path.join(DIR, 'regime1h.json'), JSON.stringify(out));
