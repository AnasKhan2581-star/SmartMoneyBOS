// Writes the data files behind the "BTC Flush Playbook" dashboard from research/cache/flush/{pro_prep,walk,final}.json.
//   node research/flush/gen_dash.js <out-dir>
'use strict';
const fs = require('fs'), path = require('path');
const { simulate, BASE } = require('./pro_lab.js');
const D = path.join(__dirname, '..', 'cache', 'flush');
const OUT = process.argv[2] || path.join(D, 'dash');
fs.mkdirSync(OUT, { recursive: true });
const J = (f) => JSON.parse(fs.readFileSync(path.join(D, f)));
const P = J('pro_prep.json'), W = J('walk.json'), F = J('final.json');
const iso = (t) => new Date(t * 1000).toISOString().replace('.000Z', 'Z');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (d) => `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
// a flush is acted on at the CLOSE of its candle (t is the candle's open time on Binance)
const whenOf = (t) => { const d = new Date((t + 900) * 1000); return `${day(d)} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
const r4 = (x) => (x == null || !isFinite(x) ? '' : +x.toFixed(4));
const csv = (name, cols, rows) => {
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  fs.writeFileSync(path.join(OUT, name), [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n') + '\n');
  console.log(name, rows.length, 'rows');
};
const H = W.split, s = F.stats, h1 = W.fin.h1, h2 = W.fin.h2, sh2 = W.simple.h2;
const PL = F.stress['placebo (random times)'];

// 1. headline figures (one row). Drawdowns are stored NEGATIVE, as they are shown.
const SPAN0 = Date.UTC(2017, 8, 1) / 1e3, SPAN1 = Date.UTC(2026, 10, 5) / 1e3, spanY = (SPAN1 - SPAN0) / 31557600;
const evAll = F.events, evOn = evAll.filter((e) => !e.skipped && e.filled);
let inMkt = 0; for (const e of evOn) { const L = F.trades.filter((t) => t.t === e.t).flatMap((t) => t.log);
  const k0 = Math.min(...L.filter((l) => l.side === 'buy').map((l) => l.k)), k1 = Math.max(...L.filter((l) => l.side === 'sell').map((l) => l.k)); inMkt += Math.max(1, k1 - k0) * 900; }
const BH = J('pro.json').res.btcHold;
const neg = (x) => r4(-Math.abs(x));
const SUM = {
  flushes: s.active, arms: P.arms.length, busy: evAll.filter((e) => e.skipped === 'busy').length, nofill: evAll.filter((e) => !e.skipped && !e.filled).length,
  trades: s.trades, avg_trade: r4(s.avgTrade), win_rate: r4(s.wr), profit_factor: r4(s.pf), growth: r4(s.mult), cagr: r4(s.cagr), max_dd: neg(s.maxDD),
  worst_flush: r4(s.worstEv), best_flush: r4(s.bestEv), flushes_per_year: r4(s.active / spanY), in_market: r4(inMkt / (SPAN1 - SPAN0)), hours_in_market: Math.round(inMkt / 3600),
  is_label: '2017–2021', oos_label: '2022–2026', is_cagr: r4(h1.cagr), is_dd: neg(h1.maxDD), oos_cagr: r4(h2.cagr), oos_dd: neg(h2.maxDD), oos_growth: r4(h2.mult),
  oos_flushes: h2.active, oos_trades: h2.trades, oos_avg_trade: r4(h2.avgTrade), simple_oos_cagr: r4(sh2.cagr), simple_oos_dd: neg(sh2.maxDD),
  boot_runs: 5000, boot_cagr_p05: r4(F.bootstrap.cagr[0]), boot_cagr_p50: r4(F.bootstrap.cagr[1]), boot_cagr_p95: r4(F.bootstrap.cagr[2]),
  boot_dd_p50: neg(F.bootstrap.maxDD[1]), boot_dd_p95: neg(F.bootstrap.maxDD[2]), boot_losing: r4(F.bootstrap.losing),
  placebo_n: P.placebo.length, placebo_growth: r4(PL.mult), placebo_avg_trade: r4(PL.avgTrade), placebo_dd: neg(PL.maxDD),
  btc_growth: r4(BH.mult), btc_cagr: r4(BH.cagr), btc_dd: neg(BH.maxDD),
  coins: 274, survivors: 103, dead: 171, data_from: '2017-09-01', data_to: '2026-11-05', years: r4(spanY),
  data_from_label: day(new Date(SPAN0 * 1000)), data_to_label: day(new Date(SPAN1 * 1000)),
  arms_good: P.arms.filter((e) => !e.bad).length, arms_bad: P.arms.filter((e) => e.bad).length,
  filled_good: evOn.filter((e) => e.mode === 'A').length, filled_bad: evOn.filter((e) => e.mode === 'B').length,
  exits_stop: F.trades.filter((t) => t.why === 'STOP').length, exits_tp1: F.trades.filter((t) => t.why.startsWith('TP1')).length,
  exits_tp2: F.trades.filter((t) => t.why === 'TP1+TP2').length, exits_time: F.trades.filter((t) => t.why === 'TIME').length,
  worst_flush_when: whenOf(evOn.reduce((a, b) => (b.ret < a.ret ? b : a)).t),
};
csv('summary.csv', Object.keys(SUM), [SUM]);
csv('compare.csv', ['strategy', 'growth', 'cagr', 'max_dd', 'in_market'], [
  { strategy: 'Flush playbook', growth: SUM.growth, cagr: SUM.cagr, max_dd: SUM.max_dd, in_market: SUM.in_market },
  { strategy: 'BTC buy & hold', growth: SUM.btc_growth, cagr: SUM.btc_cagr, max_dd: SUM.btc_dd, in_market: 1 }]);

// 1b. the rules' numbers, read from the configs the backtest ran (walk.json's final config; flush_lab.js findArms defaults
// as pro_lab.js prep called it), so the page's words cannot drift from the arithmetic
const C = W.final;
const RULES = [
  ['tf_min', 15, 'x', 'candle length the trigger reads, minutes'], ['drop_atr', 1, 'x', 'BTC close at least this many daily ATRs under its 2-hour high'],
  ['high_hours', 2, 'x', 'the high the drop is measured from, hours'], ['atr_days', 14, 'x', 'daily ATR length, days'],
  ['vol_mult', 3, 'x', 'a candle in the move trades this many times the day-before average volume'], ['sweep_days', 3, 'x', 'the low must take out the lowest low of this many days'],
  ['rearm_hours', 24 * 15 / 60, 'x', 'hours before another flush can count'], ['ma_days', 50, 'x', 'BTC moving average that splits good and bad markets, days'],
  ['coins', C.K ?? 5, 'x', 'coins bought per flush'], ['min_dollar_vol', 1e6, 'usd', 'minimum average daily turnover'], ['vol_days', 30, 'x', 'days the turnover is averaged over'],
  ['pot_per_coin', C.equalW, 'pct', 'share of the pot per coin'], ['bid_atr', C.B.ladder[0], 'x', 'bad market: limit bid this many daily ATRs under the price'],
  ['bid_hours', (C.W ?? 8) * 15 / 60, 'x', 'hours a bid stays live'], ['stop_atr', C.A.sl, 'x', 'stop, daily ATRs under the buy'],
  ['tp1_atr', C.tp1, 'x', 'first target, daily ATRs over the buy'], ['tp1_share', C.tp1Frac, 'pct', 'share sold at the first target'],
  ['tp2_atr', C.tp2, 'x', 'second target, daily ATRs over the buy'], ['hold_hours', C.hold * 15 / 60, 'x', 'hours after the buy that anything still open is sold'],
  ['fee', 0.001, 'pct', 'fee a side'], ['slip', C.slip ?? BASE.slip, 'pct', 'slippage on market buys, stops and timed exits'],
];
if (C.B.sl !== C.A.sl || C.A.ladder[0] !== 0 || C.idio || C.select !== 'fell' || C.kill || C.sizing !== 'equal') throw new Error('the page describes a different strategy than walk.json\'s final config');
csv('rules.csv', ['param', 'value', 'unit', 'meaning'], RULES.map(([param, value, unit, meaning]) => ({ param, value, unit, meaning })));

// 2. equity curves: the final strategy, the simple playbook, and the final rules at random times (placebo)
const placebo = simulate(P.placebo, W.final);
const curveRows = (curve, who) => { let pk = 0; return curve.map(([t, v]) => { pk = Math.max(pk, v); return { series: who, t: iso(Math.round(t)), pot: r4(v), dd: r4(v / pk - 1) }; }); };
const start = Date.UTC(2017, 8, 1) / 1e3, end = Date.UTC(2026, 10, 5) / 1e3;
const clip = (c) => [[start, 1], ...c.filter(([t]) => t > start), [end, c[c.length - 1][1]]];
csv('equity.csv', ['series', 't', 'pot', 'dd'], [...curveRows(clip(W.fin.curve), 'Flush playbook'), ...curveRows(clip(W.simple.curve), 'Simple version'), ...curveRows(clip(placebo.curve), 'Same rules at random times')]);

// 3. year by year
csv('years.csv', ['year', 'ret', 'flushes', 'good_market', 'bad_market'], Object.entries(F.years).map(([y, v]) => ({ year: y, ret: r4(v.m - 1), flushes: v.n, good_market: v.A, bad_market: v.B })));

// 4. the layer tests (chosen on 2017–2021 only)
csv('layers.csv', ['step', 'layer', 'what_it_does', 'kept', 'is_avg_trade', 'is_cagr', 'is_max_dd', 'is_ratio'], W.rows.map((r, i) => ({ step: i, layer: r.n, what_it_does: r.d || 'the starting point',
  kept: r.keep === null ? 'start' : r.keep ? 'kept' : 'dropped', is_avg_trade: r4(r.h1.avgTrade), is_cagr: r4(r.h1.cagr), is_max_dd: neg(r.h1.maxDD), is_ratio: r4(r.h1.maxDD > 0 ? r.h1.cagr / r.h1.maxDD : null) })));

// 5. the two halves of history
const half = (who, x, per) => ({ strategy: who, period: per, flushes: x.active, trades: x.trades, avg_trade: r4(x.avgTrade), win_rate: r4(x.wr), growth: r4(x.mult), cagr: r4(x.cagr), max_dd: neg(x.maxDD) });
csv('halves.csv', ['strategy', 'period', 'flushes', 'trades', 'avg_trade', 'win_rate', 'growth', 'cagr', 'max_dd'],
  [half('Flush playbook', h1, '2017–2021 (rules chosen here)'), half('Flush playbook', h2, '2022–2026 (never seen)'), half('Simple version', W.simple.h1, '2017–2021 (rules chosen here)'), half('Simple version', sh2, '2022–2026 (never seen)')]);

// 6. stress tests
const st = [['Base case: 0.15% slippage', s], ...Object.entries(F.stress).map(([k, v]) => [k, v])].filter(([k]) => !k.startsWith('30%'));
const label = { 'slip 0.5%': 'Slippage 0.5% on every market order', 'slip 1%': 'Slippage 1% on every market order', 'fill only 0.1% through': 'A bid fills only after trading 0.1% through it',
  '103 coins only': 'Only your 103 coins (no dead coins)', '10% a coin': '10% of the pot per coin instead of 20%', 'placebo (random times)': 'Same rules at 400 random times' };
const slipOf = { 'slip 0.5%': 0.005, 'slip 1%': 0.01 };
csv('stress.csv', ['test', 'slip', 'trades', 'avg_trade', 'growth', 'cagr', 'max_dd'], st.map(([k, v]) => ({ test: label[k] || k, slip: slipOf[k] ?? C.slip ?? BASE.slip, trades: v.trades, avg_trade: r4(v.avgTrade), growth: r4(v.mult), cagr: r4(v.cagr), max_dd: neg(v.maxDD) })));

// 7. every flush
const btc = new Map(F.btc.map((b) => [b.t, b]));
const ev = F.events.filter((e) => !e.skipped && e.filled);
csv('flushes.csv', ['t', 'when', 'market', 'btc_drop', 'btc_price', 'coins', 'filled', 'pot_ret', 'worst_inside', 'pot_used'], ev.map((e) => ({ t: iso(e.t), when: whenOf(e.t), market: e.mode === 'A' ? 'Good (buy at market)' : 'Bad (deep bids)',
  btc_drop: r4(btc.get(e.t).drop), btc_price: Math.round(btc.get(e.t).P), coins: F.trades.filter((t) => t.t === e.t).map((t) => t.sym).join(' '), filled: e.filled, pot_ret: r4(e.ret), worst_inside: r4(e.minRet), pot_used: r4(e.used) })));

// 8. every trade
const atrTxt = (x) => (x >= 0 ? '+' : '−') + Math.abs(x) + ' ATR';
const FIRST = { STOP: `stopped at ${atrTxt(-C.A.sl)}`, TIME: `sold after ${C.hold * 15 / 60}h`, END: 'sold at the window end', KILL: 'kill switch' };
const REST = { TP2: `rest at ${atrTxt(C.tp2)}`, BE: 'rest at breakeven', TIME: `rest after ${C.hold * 15 / 60}h`, END: 'rest at the window end', STOP: 'rest stopped', KILL: 'rest by kill switch' };
const exitText = (why) => { const [a, b] = why.split('+'); if (a !== 'TP1') return FIRST[a] || a; return `half at ${atrTxt(C.tp1)}` + (b ? ', ' + (REST[b] || b) : ''); };
csv('trades.csv', ['t', 'when', 'market', 'coin', 'delisted_later', 'trade_ret', 'pot_pnl', 'exits'], F.trades.map((t) => ({ t: iso(t.t), when: whenOf(t.t), market: t.mode === 'A' ? 'Good' : 'Bad', coin: t.sym, delisted_later: t.dead ? 'yes' : 'no',
  trade_ret: r4(t.ret), pot_pnl: r4(t.pnl), exits: exitText(t.why) })));

// 9. worked examples: every order of four real flushes
const best = ev.reduce((a, b) => (b.ret > a.ret ? b : a)), worst = ev.reduce((a, b) => (b.ret < a.ret ? b : a));
const goodB = ev.filter((e) => e.mode === 'B').sort((a, b) => b.ret - a.ret)[1], recentA = ev.filter((e) => e.mode === 'A' && e.t > Date.UTC(2025, 0, 1) / 1e3).slice(-1)[0];
const how = { market: 'market buy', limit: 'limit buy', TP1: `sell half at ${atrTxt(C.tp1)}`, TP2: `sell rest at ${atrTxt(C.tp2)}`, BE: 'sell rest at breakeven', STOP: 'stop', TIME: `sell after ${C.hold * 15 / 60}h`, KILL: 'kill switch', END: 'end' };
const byK = (k) => (k === 0 ? 'at the close' : `by +${k >= 4 ? Math.floor(k / 4) + 'h' : ''}${k % 4 ? (k % 4) * 15 + 'm' : ''}`);
const ex = [];
for (const [lab, e] of [['Best flush', best], ['Worst flush', worst], ['Bad market, deep bids', goodB], ['A recent, typical one', recentA]]) {
  for (const t of F.trades.filter((x) => x.t === e.t)) ex.push({ example: lab, t: iso(e.t), when: whenOf(e.t), market: e.mode === 'A' ? 'Good' : 'Bad', coin: t.sym, fell: r4(t.drop), daily_atr: r4(t.atrP),
    steps: t.log.map((l) => `${how[l.how] || l.how} ${l.px.toPrecision(5)} ${byK(l.k)}`).join(' → '), trade_ret: r4(t.ret), pot_pnl: r4(t.pnl) });
}
csv('examples.csv', ['example', 't', 'when', 'market', 'coin', 'fell', 'daily_atr', 'steps', 'trade_ret', 'pot_pnl'], ex);
