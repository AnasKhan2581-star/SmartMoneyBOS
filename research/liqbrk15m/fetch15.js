// Full 15m history for the 15m BTC-gate study: the user's 103-coin Compare list (CMP_DEFAULT) from each
// coin's Binance listing to END. The 2022-09 → 2026-10-28 middle is reused from research/cache/tfcmp
// (fetched the same way); only the older part and the last week are downloaded.
//   NODE_USE_ENV_PROXY=1 node research/liqbrk15m/fetch15.js            # the 103 coins
//   NODE_USE_ENV_PROXY=1 node research/liqbrk15m/fetch15.js FROM=2026-06-01 ARB SOL ...   # extra coins, from a date
// Writes research/cache/lb15/<SYM>_15m.json as [[timeSec, o, h, l, c, v], ...] (git-ignored).
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..'), MID = path.join(ROOT, 'research', 'cache', 'tfcmp');
// a dated pull (FROM=…) goes to its own folder so it can never stand in for a full-history file
const OUT = path.join(ROOT, 'research', 'cache', 'lb15', process.argv.some((a) => a.startsWith('FROM=')) ? 'recent' : '');
fs.mkdirSync(OUT, { recursive: true });
const END = Date.UTC(2026, 10, 5, 16, 0);          // 2026-11-05 16:00 UTC: the same last bar for every coin
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const LIST = html.match(/const CMP_DEFAULT=\[([\s\S]*?)\]\.map/)[1].match(/'([A-Z0-9]+)'/g).map((s) => s.slice(1, -1) + 'USDT');
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
// pages BACKWARDS from end (exclusive) until `from` or the listing
async function pages(sym, from, end) {
  let rows = [], e = end - 1;
  for (;;) {
    const k = await get(`symbol=${sym}&interval=15m&limit=1000&endTime=${e}`);
    if (k === null) return null;
    if (!k.length) break;
    rows = k.map((x) => [Math.floor(x[0] / 1000), +x[1], +x[2], +x[3], +x[4], +x[5]]).concat(rows);
    e = k[0][0] - 1;
    if (k.length < 1000 || k[0][0] <= from) break;
  }
  return rows.filter((r) => r[0] * 1000 >= from && r[0] * 1000 < end);
}
async function pull(sym, from) {
  const f = path.join(OUT, `${sym}_15m.json`);
  if (fs.existsSync(f)) return { n: JSON.parse(fs.readFileSync(f)).length, cached: true };
  const mf = path.join(MID, `${sym}_15m.json`);
  let rows;
  if (from === 0 && fs.existsSync(mf)) {
    const mid = JSON.parse(fs.readFileSync(mf));
    const a = mid[0][0] * 1000, b = mid[mid.length - 1][0] * 1000;
    // the middle file started at 2022-09-01 unless the coin listed later: only then is there nothing older
    const early = a <= Date.UTC(2022, 8, 1) ? await pages(sym, 0, a) : [];
    const late = await pages(sym, b + 1, END);
    if (early === null || late === null) return { missing: true };
    rows = early.concat(mid, late);
  } else {
    rows = await pages(sym, from, END);
    if (rows === null) return { missing: true };
  }
  const seen = new Set();
  rows = rows.filter((r) => !seen.has(r[0]) && seen.add(r[0])).sort((x, y) => x[0] - y[0]);
  fs.writeFileSync(f, JSON.stringify(rows));
  return { n: rows.length };
}
(async () => {
  const args = process.argv.slice(2), fa = args.find((a) => a.startsWith('FROM='));
  const from = fa ? Date.parse(fa.slice(5) + 'T00:00:00Z') : 0;
  const syms = args.filter((a) => !a.startsWith('FROM=')).map((s) => s.toUpperCase().endsWith('USDT') ? s.toUpperCase() : s.toUpperCase() + 'USDT');
  const jobs = (syms.length ? syms : LIST).slice();
  let done = 0; const t0 = Date.now(), miss = [];
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (jobs.length) {
      const s = jobs.shift();
      try { const r = await pull(s, from); done++; if (r.missing) miss.push(s);
        console.log(`${String(done).padStart(4)} ${s.padEnd(13)} ${r.missing ? 'NO SUCH PAIR' : r.n + ' bars'}${r.cached ? ' (cached)' : ''} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      } catch (e) { console.log(`FAIL ${s}: ${e.message}`); miss.push(s + ' (failed)'); }
    }
  }));
  console.log(`DONE ${done} in ${((Date.now() - t0) / 1000).toFixed(0)}s · missing: ${miss.join(', ') || 'none'}`);
})();
