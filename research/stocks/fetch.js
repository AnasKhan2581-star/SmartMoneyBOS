/*
 * Price history for the stock study, from Yahoo Finance's chart API (keyless).
 *
 *   NODE_USE_ENV_PROXY=1 node research/stocks/fetch.js            # everything that is missing
 *   NODE_USE_ENV_PROXY=1 node research/stocks/fetch.js refresh    # download again
 *
 * Per symbol: DAILY candles over all history (with Yahoo's adjusted close and its split / dividend events) and
 * HOURLY candles for the last 730 days, which is all Yahoo serves. 15-minute data reaches back only 60 days, so it
 * is not fetched: nothing can be backtested on it.
 * Also the context series: S&P 500, Sensex, Nifty 50, VIX and India VIX.
 * Files land in research/cache/stocks/raw (git-ignored). An Indian stock is listed under one of a few candidate NSE
 * codes; the one whose 31 March closes match the HalalVest page's own prices is kept (universe.json `check`).
 */
'use strict';
const fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, '..', 'cache', 'stocks', 'raw');
const U = JSON.parse(fs.readFileSync(path.join(__dirname, 'universe.json'), 'utf8'));
const UA = 'Mozilla/5.0 (X11; Linux x86_64)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fileOf = (sym, iv) => path.join(DIR, `${sym.replace(/[^A-Za-z0-9.\-]/g, '_')}_${iv}.json`);

async function chart(sym, qs) {
  let err = null;
  for (let k = 0; k < 5; k++) {
    for (const host of ['query1', 'query2']) {
      try {
        const r = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?${qs}`, { headers: { 'User-Agent': UA } });
        if (r.status === 404) return null;                              // no such symbol
        if (!r.ok) { err = `HTTP ${r.status}`; continue; }
        const j = await r.json(), res = j && j.chart && j.chart.result && j.chart.result[0];
        if (!res) { if (j && j.chart && j.chart.error && /not found|delisted/i.test(JSON.stringify(j.chart.error))) return null; err = 'empty result'; continue; }
        return res;
      } catch (e) { err = e.message; }
    }
    await sleep(1500 * (k + 1));
  }
  throw new Error(`${sym}: ${err}`);
}
// a compact file: meta, and one row per candle [t, o, h, l, c, v, adjclose?]
function pack(res) {
  const ts = res.timestamp || [], q = res.indicators.quote[0], adj = res.indicators.adjclose ? res.indicators.adjclose[0].adjclose : null, rows = [];
  for (let i = 0; i < ts.length; i++) {
    if (q.close[i] == null || q.open[i] == null || q.high[i] == null || q.low[i] == null) continue;
    rows.push([ts[i], q.open[i], q.high[i], q.low[i], q.close[i], q.volume[i] || 0, adj ? adj[i] : null]);
  }
  const m = res.meta;
  return { symbol: m.symbol, currency: m.currency, exchange: m.exchangeName, tz: m.exchangeTimezoneName, gmtoffset: m.gmtoffset, type: m.instrumentType,
    firstTradeDate: m.firstTradeDate, fetched: Math.floor(Date.now() / 1000), events: res.events || {}, rows };
}
const DAILY = `period1=0&period2=${Math.floor(Date.now() / 1000) + 86400}&interval=1d&events=div%2Csplits&includeAdjustedClose=true`;
const HOURLY = 'range=730d&interval=1h&includePrePost=false';
// the page's 31 March price for year Y against this file's adjusted close on the last trading day up to 31 March
function checkErr(pk, check) {
  let worst = 0, n = 0;
  for (const [y, px] of Object.entries(check || {})) {
    const lim = Date.UTC(+y, 3, 1) / 1000; let c = null;
    for (const r of pk.rows) { if (r[0] >= lim) break; c = r[4]; }       // split-adjusted close (the page uses split-adjusted closes)
    if (c == null || !(px > 0)) continue; n++; worst = Math.max(worst, Math.abs(c / px - 1));
  }
  return n ? worst : null;
}

(async () => {
  const refresh = process.argv[2] === 'refresh';
  fs.mkdirSync(DIR, { recursive: true });
  const jobs = [];
  for (const mk of ['us', 'in']) { for (const s of U[mk]) jobs.push({ mk, key: s.key, cands: s.yahoo, check: s.check || null });
    for (const sym of Object.values(U.context[mk])) jobs.push({ mk, key: sym, cands: [sym], ctx: true }); }
  const resolved = fs.existsSync(path.join(DIR, '..', 'symbols.json')) && !refresh ? JSON.parse(fs.readFileSync(path.join(DIR, '..', 'symbols.json'))) : {};
  let done = 0, bad = [];
  for (const j of jobs) {
    const id = `${j.mk}:${j.key}`;
    try {
      let sym = resolved[id] || null;
      if (!sym || refresh || !fs.existsSync(fileOf(sym, '1d'))) {
        sym = null; let best = null;
        for (const c of j.cands) {
          const res = await chart(c, DAILY); await sleep(250);
          if (!res) continue;
          const pk = pack(res), e = checkErr(pk, j.check);
          if (!best || (e != null && (best.e == null || e < best.e))) best = { c, pk, e };
          if (e == null || e < 0.03) break;
        }
        if (!best || best.pk.rows.length < 30) throw new Error(`no data under ${j.cands.join(', ')}`);
        sym = best.c; fs.writeFileSync(fileOf(sym, '1d'), JSON.stringify(best.pk));
        if (best.e != null && best.e >= 0.03) console.log(`  ${id}: ${sym} differs from the page's 31 March prices by ${(best.e * 100).toFixed(1)}%`);
        resolved[id] = sym;
      }
      if (refresh || !fs.existsSync(fileOf(sym, '1h'))) {
        // Yahoo answers 422 to range=730d for a share listed more recently than that: ask from its first day instead
        let res = null;
        try { res = await chart(sym, HOURLY); }
        catch (e) { const d = JSON.parse(fs.readFileSync(fileOf(sym, '1d'))), now = Math.floor(Date.now() / 1000);
          res = await chart(sym, `period1=${Math.max(d.rows[0][0] - 86400, now - 729 * 86400)}&period2=${now}&interval=1h&includePrePost=false`); }
        await sleep(250);
        fs.writeFileSync(fileOf(sym, '1h'), JSON.stringify(res ? pack(res) : { symbol: sym, rows: [] }));
      }
    } catch (e) { bad.push(`${id}: ${e.message}`); }
    if (++done % 20 === 0) process.stderr.write(`${done}/${jobs.length}\n`);
  }
  fs.writeFileSync(path.join(DIR, '..', 'symbols.json'), JSON.stringify(resolved, null, 1));
  console.log(`${Object.keys(resolved).length} of ${jobs.length} symbols in ${DIR}`);
  if (bad.length) { console.log('FAILED:\n  ' + bad.join('\n  ')); process.exitCode = 1; }
})();
