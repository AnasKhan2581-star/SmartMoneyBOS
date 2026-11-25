/*
 * The reclaim zone (Nov 2026, user request with a chart): a sudden drop, a close back above the high it fell from,
 * then the first return to the untouched bottom of the drop. RESEARCH ONLY: detector.js, the webapp and the bot are
 * unchanged.
 *
 *   NODE_USE_ENV_PROXY=1 node research/reclaim/data.js fetch     # 3m history of the 8 coins (once)
 *   node research/reclaim/reclaim_lab.js run [gross|slip2]       # → research/cache/reclaim/run_<costs>.json
 *   node research/reclaim/reclaim_lab.js report > research/reclaim/RESULTS_reclaim_2026-11.md   # needs run, run gross, run slip2
 *   node research/reclaim/reclaim_lab.js broad [gross|slip2]      # base, chosen and `big` rules on 1h/4h/1d of the 103-coin list
 *   node research/reclaim/reclaim_lab.js fresh [gross|slip2]      # the same on 1h/4h of the 295 other Binance coins
 *   node research/reclaim/reclaim_lab.js show BTCUSDT 4h          # the patterns and trades of one chart, for checking by eye
 *
 * THE RULES (fixed from the trading logic before any result was seen; each variant changes ONE thing). Everything is
 * counted in the chart's own candles and the chart's own ATR (Wilder, 14), because the pattern is a shape that the
 * user draws the same way on every timeframe:
 *   strong high  H, the highest high of the M = 50 candles before it.
 *   sudden drop  within K = 12 candles of H the low is at least D = 5 ATR under H (the ATR of the candle before H, the
 *                calm before the fall), AND it trades under the lowest low of those 50 candles: the stops and the
 *                liquidations under the range are taken. If price is still making new lows more than K candles after
 *                H, the fall was not sudden and the setup is dropped.
 *   reclaim      a candle CLOSES above H within R = 3K = 36 candles of the drop's low.
 *   zone         the bottom third of the drop, [L, L + (H − L)/3] (the user's yellow box). It must be UNMITIGATED:
 *                once price has closed above the zone, no candle may trade back into it before the reclaim.
 *   entry        a limit buy at the top of the zone from the candle after the reclaim, on the zone's FIRST touch; the
 *                zone expires E = 500 candles after the reclaim. One trade at a time per coin and timeframe; a zone
 *                touched while a trade is open is used up.
 *   stop         0.1 ATR under the drop's low: if price trades there, the buyers who absorbed the fall were wrong.
 *   target       the highest high between the reclaim and the fill (the buy stops resting above it).
 *   time         out at the close T = 100 candles after the fill if neither is hit.
 * Fills: a limit buy fills at its price when a candle trades at or below it (at the open if it opens lower); on the fill
 * candle only the stop can fill; a stop fills at the stop or a lower open; a target fills at its price (or a higher
 * open). Costs: 0.1% fee a side; stops and timed exits (and the market buy of the `confirm` entry) also pay slippage:
 * 0.05% on BTC, ETH and SOL (≥ $100M a day on Binance spot), 0.15% on the rest. `slip2` doubles the slippage, `gross`
 * drops every cost.
 * The split: each coin's history is cut in two at its middle. The first halves choose, the second halves judge. A
 * change from the base rules is kept if it raises the first-half average trade on a majority of the timeframes that
 * count (≥ 10 first-half trades under both settings; at least 2 must count). The shape fires about once per 20,000
 * candles on EVERY timeframe, so 4h and 1d (3,400 daily candles a coin) have almost no trades on 8 coins and never
 * count; they are judged on a wider coin list instead (`broad`).
 * Control: every trade's exact order (its depth under the price, stop and target in ATR, life and time stop) placed
 * at 50 random times in the same half of the same chart.
 */
'use strict';
const fs = require('fs'), path = require('path');
const { load, COINS, DIR } = require('./data.js');
const { mulberry32 } = require('../rng.js');
const ROOT = path.join(__dirname, '..', '..');
const TFS = ['3m', '15m', '1h', '4h', '1d'];
const LIQ = new Set(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XAUUSD']);
const COSTMODE = ['gross', 'slip2'].find((m) => process.argv.includes(m)) || 'spot';
const FEE = COSTMODE === 'gross' ? 0 : 0.001;
const slipOf = (sym) => (COSTMODE === 'gross' ? 0 : (LIQ.has(sym) ? 0.0005 : 0.0015) * (COSTMODE === 'slip2' ? 2 : 1));
const NCTRL = 50;

const BASE = { D: 5, K: 12, M: 50, Rx: 3, f: 1 / 3, buf: 0.1, entry: 'tap', exit: 'target', E: 500, T: 100, sweep: true, unmit: true, bos: 'high' };
const VARIANTS = {
  base: {},
  D3: { D: 3 }, D8: { D: 8 },                     // how big the fall must be
  K6: { K: 6 }, K24: { K: 24 },                   // how fast
  M20: { M: 20 }, M150: { M: 150 },               // how major the high / how wide the swept range
  Rx1: { Rx: 1 }, Rx6: { Rx: 6 },                 // how fast the reclaim
  f25: { f: 0.25 }, f50: { f: 0.5 },              // how deep the zone
  confirm: { entry: 'confirm' },                  // buy a close back above the zone after the tap (within 3 candles)
  ride: { exit: 'ride' },                         // half at the target, the rest out on a close under the 20-candle low
  E150: { E: 150 }, E2000: { E: 2000 },           // how long the zone waits
  T50: { T: 50 }, T300: { T: 300 },               // time stop
  nosweep: { sweep: false },                      // the fall needn't take the range's low
  mitig: { unmit: false },                        // the zone may have been revisited before the reclaim
  halfbos: { bos: 'mid' },                        // the reclaim is a close above the drop's middle, not the strong high
};
const PAIRS = [['D3', 'D8'], ['K6', 'K24'], ['M20', 'M150'], ['Rx1', 'Rx6'], ['f25', 'f50'], ['E150', 'E2000'], ['T50', 'T300']];

// ---------------------------------------------------------------- one chart: arrays, ATR, the split
function xau() {
  const rows = fs.readFileSync(path.join(ROOT, 'data', 'xauusd_1d.csv'), 'utf8').trim().split('\n').slice(1).map((l) => l.split(','));
  const n = rows.length, S = { sym: 'XAUUSD', tf: '1d', n, T: new Float64Array(n), O: new Float64Array(n), H: new Float64Array(n), L: new Float64Array(n), C: new Float64Array(n) };
  rows.forEach((r, i) => { S.T[i] = Date.parse(r[0] + 'T00:00:00Z') / 1000; S.O[i] = +r[1]; S.H[i] = +r[2]; S.L[i] = +r[3]; S.C[i] = +r[4]; });
  return S;
}
function prep(sym, tf, raw) {
  const S = raw || (sym === 'XAUUSD' ? xau() : load(sym, tf));
  if (!S || S.n < 400) return null;
  const { n, H, L, C } = S, A = new Float64Array(n);
  let a = 0;
  for (let i = 0; i < n; i++) {
    const tr = i ? Math.max(H[i] - L[i], Math.abs(H[i] - C[i - 1]), Math.abs(L[i] - C[i - 1])) : H[i] - L[i];
    a = i < 14 ? (a * i + tr) / (i + 1) : (a * 13 + tr) / 14;
    A[i] = a;
  }
  S.A = A; S.memo = {};
  S.split = S.T[0] + (S.T[n - 1] - S.T[0]) / 2;
  let k = 0; while (k < n && S.T[k] < S.split) k++;
  S.splitIdx = k;
  return S;
}
const memo = (S, k, f) => S.memo[k] || (S.memo[k] = f());
// max (or min) of X over the window [i − w + 1, i]
function winExt(X, w, isMax) {
  const n = X.length, out = new Float64Array(n), dq = new Int32Array(n); let h = 0, t = 0;
  for (let i = 0; i < n; i++) {
    while (t > h && (isMax ? X[dq[t - 1]] <= X[i] : X[dq[t - 1]] >= X[i])) t--;
    dq[t++] = i;
    while (dq[h] <= i - w) h++;
    out[i] = X[dq[h]];
  }
  return out;
}
// index of the highest X over [i − K, i] (the latest on ties)
function argmaxWin(X, K) {
  const n = X.length, out = new Int32Array(n), dq = new Int32Array(n); let h = 0, t = 0;
  for (let i = 0; i < n; i++) {
    while (t > h && X[dq[t - 1]] <= X[i]) t--;
    dq[t++] = i;
    while (dq[h] < i - K) h++;
    out[i] = dq[h];
  }
  return out;
}

// ---------------------------------------------------------------- the pattern
function detect(S, P) {
  const key = ['det', P.D, P.K, P.M, P.Rx, P.f, P.sweep, P.unmit, P.bos, P.buf].join('|');
  if (S.memo[key]) return S.memo[key];
  const { n, H, L, C, A } = S;
  const amax = memo(S, 'amax' + P.K, () => argmaxWin(H, P.K));
  const pmax = memo(S, 'wmaxH' + P.M, () => winExt(H, P.M, true));     // pmax[h − 1] = max high of the M candles before h
  const pmin = memo(S, 'wminL' + P.M, () => winExt(L, P.M, false));
  const R = P.Rx * P.K, out = [];
  let armed = [];
  for (let i = P.M + 1; i < n; i++) {
    for (const a of armed) {
      if (L[i] < a.L) {
        if (i - a.iH > P.K) { a.dead = 1; continue; }                // still falling after K candles: not sudden
        a.L = L[i]; a.iL = i; a.left = false;
      }
      const top = a.L + P.f * (a.H - a.L);
      if (i > a.iL) {
        if (!a.left) { if (C[i] > top) a.left = true; }
        else if (L[i] <= top && P.unmit) { a.dead = 1; continue; }   // back in the zone before the reclaim: mitigated
        const lvl = P.bos === 'mid' ? (a.H + a.L) / 2 : a.H;
        if (C[i] > lvl) {
          out.push({ iH: a.iH, H: a.H, iL: a.iL, L: a.L, j: i, top, stop: a.L - P.buf * A[i] });
          a.dead = 1; continue;
        }
      }
      if (i - a.iL > R) a.dead = 1;
    }
    if (armed.length) armed = armed.filter((a) => !a.dead);
    // a new sudden drop whose low is this candle?
    const h = amax[i];
    if (h < i && h > P.M) {
      const Hh = H[h];
      if (Hh >= pmax[h - 1] && Hh - L[i] >= P.D * A[h - 1] && (!P.sweep || L[i] < pmin[h - 1]) && !armed.some((a) => a.iH === h)) {
        let low = true;
        for (let k = h; k < i; k++) if (L[k] < L[i]) { low = false; break; }  // the lowest point of the fall so far
        if (low) armed.push({ iH: h, H: Hh, iL: i, L: L[i], left: C[i] > L[i] + P.f * (Hh - L[i]) });
      }
    }
  }
  S.memo[key] = out;
  return out;
}

// ---------------------------------------------------------------- one trade's life after the fill (shared by real and control orders)
// returns the trade, or null; `p` = { i0, px, stop, tgt, mkt (entry paid slippage), i0close (entry at the close of i0) }
function manage(S, P, p, slip) {
  const { n, O, H, L, C } = S;
  const lo20 = P.exit === 'ride' ? memo(S, 'wminL20', () => winExt(L, 20, false)) : null;
  const inEff = p.px * (1 + FEE + (p.mkt ? slip : 0));
  let half = null, i = p.i0;
  const out = (j, px, why, mkt) => {
    const eff = px * (1 - FEE - (mkt ? slip : 0));
    const ret = half ? 0.5 * half / inEff + 0.5 * eff / inEff - 1 : eff / inEff - 1;
    const risk = Math.max(p.px - p.stop, 1e-12) / p.px;
    return { i0: p.i0, i1: j, px: p.px, stop: p.stop, tgt: p.tgt, why, ret, R: ret / risk, risk, halfPx: half ? half / (1 - FEE) : null };
  };
  for (; i < n; i++) {
    if (!(p.i0close && i === p.i0)) {
      if (L[i] <= p.stop) return out(i, Math.min(O[i], p.stop), half ? 'stop2' : 'stop', true);
      if (i === p.i0) continue;                                      // the fill candle: only the stop
      if (!half && H[i] >= p.tgt) {
        const px = Math.max(O[i], p.tgt);
        if (P.exit !== 'ride') return out(i, px, 'target', false);
        half = px * (1 - FEE);
      }
      if (half) {
        if (C[i] < lo20[i - 1]) return out(i, C[i], 'trail', true);
        if (i - p.i0 >= 5 * P.T) return out(i, C[i], 'time', true);
      } else if (i - p.i0 >= P.T) return out(i, C[i], 'time', true);
    }
  }
  return out(n - 1, C[n - 1], 'end', false);
}

// ---------------------------------------------------------------- the real trades
function simulate(S, pats, P, sym) {
  const { n, O, L, H, C } = S, slip = slipOf(sym), trades = [];
  let act = [], pi = 0, busyTill = -1;
  for (let i = 0; i < n; i++) {
    while (pi < pats.length && pats[pi].j < i) { const z = pats[pi++]; act.push({ z, ph: H[z.j], end: z.j + P.E, tap: -1 }); }
    if (!act.length) continue;
    const free = i > busyTill;
    let best = null;
    for (const s of act) {
      if (s.done) continue;
      if (i > s.end) { s.done = 1; continue; }
      if (P.entry === 'tap') {
        if (L[i] <= s.z.top) {
          s.done = 1;
          if (free && (!best || s.z.top > best.z.top)) best = s;
        }
      } else {
        if (s.tap < 0 && L[i] <= s.z.top) { s.tap = i; s.tgt = s.ph; }
        if (s.tap >= 0) {
          if (L[i] <= s.z.stop) s.done = 1;                         // the low broke before a confirmation
          else if (C[i] > s.z.top) { s.done = 1; if (free && (!best || s.z.top > best.z.top)) best = s; }
          else if (i - s.tap >= 2) s.done = 1;                       // no close back above within 3 candles
        }
      }
      if (!s.done) s.ph = Math.max(s.ph, H[i]);
    }
    if (best) {
      const z = best.z, tap = P.entry === 'tap';
      const p = tap ? { i0: i, px: Math.min(O[i], z.top), stop: z.stop, tgt: best.ph, mkt: false, i0close: false }
        : { i0: i, px: C[i], stop: z.stop, tgt: best.tgt, mkt: true, i0close: true };
      const t = manage(S, P, p, slip);
      Object.assign(t, { t: S.T[i], age: i - z.j, j: z.j, iH: z.iH, iL: z.iL,
        dTop: (C[z.j] - z.top) / S.A[z.j], dStop: (z.top - z.stop) / S.A[z.j], dTgt: (p.tgt - z.top) / S.A[z.j] });
      trades.push(t);
      busyTill = t.i1;
    }
    if (act.length > 64) act = act.filter((s) => !s.done);
  }
  return trades;
}

// ---------------------------------------------------------------- the control: each trade's order at random times
function control(S, P, sym, trades, lo, hi, seed) {
  const rnd = mulberry32(seed), slip = slipOf(sym), { O, L, C, A } = S, res = [];
  // placed at a random candle of the same half; like a real zone, the order may fill and run past the half's end
  const last = Math.min(hi, S.n - 1);
  for (const t of trades) {
    const copies = [];
    if (last - lo < 20) { res.push(copies); continue; }
    for (let c = 0; c < NCTRL; c++) {
      const r = lo + Math.floor(rnd() * (last - lo));
      const top = C[r] - t.dTop * A[r], stop = top - t.dStop * A[r], tgt = top + t.dTgt * A[r];
      if (!(stop > 0)) continue;
      let p = null, tap = -1;
      for (let i = r + 1; i <= r + P.E && i < S.n; i++) {
        if (P.entry === 'tap') { if (L[i] <= top) { p = { i0: i, px: Math.min(O[i], top), stop, tgt, mkt: false, i0close: false }; break; } }
        else {
          if (tap < 0 && L[i] <= top) tap = i;
          if (tap >= 0) {
            if (L[i] <= stop) break;
            if (C[i] > top) { p = { i0: i, px: C[i], stop, tgt, mkt: true, i0close: true }; break; }
            if (i - tap >= 2) break;
          }
        }
      }
      copies.push(p ? manage(S, P, p, slip).ret : null);
    }
    res.push(copies);
  }
  return res;
}

// ---------------------------------------------------------------- statistics
function pool(rets) {
  const n = rets.length;
  if (!n) return { n: 0 };
  const m = rets.reduce((s, x) => s + x, 0) / n, sd = Math.sqrt(rets.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, n - 1));
  const g = rets.filter((x) => x > 0).reduce((s, x) => s + x, 0), b = -rets.filter((x) => x < 0).reduce((s, x) => s + x, 0);
  const srt = rets.slice().sort((x, y) => x - y);
  return { n, avg: m, med: srt[n >> 1], wr: rets.filter((x) => x > 0).length / n, pf: b ? g / b : Infinity, t: sd ? m / (sd / Math.sqrt(n)) : 0 };
}
// real trades vs their orders at random times: the share of random sets (one filled copy per trade) that do as well
function vsRandom(real, copies, seed) {
  const keep = copies.map((c) => c.filter((x) => x !== null));
  const all = keep.flat(), m = real.length ? real.reduce((s, x) => s + x, 0) / real.length : NaN;
  const rnd = mulberry32(seed || 7);
  let ge = 0, sets = 0;
  for (let s = 0; s < 2000 && real.length; s++) {
    let sum = 0, k = 0;
    for (const c of keep) if (c.length) { sum += c[Math.floor(rnd() * c.length)]; k++; }
    if (k) { sets++; if (sum / k >= m) ge++; }
  }
  return { real: pool(real), rand: all.length ? all.reduce((s, x) => s + x, 0) / all.length : null,
    fill: copies.length ? all.length / (copies.length * NCTRL) : null, p: sets ? ge / sets : null };
}
// all-in equity over [i0, i1): net, max drawdown on closes, in-market share; buy & hold over the same candles
function equity(S, trades, i0, i1) {
  const { C } = S;
  let eq = 1, peak = 1, dd = 0, held = 0, k = 0;
  const tr = trades.filter((t) => t.i0 >= i0 && t.i0 < i1);
  for (const t of tr) {
    const inEff = t.px * (1 + FEE);
    for (let i = t.i0; i < t.i1 && i < i1; i++) {
      const v = eq * (t.halfPx ? 0.5 * t.halfPx * (1 - FEE) / inEff + 0.5 * C[i] / inEff : C[i] / inEff);
      if (v > peak) peak = v;
      dd = Math.min(dd, v / peak - 1);
    }
    held += Math.min(t.i1, i1) - t.i0 + 1;
    eq *= 1 + t.ret;
    if (eq > peak) peak = eq;
    dd = Math.min(dd, eq / peak - 1);
    k++;
  }
  return { n: k, net: eq - 1, dd, inMkt: held / Math.max(1, i1 - i0), bh: C[i1 - 1] / C[i0] - 1, yrs: (S.T[i1 - 1] - S.T[i0]) / (365.25 * 86400), pool: pool(tr.map((t) => t.ret)) };
}

// ---------------------------------------------------------------- run everything
function settingOf(name, over) { return Object.assign({}, BASE, VARIANTS[name] || {}, over || {}); }
function charts() {
  const out = [];
  for (const tf of TFS) for (const s of COINS) out.push([s, tf]);
  out.push(['XAUUSD', '1d']);                                      // extra: spot gold from 2003 (1d only, not in the pooled tables)
  return out;
}
function runAll() {
  const res = { costs: COSTMODE, base: BASE, variants: VARIANTS, rows: {}, freq: {}, trades: {} };
  const t0 = Date.now();
  // 1. every variant on every chart: pooled per timeframe and half
  const perVar = {};                                                // name → tf → half → rets
  const byChart = {};
  let curSym = null;
  for (const [sym, tf] of charts()) {
    const S = prep(sym, tf);
    if (!S) { console.error('skip', sym, tf); continue; }
    if (sym !== curSym) { curSym = sym; }
    for (const name of Object.keys(VARIANTS)) {
      const P = settingOf(name), pats = detect(S, P), tr = simulate(S, pats, P, sym);
      const key = `${sym}|${tf}`;
      ((byChart[name] = byChart[name] || {})[key] = { first: equity(S, tr, 0, S.splitIdx), second: equity(S, tr, S.splitIdx, S.n), all: equity(S, tr, 0, S.n), pats: pats.length });
      if (sym === 'XAUUSD') continue;
      const pv = ((perVar[name] = perVar[name] || {})[tf] = perVar[name][tf] || { first: [], second: [] });
      for (const t of tr) (t.i0 < S.splitIdx ? pv.first : pv.second).push(t.ret);
    }
    console.error(`${sym} ${tf} n=${S.n} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  // 2. the choice, on the first halves only. A timeframe counts when both settings have ≥ 10 first-half trades there
  // (4h and 1d have almost none: the shape is as rare per candle on every timeframe). A change is kept if it raises the
  // average trade on a majority of the timeframes that count, and at least 2 count.
  const avg = (name, tf) => pool(perVar[name][tf].first).avg;
  const counts = (name, tf) => perVar[name][tf].first.length >= 10 && perVar.base[tf].first.length >= 10;
  const wins = {}, cnt = {};
  for (const name of Object.keys(VARIANTS)) if (name !== 'base') {
    const tfs = TFS.filter((tf) => counts(name, tf));
    cnt[name] = tfs.length;
    wins[name] = tfs.filter((tf) => avg(name, tf) > avg('base', tf)).length;
  }
  const kept = [];
  for (const name of Object.keys(VARIANTS)) {
    if (name === 'base' || cnt[name] < 2 || wins[name] * 2 <= cnt[name]) continue;
    const pair = PAIRS.find((p) => p.includes(name));
    if (pair) {                                                     // alternatives: keep the one that wins more often
      const other = pair.find((x) => x !== name), share = (x) => (cnt[x] ? wins[x] / cnt[x] : 0);
      const both = TFS.filter((tf) => counts(name, tf) && counts(other, tf));
      const gain = (x) => both.reduce((s, tf) => s + (avg(x, tf) - avg('base', tf)), 0);
      if (share(other) > share(name) || (share(other) === share(name) && gain(other) > gain(name))) continue;
    }
    kept.push(name);
  }
  let FINAL = Object.assign({}, BASE, ...kept.map((k) => VARIANTS[k]));
  res.choice = { wins, cnt, kept, final: FINAL };
  // the choice is made once, with spot costs; the gross and double-slippage runs judge those same rules
  const spotFile = path.join(DIR, 'run_spot.json');
  if (COSTMODE !== 'spot' && fs.existsSync(spotFile)) {
    res.choice = JSON.parse(fs.readFileSync(spotFile)).choice;
    kept.splice(0, kept.length, ...res.choice.kept); FINAL = res.choice.final;
  }
  console.error('kept', kept.join(', ') || '(none)');
  // 3. the final rules (if any change was kept) and the base: every chart, with the control
  const finals = kept.length ? [['final', FINAL], ['base', BASE]] : [['base', BASE]];
  for (const [nm, P] of finals) {
    const rows = {}, tradeLog = [];
    for (const [sym, tf] of charts()) {
      const S = prep(sym, tf);
      if (!S) continue;
      const tr = simulate(S, detect(S, P), P, sym);
      const halves = { first: [0, S.splitIdx], second: [S.splitIdx, S.n] }, ctrl = {};
      for (const [h, [lo, hi]] of Object.entries(halves)) {
        const real = tr.filter((t) => t.i0 >= lo && t.i0 < hi);
        ctrl[h] = control(S, P, sym, real, lo, hi, 1000 + TFS.indexOf(tf) * 100 + COINS.indexOf(sym) + (h === 'second' ? 50000 : 0));
      }
      rows[`${sym}|${tf}`] = { first: equity(S, tr, 0, S.splitIdx), second: equity(S, tr, S.splitIdx, S.n), all: equity(S, tr, 0, S.n),
        pats: detect(S, P).length, ctrl, split: S.split, from: S.T[0], to: S.T[S.n - 1], bars: S.n,
        real: { first: tr.filter((t) => t.i0 < S.splitIdx).map((t) => t.ret), second: tr.filter((t) => t.i0 >= S.splitIdx).map((t) => t.ret) } };
      for (const t of tr) tradeLog.push({ sym, tf, t: t.t, ret: +t.ret.toFixed(5), R: +t.R.toFixed(3), risk: +t.risk.toFixed(5), why: t.why, age: t.age, bars: t.i1 - t.i0, half: t.i0 < S.splitIdx ? 1 : 2 });
    }
    res.rows[nm] = rows;
    res.trades[nm] = tradeLog;
  }
  res.byChart = byChart;
  res.perVar = Object.fromEntries(Object.entries(perVar).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([tf, h]) => [tf, { first: pool(h.first), second: pool(h.second) }]))]));
  fs.writeFileSync(path.join(DIR, `run_${COSTMODE}.json`), JSON.stringify(res));
  console.error(`done ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

// ---------------------------------------------------------------- the wider checks
// `broad`: 1h, 4h and 1d on the user's 103-coin list (the 8 coins have almost no 4h/1d trades). `fresh`: 1h and 4h on
// every other Binance USDT coin (295, never used for any choice). Rules: the base, the chosen ones, and `big`, the
// chosen ones with an 8-ATR fall: a neighbour that stood out on the 103-coin 1h list, so `fresh` is its real test.
function wide(which) {
  const { loadTf, LIST103 } = require('./data.js');
  const spot = JSON.parse(fs.readFileSync(path.join(DIR, 'run_spot.json')));
  const sets = [['base', BASE], ['final', spot.choice.final], ['big', Object.assign({}, spot.choice.final, { D: 8 })]];
  const list = which === 'fresh' ? JSON.parse(fs.readFileSync(path.join(DIR, 'fresh', 'list.json'))) : LIST103();
  const tfs = which === 'fresh' ? ['1h', '4h'] : ['1h', '4h', '1d'];
  const out = { costs: COSTMODE, coins: list.length, rows: {} };
  for (const tf of tfs) for (const [nm, P] of sets) {
    const acc = { first: [[], []], second: [[], []] }, coins = [];
    let bars = 0, pats = 0;
    list.forEach((sym, ci) => {
      const raw = loadTf(sym, tf, which), S = raw && raw.n >= 400 ? prep(sym, tf, raw) : null;
      if (!S) return;
      const pp = detect(S, P), tr = simulate(S, pp, P, sym);
      bars += S.n; pats += pp.length;
      for (const [h, lo, hi] of [['first', 0, S.splitIdx], ['second', S.splitIdx, S.n]]) {
        const real = tr.filter((t) => t.i0 >= lo && t.i0 < hi);
        const ctrl = control(S, P, sym, real, lo, hi, 7000 + ci * 10 + (h === 'second' ? 5 : 0) + ['1h', '4h', '1d'].indexOf(tf) * 3000);
        real.forEach((t, i) => { acc[h][0].push(t.ret); acc[h][1].push(ctrl[i]); });
      }
      const e = equity(S, tr, 0, S.n);
      coins.push({ sym, n: e.n, net: e.net, bh: e.bh, dd: e.dd, sum: tr.reduce((x, t) => x + t.ret, 0) });
    });
    out.rows[`${nm}|${tf}`] = { bars, pats, first: vsRandom(...acc.first), second: vsRandom(...acc.second),
      all: vsRandom(acc.first[0].concat(acc.second[0]), acc.first[1].concat(acc.second[1])), coins };
    console.error(which, nm, tf, 'trades', acc.first[0].length + acc.second[0].length);
  }
  fs.writeFileSync(path.join(DIR, `${which}_${COSTMODE}.json`), JSON.stringify(out));
}

// ---------------------------------------------------------------- show one chart's patterns (for checking the rules by eye)
function show(sym, tf, name) {
  const S = prep(sym, tf), P = settingOf(name || 'base');
  const pats = detect(S, P), tr = simulate(S, pats, P, sym);
  const d = (i) => new Date(S.T[i] * 1000).toISOString().slice(0, 16).replace('T', ' ');
  console.log(`${sym} ${tf}: ${S.n} candles, ${pats.length} patterns, ${tr.length} trades`);
  for (const z of pats) {
    const t = tr.find((x) => x.j === z.j);
    console.log(`high ${d(z.iH)} ${z.H.toPrecision(6)} → low ${d(z.iL)} ${z.L.toPrecision(6)} (${((z.H - z.L) / S.A[z.iH - 1]).toFixed(1)} ATR, ${z.iL - z.iH} candles)`
      + ` → reclaim ${d(z.j)} · zone ${z.L.toPrecision(6)}–${z.top.toPrecision(6)}`
      + (t ? ` · BUY ${d(t.i0)} at ${t.px.toPrecision(6)} → ${t.why} ${d(t.i1)} ${(t.ret * 100).toFixed(2)}% (${t.R.toFixed(2)}R)` : ''));
  }
}

module.exports = { prep, detect, simulate, manage, control, equity, pool, vsRandom, settingOf, BASE, VARIANTS, TFS, NCTRL };

if (require.main === module) {
  const cmd = process.argv[2];
  if (cmd === 'run') runAll();
  else if (cmd === 'show') show(process.argv[3], process.argv[4], process.argv[5]);
  else if (cmd === 'broad' || cmd === 'fresh') wide(cmd);
  else if (cmd === 'report') require('./reclaim_report.js').report();
  else console.log('usage: reclaim_lab.js run [gross|slip2] | broad|fresh [gross|slip2] | report | show SYM TF [variant]');
}
