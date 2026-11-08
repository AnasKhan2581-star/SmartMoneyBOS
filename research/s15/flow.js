// Order flow at the entry: does the share of volume that BUYERS took at the ask (Binance's taker-buy volume, a field
// this repo never used before) tell real breakouts from fake ones?  Reads the trades of research/cache/s15/run.json and
// the candles with taker volume from research/cache/lb15t (research/liqbrk15m/fetch15t.js).
//   node research/s15/flow.js [strategy keys…]
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const R = JSON.parse(fs.readFileSync(path.join(ROOT, 'research', 'cache', 's15', 'run.json')));
const KEYS = process.argv.slice(2).length ? process.argv.slice(2) : ['L0', 'Vsxb', 'H4e', 'H4c'];
const BL = [['2018–20', Date.UTC(2018, 0, 1) / 1e3, Date.UTC(2021, 0, 1) / 1e3], ['2021–22', Date.UTC(2021, 0, 1) / 1e3, Date.UTC(2023, 0, 1) / 1e3],
  ['2023–24', Date.UTC(2023, 0, 1) / 1e3, Date.UTC(2025, 0, 1) / 1e3], ['2025–26', Date.UTC(2025, 0, 1) / 1e3, Infinity]];
const bySym = {};
for (const t of R.trades) if (KEYS.includes(t.k)) (bySym[t.sym] || (bySym[t.sym] = [])).push(t);
const feats = [];
for (const [sym, T] of Object.entries(bySym)) {
  const f = path.join(ROOT, 'research', 'cache', 'lb15t', `${sym}USDT_15m.json`); if (!fs.existsSync(f)) continue;
  const c = JSON.parse(fs.readFileSync(f)), at = new Map(c.map((r, i) => [r[0], i]));
  const sum = (i, L, k) => { let s = 0; for (let q = Math.max(0, i - L + 1); q <= i; q++) s += c[q][k]; return s; };
  for (const t of T) {
    // the entry candle: 15m strategies log the 15m candle's open time; the 4h one logs its 4h candle, whose last 15m is +3h45
    const i = at.get(t.t + (t.k === 'H4' ? 14400 - 900 : 0)); if (i == null || i < 96) continue;
    const v1 = c[i][5], v16 = sum(i, 16, 5), v96 = sum(i, 96, 5), n1 = c[i][7], n96 = sum(i, 96, 7);
    feats.push({ ...t, tb1: v1 > 0 ? c[i][6] / v1 : NaN, tb16: v16 > 0 ? sum(i, 16, 6) / v16 : NaN, tb96: v96 > 0 ? sum(i, 96, 6) / v96 : NaN,
      act: n96 > 0 ? n1 / (n96 / 96) : NaN, size: n1 > 0 && n96 > 0 && v96 > 0 ? (v1 / n1) / (v96 / n96) : NaN });
  }
}
const mean = (a) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const pool = (T) => { const w = T.filter((t) => t.net > 0), gp = w.reduce((s, t) => s + t.net, 0), gl = -T.filter((t) => t.net <= 0).reduce((s, t) => s + t.net, 0);
  return { n: T.length, avg: mean(T.map((t) => t.net)), pf: gl > 0 ? gp / gl : Infinity, wr: T.length ? w.length / T.length : NaN }; };
const qs = (a, ps) => { const s = a.slice().sort((x, y) => x - y); return ps.map((p) => s[Math.floor(p * (s.length - 1))]); };
const SAVE = {};
for (const k of KEYS) {
  const F = feats.filter((t) => t.k === k); if (!F.length) continue;
  SAVE[k] = { n: F.length, feats: {} };
  console.log(`\n=== ${k}: ${F.length} trades with order-flow data`);
  for (const [nm, key] of [['buyer share, entry 15m candle', 'tb1'], ['buyer share, last 4 hours', 'tb16'], ['buyer share, last day', 'tb96'], ['trades in the candle vs the day\'s average', 'act'], ['average trade size vs the day\'s', 'size']]) {
    const G = F.filter((t) => isFinite(t[key])), cuts = qs(G.map((t) => t[key]), [0.2, 0.4, 0.6, 0.8]);
    const bucket = (x) => (x <= cuts[0] ? 0 : x <= cuts[1] ? 1 : x <= cuts[2] ? 2 : x <= cuts[3] ? 3 : 4);
    console.log(`  ${nm} (quintile cuts ${cuts.map((x) => x.toFixed(3)).join(' / ')})`);
    SAVE[k].feats[key] = { nm, cuts, q: [] };
    for (let b = 0; b < 5; b++) {
      const B = G.filter((t) => bucket(t[key]) === b), s = pool(B);
      SAVE[k].feats[key].q.push({ ...s, blocks: BL.map(([, a, z]) => { const q = pool(B.filter((t) => t.t >= a && t.t < z)); return q.n >= 20 ? q.avg : null; }) });
      const blocks = BL.map(([, a, z]) => { const q = pool(B.filter((t) => t.t >= a && t.t < z)); return q.n >= 20 ? `${(q.avg * 100).toFixed(2).padStart(6)}%` : '     —'; }).join(' ');
      console.log(`    Q${b + 1}: n ${String(s.n).padStart(5)} avg ${(s.avg * 100).toFixed(2).padStart(6)}% PF ${s.pf.toFixed(2)} WR ${(s.wr * 100).toFixed(0)}% | by block ${blocks}`);
    }
  }
}
// the one hint in those tables (the most seller-heavy fifth over the last 4 hours doing worst) tested properly: the
// bottom/rest labels shuffled 5,000 times inside each block. Read the result against ~20 tries (5 measures × 4 strategies).
for (const k of KEYS) {
  const F = feats.filter((t) => t.k === k && isFinite(t.tb16)); if (!F.length) continue;
  const cut = qs(F.map((t) => t.tb16), [0.2])[0], lab = F.map((t) => t.tb16 <= cut);
  const gap = (L) => { const a = [], b = []; F.forEach((t, i) => (L[i] ? b : a).push(t.net)); return mean(a) - mean(b); };
  const idx = BL.map(([, a, z]) => F.map((t, i) => (t.t >= a && t.t < z ? i : -1)).filter((i) => i >= 0));
  const rnd = require('../rng.js').mulberry32(777);
  const g0 = gap(lab); let ge = 0;
  for (let r = 0; r < 5000; r++) { const L = lab.slice(); for (const I of idx) for (let i = I.length - 1; i > 0; i--) { const j = I[Math.floor(rnd() * (i + 1))], a = I[i]; [L[a], L[j]] = [L[j], L[a]]; } if (gap(L) >= g0) ge++; }
  SAVE[k].bottom4h = { cut, bottom: mean(F.filter((t, i) => lab[i]).map((t) => t.net)), rest: mean(F.filter((t, i) => !lab[i]).map((t) => t.net)), p: ge / 5000 };
  console.log(`${k}: bottom fifth of 4h buyer share ${(SAVE[k].bottom4h.bottom * 100).toFixed(2)}% vs rest ${(SAVE[k].bottom4h.rest * 100).toFixed(2)}%, chance ${(ge / 50).toFixed(1)}%`);
}
fs.writeFileSync(path.join(ROOT, 'research', 'cache', 's15', 'flow.json'), JSON.stringify(SAVE));
