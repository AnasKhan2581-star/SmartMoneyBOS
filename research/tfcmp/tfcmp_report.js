// 15m vs 4h on the user's 103-coin Compare list, last 4 years: does any strategy do better on 15m, and which
// coin × strategy combos perform best on each timeframe (no ✓ filter — user request, Oct 2026).
//   NODE_USE_ENV_PROXY=1 node research/tfcmp/fetch.js 1d:BTC 4h 15m
//   node research/tfcmp/tfcmp_report.js > research/tfcmp/RESULTS_tfcmp_2026-10.md     (~15 min; REUSE=1 re-renders from the saved rows)
// Mirrors the Compare tab in date mode: the engine runs on the window only (each strategy's warm-up comes out of it),
// fills at the signal candle's close, 0.1% fee a side, and the stats come from the app's OWN pathStats — read out of
// index.html below, so these are the numbers the Compare table would show.
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..'), DATA = path.join(ROOT, 'research', 'cache', 'tfcmp');
const SMC = require(path.join(ROOT, 'detector.js'));
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// ---------------------------------------------------------------- the app's own code and lists
const grab = (name) => {
  const i = html.indexOf(`function ${name}(`); if (i < 0) throw new Error(name + ' not found in index.html');
  let j = html.indexOf('{', i), depth = 0;
  for (; j < html.length; j++) { if (html[j] === '{') depth++; else if (html[j] === '}' && --depth === 0) break; }
  return html.slice(i, j + 1);
};
const PS = grab('pathStats');
const pathStats = new Function('SMC', PS + '\nreturn pathStats;')(SMC);
// the same stats with extra slippage on every fill, to see how much of a result survives real execution
const slipSrc = (s) => {
  const a = 'r[t.exitIdx]-=f*0.002;', b = '(t.exitPrice/t.entry)*(1-0.001)/(1+0.001)-1';
  if (!PS.includes(a) || !PS.includes(b)) throw new Error('pathStats changed — update the slippage patch');
  return PS.replace(a, `r[t.exitIdx]-=f*(0.002+${2 * s});`).replace(b, `(t.exitPrice/t.entry)*(1-0.001-${s})/(1+0.001+${s})-1`);
};
const SLIP = 0.0005;                                   // 0.05% a side, the research "honest fill" slippage
const pathStatsSlip = new Function('SMC', slipSrc(SLIP) + '\nreturn pathStats;')(SMC);
const LIST = html.match(/const CMP_DEFAULT=\[([\s\S]*?)\]\.map/)[1].match(/'([A-Z0-9]+)'/g).map((s) => s.slice(1, -1) + 'USDT');
const STRATS = [...html.match(/const CMP_STRATS=\[(.*?)\];/)[1].matchAll(/\['(\w+)','([^']+)'\]/g)].map((m) => [m[1], m[2]]);
const TF_MS = { '15m': 9e5, '4h': 144e5 };
const minTrades = (tf) => ['15m', '30m', '1h'].includes(tf) ? 12 : 20;     // the app's minTrades()

// ---------------------------------------------------------------- data
const FROM = Date.UTC(2022, 9, 28), END = Date.UTC(2026, 9, 28);   // the last 4 years, same for both TFs
const load = (sym, tf) => {
  const f = path.join(DATA, `${sym}_${tf}.json`);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f)).map((r) => ({ time: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] })) : null;
};
const BTC = { '4h': load('BTCUSDT', '4h'), '15m': load('BTCUSDT', '15m') }, BTCD = load('BTCUSDT', '1d');
if (!BTC['4h'] || !BTC['15m'] || !BTCD) throw new Error('BTC data missing — run research/tfcmp/fetch.js first');

// ---------------------------------------------------------------- run
const SAVED = path.join(DATA, 'rows.json');          // every row, for re-rendering and follow-up checks (git-ignored)
let rows = [], skipped = [];
const t0 = Date.now();
if (process.env.REUSE && fs.existsSync(SAVED)) {
  ({ rows, skipped } = JSON.parse(fs.readFileSync(SAVED)));
  for (const r of rows) if (r.pf == null) r.pf = Infinity;     // JSON has no Infinity: a PF with no losing trade comes back as null
} else for (const [k, sym] of LIST.entries()) {
  for (const tf of ['4h', '15m']) {
    const full = load(sym, tf);
    if (!full) { skipped.push(`${sym} ${tf} (no data)`); continue; }
    const c = full.filter((x) => x.time * 1000 >= FROM && x.time * 1000 < END);
    if (c.length < 250) { skipped.push(`${sym.replace('USDT', '')} ${tf} (only ${c.length} bars)`); continue; }
    // btcFor(): BTC on the same TF from 51 days before the coin's first bar (the coin itself on BTCUSDT)
    const btc = sym === 'BTCUSDT' ? full : BTC[tf].filter((x) => x.time >= c[0].time - 51 * 86400);
    const btcD = sym === 'BTCUSDT' ? 'self' : BTCD;
    const fullWin = c[0].time * 1000 <= FROM + 2 * TF_MS[tf];   // the app's "listed later, clamped" test
    for (const [st, label] of STRATS) {
      const res = SMC.detectAll(c, { strategy: st, longOnly: true, useLiq: false, btc, btcD });
      const e = pathStats(res.trades, c), es = pathStatsSlip(res.trades, c);
      rows.push({ sym: sym.replace('USDT', ''), tf, st, label, fullWin, from: c[0].time, bars: c.length,
        net: e.net, bh: e.bh, edge: e.edge, dd: e.dd, n: e.n, wr: e.wr, pf: e.pf, expo: e.expo, yrs: e.yrs, pos: e.pos,
        netSlip: es.net, open: res.trades.some((t) => t.outcome === 'open') });
    }
  }
  if (process.env.PROGRESS) process.stderr.write(`${k + 1}/${LIST.length} ${sym} · ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
}
if (!process.env.REUSE) fs.writeFileSync(SAVED, JSON.stringify({ rows, skipped }));

// ---------------------------------------------------------------- report helpers
const out = [], say = (s = '') => out.push(s);
const row = (a) => '| ' + a.join(' | ') + ' |';
const big = (x) => { const v = Math.abs(x * 100); return (x >= 0 ? '+' : '−') + (v >= 1000 ? Math.round(v).toLocaleString('en-US') : v.toFixed(v >= 100 ? 0 : 1)) + '%'; };
const pp = (x) => (x * 100).toFixed(0) + '%';
const f2 = (x) => Number.isNaN(x) ? '—' : isFinite(x) ? x.toFixed(2) : '∞';
const med = (v) => { const s = v.filter((x) => x != null && !Number.isNaN(x)).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const iso = (t) => new Date(t * 1000).toISOString().slice(0, 10);
const nFull = new Set(rows.filter((r) => r.fullWin && r.tf === '4h').map((r) => r.sym)).size;

say(`# 15m vs 4h on the 103-coin Compare list — last 4 years (Oct 2026)\n`);
say(`Generated by \`research/tfcmp/tfcmp_report.js\` on ${new Date().toISOString().slice(0, 10)} (data: \`research/tfcmp/fetch.js\`). `
  + `Window **${iso(FROM / 1000)} → ${iso(END / 1000)}** on both timeframes, the user's Compare list (\`CMP_DEFAULT\`, ${LIST.length} coins), all four Compare strategies. `
  + `It mirrors the Compare tab in date mode: each strategy's warm-up comes out of the window, fills are at the signal candle's close, 0.1% fee a side, `
  + `and every number comes from the app's own \`pathStats\` (read out of index.html). "After slippage" adds ${SLIP * 100}% a side on every fill.\n`);
say(`${nFull} coins have the full 4 years on Binance; the rest listed later (or were delisted: XMR, LIT) and cover less, so the top-10 tables `
  + `rank only the full-window coins. Skipped (fewer than 250 bars, as the app does): ${skipped.join(', ') || 'none'}.\n`);

// ---- 1. per strategy, 15m vs 4h, same coins
say(`## 1. Does any strategy do better on 15m?\n`);
say(`Every coin with both timeframes, same window per coin. "15m better" counts coins where the 15m row ended with more money than the 4h row.\n`);
say(row(['strategy', 'TF', 'coins', 'profitable', 'beat buy & hold', 'median net', 'median net after slippage', 'median max DD', 'median PF', 'median trades', '15m better / worse']));
say(row(['---', '---', '---', '---', '---', '---', '---', '---', '---', '---', '---']));
const key = (r) => r.sym + '|' + r.st;
const pfMed = (R) => R.length >= 5 ? `${f2(med(R.map((r) => r.pf)))} (${R.length})` : `— (${R.length})`;
const by = { '4h': new Map(), '15m': new Map() };
for (const r of rows) by[r.tf].set(key(r), r);
const S = {};
for (const [st, label] of STRATS) {
  const pairs = [...by['4h'].values()].filter((r) => r.st === st && by['15m'].has(key(r))).map((r) => [r, by['15m'].get(key(r))]);
  const better = pairs.filter(([a, b]) => b.net > a.net + 1e-9).length, worse = pairs.filter(([a, b]) => b.net < a.net - 1e-9).length;
  S[st] = { pairs, better, worse };
  for (const [i, tf] of ['4h', '15m'].entries()) {
    const R = pairs.map((p) => p[i]);
    say(row([i ? '' : `**${label}**`, tf, R.length, `${R.filter((r) => r.net > 0).length}`, `${R.filter((r) => r.edge > 0).length}`, big(med(R.map((r) => r.net))),
      big(med(R.map((r) => r.netSlip))), '−' + pp(med(R.map((r) => r.dd))), pfMed(R.filter((r) => r.n >= minTrades(tf))),
      Math.round(med(R.map((r) => r.n))), i ? `${better} / ${worse}` : '']));
  }
}
say();
say(`"median PF" counts only rows with at least the app's trade floor (${minTrades('4h')} on 4h, ${minTrades('15m')} on 15m); the number of such rows is in brackets, `
  + `and under 5 it is not shown. "15m better / worse" counts coins whose 15m row ended with more / less money than the 4h row; the rest are equal (usually no trade on either).\n`);

// ---- 2. top 10 per TF — as asked, then the same with a real sample
const top = (tf, floor) => rows.filter((r) => r.tf === tf && r.fullWin && (!floor || r.n >= minTrades(tf))).sort((a, b) => b.net - a.net).slice(0, 10);
const T = {};
let sec = 2;
for (const [floor, what] of [[false, 'ranked by net P/L (the Compare tab\'s default sort), no ✓ filter'], [true, `only rows with at least the app's trade floor (${minTrades('15m')} on 15m, ${minTrades('4h')} on 4h)`]]) {
  for (const tf of ['15m', '4h']) {
    const L = T[tf + floor] = top(tf, floor);
    say(`## ${sec++}. Top 10 on ${tf}${floor ? ' with a real sample' : ''} — full 4-year window, ${what}\n`);
    say(row(['#', 'coin · strategy', 'net P/L', 'after slippage', 'vs B&H', 'PF', 'max DD', 'win rate', 'trades', 'in market', 'windows profitable', `same combo on ${tf === '15m' ? '4h' : '15m'}`]));
    say(row(['---', '---', '---', '---', '---', '---', '---', '---', '---', '---', '---', '---']));
    L.forEach((r, i) => {
      const o = by[tf === '15m' ? '4h' : '15m'].get(key(r));
      say(row([i + 1, `**${r.sym}** · ${r.label}`, big(r.net), big(r.netSlip), big(r.edge), f2(r.pf), '−' + pp(r.dd), pp(r.wr), r.n + (r.n < minTrades(tf) ? ' ⚠' : ''),
        pp(r.expo), pp(r.pos), o ? big(o.net) : '—']));
    });
    say();
  }
}
say(`⚠ = fewer closed trades than the app's floor for that timeframe — the win rate and PF on that row are noise.\n`);

// ---- reading it, from the numbers above
const mean = (v) => v.reduce((x, y) => x + y, 0) / Math.max(1, v.length);
const st = (k) => {
  const P = S[k].pairs, ratio = Math.exp(mean(P.map(([a, b]) => Math.log(1 + b.net) - Math.log(1 + a.net)))) - 1;
  return { P, ratio, sameN: P.filter(([a, b]) => a.n === b.n).length, small: P.filter(([a, b]) => Math.abs(b.net - a.net) <= 0.05).length };
};
const lbStats = (tf) => {
  const R = rows.filter((r) => r.st === 'liqbrk' && r.tf === tf && r.fullWin);
  return { perYr: R.reduce((x, r) => x + r.n, 0) / R.length / 4, wr: med(R.filter((r) => r.n >= 12).map((r) => r.wr)), slip: med(R.map((r) => r.net - r.netSlip)) };
};
const lb4 = lbStats('4h'), lb15 = lbStats('15m'), name = Object.fromEntries(STRATS);
say(`## ${sec}. Reading it\n`);
say(`Per coin, on average, the 15m row ended with this much more (+) or less (−) money than the 4h row: `
  + STRATS.map(([k, l]) => `${l} ${big(st(k).ratio)}`).join(' · ') + '.\n');
say(`- **${name.liqbrk} is clearly a 4h system.** On 15m it trades ${lb15.perYr.toFixed(0)} times a coin a year instead of ${lb4.perYr.toFixed(0)}, its median win rate `
  + `falls to ${pp(lb15.wr)} from ${pp(lb4.wr)}, and slippage costs a median ${(lb15.slip * 100).toFixed(1)} points instead of ${(lb4.slip * 100).toFixed(1)}. `
  + `15m beat 4h on only ${S.liqbrk.better} of ${S.liqbrk.pairs.length} coins.`);
say(`- **${name.cycle} is the same system on both** — it is a daily system on every chart: the same trade count on ${st('cycle').sameN} of ${st('cycle').P.length} coins, `
  + `within 5 points of net on ${st('cycle').small}. The "better / worse" split is stop fills and rounding, not an edge.`);
say(`- **${name.donch} and ${name.tsmom} are a coin flip between the two** (15m better on ${S.donch.better} / worse on ${S.donch.worse}; ${S.tsmom.better} / ${S.tsmom.worse}). `
  + `Their lookbacks are in days, so the timeframe mostly changes when within the day an entry or exit fills.`);
const U10 = [...T['15mfalse'], ...T['4hfalse']], thin = U10.filter((r) => r.n < minTrades(r.tf));
const both10 = T['15mfalse'].filter((r) => T['4hfalse'].some((q) => key(q) === key(r))).length;
const lbShare = (L) => L.filter((r) => r.st === 'liqbrk').length;
say(`- **The unfiltered top 10s are mostly the same few trades on both timeframes:** ${both10} of the 10 combos are on both lists, and ${thin.length} of the 20 rows `
  + `have fewer trades than the app's floor (${Math.min(...thin.map((r) => r.n))}–${Math.max(...thin.map((r) => r.n))} trades — a few long trend holds on the coins that ran: `
  + `${[...new Set(thin.map((r) => r.sym))].join(', ')}).`);
say(`- **With a real sample**, ${lbShare(T['4htrue'])} of the 4h top 10 are ${name.liqbrk} (median max drawdown ${'−' + pp(med(T['4htrue'].map((r) => r.dd)))}), `
  + `against ${lbShare(T['15mtrue'])} of the 15m top 10 (median max drawdown ${'−' + pp(med(T['15mtrue'].map((r) => r.dd)))}).\n`);
process.stdout.write(out.join('\n') + '\n');
