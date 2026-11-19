// Daily vs weekly vs monthly for the three strategies that take monthly alerts (Trend Follow, Turtle, BTC Cycle), Nov 2026.
//   NODE_USE_ENV_PROXY=1 node research/tfcmp/monthly.js
// 16 coins: 8 majors and the coins on the alert lists' Trend Follow / Turtle / Cycle watches. All history, the same period
// on every timeframe: from each coin's first full month to 2026-11-01, the last closed month. Stats are the Compare tab's
// own pathStats (read out of index.html, 0.1% a side); the Cycle gets BTC's daily candles for its BTC-led rules.
// Candles are cached in research/cache/monthly (git-ignored) as [[timeSec, o, h, l, c, v], ...].
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..'), CACHE = path.join(ROOT, 'research', 'cache', 'monthly');
const SMC = require(path.join(ROOT, 'detector.js'));
fs.mkdirSync(CACHE, { recursive: true });
const END = Date.UTC(2026, 10, 1);                                 // 2026-11-01 00:00 UTC: the running month is left out
const COINS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'LINK', 'ADA', 'DOGE', 'TRX', 'AR', 'PAXG', 'RAY', 'STX', 'CFX', 'INJ', 'PROM'];
const STRATS = [['tsmom', 'Trend Follow'], ['donch', 'Turtle'], ['cycle', 'BTC Cycle']], TFS = ['1d', '1w', '1M'];

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), i0 = html.indexOf('function pathStats(');
let j0 = html.indexOf('{', i0), depth = 0;
for (; j0 < html.length; j0++) { if (html[j0] === '{') depth++; else if (html[j0] === '}' && --depth === 0) break; }
const pathStats = new Function('SMC', html.slice(i0, j0 + 1) + '\nreturn pathStats;')(SMC);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(qs) {
  let err;
  for (let a = 0; a < 6; a++) {
    if (a) await sleep(500 * 2 ** (a - 1));
    for (const h of ['https://data-api.binance.vision', 'https://api.binance.com']) {
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
// every candle that opened before END, paged backwards like the app's fetchKlines
async function candles(sym, tf) {
  const f = path.join(CACHE, `${sym}_${tf}.json`);
  let rows;
  if (fs.existsSync(f)) rows = JSON.parse(fs.readFileSync(f, 'utf8'));
  else {
    rows = []; let end = END - 1;
    for (;;) {
      const k = await get(`symbol=${sym}&interval=${tf}&limit=1000&endTime=${end}`);
      if (!k || !k.length) break;
      rows = k.map((x) => [Math.floor(x[0] / 1000), +x[1], +x[2], +x[3], +x[4], +x[5]]).concat(rows);
      end = k[0][0] - 1;
      if (k.length < 1000) break;
    }
    fs.writeFileSync(f, JSON.stringify(rows));
  }
  return rows.map(([time, open, high, low, close, volume]) => ({ time, open, high, low, close, volume }));
}

const med = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const pc = (x) => (x >= 0 ? '+' : '') + (x * 100).toFixed(0) + '%';
(async () => {
  const btcD = await candles('BTCUSDT', '1d'), out = {};
  for (const coin of COINS) {
    const sym = coin + 'USDT', C = {};
    for (const tf of TFS) C[tf] = await candles(sym, tf);
    const t0 = C['1M'][1].time;                                    // the first full month (a listing month is partial)
    for (const tf of TFS) C[tf] = C[tf].filter((x) => x.time >= t0);
    for (const [st] of STRATS) for (const tf of TFS) {
      const c = C[tf], r = SMC.detectAll(c, { strategy: st, longOnly: true, useLiq: false, btcD: sym === 'BTCUSDT' ? 'self' : btcD });
      const e = pathStats(r.trades, c);
      ((out[st] = out[st] || {})[coin] = out[st][coin] || {})[tf] = { n: e.n, net: e.net, edge: e.edge, dd: e.dd, yrs: e.yrs };
    }
  }
  for (const [st, name] of STRATS) {
    console.log(`\n${name}: net / vs holding / max drawdown / closed trades`);
    for (const coin of COINS) {
      const r = out[st][coin];
      console.log(`  ${coin.padEnd(5)} ` + TFS.map((tf) => `${tf.padEnd(3)} ${pc(r[tf].net).padStart(7)} ${pc(r[tf].edge).padStart(6)} DD ${pc(-r[tf].dd).padStart(5)} n${String(r[tf].n).padStart(3)}`).join(' | ')
        + `  (${r['1M'].yrs.toFixed(1)} y)`);
    }
    const rows = Object.values(out[st]), beat = (a, b) => rows.filter((r) => r[a].net > r[b].net).length;
    const m = (k, tf) => med(rows.map((r) => r[tf][k]));
    console.log(`  median net: ${TFS.map((tf) => `${tf} ${pc(m('net', tf))}`).join(' · ')}`
      + ` | median DD: ${TFS.map((tf) => `${tf} ${pc(-m('dd', tf))}`).join(' · ')}`
      + ` | trades a coin: ${TFS.map((tf) => `${tf} ${m('n', tf)}`).join(' · ')}`
      + ` | 1M beats 1d on ${beat('1M', '1d')}/${rows.length}, 1w on ${beat('1M', '1w')}/${rows.length}`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
