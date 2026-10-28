// Klines for the 15m-vs-4h study, fetched the way the app's fetchKlines does it: pages BACKWARDS from a fixed end
// via endTime, no renamed-ticker stitching (the app has none), so every row here is what the Compare tab would see.
//   NODE_USE_ENV_PROXY=1 node research/tfcmp/fetch.js 15m 4h 1d:BTC
// Writes research/cache/tfcmp/<SYM>_<TF>.json as [[timeSec, o, h, l, c, v], ...]; existing complete files are kept.
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..'), OUT = path.join(ROOT, 'research', 'cache', 'tfcmp');
fs.mkdirSync(OUT, { recursive: true });
const END = Date.UTC(2026, 9, 28);                 // 2026-10-28 00:00 UTC — the same last bar for every coin and TF
const FROM = Date.UTC(2022, 8, 1);                 // window starts 2022-10-28; the extra weeks warm BTC's 50-day gate
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
        if (r.status === 400 || r.status === 404) return null;          // no such pair
        if (!r.ok) { err = `HTTP ${r.status}`; continue; }
        return await r.json();
      } catch (e) { err = e.message; }
    }
  }
  throw new Error(err);
}
async function pull(sym, tf, from) {
  const f = path.join(OUT, `${sym}_${tf}.json`);
  if (fs.existsSync(f)) return { sym, tf, n: JSON.parse(fs.readFileSync(f)).length, cached: true };
  let rows = [], end = END - 1;
  for (;;) {
    const k = await get(`symbol=${sym}&interval=${tf}&limit=1000&endTime=${end}`);
    if (k === null) return { sym, tf, n: 0, missing: true };
    if (!k.length) break;
    rows = k.map((x) => [Math.floor(x[0] / 1000), +x[1], +x[2], +x[3], +x[4], +x[5]]).concat(rows);
    end = k[0][0] - 1;
    if (k.length < 1000 || k[0][0] <= from) break;
  }
  const seen = new Set();
  rows = rows.filter((r) => r[0] * 1000 >= from && !seen.has(r[0]) && seen.add(r[0])).sort((a, b) => a[0] - b[0]);
  fs.writeFileSync(f, JSON.stringify(rows));
  return { sym, tf, n: rows.length };
}
(async () => {
  const jobs = [];
  for (const a of process.argv.slice(2)) {
    const [tf, only] = a.split(':');
    for (const s of only ? [only + 'USDT'] : LIST) jobs.push([s, tf, tf === '1d' ? Date.UTC(2017, 7, 1) : FROM]);
  }
  let done = 0; const t0 = Date.now(), miss = [];
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (jobs.length) {
      const [s, tf, from] = jobs.shift();
      try { const r = await pull(s, tf, from); done++; if (r.missing) miss.push(`${s} ${tf}`);
        console.log(`${String(done).padStart(4)} ${s.padEnd(12)} ${tf.padEnd(4)} ${r.missing ? 'NO SUCH PAIR' : r.n + ' bars'}${r.cached ? ' (cached)' : ''} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      } catch (e) { console.log(`FAIL ${s} ${tf}: ${e.message}`); miss.push(`${s} ${tf} (failed)`); }
    }
  }));
  console.log(`DONE ${done} files in ${((Date.now() - t0) / 1000).toFixed(0)}s · missing: ${miss.join(', ') || 'none'}`);
})();
