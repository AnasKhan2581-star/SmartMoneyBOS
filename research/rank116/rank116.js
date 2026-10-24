// liqbrk 4h on every coin trading on Binance now, in two windows, ranked into one top-30 list.
//   python research/fetch_klines.py 4h --since 2022-08-15 --file research/rank116/universe.txt
//   python research/fetch_klines.py 2h BTC
//   node research/rank116/rank116.js > research/rank116/RESULTS_rank116.md
//
// Windows: NEW = the last 116 days to the latest closed 4h candle; OLD "(O)" = 2022-11-22 → 2023-09-12.
// Shipped rules (BTC > 50-day MA or coin +50%/30d, sell ½ at +3R, 149-bar MA, 4×ATR stop, 1-day-low trail),
// warmed up on history BEFORE each window so no part of the window is lost. Honest fills: next candle's open
// ± 0.05%, 0.1% fee per side. Only trades ENTERED inside a window count; one still open at the window's end is
// marked at that close (counts in Net P/L, not in trades or win rate).
// Eligible: coin listed ≥ 30 days before the window starts, ≥ $1M/day median volume in the window,
// ≥ 2 closed trades. Score = percentile points (0–100 among all eligible entries, both windows pooled):
// Net P/L 35%, Stable 25%, vs B&H 20%, Win rate 20%. A coin eligible in BOTH windows becomes one entry ★:
// the average of its two scores + 10 bonus points.
'use strict';
const fs = require('fs'), path = require('path');
const L = require('../liqbrk_lab.js');
const CACHE = path.join(__dirname, '..', 'cache');
const DAY = 86400, H4 = 14400;
const coins = fs.readFileSync(path.join(__dirname, 'universe.txt'), 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
const btc = L.load('BTC', '2h');
const load4h = (coin) => {
  const f = path.join(CACHE, `${coin}_4h.json`);
  if (!fs.existsSync(f)) return null;
  return JSON.parse(fs.readFileSync(f)).map(r => ({ time: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] }));
};
const lastT = Math.max(...['BTC', 'ETH', 'SOL'].map(c => load4h(c).slice(-1)[0].time));
const WINDOWS = [
  { key: 'new', label: 'last 116 days', from: lastT + H4 - 116 * DAY, to: lastT + H4 },
  { key: 'old', label: '2022-11-22 → 2023-09-12', from: Date.UTC(2022, 10, 22) / 1000, to: Date.UTC(2023, 8, 13) / 1000 },
];
const FEE = 0.001, SLIP = 0.0005;

function windowStats(c, w0, trades, open) {
  // equity marked to market on every window bar; a trade's value = legs already sold + the rest at the close
  const n = c.length, eq = []; let e = 1, cur = null, e0 = 1;
  const byEntry = new Map(trades.map(t => [t.entryIdx, t]));
  const all = trades.slice();
  if (open) {                                                   // mark the still-open trade at the last close
    const px = c[n - 1].close * (1 - SLIP);
    const legs = open.legs.concat([{ w: open.w, px, i: n - 1 }]);
    const ret = legs.reduce((s, l) => s + l.w * l.px * (1 - FEE), 0) / (open.entry * (1 + FEE)) - 1;
    const t = { entryIdx: open.entryIdx, exitIdx: n - 1, entry: open.entry, ret, legs, open: true };
    byEntry.set(t.entryIdx, t); all.push(t);
  }
  for (let i = w0; i < n; i++) {
    if (!cur && byEntry.has(i)) { cur = byEntry.get(i); e0 = e; }
    if (cur) {
      if (i >= cur.exitIdx) { e = e0 * (1 + cur.ret); cur = null; }
      else {
        let v = 0, wr = 1;
        for (const l of cur.legs.slice(0, -1)) if (l.i <= i) { v += l.w * l.px * (1 - FEE); wr -= l.w; }
        v += wr * c[i].close * (1 - FEE);
        e = e0 * v / (cur.entry * (1 + FEE));
      }
    }
    eq.push(e);
  }
  const closed = trades;
  const net = eq[eq.length - 1] - 1;
  const bh = c[n - 1].close / c[w0].open - 1;
  let pk = 1, dd = 0; for (const v of eq) { pk = Math.max(pk, v); dd = Math.max(dd, (pk - v) / pk); }
  const W = Math.max(30, Math.round(eq.length * 0.35)), step = Math.max(1, Math.round(W / 8));
  let wn = 0, wp = 0; for (let s = 0; s + W < eq.length; s += step) { wn++; if (eq[s + W] > eq[s]) wp++; }
  return { n: closed.length, wins: closed.filter(t => t.ret > 0).length, wr: closed.length ? closed.filter(t => t.ret > 0).length / closed.length : 0,
    net, bh, edge: (1 + net) / (1 + bh) - 1, dd, stab: wn ? wp / wn : 0, open: !!open };
}

const entries = [];
let skipped = { noData: 0, young: 0, illiquid: 0, fewTrades: 0 };
for (const coin of coins) {
  const full = load4h(coin);
  if (!full || full.length < 300) { skipped.noData += 2; continue; }
  for (const W of WINDOWS) {
    if (full[0].time > W.from - 30 * DAY) { skipped.young++; continue; }           // must exist well before the window
    const c = full.filter(b => b.time < W.to);
    const w0 = c.findIndex(b => b.time >= W.from);
    if (w0 < 0 || c.length - w0 < 100) { skipped.noData++; continue; }
    const dv = c.slice(w0).map(b => b.volume * b.close * 6).sort((a, b) => a - b);  // ≈ $/day
    if (dv[Math.floor(dv.length / 2)] < 1e6) { skipped.illiquid++; continue; }
    const ind = L.indicators(c);
    const run = L.simulate(c, ind, { fill: 'next', slip: SLIP, exit: 'scale3R', veto: L.marketGate(c, btc) });
    const inWin = run.trades.filter(t => t.entryIdx >= w0);
    const open = run.open && run.open.entryIdx >= w0 ? run.open : null;
    const s = windowStats(c, w0, inWin, open);
    if (s.n < 2) { skipped.fewTrades++; continue; }
    entries.push({ coin, win: W.key, ...s });
  }
}

// percentile points among all eligible entries (both windows pooled): 100 = best, ties share the average rank
const pctPoints = (key) => {
  const v = entries.map(e => e[key]), sorted = v.slice().sort((a, b) => a - b);
  return v.map(x => { const lo = sorted.indexOf(x), hi = sorted.lastIndexOf(x); return ((lo + hi) / 2) / Math.max(1, sorted.length - 1) * 100; });
};
const P = { net: pctPoints('net'), stab: pctPoints('stab'), edge: pctPoints('edge'), wr: pctPoints('wr') };
entries.forEach((e, i) => {
  e.pts = { net: P.net[i], stab: P.stab[i], edge: P.edge[i], wr: P.wr[i] };
  e.score = 0.35 * P.net[i] + 0.25 * P.stab[i] + 0.20 * P.edge[i] + 0.20 * P.wr[i];
});
const byCoin = new Map();
for (const e of entries) (byCoin.get(e.coin) || byCoin.set(e.coin, []).get(e.coin)).push(e);
const ranked = [...byCoin.entries()].map(([coin, es]) => {
  if (es.length === 2) return { label: `${coin} ★`, coin, both: true, score: (es[0].score + es[1].score) / 2 + 10, es };
  const e = es[0];
  return { label: e.win === 'old' ? `${coin} (O)` : coin, coin, both: false, score: e.score, es };
}).sort((a, b) => b.score - a.score);

const pc = x => (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(0) + '%';
const pp = x => (x * 100).toFixed(0) + '%';
const row = c => '| ' + c.join(' | ') + ' |';
const out = [];
const say = s => out.push(s);
say(`# liqbrk 4h — top 30 across two windows (${new Date().toISOString().slice(0, 10)})\n`);
say(`Windows: **new** = ${WINDOWS[0].label} (${new Date(WINDOWS[0].from * 1000).toISOString().slice(0, 10)} → ${new Date(lastT * 1000).toISOString().slice(0, 16)} UTC) · **(O)** = ${WINDOWS[1].label}. `
  + `${coins.length} coins trading on Binance now. Eligible entries: **${entries.length}** (new ${entries.filter(e => e.win === 'new').length}, old ${entries.filter(e => e.win === 'old').length}); `
  + `skipped — listed too late ${skipped.young}, under $1M/day ${skipped.illiquid}, fewer than 2 closed trades ${skipped.fewTrades}, no data ${skipped.noData}.\n`);
say(`Score = percentile points: Net P/L 35% · Stable 25% · vs B&H 20% · Win rate 20%. ★ = eligible in both windows: average of the two scores + 10.\n`);
say(row(['#', 'coin', 'score', 'window', 'trades', 'win rate', 'net P/L', 'vs B&H', 'stable', 'max DD', 'still open?']));
say(row(Array(11).fill('---')));
ranked.slice(0, 30).forEach((r, i) => {
  r.es.sort((a, b) => (a.win === 'new' ? -1 : 1));
  r.es.forEach((e, k) => say(row([k ? '' : i + 1, k ? '' : `**${r.label}**`, k ? '' : r.score.toFixed(1), e.win === 'new' ? 'new' : '(O)',
    e.n, pp(e.wr), pc(e.net), pc(e.edge), pp(e.stab), pc(-e.dd), e.open ? 'yes' : ''])));
});
say(`\n**Coins eligible in both windows (★), all of them:** ${ranked.filter(r => r.both).map(r => `${r.coin} (${r.score.toFixed(0)})`).join(', ') || 'none'}`);
console.log(out.join('\n'));
