// Gold accumulation lab (Nov 2026, user request): build a position in tranches, keep the stop tied to the AVERAGE entry,
// hold long term. Rules are chosen on spot gold (XAUUSD daily) 2003-2019 only, then judged on 2020-2026 and on PAXG at
// 4h, 1d, 1w and 1M, the user's Compare settings, against the Compare tab's own rows on the same candles.
//   node research/goldacc/goldacc_lab.js design     # the grid on XAUUSD 2003-2019, best of each family
//   node research/goldacc/goldacc_lab.js report     # everything else, as markdown (RESULTS_goldacc_2026-11.md)
// Data: research/goldacc/data.js (fetch first). Stats are the Compare tab's own pathStats (0.1% a side, window sweep).
'use strict';
const { binance, xau, comparePathStats, SMC } = require('./data.js');
const pathStats = comparePathStats();

// ---------------------------------------------------------------- helpers
// Lookbacks count CALENDAR days through the series' own density: gold trades on weekdays (about 0.71 candles a day),
// PAXG every day. "200 days" is then 200 calendar days on both, on every timeframe (a monthly candle ≈ 30.4 days).
function spanOf(c) {
  const bpd = (c.length - 1) / ((c[c.length - 1].time - c[0].time) / 86400);
  return (days) => Math.max(2, Math.round(days * bpd));
}
function sma(x, len) {
  const out = new Array(x.length).fill(NaN); let s = 0;
  for (let i = 0; i < x.length; i++) { s += x[i]; if (i >= len) s -= x[i - len]; if (i >= len - 1) out[i] = s / len; }
  return out;
}
// highest / lowest close of the `len` candles BEFORE i
function priorMax(x, len) { const out = new Array(x.length).fill(NaN); for (let i = len; i < x.length; i++) { let m = -Infinity; for (let j = i - len; j < i; j++) if (x[j] > m) m = x[j]; out[i] = m; } return out; }
function priorMin(x, len) { const out = new Array(x.length).fill(NaN); for (let i = len; i < x.length; i++) { let m = Infinity; for (let j = i - len; j < i; j++) if (x[j] < m) m = x[j]; out[i] = m; } return out; }

// ---------------------------------------------------------------- the accumulation machine
// One campaign = up to N tranches of 1/N of the slot each, filled at a candle's close. The stop belongs to the whole
// position and is read from its AVERAGE entry: avg × (1 − stop). It is checked on the candle's low before any buy on
// that candle, and fills at the stop, or at the open when the candle opens below it. Once the position has been
// `lockAt` above its average, the stop rises to the average (a campaign that was well in profit never ends in a loss).
// Each family adds its own entry, add and close-based exit. Trades come out in detector.js's shape, with `fills`, so the
// Compare tab's pathStats and SMC.markMult read them exactly as they read the BTC Cycle's tranches.
const FAMILIES = {
  // DL: buy the dips of an uptrend. Uptrend = close above the T-day MA and that MA higher than 20 days ago. A dip is a
  // close under the D-day MA; each dip buys one tranche (re-armed by a close back above the D-day MA). Out when the
  // close falls b under the T-day MA. first:'regime' also buys the first tranche when the uptrend starts.
  DL: {
    grid: { T: [150, 200], D: [20, 50], N: [3, 4], stop: [0.08, 0.12, 0.16], b: [0, 0.03], lockAt: [0.1, null], first: ['dip', 'regime'] },
    make(c, p, S) {
      const cl = c.map((x) => x.close), maT = sma(cl, S(p.T)), maD = sma(cl, S(p.D)), sl = S(20);
      const up = (k) => cl[k] > maT[k] && maT[k] > maT[k - sl], dip = (k) => cl[k] < maD[k];
      return { warm: S(p.T) + sl, rearm: (k) => cl[k] > maD[k],
        entry: (k, armed) => up(k) && ((dip(k) && armed) || (p.first === 'regime' && !up(k - 1))),
        add: (k, armed) => up(k) && dip(k) && armed,
        exit: (k) => cl[k] < maT[k] * (1 - p.b) };
    },
  },
  // PY: pyramid on strength (the Turtle's way of building a position). First tranche on a close above the H-day high
  // while above the 200-day MA; one more each time the close is `step` above the last fill. Out on a close under the
  // X-day low or b under the 200-day MA.
  PY: {
    grid: { H: [55, 100], step: [0.03, 0.05], N: [3, 4], stop: [0.08, 0.12, 0.16], X: [20, 50], lockAt: [0.1, null] },
    make(c, p, S) {
      const cl = c.map((x) => x.close), maT = sma(cl, S(200)), hi = priorMax(cl, S(p.H)), lo = priorMin(cl, S(p.X));
      return { warm: Math.max(S(200), S(p.H), S(p.X)), rearm: () => true,
        entry: (k) => cl[k] > maT[k] && cl[k] > hi[k],
        add: (k, armed, pos) => cl[k] >= pos.last * (1 + p.step),
        exit: (k) => cl[k] < lo[k] || cl[k] < maT[k] };
    },
  },
  // VZ: value zone. While the 350-day MA (about 50 weeks) is rising, buy when the close is at most z above the 200-day MA
  // (a deep pullback of a long uptrend), and again each time it closes g under the last fill. Out when the 350-day MA
  // turns down and the close is under it. A stop-out waits for a close back above the 200-day MA before buying again.
  VZ: {
    grid: { z: [0, 0.03, 0.06], g: [0.03, 0.05], N: [3, 4], stop: [0.10, 0.15, 0.20], lockAt: [0.1, null] },
    make(c, p, S) {
      const cl = c.map((x) => x.close), maT = sma(cl, S(200)), maL = sma(cl, S(350)), sl = S(60);
      const longUp = (k) => maL[k] > maL[k - sl], zone = (k) => cl[k] <= maT[k] * (1 + p.z);
      return { warm: S(350) + sl, rearm: (k) => cl[k] > maT[k],
        entry: (k, armed) => armed && longUp(k) && zone(k),
        add: (k, armed, pos) => zone(k) && cl[k] <= pos.last * (1 - p.g),
        exit: (k) => !longUp(k) && cl[k] < maL[k] };
    },
  },
  // MS: staged trend. While the close is above the T-day MA (210 ≈ 10 months, Faber's rule), buy one tranche when the
  // trend starts and one more every `every` days, up to N. Out when the close falls b under the MA.
  MS: {
    grid: { T: [150, 210], every: [20, 30, 60], N: [3, 4, 6], stop: [0.10, 0.15, null], b: [0, 0.03] },
    make(c, p, S) {
      const cl = c.map((x) => x.close), maT = sma(cl, S(p.T)), gap = S(p.every);
      return { warm: S(p.T), rearm: () => true,
        entry: (k) => cl[k] > maT[k],
        add: (k, armed, pos) => cl[k] > maT[k] && k - pos.lastIdx >= gap,
        exit: (k) => cl[k] < maT[k] * (1 - p.b) };
    },
  },
};

function accumulate(c, fam, p, opt = {}) {
  const S = spanOf(c), F = FAMILIES[fam].make(c, p, S), n = c.length, cl = c.map((x) => x.close);
  const N = p.N || 1, w = 1 / N, out = [];
  let pos = null, armed = true;
  const fill = (k) => { pos.fills.push({ idx: k, w, px: cl[k] }); pos.inv += w / cl[k]; pos.frac += w; pos.avg = pos.frac / pos.inv;
    pos.last = cl[k]; pos.lastIdx = k; armed = false; };
  const stopPx = () => (p.stop == null ? -Infinity : Math.max(pos.avg * (1 - p.stop), pos.locked ? pos.avg : -Infinity));
  const close = (k, px, why) => {
    out.push({ entryIdx: pos.fills[0].idx, exitIdx: k, entry: pos.avg, exitPrice: px, frac: pos.frac, fills: pos.fills,
      stop: p.stop == null ? null : pos.fills[0].px * (1 - p.stop), outcome: px >= pos.avg ? 'win' : 'loss', targetPool: why, tranches: pos.fills.length });
    pos = null;
  };
  for (let k = Math.max(F.warm + 1, opt.startIdx || 0); k < n; k++) {
    if (!armed && F.rearm(k)) armed = true;
    if (pos) {
      const st = stopPx();
      if (c[k].low <= st) { close(k, Math.min(c[k].open, st), 'STOP'); armed = false; continue; }
      if (F.exit(k)) { close(k, cl[k], 'TREND'); continue; }
      if (p.lockAt != null && cl[k] >= pos.avg * (1 + p.lockAt)) pos.locked = true;
      if (pos.fills.length < N && F.add(k, armed, pos)) fill(k);
    } else if (F.entry(k, armed)) { pos = { fills: [], inv: 0, frac: 0, avg: 0, locked: false }; fill(k); }
  }
  if (pos) out.push({ entryIdx: pos.fills[0].idx, exitIdx: n - 1, entry: pos.avg, exitPrice: cl[n - 1], frac: pos.frac, fills: pos.fills,
    stop: null, outcome: 'open', targetPool: 'OPEN', tranches: pos.fills.length });
  return out;
}

// stats on [from, to): the strategy runs on all the candles it has (warm indicators) but may only open from `from` on,
// so every window starts flat (a position bought before it never counts); the curve and holding are read on the window.
function windowStats(c, trades, from = -Infinity, to = Infinity) {
  const i0 = c.findIndex((x) => x.time >= from), i1 = to === Infinity ? c.length : c.findIndex((x) => x.time >= to);
  const sub = c.slice(i0, i1 < 0 ? c.length : i1), last = sub.length - 1;
  const T = trades.filter((t) => t.entryIdx >= i0 && t.entryIdx - i0 <= last).map((t) => {
    const cut = t.exitIdx - i0 > last;                           // still open at the window's end: marked there
    const fills = t.fills.filter((f) => f.idx - i0 <= last).map((f) => ({ ...f, idx: f.idx - i0 }));
    const inv = fills.reduce((s, f) => s + f.w / f.px, 0), frac = fills.reduce((s, f) => s + f.w, 0);
    return { ...t, fills, frac, entry: frac / inv, entryIdx: t.entryIdx - i0, exitIdx: cut ? last : t.exitIdx - i0,
      exitPrice: cut ? sub[last].close : t.exitPrice, outcome: cut ? 'open' : t.outcome };
  });
  const e = pathStats(T, sub), cagr = Math.pow(1 + e.net, 1 / e.yrs) - 1;
  return Object.assign(e, { cagr, mar: e.dd > 0 ? cagr / e.dd : Infinity, trades: T });
}
// holding, as a row: one trade from the first candle to the last
function holdStats(c) {
  const t = { entryIdx: 0, exitIdx: c.length - 1, entry: c[0].close, exitPrice: c[c.length - 1].close, frac: 1, outcome: 'open', targetPool: 'HOLD' };
  const e = pathStats([t], c), cagr = Math.pow(1 + e.net, 1 / e.yrs) - 1;
  return Object.assign(e, { cagr, mar: e.dd > 0 ? cagr / e.dd : Infinity });
}

// ---------------------------------------------------------------- the grid
const combos = (grid) => Object.entries(grid).reduce((acc, [k, vs]) => acc.flatMap((a) => vs.map((v) => ({ ...a, [k]: v }))), [{}]);
const keyOf = (p) => JSON.stringify(p);
// a combo's score is the median return-per-drawdown of itself and every combo one step away on one setting, so a lone
// spike between weak neighbours can't win
function design(c, from, to, minTrades = 6) {
  const res = {};
  for (const fam of Object.keys(FAMILIES)) {
    const grid = FAMILIES[fam].grid, all = combos(grid), byKey = new Map();
    for (const p of all) { const e = windowStats(c, accumulate(c, fam, p), from, to); byKey.set(keyOf(p), { p, e }); }
    const scored = all.map((p) => {
      const near = [byKey.get(keyOf(p))];
      for (const [k, vs] of Object.entries(grid)) { const i = vs.indexOf(p[k]);
        for (const j of [i - 1, i + 1]) if (j >= 0 && j < vs.length) near.push(byKey.get(keyOf({ ...p, [k]: vs[j] }))); }
      const m = near.map((x) => (x.e.n >= minTrades ? x.e.mar : 0)).sort((a, b) => a - b);
      return { ...byKey.get(keyOf(p)), score: m[Math.floor(m.length / 2)], plateau: m };
    }).filter((x) => x.e.n >= minTrades).sort((a, b) => b.score - a.score);
    res[fam] = { scored, n: all.length };
  }
  return res;
}

// ---------------------------------------------------------------- printing
const pc = (x, d = 0) => (x == null || !isFinite(x) ? '—' : (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(d) + '%');
const f2 = (x) => (x == null ? '—' : !isFinite(x) ? '∞' : x.toFixed(2));
const pStr = (p) => Object.entries(p).map(([k, v]) => `${k} ${v == null ? '–' : v}`).join(', ');
const stable = (e) => (e.sweep && (e.n || e.expo > 0) ? `${Math.round(e.sweep.pos * 100)}%` : '—');
const share = (x) => `${Math.round(x * 100)}%`;

const IS = [Date.UTC(2003, 0, 1) / 1000, Date.UTC(2020, 0, 1) / 1000], OOS = [Date.UTC(2020, 0, 1) / 1000, Infinity];
const HALVES = [[Date.UTC(2003, 0, 1) / 1000, Date.UTC(2012, 0, 1) / 1000], [Date.UTC(2012, 0, 1) / 1000, Date.UTC(2020, 0, 1) / 1000]];

module.exports = { FAMILIES, accumulate, windowStats, holdStats, design, spanOf, IS, OOS, HALVES, pc, f2, pStr, stable, combos };

if (require.main === module && process.argv[2] === 'design') {
  const c = xau().filter((x) => x.time < IS[1]), hold = holdStats(c.filter((x) => x.time >= IS[0]));
  console.log(`XAUUSD daily 2003-2019, holding: ${pc(hold.net)} (${pc(hold.cagr, 1)} a year), max DD ${pc(-hold.dd)}, return per drawdown ${f2(hold.mar)}\n`);
  const R = design(c, IS[0], IS[1]);
  for (const [fam, { scored, n }] of Object.entries(R)) {
    console.log(`${fam}: ${n} combos, ${scored.length} with 6+ campaigns`);
    for (const x of scored.slice(0, 4)) console.log(`  score ${f2(x.score)} | own ${f2(x.e.mar)} | ${pc(x.e.net)} (${pc(x.cagr != null ? x.cagr : x.e.cagr, 1)}/yr) DD ${pc(-x.e.dd)} n ${x.e.n} WR ${pc(x.e.wr)} in ${pc(x.e.expo)} | ${pStr(x.p)}`);
  }
}

// ---------------------------------------------------------------- the choice, fixed before any out-of-sample run
// Rule (declared on 2003-2019 only): the best plateau score (median return per drawdown of a setting and its one-step
// neighbours) among settings with 6+ campaigns that keep at least two-thirds of holding's yearly growth. Ties: the
// setting's own return per drawdown, then the tighter stop.
function choose(c) {
  const hold = holdStats(c.filter((x) => x.time >= IS[0] && x.time < IS[1])), floor = (2 / 3) * hold.cagr;
  const R = design(c.filter((x) => x.time < IS[1]), IS[0], IS[1]), all = [];
  for (const [fam, { scored }] of Object.entries(R)) for (const x of scored) if (x.e.cagr >= floor) all.push({ fam, ...x });
  all.sort((a, b) => b.score - a.score || b.e.mar - a.e.mar || (a.p.stop == null) - (b.p.stop == null) || (a.p.stop || 0) - (b.p.stop || 0));
  return { pick: all[0], hold, floor, R };
}
module.exports.choose = choose;

const CMP = [['cycle', 'BTC Cycle'], ['tsmom', 'Trend Follow'], ['donch', 'Turtle'], ['liqbrk', 'Liq Breakout']];
function compareRows(tf) {            // the Compare tab's rows on PAXG, computed the way the tab computes them
  const c = binance('PAXGUSDT', tf), btcAll = binance('BTCUSDT', tf), btcD = binance('BTCUSDT', '1d');
  const btc = btcAll.filter((x) => x.time >= c[0].time - 51 * 86400);
  return CMP.map(([st, name]) => {
    const r = SMC.detectAll(c, { strategy: st, longOnly: true, useLiq: false, btc, btcD });
    const e = pathStats(r.trades, c), cagr = Math.pow(1 + e.net, 1 / e.yrs) - 1;
    return { name, e: Object.assign(e, { cagr, mar: e.dd > 0 ? cagr / e.dd : Infinity }) };
  });
}
function goldRow(c) {                 // the shipped `gold` strategy, as the Chart tab runs it on this symbol
  const r = SMC.detectAll(c, { strategy: 'gold', longOnly: true, useLiq: false });
  const e = pathStats(r.trades, c), cagr = Math.pow(1 + e.net, 1 / e.yrs) - 1;
  return Object.assign(e, { cagr, mar: e.dd > 0 ? cagr / e.dd : Infinity });
}
// ---------------------------------------------------------------- the report
function row(name, e, bh) {
  const traded = e.n > 0 || e.expo > 0;
  return `| ${name} | ${e.n} | ${pc(e.net, 1)} | ${bh == null ? '—' : pc((1 + e.net) / (1 + bh) - 1, 1)} | ${e.n ? f2(e.pf) : '—'} | ${traded ? pc(-e.dd) : '—'} | ${e.n ? share(e.wr) : '—'} | ${share(e.expo)} | ${stable(e)} | ${traded ? f2(e.mar) : '—'} |`;
}
const HEAD = '| | Trades | Net P/L | vs B&H | PF | Max DD | Win rate | In mkt | Stable | Return per DD |\n|---|---|---|---|---|---|---|---|---|---|';
function report() {
  const X = xau(), { pick, hold: hIS, floor, R } = choose(X), P = pick.p, out = [], say = (s = '') => out.push(s);
  const need = (cond, what) => { if (!cond) throw new Error('report check failed: ' + what); };
  say('# Gold accumulation: buy in tranches, stop from the average (Nov 2026)');
  say();
  say(`Generated by \`node research/goldacc/goldacc_lab.js report\` on ${new Date().toISOString().slice(0, 10)}. Research only: the app and the bot don't use it.`);
  say();
  say('## The rules that were chosen');
  say();
  say(`Family **${pick.fam}** (dip ladder), settings ${pStr(P)}:`);
  say(`- **Uptrend**: the close is above its ${P.T}-day average and that average is higher than 20 days ago.`);
  say(`- **Accumulate**: in an uptrend, every dip buys one tranche of ${Math.round(100 / P.N)}% of the slot, up to ${P.N}. A dip is a close under the ${P.D}-day average; the next dip counts once the close has been back above it.`);
  say(`- **Stop from the average**: the whole position is sold if price touches ${Math.round(P.stop * 100)}% under its average entry (filled there, or at the open if it opens lower). After a close ${Math.round(P.lockAt * 100)}% above the average, the stop rises to the average itself: a campaign that was well in profit can then lose only what a gap through the stop costs.`);
  say(`- **Out**: a close ${Math.round(P.b * 100)}% under the ${P.T}-day average.`);
  say('- Lookbacks count calendar days (gold trades on weekdays, PAXG every day), so they read the same on 4h, 1d, 1w and 1M candles. 0.1% a side, as in Compare.');
  say();
  say('## How they were chosen (spot gold, XAUUSD daily, 2003-2019 only)');
  say();
  say(`Four families of tranche buying, every setting of a small grid each (${Object.values(R).reduce((s, x) => s + x.n, 0)} in all). The rule, fixed before any later data was run: the best **plateau score** (the median return per drawdown of a setting and its one-step neighbours) among settings with 6+ campaigns that keep at least two-thirds of holding's yearly growth (${pc(floor, 1)} of ${pc(hIS.cagr, 1)}). Holding gold 2003-2019: ${pc(hIS.net)}, max DD ${pc(-hIS.dd)}, return per drawdown ${f2(hIS.mar)}.`);
  say();
  say('| family | what it does | best plateau score | its growth a year | max DD | campaigns |');
  say('|---|---|---|---|---|---|');
  const what = { DL: 'buys the dips of an uptrend', PY: 'adds on strength (Turtle pyramiding)', VZ: 'buys deep pullbacks to the 200-day in a long uptrend', MS: 'adds every few weeks while above the 10-month average' };
  for (const [fam, { scored }] of Object.entries(R)) { const x = scored[0];
    say(`| ${fam} | ${what[fam]} | ${f2(x.score)} | ${pc(x.e.cagr, 1)} | ${pc(-x.e.dd)} | ${x.e.n} |`); }
  say();
  say(`Value zone (VZ) and pyramid (PY) keep their drawdowns small by barely holding gold (under ${pc(Math.max(R.VZ.scored[0].e.cagr, R.PY.scored[0].e.cagr), 1)} a year), so they miss the growth floor. The stop level made no difference to the chosen family's 2003-2019 result (8%, 12% and 16% gave the same campaigns), so the tightest was taken.`);
  say();
  const halves = HALVES.map(([a, b]) => { const c = X.filter((x) => x.time < b); return { a, b, e: windowStats(c, accumulate(c, pick.fam, P), a, b), h: holdStats(c.filter((x) => x.time >= a)) }; });
  say('Both halves of the design years:');
  say();
  say('| | dip ladder | holding |'); say('|---|---|---|');
  for (const x of halves) say(`| ${new Date(x.a * 1000).getUTCFullYear()}-${new Date(x.b * 1000).getUTCFullYear() - 1} | ${pc(x.e.net)}, DD ${pc(-x.e.dd)}, ${x.e.n} campaigns | ${pc(x.h.net)}, DD ${pc(-x.h.dd)} |`);
  say();
  // ------------------------------------------------ out of sample: spot gold 2020-2026
  const oos = windowStats(X, accumulate(X, pick.fam, P), OOS[0], OOS[1]), hO = holdStats(X.filter((x) => x.time >= OOS[0]));
  const stops = oos.trades.filter((t) => t.targetPool === 'STOP');
  say('## Out of sample: spot gold, 2020 to Nov 2026');
  say();
  say(HEAD);
  say(row('Gold accumulation (dip ladder)', oos, hO.net));
  say(row('Holding gold', hO, hO.net));
  say();
  say('Its campaigns:');
  say();
  const dayOf = (c, i) => new Date(c[i].time * 1000).toISOString().slice(0, 10), Xo = X.filter((x) => x.time >= OOS[0]);
  for (const t of oos.trades) say(`- ${dayOf(Xo, t.entryIdx)} → ${dayOf(Xo, t.exitIdx)}: ${t.fills.length} tranche${t.fills.length === 1 ? '' : 's'}, average ${t.entry.toFixed(0)}, out at ${t.exitPrice.toFixed(0)} (${pc(t.exitPrice / t.entry - 1, 1)}, ${t.outcome === 'open' ? 'still open' : t.targetPool === 'STOP' ? 'stop' : 'trend exit'})`);
  say();
  // ------------------------------------------------ the comparison the user asked for: PAXG, Compare's settings
  say('## Against your Compare rows: PAXG, all history (Aug 2020 →), each timeframe');
  say();
  say('Compare\'s settings from your screenshot (All strategies, 22,500 bars = all history, Window sweep on), Compare\'s own statistics. "Gold (shipped)" is the app\'s existing gold strategy, as the Chart tab runs it on PAXG. "Return per DD" is the yearly growth divided by the worst fall.');
  const sum = {};
  for (const tf of ['4h', '1d', '1w', '1M']) {
    const c = binance('PAXGUSDT', tf), e = windowStats(c, accumulate(c, pick.fam, P)), h = holdStats(c), rows = compareRows(tf), g = goldRow(c);
    sum[tf] = { e, h, rows, g };
    say(); say(`### ${tf}`); say(); say(HEAD);
    const all = [{ name: '**Gold accumulation (new)**', e }, ...rows, { name: 'Gold (shipped)', e: g }, { name: 'Holding PAXG', e: h }];
    for (const x of all) say(row(x.name, x.e, h.net));
  }
  say();
  // ------------------------------------------------ checks: what each design choice is worth
  const Xis = X.filter((x) => x.time < IS[1]), pd = binance('PAXGUSDT', '1d');
  const variants = [
    ['The chosen rules', P],
    ['All at once on the first dip (no tranches)', { ...P, N: 1 }],
    ['Tranches, but no stop and no break-even', { ...P, stop: null, lockAt: null }],
    ['Tranches and the 8% stop, no break-even', { ...P, lockAt: null }],
    ['First tranche when the uptrend starts', { ...P, first: 'regime' }],
    ['The uptrend alone: all in when it starts, no stop', { ...P, N: 1, first: 'regime', stop: null, lockAt: null }],
  ].map(([name, q]) => ({ name, q, is: windowStats(Xis, accumulate(Xis, pick.fam, q), IS[0], IS[1]),
    oos: windowStats(X, accumulate(X, pick.fam, q), OOS[0], OOS[1]), paxg: windowStats(pd, accumulate(pd, pick.fam, q)) }));
  const cell = (e) => `${pc(e.net, 1)} / ${pc(-e.dd)} / ${f2(e.mar)}`;
  say('## What each design choice is worth');
  say();
  say('Net / max drawdown / return per drawdown. Spot gold for the first two columns, PAXG daily for the third.');
  say();
  say('| | 2003-2019 (design) | 2020-2026 (test) | PAXG 1d |'); say('|---|---|---|---|');
  for (const v of variants) say(`| ${v.name} | ${cell(v.is)} | ${cell(v.oos)} | ${cell(v.paxg)} |`);
  say();
  const nb = [];
  for (const [k, vs] of Object.entries(FAMILIES[pick.fam].grid)) { const i = vs.indexOf(P[k]);
    for (const j of [i - 1, i + 1]) if (j >= 0 && j < vs.length) { const q = { ...P, [k]: vs[j] }; nb.push({ k, v: vs[j], e: windowStats(X, accumulate(X, pick.fam, q), OOS[0], OOS[1]) }); } }
  say(`**Neighbouring settings on 2020-2026** (one setting changed at a time; net / max DD): ${nb.map((x) => `${x.k} ${x.v == null ? '–' : x.v}: ${pc(x.e.net)} / ${pc(-x.e.dd)}`).join('; ')}.`);
  say();
  for (const t of oos.trades.filter((x) => x.targetPool === 'STOP' && x.exitPrice < x.entry * 0.99)) {
    const k = t.exitIdx, ck = Xo[k].close;
    say(`The 8% stop sold on ${dayOf(Xo, k)} at ${t.exitPrice.toFixed(0)}, a candle that closed at ${ck.toFixed(0)}. Compare's statistics mark every exit at its candle's close (for every strategy alike), so the tables count ${ck.toFixed(0)}: a real stop order fills ${pc(t.exitPrice / ck - 1, 1)} under that, ${pc((t.exitPrice / ck - 1) * t.frac, 1)} of the account on this ${t.fills.length}-tranche campaign. That is why "the 8% stop, no break-even" matches "no stop" above: without the stop the trend exit sold the same day, at the close.`);
    say();
  }
  const hard = stops.filter((t) => t.exitPrice < t.entry * 0.99).length;
  say(`**The stop in 2020-2026**: ${stops.length} of ${oos.trades.length} campaigns ended on it, ${hard} on the 8% stop and ${stops.length - hard} on the break-even stop.`);
  say();
  return { text: out.join('\n'), pick, oos, hO, sum, variants, nb, halves, stops, need };
}
module.exports.report = report;
if (require.main === module && process.argv[2] === 'report') console.log(report().text);
