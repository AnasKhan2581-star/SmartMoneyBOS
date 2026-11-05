/*
 * liqbrk on 15m: is "BTC above its 50-day MA" the right market gate there? (Nov 2026, user question)
 * RESEARCH ONLY: detector.js, the webapp and the bot are unchanged.
 *
 *   NODE_USE_ENV_PROXY=1 node research/liqbrk15m/fetch15.js     # 103 coins, full 15m history → research/cache/lb15
 *   node research/liqbrk15m/lab15.js parity [k/m]               # fast replica vs detector.js, trade for trade
 *   node research/liqbrk15m/lab15.js run                        # every gate × every coin → research/cache/lb15/run.json
 *   node research/liqbrk15m/lab15.js scenario                   # today's top 50 gainers, last 3 months (Compare date mode)
 *   node research/liqbrk15m/report15.js > research/liqbrk15m/RESULTS_liqbrk15m_2026-11.md
 *
 * Every variant changes ONE thing: which candles a buy is allowed on. Signals (2-day-high break, 5-day SMA,
 * 149-bar MA, 1.3× volume, 1×ATR decisive break) and exits (4×ATR stop, prior-1-day-low trail, ½ at +3R) are the
 * shipped ones, run by research/liqbrk_lab.js — whose output this file checks against detector.js itself.
 */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const { SMC, indicators, simulate } = require('../liqbrk_lab.js');
const DATA = path.join(ROOT, 'research', 'cache', 'lb15');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// ---------------------------------------------------------------- the app's own Compare stats
const grab = (name) => {
  const i = html.indexOf(`function ${name}(`); if (i < 0) throw new Error(name + ' not found in index.html');
  let j = html.indexOf('{', i), d = 0;
  for (; j < html.length; j++) { if (html[j] === '{') d++; else if (html[j] === '}' && --d === 0) break; }
  return html.slice(i, j + 1);
};
const PS = grab('pathStats');
if (!PS.includes('return { net, bh,')) throw new Error('pathStats changed: update the eq patch');
// the same function, also handing back its equity path (for the equal-weight basket)
const pathStats = new Function('SMC', PS.replace('return { net, bh,', 'return { eq, net, bh,') + '\nreturn pathStats;')(SMC);
// …and with 0.05% slippage a side on top of the fee, the research "honest fill" (as research/tfcmp does)
const SLIP = 0.0005;
const slipSrc = (() => {
  const a = 'r[t.exitIdx]-=f*0.002;', b = '(t.exitPrice/t.entry)*(1-0.001)/(1+0.001)-1';
  if (!PS.includes(a) || !PS.includes(b)) throw new Error('pathStats changed: update the slippage patch');
  return PS.replace(a, `r[t.exitIdx]-=f*(0.002+${2 * SLIP});`).replace(b, `(t.exitPrice/t.entry)*(1-0.001-${SLIP})/(1+0.001+${SLIP})-1`);
})();
const pathStatsSlip = new Function('SMC', slipSrc + '\nreturn pathStats;')(SMC);
const LIST = html.match(/const CMP_DEFAULT=\[([\s\S]*?)\]\.map/)[1].match(/'([A-Z0-9]+)'/g).map((s) => s.slice(1, -1) + 'USDT');

// ---------------------------------------------------------------- data
function load(sym, dir = DATA) {
  const f = path.join(dir, `${sym}_15m.json`);
  if (!fs.existsSync(f)) return null;
  return JSON.parse(fs.readFileSync(f)).map((r) => ({ time: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] }));
}

// ---------------------------------------------------------------- BTC states, per BTC candle
// Price-vs-MA uses detector.js's exact arithmetic (running sum, strict >), so `ma(50)` IS the shipped gate.
function btcStates(B) {
  const n = B.length, dB = Math.max(60, B[1].time - B[0].time), memo = {};
  const above = (L) => memo['a' + L] || (memo['a' + L] = (() => {
    const up = new Array(n).fill(false); let s = 0;
    for (let j = 0; j < n; j++) { s += B[j].close; if (j >= L) s -= B[j - L].close; if (j >= L - 1) up[j] = B[j].close > s / L; }
    return up;
  })());
  const D = (d) => Math.max(2, Math.round(d * 86400 / dB));
  const ret = (days) => memo['r' + days] || (memo['r' + days] = (() => {
    const L = D(days); return B.map((b, j) => (j >= L ? b.close / B[j - L].close - 1 : NaN));
  })());
  return { B, n, dB, ma: (d) => above(D(d)), maBars: (L) => above(L), ret };
}
// for each coin candle, the last BTC candle CLOSED by that candle's close (detector.js's two-pointer)
function alignIdx(c, S) {
  const n = c.length, dt = n > 1 ? Math.max(60, c[1].time - c[0].time) : 86400, out = new Int32Array(n), B = S.B;
  for (let i = 0, j = -1; i < n; i++) { while (j + 1 < S.n && B[j + 1].time + S.dB <= c[i].time + dt) j++; out[i] = j; }
  return out;
}
// the coin's own 30-day leader rescue, as detector.js computes it
function leadArr(c, pump = 0.5, days = 30) {
  const n = c.length, dt = n > 1 ? Math.max(60, c[1].time - c[0].time) : 86400, L = Math.max(2, Math.round(days * 86400 / dt));
  const o = new Array(n).fill(false);
  if (pump > 0) for (let i = L; i < n; i++) o[i] = c[i].close >= (1 + pump) * c[i - L].close;
  return o;
}

// ---------------------------------------------------------------- the gates (pre-registered before any result was seen)
// Each returns, per coin candle, whether a buy signal on it may be taken. `L` = the 30-day leader rescue.
const YR = 365 * 96;                                   // one year of 15m candles, for the placebo shifts
const GATES = [
  // baselines
  ['none',   'no market gate (the rules before Oct 2026, with ½ at +3R)', null],
  ['ship',   'SHIPPED: BTC > 50-day MA, or the coin +50% in 30 days', (s, j, L) => (j >= 0 && s.ma(50)[j]) || L],
  ['btc50',  'BTC > 50-day MA, no leader rescue', (s, j) => j >= 0 && s.ma(50)[j]],
  // is the slow regime effect a plateau on 15m, as on 2h/4h?
  ['ma20',   'BTC > 20-day MA, or a 30-day leader', (s, j, L) => (j >= 0 && s.ma(20)[j]) || L],
  ['ma100',  'BTC > 100-day MA, or a 30-day leader', (s, j, L) => (j >= 0 && s.ma(100)[j]) || L],
  ['ma200',  'BTC > 200-day MA, or a 30-day leader', (s, j, L) => (j >= 0 && s.ma(200)[j]) || L],
  // horizon-matched: a 15m trade lasts ~1 day, so read BTC on the coin's own short horizons
  ['ma5',    'BTC > 5-day MA (the horizon of the coin\'s own trend filter), or a leader', (s, j, L) => (j >= 0 && s.ma(5)[j]) || L],
  ['ma149b', 'BTC > its 149-bar MA (≈37h on 15m: the filter the coin itself must pass), or a leader', (s, j, L) => (j >= 0 && s.maBars(149)[j]) || L],
  ['up24',   'BTC up over the last 24h, or a leader', (s, j, L) => (j >= 0 && s.ret(1)[j] > 0) || L],
  // both horizons
  ['either', 'shipped gate OR BTC > its 149-bar MA (loosen: a BTC bounce opens it)', (s, j, L) => (j >= 0 && (s.ma(50)[j] || s.maBars(149)[j])) || L],
  ['both',   'BTC > 50-day MA AND > its 149-bar MA, or a leader (tighten)', (s, j, L) => (j >= 0 && s.ma(50)[j] && s.maBars(149)[j]) || L],
  // the Sep 2026 1h finding: veto only BTC weakness
  ['mom30v', 'skip only while BTC is down >10% over 30 days (Sep 2026 1h veto)', (s, j) => !(j >= 0 && s.ret(30)[j] < -0.10)],
  // placebo: the shipped gate with BTC's state taken from a different year (keeps how often and how long it is
  // open, breaks the link to the market the trade is in); the coin's own leader rescue stays real
  ...[-3, -2, -1, 1, 2, 3].map((k) => [`plc${k > 0 ? '+' : ''}${k}`, `placebo: shipped gate with BTC's state ${k > 0 ? k + 'y later' : -k + 'y earlier'} (circular)`,
    (s, j, L) => { if (j < 0) return L; const m = ((j + k * YR) % s.n + s.n) % s.n; return s.ma(50)[m] || L; }]),
  // FOLLOW-UP, added after the first run showed `both` ahead in every block: is that a plateau or one lucky MA
  // length, and is the short-term BTC state real information or just fewer trades?
  ...[96, 192, 288, 480].map((L0) => [`and${L0}`, `follow-up: BTC > 50-day MA AND > its ${L0}-bar MA (${L0 / 96} day${L0 > 96 ? 's' : ''}), or a leader`,
    (s, j, L) => (j >= 0 && s.ma(50)[j] && s.maBars(L0)[j]) || L]),
  ...[-2, -1, 1, 2].map((k) => [`andplc${k > 0 ? '+' : ''}${k}`, `follow-up placebo: real 50-day gate AND BTC's 149-bar state from ${k > 0 ? k + 'y later' : -k + 'y earlier'}`,
    (s, j, L) => { if (j < 0) return L; const m = ((j + k * YR) % s.n + s.n) % s.n; return (s.ma(50)[j] && s.maBars(149)[m]) || L; }]),
];

// ---------------------------------------------------------------- one coin, one gate
// lab trades → the detector.js trade shape that pathStats and SMC.markMult read
function toDet(run, c) {
  const out = [];
  for (const m of run.trades) {
    const ex = m.legs.reduce((s, l) => s + l.w * l.px, 0);
    const sc = m.legs.length > 1 ? { idx: m.legs[0].i, px: m.legs[0].px, w: 0.5 } : null;
    out.push({ entryIdx: m.entryIdx - 1, exitIdx: m.exitIdx, entry: m.entry, stop: m.stop, exitPrice: ex, scale: sc,
      outcome: (ex - m.entry) / (m.entry - m.stop) >= 0 ? 'win' : 'loss', frac: 1, why: m.why });
  }
  if (run.open) {
    const o = run.open, n = c.length, last = c[n - 1].close;
    const sc = o.legs.length ? { idx: o.legs[0].i, px: o.legs[0].px, w: 0.5 } : null;
    out.push({ entryIdx: o.entryIdx - 1, exitIdx: n - 1, entry: o.entry, stop: o.stop0, exitPrice: sc ? sc.w * sc.px + (1 - sc.w) * last : last,
      scale: sc, outcome: 'open', frac: 1, why: 'OPEN' });
  }
  return out;
}
function runGate(c, ind, S, jIdx, lead, g) {
  const veto = g ? Array.from({ length: c.length }, (_, i) => !!g(S, jIdx[i], lead[i])) : undefined;
  return toDet(simulate(c, ind, { fill: 'close', exit: 'scale3R', veto }), c);
}
const netOf = (t) => (t.exitPrice / t.entry) * (1 - 0.001) / (1 + 0.001) - 1;     // pathStats' per-trade net

// stats on a sub-window [a, b) of the candles: trades that open AND close inside it, re-indexed
function windowStats(c, T, a, b, slip) {
  let i0 = 0; while (i0 < c.length && c[i0].time < a) i0++;
  let i1 = i0; while (i1 < c.length && c[i1].time < b) i1++;
  if (i1 - i0 < 250) return null;
  const sub = c.slice(i0, i1), TT = [];
  for (const t of T) {
    if (t.entryIdx < i0 || t.exitIdx >= i1) continue;
    TT.push({ ...t, entryIdx: t.entryIdx - i0, exitIdx: t.exitIdx - i0, scale: t.scale ? { ...t.scale, idx: t.scale.idx - i0 } : null });
  }
  return (slip ? pathStatsSlip : pathStats)(TT, sub);
}

module.exports = { load, btcStates, alignIdx, leadArr, GATES, toDet, runGate, netOf, windowStats, pathStats, pathStatsSlip, LIST, DATA, SMC, indicators };

// ---------------------------------------------------------------- CLI
const mode = require.main === module ? process.argv[2] : null;
const iso = (t) => new Date(t * 1000).toISOString().slice(0, 10);

if (mode === 'parity') {
  // the replica must reproduce detector.js trade for trade: shipped gate (real BTC 15m) and no gate
  const [k, m] = (process.argv[3] || '0/1').split('/').map(Number);
  const BTC = load('BTCUSDT'), S = btcStates(BTC);
  let bad = 0, total = 0, trades = 0; const t0 = Date.now();
  LIST.forEach((sym, idx) => {
    if (idx % m !== k) return;
    const c = load(sym); if (!c || c.length < 600) return;
    const ind = indicators(c), jIdx = alignIdx(c, S), lead = leadArr(c);
    for (const [name, g, prm] of [['ship', GATES.find((x) => x[0] === 'ship')[2], { btc: BTC }], ['none', null, { lbBtcMaDays: 0 }]]) {
      const ref = SMC.detectAll(c, { strategy: 'liqbrk', longOnly: true, useLiq: false, ...prm }).trades;
      const mine = runGate(c, ind, S, jIdx, lead, g);
      const same = ref.length === mine.length && ref.every((r, i) => {
        const q = mine[i];
        return r.entryIdx === q.entryIdx && r.exitIdx === q.exitIdx && r.outcome === q.outcome && r.entry === q.entry
          && Math.abs(r.exitPrice - q.exitPrice) <= 1e-12 * r.exitPrice && (!!r.scale === !!q.scale) && (!r.scale || (r.scale.idx === q.scale.idx && r.scale.px === q.scale.px));
      });
      total++; trades += ref.length;
      if (!same) { bad++; console.log(`MISMATCH ${sym} ${name}: detector ${ref.length} trades, replica ${mine.length}`); }
    }
    process.stderr.write(`${sym} ok · ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
  });
  console.log(bad ? `${bad}/${total} MISMATCHED` : `PARITY OK: ${total} coin runs (${trades} trades) reproduce detector.js trade for trade [part ${k}/${m}]`);
}

if (mode === 'run') {
  // periods: two-year blocks, each its own market (2018 bear · 2021–22 bull+bear · 2023–24 · 2025→)
  const PER = [['all', 0, Infinity], ['2018–20', Date.UTC(2018, 0, 1) / 1e3, Date.UTC(2021, 0, 1) / 1e3], ['2021–22', Date.UTC(2021, 0, 1) / 1e3, Date.UTC(2023, 0, 1) / 1e3],
    ['2023–24', Date.UTC(2023, 0, 1) / 1e3, Date.UTC(2025, 0, 1) / 1e3], ['2025–26', Date.UTC(2025, 0, 1) / 1e3, Infinity],
    ['last 4y', Date.UTC(2022, 9, 28) / 1e3, Infinity], ['last 3m', Date.UTC(2026, 7, 5) / 1e3, Infinity]];
  const BTC = load('BTCUSDT'), S = btcStates(BTC);
  const rows = [], trades = [], skipped = [];
  // equal-weight basket per gate and period: coins with ≥31 days of data before the period starts (so every filter
  // is warm), one equal slice of capital each, never rebalanced; a delisted coin's money stays where it ended
  const ENDT = BTC[BTC.length - 1].time + 900;        // the shared last candle's close: "now" for open-ended periods
  const BK = {}; for (const [p, a, b] of PER) if (p !== 'all' && p !== 'last 3m' && p !== 'last 4y') BK[p] = { a, b: Math.min(b, ENDT), coins: 0, sum: {} };
  const t0 = Date.now();
  for (const [idx, sym] of LIST.entries()) {
    const c = load(sym); if (!c || c.length < 600) { skipped.push(sym); continue; }
    const ind = indicators(c), jIdx = alignIdx(c, S), lead = leadArr(c);
    // entry context for every candle a signal could fire on (stored with the no-gate trades)
    const ctx = (i) => { const j = jIdx[i]; return j < 0 ? null : {
      b50: S.ma(50)[j], b20: S.ma(20)[j], b100: S.ma(100)[j], b200: S.ma(200)[j], b5: S.ma(5)[j], b149: S.maBars(149)[j],
      r1: +S.ret(1)[j].toFixed(4), r30: +S.ret(30)[j].toFixed(4), lead: lead[i] }; };
    for (const [g, , fn] of GATES) {
      const T = runGate(c, ind, S, jIdx, lead, fn);
      for (const [p, a, b] of PER) {
        const e = windowStats(c, T, a, b), es = e && windowStats(c, T, a, b, true);
        if (!e) continue;
        rows.push({ sym: sym.replace('USDT', ''), g, p, net: e.net, bh: e.bh, edge: e.edge, dd: e.dd, n: e.n, wr: e.wr, pf: e.pf, expo: e.expo,
          yrs: e.yrs, pos: e.pos, netSlip: es.net, from: c[0].time });
        // basket: sample this coin's equity once a UTC day
        if (BK[p] && c[0].time <= a - 31 * 86400) {
          const B = BK[p], eq = e.eq; let i0 = 0; while (c[i0].time < a) i0++;
          const days = Math.ceil((B.b - a) / 86400);
          const arr = B.sum[g] || (B.sum[g] = new Array(days).fill(0));
          let k = 0, last = 1;
          for (let d = 0; d < arr.length; d++) {
            const tEnd = a + (d + 1) * 86400;
            while (i0 + k < c.length && c[i0 + k].time < tEnd && k < eq.length) { last = eq[k]; k++; }
            arr[d] += last;                 // past the data's end, the last value stays (cash after a delisting)
          }
          if (g === 'none') B.coins++;
        }
      }
      for (const t of T) {
        if (t.outcome === 'open') continue;
        const rec = { sym: sym.replace('USDT', ''), g, t: c[t.entryIdx].time, h: t.exitIdx - t.entryIdx, net: +netOf(t).toFixed(5), why: t.why };
        if (g === 'none') rec.ctx = ctx(t.entryIdx);
        trades.push(rec);
      }
    }
    process.stderr.write(`${idx + 1}/${LIST.length} ${sym} ${c.length} bars from ${iso(c[0].time)} · ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
  }
  const basket = {};
  for (const [p, B] of Object.entries(BK)) basket[p] = { coins: B.coins, from: B.a, eq: Object.fromEntries(Object.entries(B.sum).map(([g, s]) => [g, s.map((x) => +(x / B.coins).toFixed(5))])) };
  // how often each BTC state is "on" across BTC's own history, per period (context for the report)
  const share = {};
  for (const [p, a, b] of PER) {
    const J = []; for (let j = 0; j < S.n; j++) if (BTC[j].time >= a && BTC[j].time < b) J.push(j);
    share[p] = { ma50: J.filter((j) => S.ma(50)[j]).length / J.length, ma149b: J.filter((j) => S.maBars(149)[j]).length / J.length,
      ma5: J.filter((j) => S.ma(5)[j]).length / J.length, up24: J.filter((j) => S.ret(1)[j] > 0).length / J.length };
  }
  fs.writeFileSync(path.join(DATA, 'run.json'), JSON.stringify({ at: new Date().toISOString(), gates: GATES.map(([g, d]) => [g, d]), periods: PER.map((x) => x[0]), rows, trades, basket, share, skipped }));
  console.log(`wrote ${rows.length} rows, ${trades.length} trades · ${((Date.now() - t0) / 1000).toFixed(0)}s · skipped ${skipped.join(' ') || 'none'}`);
}

if (mode === 'scenario') {
  // The user's case: Compare in date mode, 15m, last 3 months, on today's Top 50 gainers. The engine runs on the window
  // only (warm-up inside it, as Compare does) and BTC comes from 51 days before the window (btcFor()).
  const G = JSON.parse(fs.readFileSync(path.join(DATA, 'gainers.json')));
  const FROM = Date.UTC(2026, 7, 5) / 1e3, TO = Date.UTC(2026, 10, 5, 16) / 1e3;
  const BTCall = load('BTCUSDT');
  const out = [];
  for (const sym of G.syms) {
    const full = load(sym, path.join(DATA, 'recent')) || load(sym);
    if (!full) { out.push({ sym, missing: true }); continue; }
    const c = full.filter((x) => x.time >= FROM && x.time < TO);
    if (c.length < 250) { out.push({ sym, short: c.length }); continue; }
    // BTC with 201 days of history before Compare's fetch start (min(from, to − 10,000 bars)), so the 100/200-day
    // variants are warm too. For the shipped 50-day gate on alts this is the app's input (btcFor gives 51 days);
    // the one difference is BTC's OWN row: the app hands it only its fetched series (≈12 days before this window),
    // so in the app BTC's row keeps its gate shut for the first ~38 days of a 3-month 15m window.
    const refFrom = Math.min(FROM, TO - 10000 * 900);
    const btc = BTCall.filter((x) => x.time >= refFrom - 201 * 86400 && x.time < TO);
    const S = btcStates(btc), ind = indicators(c), jIdx = alignIdx(c, S), lead = leadArr(c);
    const res = { sym: sym.replace('USDT', ''), bars: c.length, from: c[0].time, g: {} };
    for (const [g, , fn] of GATES) {
      if (g.startsWith('plc') || g.startsWith('andplc')) continue;      // year shifts mean nothing on a 5-month BTC series
      const T = runGate(c, ind, S, jIdx, lead, fn), e = pathStats(T, c);
      res.g[g] = { net: e.net, bh: e.bh, edge: e.edge, dd: e.dd, n: e.n, wr: e.wr, pf: e.pf, expo: e.expo, pos: e.pos,
        trades: T.map((t) => ({ t: c[t.entryIdx].time, net: +netOf(t).toFixed(4), open: t.outcome === 'open' })) };
    }
    // the shipped gate checked against detector.js itself on this exact window
    const ref = SMC.detectAll(c, { strategy: 'liqbrk', longOnly: true, useLiq: false, btc }).trades;
    res.parity = ref.length === res.g.ship.trades.length && ref.every((r, i) => c[r.entryIdx].time === res.g.ship.trades[i].t);
    out.push(res);
  }
  const S = btcStates(BTCall), J = []; for (let j = 0; j < S.n; j++) if (BTCall[j].time >= FROM && BTCall[j].time < TO) J.push(j);
  const btcShare = { ma50: J.filter((j) => S.ma(50)[j]).length / J.length, ma149b: J.filter((j) => S.maBars(149)[j]).length / J.length };
  fs.writeFileSync(path.join(DATA, 'scenario.json'), JSON.stringify({ list: G, from: FROM, to: TO, btcShare, out }));
  console.log(`scenario: ${out.filter((r) => r.g).length} coins run, parity ${out.filter((r) => r.parity).length}/${out.filter((r) => r.g).length}, BTC > 50d MA on ${(btcShare.ma50 * 100).toFixed(0)}% of the window`);
}
