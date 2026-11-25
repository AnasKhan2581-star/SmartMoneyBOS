/*
 * The reclaim zone per coin and timeframe on the user's 103-coin list (Nov 2026, user request: "find on which coins it
 * performed best and on what timeframe, in how many trades, win rate etc"). RESEARCH ONLY.
 *
 *   NODE_USE_ENV_PROXY=1 node research/reclaim/data.js broad 15m     # 15m for the 103 coins (1h/4h/1d come with `broad`)
 *   node research/reclaim/coins.js > research/reclaim/RESULTS_reclaim_coins_2026-11.md
 *
 * Rules: the chosen rules of RESULTS_reclaim_2026-11.md, and `big` (the same with an 8-ATR fall). Spot costs as in the
 * lab. Per coin and timeframe: the trades, all-in equity (Compare's columns), the best trade's share, each half of the
 * coin's history, and the same orders at 50 random times on that coin. 3m exists only for the 8 study coins
 * (RESULTS_reclaim_2026-11.md, per-coin table); every one of them lost there.
 * The question that decides whether a best-coin list is worth anything: do the coins that did best in the first half of
 * their history also do best in the second? (`persistence`, below.)
 */
'use strict';
const fs = require('fs'), path = require('path');
const L = require('./reclaim_lab.js');
const { loadTf, LIST103, DIR } = require('./data.js');
const { mulberry32 } = require('../rng.js');
const spot = JSON.parse(fs.readFileSync(path.join(DIR, 'run_spot.json')));
const SETS = { chosen: spot.choice.final, big: Object.assign({}, spot.choice.final, { D: 8 }) };
const TFS = ['15m', '1h', '4h', '1d'];
const MIN = 5;                                                     // trades a coin needs to enter the rankings
const sg = (x, d = 1) => (x === null || x === undefined || Number.isNaN(x) ? '–' : (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(d) + '%');
const pv = (p) => (p === null || p === undefined ? '–' : p < 0.001 ? '< 0.001' : p.toFixed(2));
const pff = (x) => (x === Infinity ? '∞' : x === undefined || x === null ? '–' : x.toFixed(2));
const coin = (s) => s.replace('USDT', '');
const day = (t) => new Date(t * 1000).toISOString().slice(0, 10);
function need(cond, what) { if (!cond) throw new Error(`report claim no longer holds: ${what}`); }

function rowsFor(P, tf) {
  const rows = [];
  LIST103().forEach((sym, ci) => {
    const raw = loadTf(sym, tf, 'broad');
    if (!raw || raw.n < 400) return;
    const S = L.prep(sym, tf, raw), tr = L.simulate(S, L.detect(S, P), P, sym);
    const yrs = (S.T[S.n - 1] - S.T[0]) / (365.25 * 86400), bh = S.C[S.n - 1] / S.C[0] - 1;
    if (!tr.length) { rows.push({ sym, tf, n: 0, yrs, bh }); return; }
    const rets = tr.map((t) => t.ret), p = L.pool(rets), e = L.equity(S, tr, 0, S.n);
    const bi = rets.indexOf(Math.max(...rets));
    const noBest = rets.filter((_, i) => i !== bi);
    const ctrl = L.control(S, P, sym, tr, 0, S.n, 9000 + ci * 7 + TFS.indexOf(tf));
    const vr = L.vsRandom(rets, ctrl, 31 + ci);
    const h1 = L.pool(tr.filter((t) => t.i0 < S.splitIdx).map((t) => t.ret)), h2 = L.pool(tr.filter((t) => t.i0 >= S.splitIdx).map((t) => t.ret));
    rows.push({ sym, tf, n: p.n, wr: p.wr, avg: p.avg, med: p.med, pf: p.pf, net: e.net, bh, vs: (1 + e.net) / (1 + bh) - 1, dd: e.dd,
      inMkt: e.inMkt, yrs, best: rets[bi], bestAt: day(tr[bi].t), avgNoBest: noBest.length ? noBest.reduce((s, x) => s + x, 0) / noBest.length : null,
      netNoBest: (1 + e.net) / (1 + rets[bi]) - 1, worst: Math.min(...rets), h1, h2, rand: vr.rand, p: vr.p,
      first: day(tr[0].t), last: day(tr[tr.length - 1].t), stop: tr.map((t) => t.risk).sort((a, b) => a - b)[tr.length >> 1],
      exits: tr.reduce((m, t) => ((m[t.why] = (m[t.why] || 0) + 1), m), {}) });
  });
  return rows;
}

// Spearman rank correlation
function spearman(a, b) {
  const rk = (x) => { const o = x.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]), r = new Array(x.length); o.forEach(([, i], k) => { r[i] = k; }); return r; };
  const ra = rk(a), rb = rk(b), n = a.length, ma = (n - 1) / 2;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (ra[i] - ma) * (rb[i] - ma); da += (ra[i] - ma) ** 2; db += (rb[i] - ma) ** 2; }
  return num / Math.sqrt(da * db);
}

function main() {
  const out = [], w = (s = '') => out.push(s);
  const all = {};
  for (const [nm, P] of Object.entries(SETS)) for (const tf of TFS) { all[`${nm}|${tf}`] = rowsFor(P, tf); console.error(nm, tf, all[`${nm}|${tf}`].length); }
  const head = '| coin | tf | trades | win rate | avg trade | median | PF | Net P/L | vs B&H | Max DD | best trade | Net without it | 1st half | 2nd half | random times | p |';
  const line = '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|';
  const fmt = (r) => `| ${coin(r.sym)} | ${r.tf} | ${r.n} | ${Math.round(r.wr * 100)}% | ${sg(r.avg, 2)} | ${sg(r.med, 2)} | ${pff(r.pf)} | ${sg(r.net)} | ${sg(r.vs)} | ${sg(r.dd)} | ${sg(r.best)} (${r.bestAt}) | ${sg(r.netNoBest)} | ${r.h1.n ? `${r.h1.n} · ${sg(r.h1.avg, 2)}` : '0'} | ${r.h2.n ? `${r.h2.n} · ${sg(r.h2.avg, 2)}` : '0'} | ${sg(r.rand, 2)} | ${pv(r.p)} |`;

  w('# The reclaim zone, coin by coin: the 103-coin list on 15m, 1h, 4h and 1d (Nov 2026)');
  w();
  w(`Generated by \`node research/reclaim/coins.js\` on ${new Date().toISOString().slice(0, 10)}. Research only. Rules: the chosen rules of RESULTS_reclaim_2026-11.md (a ≥ 5-ATR fall within 6 candles from a 20-candle high that takes the 20-candle low; a close back above the high within 36 candles; a limit buy at the middle of the fall on its first touch; stop under the low; target the high since the reclaim; out after 300 candles), and \`big\`, the same with a ≥ 8-ATR fall. Spot costs (0.1% a side, slippage on stops). Data from each coin's listing to 25 Nov 2026. 3m was only run on the 8 study coins, and lost on every one (RESULTS_reclaim_2026-11.md).`);
  w();
  w(`Net P/L is all-in on every trade, marked on candle closes, as in Compare. **Net without it** removes the coin's single best trade. *Random times*: the coin's own orders placed at 50 random times on the same chart (avg trade); *p* = the share of random sets that did as well. Rankings need ≥ ${MIN} trades.`);
  w();

  for (const nm of Object.keys(SETS)) {
    w(`## ${nm === 'chosen' ? 'The chosen rules' : '`big`: the chosen rules with an 8-ATR fall'}`);
    w();
    w('### Each timeframe');
    w();
    w('| tf | coins with trades | coins ahead | trades | win rate | avg trade | median coin Net P/L | best coin (Net P/L) |');
    w('|---|---|---|---|---|---|---|---|');
    for (const tf of TFS) {
      const rs = all[`${nm}|${tf}`].filter((r) => r.n > 0), ahead = rs.filter((r) => r.net > 0);
      const trades = rs.reduce((s, r) => s + r.n, 0), wins = rs.reduce((s, r) => s + r.wr * r.n, 0), sum = rs.reduce((s, r) => s + r.avg * r.n, 0);
      const nets = rs.map((r) => r.net).sort((a, b) => a - b), top = rs.filter((r) => r.n >= MIN).sort((a, b) => b.net - a.net)[0];
      w(`| ${tf} | ${rs.length} | ${ahead.length} | ${trades} | ${trades ? Math.round(wins / trades * 100) + '%' : '–'} | ${trades ? sg(sum / trades, 2) : '–'} | ${nets.length ? sg(nets[nets.length >> 1]) : '–'} | ${top ? `${coin(top.sym)} ${sg(top.net)} (${top.n} trades)` : '–'} |`);
    }
    w();
    const ranked = TFS.flatMap((tf) => all[`${nm}|${tf}`]).filter((r) => r.n >= MIN).sort((a, b) => b.net - a.net);
    w(`### The best ${Math.min(20, ranked.length)} coin and timeframe pairs (≥ ${MIN} trades), by Net P/L`);
    w();
    w(head); w(line);
    for (const r of ranked.slice(0, 20)) w(fmt(r));
    w();
    w(`### The worst 10`);
    w();
    w(head); w(line);
    for (const r of ranked.slice(-10).reverse()) w(fmt(r));
    w();
    // each coin's best timeframe
    const best = {};
    for (const r of ranked) if (!best[r.sym] || r.net > best[r.sym].net) best[r.sym] = r;
    const bl = Object.values(best).sort((a, b) => b.net - a.net);
    const tfCount = TFS.map((tf) => `${tf} ${bl.filter((r) => r.tf === tf).length}`).join(', ');
    w(`### Each coin's best timeframe (coins with ≥ ${MIN} trades somewhere: ${bl.length}; best on ${tfCount})`);
    w();
    w('| coin | best tf | trades | win rate | avg trade | Net P/L | Net without the best trade | the other timeframes (trades · Net P/L) |');
    w('|---|---|---|---|---|---|---|---|');
    for (const r of bl) {
      const others = TFS.filter((tf) => tf !== r.tf).map((tf) => { const o = all[`${nm}|${tf}`].find((x) => x.sym === r.sym); return o && o.n ? `${tf} ${o.n} · ${sg(o.net)}` : `${tf} 0`; }).join(' · ');
      w(`| ${coin(r.sym)} | ${r.tf} | ${r.n} | ${Math.round(r.wr * 100)}% | ${sg(r.avg, 2)} | ${sg(r.net)} | ${sg(r.netNoBest)} | ${others} |`);
    }
    w();
    // persistence: does a good first half predict a good second half?
    w('### Does a coin\'s first half predict its second half?');
    w();
    w('Coins with ≥ 3 trades in each half of their history. The first half picks the best 5, 10 or 20 coins; the second half judges them against all the eligible coins. *p* = the share of 20,000 random picks of as many coins that did as well in the second half.');
    w();
    w('| tf | coins | rank correlation, 1st vs 2nd half | all eligible: 2nd-half avg trade | best 5 by 1st half (p) | best 10 (p) | best 20 (p) | ahead in both halves |');
    w('|---|---|---|---|---|---|---|---|');
    const pers = {};
    for (const tf of TFS) {
      const rs = all[`${nm}|${tf}`].filter((r) => r.n && r.h1.n >= 3 && r.h2.n >= 3);
      if (rs.length < 12) { w(`| ${tf} | ${rs.length} | – | – | – | – | – | – |`); continue; }
      const rho = spearman(rs.map((r) => r.h1.avg), rs.map((r) => r.h2.avg));
      const by1 = rs.slice().sort((a, b) => b.h1.avg - a.h1.avg);
      const h2avg = (a) => a.reduce((s, r) => s + r.h2.avg * r.h2.n, 0) / a.reduce((s, r) => s + r.h2.n, 0);
      const pick = (k) => {
        const obs = h2avg(by1.slice(0, k)), rnd = mulberry32(5 + k + TFS.indexOf(tf) * 100); let ge = 0;
        for (let i = 0; i < 20000; i++) { const idx = new Set(); while (idx.size < k) idx.add(Math.floor(rnd() * rs.length)); if (h2avg([...idx].map((j) => rs[j])) >= obs) ge++; }
        return { obs, p: ge / 20000, n: by1.slice(0, k).reduce((s, r) => s + r.h2.n, 0) };
      };
      const k5 = pick(5), k10 = pick(10), k20 = pick(20);
      const up1 = rs.filter((r) => r.h1.avg > 0), both = up1.filter((r) => r.h2.avg > 0);
      pers[tf] = { rho, k5, k10, k20, n: rs.length, all: h2avg(rs), top10: by1.slice(0, 10) };
      const c = (k) => `${sg(k.obs, 2)} on ${k.n} trades (${pv(k.p)})`;
      w(`| ${tf} | ${rs.length} | ${rho >= 0 ? '+' : '−'}${Math.abs(rho).toFixed(2)} | ${sg(h2avg(rs), 2)} | ${c(k5)} | ${c(k10)} | ${c(k20)} | ${both.length} of the ${up1.length} ahead in the 1st |`);
    }
    w();
    if (nm === 'chosen') {
      const p1 = pers['1h'], p15 = pers['15m'];
      need(Math.abs(p1.rho) < 0.2 && Math.abs(p15.rho) < 0.2, 'the rank correlation between halves is near zero on 15m and 1h');
      need(p15.k5.p > 0.1 && p15.k10.p > 0.1 && p15.k20.p > 0.1, 'on 15m no pick of first-half winners stands out');
      need(p1.k10.p < 0.05 && p1.k5.p > 0.05 && p1.k20.p > 0.05, 'on 1h only the best-10 pick stands out');
      w(`- **15m: no persistence.** A coin's first half says nothing about its second (rank correlation ${p15.rho.toFixed(2)}; one standard error is about ±0.10 with ${p15.n} coins), and no pick of first-half winners beats random picks.`);
      w(`- **1h: a weak hint.** Over all ${p1.n} coins the rank correlation is ${p1.rho.toFixed(2)} (one standard error about ±0.14). But the 10 best first-half coins (${p1.top10.map((r) => coin(r.sym)).join(', ')}) made ${sg(p1.k10.obs, 2)} a trade in their second half against ${sg(p1.all, 2)} for all eligible coins (p ${pv(p1.k10.p)}). Their average fell from ${sg(p1.top10.reduce((s, r) => s + r.h1.avg * r.h1.n, 0) / p1.top10.reduce((s, r) => s + r.h1.n, 0), 1)} to ${sg(p1.k10.obs, 1)}, and the best 5 (p ${pv(p1.k5.p)}) and best 20 (p ${pv(p1.k20.p)}) don't stand out. Three cuts were tried, so one at p ${pv(p1.k10.p)} is a hint, not proof.`);
      w();
      // the best 1h coins year by year (picked on all history, so their recent years are flattered)
      const P = SETS.chosen, top = all['chosen|1h'].filter((r) => r.n >= MIN).sort((a, b) => b.net - a.net).slice(0, 10);
      const yrs = {}, rowsY = [];
      for (const r of top) {
        const S = L.prep(r.sym, '1h', loadTf(r.sym, '1h', 'broad')), tr = L.simulate(S, L.detect(S, P), P, r.sym), by = {};
        for (const t of tr) { const y = new Date(t.t * 1000).getUTCFullYear(); (by[y] = by[y] || []).push(t.ret); (yrs[y] = yrs[y] || []).push(t.ret); }
        rowsY.push([coin(r.sym), by]);
      }
      const ys = Object.keys(yrs).sort();
      w('### The 10 best 1h coins, year by year (avg trade, trades)');
      w();
      w('Picked on all their history, 2025–26 included, so the recent years are flattered by the pick itself.');
      w();
      w(`| coin | ${ys.join(' | ')} |`);
      w(`|---|${ys.map(() => '---').join('|')}|`);
      const cell = (a) => (a && a.length ? `${sg(a.reduce((s, x) => s + x, 0) / a.length)} (${a.length})` : '–');
      for (const [c2, by] of rowsY) w(`| ${c2} | ${ys.map((y) => cell(by[y])).join(' | ')} |`);
      w(`| **all 10** | ${ys.map((y) => `**${cell(yrs[y])}**`).join(' | ')} |`);
      w();
    }
  }
  process.stdout.write(out.join('\n') + '\n');
  fs.writeFileSync(path.join(DIR, 'coins.json'), JSON.stringify(all));
}

main();
