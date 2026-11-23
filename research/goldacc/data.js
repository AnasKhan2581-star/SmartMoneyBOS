// Candles for the gold accumulation study (Nov 2026). PAXG and BTC from Binance, every candle up to the moment of the
// fetch, the forming one included, exactly as the Compare tab reads them; spot gold (XAUUSD) daily from the repo's file.
//   NODE_USE_ENV_PROXY=1 node research/goldacc/data.js fetch      # writes research/cache/goldacc/<SYM>_<TF>.json
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..'), CACHE = path.join(ROOT, 'research', 'cache', 'goldacc');
const SMC = require(path.join(ROOT, 'detector.js'));
const HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(qs) {
  let err;
  for (let a = 0; a < 6; a++) {
    if (a) await sleep(500 * 2 ** (a - 1));
    for (const h of HOSTS) {
      try {
        const r = await fetch(`${h}/api/v3/klines?${qs}`);
        if (r.status === 400 || r.status === 404) return null;
        if (!r.ok) { err = `HTTP ${r.status}`; continue; }
        return await r.json();
      } catch (e) { err = e.message; }
    }
  }
  throw new Error(err);
}
async function pull(sym, tf) {
  let rows = [], end;
  for (;;) {
    const k = await get(`symbol=${sym}&interval=${tf}&limit=1000` + (end ? `&endTime=${end}` : ''));
    if (!k || !k.length) break;
    rows = k.map((x) => [Math.floor(x[0] / 1000), +x[1], +x[2], +x[3], +x[4], +x[5]]).concat(rows);
    end = k[0][0] - 1;
    if (k.length < 1000) break;
  }
  return rows;
}
const SETS = [['PAXGUSDT', ['4h', '1d', '1w', '1M']], ['BTCUSDT', ['4h', '1d', '1w', '1M']]];
async function fetchAll() {
  fs.mkdirSync(CACHE, { recursive: true });
  const asOf = Math.floor(Date.now() / 1000);
  for (const [sym, tfs] of SETS) for (const tf of tfs) {
    const rows = await pull(sym, tf);
    fs.writeFileSync(path.join(CACHE, `${sym}_${tf}.json`), JSON.stringify({ asOf, rows }));
    console.log(`${sym} ${tf}: ${rows.length} candles, ${new Date(rows[0][0] * 1000).toISOString().slice(0, 10)} → ${new Date(rows[rows.length - 1][0] * 1000).toISOString().slice(0, 16)}`);
  }
}
const toC = (rows) => rows.map(([time, open, high, low, close, volume]) => ({ time, open, high, low, close, volume }));
function binance(sym, tf) {
  const f = path.join(CACHE, `${sym}_${tf}.json`);
  if (!fs.existsSync(f)) throw new Error(`${f} missing: run  NODE_USE_ENV_PROXY=1 node research/goldacc/data.js fetch`);
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  return Object.assign(toC(j.rows), { asOf: j.asOf });
}
function xau() {
  return fs.readFileSync(path.join(ROOT, 'data', 'xauusd_1d.csv'), 'utf8').trim().split('\n').slice(1).map((l) => {
    const [d, o, h, lo, c] = l.split(','); return { time: Date.parse(d + 'T00:00:00Z') / 1000, open: +o, high: +h, low: +lo, close: +c, volume: 0 };
  });
}
// the Compare tab's own statistics, read out of index.html (all-in per trade, 0.1% a side, window sweep)
function comparePathStats() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), i = html.indexOf('function pathStats(');
  let j = html.indexOf('{', i), d = 0;
  for (; j < html.length; j++) { if (html[j] === '{') d++; else if (html[j] === '}' && --d === 0) break; }
  return new Function('SMC', html.slice(i, j + 1) + '\nreturn pathStats;')(SMC);
}
module.exports = { binance, xau, comparePathStats, SMC, ROOT };
if (require.main === module && process.argv[2] === 'fetch') fetchAll().catch((e) => { console.error(e); process.exit(1); });
