/*
 * Data for the reclaim-zone study (Nov 2026, user request). RESEARCH ONLY.
 *
 *   NODE_USE_ENV_PROXY=1 node research/reclaim/data.js fetch            # the 8 coins, all 3m history → research/cache/reclaim
 *   NODE_USE_ENV_PROXY=1 node research/reclaim/data.js fetch DOGE LINK  # other coins
 *   NODE_USE_ENV_PROXY=1 node research/reclaim/data.js broad 1h 4h 1d   # the 103-coin Compare list on those timeframes
 *   NODE_USE_ENV_PROXY=1 node research/reclaim/data.js fresh 1h 4h      # every other Binance USDT coin (out-of-sample check)
 *
 * One file per coin: <SYM>_3m.bin, a Float64Array of rows [openTimeSec, open, high, low, close, volume, takerBuyVolume]
 * (git-ignored). Every coin runs from its Binance listing to END, the same last candle for all. 15m, 1h, 4h and 1d are
 * built from the 3m candles by load() (UTC buckets, as Binance builds its own), so every timeframe of a coin covers the
 * same history. Pages are fetched by time window (startTime/endTime), so one coin's pages run in parallel.
 */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const DIR = path.join(ROOT, 'research', 'cache', 'reclaim');
const COINS = ['PAXGUSDT', 'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'STXUSDT', 'XRPUSDT', 'BNBUSDT', 'ARBUSDT'];
const END = Date.UTC(2026, 10, 25, 0, 0);          // 2026-11-25 00:00 UTC: the same last candle for every coin
const COLS = 7, STEP = 180;                        // 3m candles
const TF_SEC = { '3m': 180, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 };
const HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(qs) {
  let err;
  for (let a = 0; a < 8; a++) {
    if (a) await sleep(Math.min(30000, 500 * 2 ** (a - 1)));
    for (const h of HOSTS) {
      try {
        const r = await fetch(`${h}/api/v3/klines?${qs}`);
        if (r.status === 400) return null;
        if (r.status === 429 || r.status === 418) { err = `HTTP ${r.status}`; await sleep(5000); continue; }
        if (!r.ok) { err = `HTTP ${r.status}`; continue; }
        return await r.json();
      } catch (e) { err = e.message; }
    }
  }
  throw new Error(err);
}

// a small pool: at most `n` requests in flight across every coin
function pool(n) {
  let live = 0; const q = [];
  const next = () => { while (live < n && q.length) { const [fn, ok, ko] = q.shift(); live++; fn().then(ok, ko).finally(() => { live--; next(); }); } };
  return (fn) => new Promise((ok, ko) => { q.push([fn, ok, ko]); next(); });
}

async function pull(sym, run) {
  const f = path.join(DIR, `${sym}_3m.bin`);
  if (fs.existsSync(f)) return { n: fs.statSync(f).size / 8 / COLS, cached: true };
  const first = await run(() => get(`symbol=${sym}&interval=3m&startTime=0&limit=1`));
  if (!first || !first.length) return { missing: true };
  const t0 = first[0][0], span = 1000 * STEP * 1000, starts = [];
  for (let s = t0; s < END; s += span) starts.push(s);
  let done = 0;
  const parts = await Promise.all(starts.map((s) => run(async () => {
    const k = await get(`symbol=${sym}&interval=3m&startTime=${s}&endTime=${Math.min(s + span, END) - 1}&limit=1000`);
    if (++done % 200 === 0) console.log(`  ${sym} ${done}/${starts.length} pages`);
    return k || [];
  })));
  const rows = [].concat(...parts).filter((x) => x[0] < END);
  rows.sort((a, b) => a[0] - b[0]);
  const out = new Float64Array(rows.length * COLS);
  let n = 0, last = -1;
  for (const x of rows) {
    const t = x[0] / 1000;
    if (t === last) continue;
    last = t;
    out.set([t, +x[1], +x[2], +x[3], +x[4], +x[5], +x[9]], n * COLS); n++;
  }
  fs.writeFileSync(f, Buffer.from(out.buffer, 0, n * COLS * 8));
  return { n, from: new Date(t0).toISOString().slice(0, 10) };
}

// one coin on one timeframe: { sym, tf, n, T, O, H, L, C, V, B } (B = taker-buy volume), built from the 3m file
const raw = new Map();
function load(sym, tf) {
  const f = path.join(DIR, `${sym}_3m.bin`);
  if (!fs.existsSync(f)) return null;
  let a = raw.get(sym);
  if (!a) {
    const buf = fs.readFileSync(f);
    a = new Float64Array(buf.buffer, buf.byteOffset, buf.length / 8);
    raw.clear(); raw.set(sym, a);                  // one coin in memory at a time
  }
  const m = a.length / COLS, step = TF_SEC[tf];
  if (!step) throw new Error(`unknown timeframe ${tf}`);
  const T = new Float64Array(m), O = new Float64Array(m), H = new Float64Array(m), L = new Float64Array(m),
    C = new Float64Array(m), V = new Float64Array(m), B = new Float64Array(m);
  let n = -1, cur = -1;
  for (let i = 0; i < m; i++) {
    const r = i * COLS, b = Math.floor(a[r] / step) * step;
    if (b !== cur) {
      n++; cur = b;
      T[n] = b; O[n] = a[r + 1]; H[n] = a[r + 2]; L[n] = a[r + 3]; C[n] = a[r + 4]; V[n] = a[r + 5]; B[n] = a[r + 6];
    } else {
      if (a[r + 2] > H[n]) H[n] = a[r + 2];
      if (a[r + 3] < L[n]) L[n] = a[r + 3];
      C[n] = a[r + 4]; V[n] += a[r + 5]; B[n] += a[r + 6];
    }
  }
  n++;
  // the last bucket is cut by END on no timeframe here: END is a UTC midnight, so every 15m/1h/4h/1d bucket is whole
  return { sym, tf, n, T: T.subarray(0, n), O: O.subarray(0, n), H: H.subarray(0, n), L: L.subarray(0, n),
    C: C.subarray(0, n), V: V.subarray(0, n), B: B.subarray(0, n) };
}

// the wider check for 1h, 4h and 1d: the user's 103-coin Compare list (CMP_DEFAULT in index.html), each timeframe
// fetched directly into research/cache/reclaim/broad/<SYM>_<tf>.bin (same columns), to the same END
const BROAD = path.join(DIR, 'broad');
const html = () => fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const LIST103 = () => html().match(/const CMP_DEFAULT=\[([\s\S]*?)\]\.map/)[1].match(/'([A-Z0-9]+)'/g).map((s) => s.slice(1, -1) + 'USDT');
async function pullTf(sym, tf, run, dir = BROAD) {
  const f = path.join(dir, `${sym}_${tf}.bin`);
  if (fs.existsSync(f)) return { n: fs.statSync(f).size / 8 / COLS, cached: true };
  const first = await run(() => get(`symbol=${sym}&interval=${tf}&startTime=0&limit=1`));
  if (!first || !first.length) return { missing: true };
  const t0 = first[0][0], span = 1000 * TF_SEC[tf] * 1000, starts = [];
  for (let s = t0; s < END; s += span) starts.push(s);
  const parts = await Promise.all(starts.map((s) => run(async () => (await get(`symbol=${sym}&interval=${tf}&startTime=${s}&endTime=${Math.min(s + span, END) - 1}&limit=1000`)) || [])));
  const rows = [].concat(...parts).filter((x) => x[0] < END).sort((a, b) => a[0] - b[0]);
  const out = new Float64Array(rows.length * COLS);
  let n = 0, last = -1;
  for (const x of rows) { const t = x[0] / 1000; if (t === last) continue; last = t; out.set([t, +x[1], +x[2], +x[3], +x[4], +x[5], +x[9]], n * COLS); n++; }
  fs.writeFileSync(f, Buffer.from(out.buffer, 0, n * COLS * 8));
  return { n };
}
function loadTf(sym, tf, sub = 'broad') {
  const f = path.join(DIR, sub, `${sym}_${tf}.bin`);
  if (!fs.existsSync(f)) return null;
  const buf = fs.readFileSync(f), a = new Float64Array(buf.buffer, buf.byteOffset, buf.length / 8), n = a.length / COLS;
  const S = { sym, tf, n };
  ['T', 'O', 'H', 'L', 'C', 'V', 'B'].forEach((k, c) => { const x = new Float64Array(n); for (let i = 0; i < n; i++) x[i] = a[i * COLS + c]; S[k] = x; });
  return S;
}

// fresh coins for the out-of-sample check: every USDT pair trading on Binance spot today that is not in the 103-coin
// list or the 8 study coins, without stablecoins, wrapped or staked copies, gold, leveraged tokens or the tokenized
// stocks (Binance's TRD_GRP_261), as the app's coin filter does. Saved to research/cache/reclaim/fresh/list.json.
const FRESH = path.join(DIR, 'fresh');
const NOT_COIN = new Set(['WBTC', 'WETH', 'WBETH', 'BETH', 'STETH', 'WSTETH', 'BNSOL', 'PAXG', 'XAUT', 'EURI', 'EUR', 'AEUR', 'TUSD', 'DAI', 'FRAX']);
async function freshList() {
  const f = path.join(FRESH, 'list.json');
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f));
  const info = async (q) => (await (await fetch(`${HOSTS[0]}/api/v3/exchangeInfo?${q}&showPermissionSets=false`)).json()).symbols;
  const spot = await info('permissions=SPOT&symbolStatus=TRADING'), stocks = new Set((await info('permissions=TRD_GRP_261')).map((x) => x.baseAsset));
  const skip = new Set(LIST103().concat(COINS).map((s) => s.replace(/USDT$/, '')));
  const list = spot.filter((x) => x.quoteAsset === 'USDT' && x.status === 'TRADING').map((x) => x.baseAsset)
    .filter((b) => !skip.has(b) && !/USD/.test(b) && !NOT_COIN.has(b) && !stocks.has(b) && !/(UP|DOWN|BULL|BEAR)$/.test(b) || /^(JUP|SYRUP)$/.test(b))
    .filter((b) => !skip.has(b) && !stocks.has(b))
    .sort().map((b) => b + 'USDT');
  fs.mkdirSync(FRESH, { recursive: true });
  fs.writeFileSync(f, JSON.stringify(list));
  return list;
}

module.exports = { load, loadTf, LIST103, freshList, COINS, END, TF_SEC, DIR };

if (require.main === module && process.argv[2] === 'broad') {     // node data.js broad 1h 4h 1d
  (async () => {
    fs.mkdirSync(BROAD, { recursive: true });
    const tfs = process.argv.slice(3), run = pool(10), t0 = Date.now(), miss = [];
    for (const tf of tfs) {
      await Promise.all(LIST103().map(async (s) => {
        try { const r = await pullTf(s, tf, run); if (r.missing) miss.push(`${s} ${tf}`); }
        catch (e) { miss.push(`${s} ${tf} ${e.message}`); }
      }));
      console.log(tf, 'done', `${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
    console.log('missing:', miss.join(', ') || 'none');
  })();
}
if (require.main === module && process.argv[2] === 'fresh') {     // node data.js fresh 1h 4h
  (async () => {
    const list = await freshList(), tfs = process.argv.slice(3), run = pool(10), t0 = Date.now(), miss = [];
    console.log(list.length, 'fresh coins');
    for (const tf of tfs) {
      await Promise.all(list.map(async (s) => {
        try { const r = await pullTf(s, tf, run, FRESH); if (r.missing) miss.push(`${s} ${tf}`); }
        catch (e) { miss.push(`${s} ${tf} ${e.message}`); }
      }));
      console.log(tf, 'done', `${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
    console.log('missing:', miss.join(', ') || 'none');
  })();
}
if (require.main === module && process.argv[2] === 'fetch') {
  (async () => {
    fs.mkdirSync(DIR, { recursive: true });
    const args = process.argv.slice(3).map((s) => (s.toUpperCase().endsWith('USDT') ? s.toUpperCase() : s.toUpperCase() + 'USDT'));
    const run = pool(10), t0 = Date.now();
    const res = await Promise.all((args.length ? args : COINS).map(async (s) => {
      try { const r = await pull(s, run); console.log(s, JSON.stringify(r), `${((Date.now() - t0) / 1000).toFixed(0)}s`); return r; }
      catch (e) { console.log(s, 'FAILED', e.message); return { failed: true }; }
    }));
    console.log('done', res.filter((r) => r.failed || r.missing).length ? 'with failures' : 'ok', `${((Date.now() - t0) / 1000).toFixed(0)}s`);
  })();
}
