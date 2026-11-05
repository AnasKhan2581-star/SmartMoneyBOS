// Today's "Top 50 gainers" exactly as the Compare tab's button builds it (buildGainers / spotUniverse /
// isNormalCoin, read out of index.html), saved with its timestamp so the scenario can be re-run.
//   NODE_USE_ENV_PROXY=1 node research/liqbrk15m/gainers.js   → research/cache/lb15/gainers.json
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const grabLine = (re) => { const m = html.match(re); if (!m) throw new Error('not found: ' + re); return m[0]; };
const grabFn = (name) => {
  const i = html.indexOf(`function ${name}(`); if (i < 0) throw new Error(name + ' not found');
  let j = html.indexOf('{', i), d = 0; for (; j < html.length; j++) { if (html[j] === '{') d++; else if (html[j] === '}' && --d === 0) break; }
  return html.slice(i, j + 1);
};
const src = [grabLine(/const QUOTES=.*;/), grabLine(/const NOT_COIN_SYM=.*;/), grabLine(/const NOT_COIN_SET=.*;/),
  grabLine(/const STOCK_SNAPSHOT=.*;/), grabLine(/const isLevToken=.*;/), grabFn('normSym'), grabFn('spotUniverse'),
  grabLine(/const isNormalCoin=[\s\S]*?normSym\(b\)===b\+'USDT';/), grabLine(/const coinsNote=[\s\S]*?: `; Binance's stock list unavailable, used the \$\{U\.stockSrc\}`\);/),
  grabLine(/const GAIN_MIN_VOL=.*;/), grabFn('buildGainers')].join('\n');
const binanceJSON = async (p) => { const r = await fetch('https://data-api.binance.vision' + p); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); };
const buildGainers = new Function('binanceJSON', src.replace('function spotUniverse', 'async function spotUniverse').replace('async async', 'async')
  .replace('function buildGainers', 'async function buildGainers').replace('async async', 'async') + '\nreturn buildGainers;')(binanceJSON);
(async () => {
  const g = await buildGainers(50);
  const out = path.join(ROOT, 'research', 'cache', 'lb15', 'gainers.json');
  fs.writeFileSync(out, JSON.stringify(g, null, 1));
  console.log(new Date(g.at).toISOString(), g.coins);
  console.log(g.syms.map((s, i) => s.replace(/USDT$/, '') + ' ' + (g.chg[i] * 100).toFixed(1) + '%').join(' · '));
})();
