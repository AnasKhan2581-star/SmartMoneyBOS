/*
 * The stock study's data layer: cleaned candles on three timeframes, and the daily CONTEXT every strategy reads.
 *
 *   const D = require('./stock_data.js');  const M = D.market('us');   // or 'in'
 *   M.stocks[i] = { key, sector, d1: [...], h1: [...] | null, w1: [...] }      candles { t, d, o, h, l, c, v }
 *   M.ctx(key, date)  -> { bull, above, rs, sec, breadth, vix } as of that day's close (null before the warm-up)
 *   M.prevDay(date)   -> the trading day before, for anything decided inside a day
 *
 * Prices are adjusted for splits and dividends, so a held share earns its total return.
 * `t` is the candle's opening time (UTC seconds); `d` is the exchange's own calendar date, for a weekly candle the
 * date of its last trading day.
 *
 * What the cleaning does (Yahoo's raw files are in research/cache/stocks/raw, see fetch.js):
 *   daily   rows with no volume are placeholders and are dropped; a high or low that does not contain the open and
 *           close is widened to it. India only: a single day that jumps and jumps straight back is a bad tick and is
 *           dropped, and everything BEFORE the last one-day move of more than 45% is discarded, because on NSE that
 *           is a mis-adjusted split or a demerger, not a price (Yahoo's Indian history is full of them before 2008).
 *           Dividends are applied from Yahoo's event list; one worth over 25% of the price is ignored (those are
 *           spin-offs or errors).
 *   hourly  stray prints (no volume, no range) are dropped; a stretch where the hourly close sits more than 5% off
 *           the daily close is an unadjusted split or demerger in the hourly feed and is rescaled to the daily
 *           series; then each day carries its daily dividend factor. A share with under 2,000 hourly candles has
 *           no hourly series. Hourly VOLUME is unreliable (India reports none for the first hour of most days), so
 *           no strategy uses it.
 *   weekly  built from the daily candles, Monday to Friday.
 */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const CACHE = path.join(ROOT, 'research', 'cache', 'stocks'), RAW = path.join(CACHE, 'raw');
const U = JSON.parse(fs.readFileSync(path.join(__dirname, 'universe.json'), 'utf8'));
const fileOf = (sym, iv) => path.join(RAW, `${sym.replace(/[^A-Za-z0-9.\-]/g, '_')}_${iv}.json`);
const localDate = (t, off) => new Date((t + off) * 1000).toISOString().slice(0, 10);
const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
let SYM = null;
const symOf = (mk, key) => { if (!SYM) SYM = JSON.parse(fs.readFileSync(path.join(CACHE, 'symbols.json'), 'utf8')); return SYM[`${mk}:${key}`]; };

// ---------------------------------------------------------------- daily
function loadDaily(mk, key, isIndex) {
  const raw = JSON.parse(fs.readFileSync(fileOf(symOf(mk, key), '1d'), 'utf8')), off = raw.gmtoffset || 0, notes = [];
  let r = [];
  for (const x of raw.rows) {
    if (!isIndex && !(x[5] > 0)) continue;
    if (!(x[4] > 0) || !(x[1] > 0)) continue;
    const d = localDate(x[0], off); if (r.length && r[r.length - 1].d === d) r.pop();       // Yahoo can repeat the last day
    r.push({ t: x[0], d, o: x[1], h: Math.max(x[1], x[2], x[3], x[4]), l: Math.min(x[1], x[2], x[3], x[4]), c: x[4], v: x[5] || 0 });
  }
  if (!isIndex && mk === 'in') {
    for (let i = r.length - 2; i >= 1; i--) { const a = r[i].c / r[i - 1].c - 1, b = r[i + 1].c / r[i].c - 1;
      if ((a > 0.4 && b < -0.28) || (a < -0.28 && b > 0.4)) { notes.push(`bad tick on ${r[i].d} dropped`); r.splice(i, 1); } }
    let cut = 0; for (let i = 1; i < r.length; i++) if (Math.abs(r[i].c / r[i - 1].c - 1) > 0.45) cut = i;
    if (cut) { notes.push(`history before ${r[cut].d} dropped (a one-day move of ${((r[cut].c / r[cut - 1].c - 1) * 100).toFixed(0)}%: a data break)`); r = r.slice(cut); }
  }
  // dividends -> a factor for every earlier candle
  const f = new Float64Array(r.length).fill(1);
  if (!isIndex) {
    const ev = Object.values((raw.events || {}).dividends || {}).filter((e) => e.amount > 0).sort((a, b) => a.date - b.date);
    let k = 0, skipped = 0; const cuts = [];
    for (const e of ev) { while (k < r.length && r[k].t < e.date) k++; if (k === 0 || k >= r.length) continue;
      const y = e.amount / r[k - 1].c; if (y > 0.25) { skipped++; continue; } cuts.push([k, 1 - y]); }
    let acc = 1, j = cuts.length - 1;
    for (let i = r.length - 1; i >= 0; i--) { while (j >= 0 && cuts[j][0] > i) { acc *= cuts[j][1]; j--; } f[i] = acc; }
    if (skipped) notes.push(`${skipped} dividend${skipped > 1 ? 's' : ''} over 25% of the price ignored`);
  }
  const out = r.map((x, i) => ({ t: x.t, d: x.d, o: x.o * f[i], h: x.h * f[i], l: x.l * f[i], c: x.c * f[i], v: x.v, rc: x.c, f: f[i] }));
  return { bars: out, notes, off };
}

// ---------------------------------------------------------------- hourly
function loadHourly(mk, key, daily) {
  const file = fileOf(symOf(mk, key), '1h'); if (!fs.existsSync(file)) return { bars: null, notes: ['no hourly file'] };
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')), off = raw.gmtoffset != null ? raw.gmtoffset : daily.off, notes = [];
  const dm = new Map(daily.bars.map((b) => [b.d, b]));
  const days = []; let cur = null;
  for (const x of raw.rows) {
    if (!(x[4] > 0) || !(x[1] > 0)) continue;
    if (!(x[5] > 0) && x[2] === x[3]) continue;                                   // a stray print
    const d = localDate(x[0], off); if (!dm.has(d)) continue;                     // a day the daily series does not have
    if (!cur || cur.d !== d) days.push(cur = { d, rows: [] });
    cur.rows.push(x);
  }
  const n = days.reduce((s, x) => s + x.rows.length, 0);
  if (n < 2000) return { bars: null, notes: [`only ${n} hourly candles`] };
  // the hourly feed against the daily one: an unadjusted split or demerger shows as a ratio that stays off 1
  const ratio = days.map((x) => dm.get(x.d).rc / x.rows[x.rows.length - 1][4]);
  let fixed = 0; const bars = [];
  days.forEach((x, i) => {
    const m = median(ratio.slice(Math.max(0, i - 10), i + 11)), fix = Math.abs(m - 1) > 0.05 ? m : 1; if (fix !== 1) fixed++;
    const s = fix * dm.get(x.d).f;
    for (const q of x.rows) bars.push({ t: q[0], d: x.d, o: q[1] * s, h: Math.max(q[1], q[2], q[3], q[4]) * s, l: Math.min(q[1], q[2], q[3], q[4]) * s, c: q[4] * s, v: q[5] || 0 });
  });
  if (fixed) notes.push(`${fixed} days of hourly candles rescaled to the daily series (an unadjusted split or demerger)`);
  return { bars, notes };
}

// ---------------------------------------------------------------- weekly (Monday-based weeks, from the daily candles)
function toWeekly(d1) {
  const out = []; let cur = null, wk = null;
  for (const b of d1) {
    const t0 = Date.parse(b.d + 'T00:00:00Z') / 1000, dow = (new Date(t0 * 1000).getUTCDay() + 6) % 7, w = t0 - dow * 86400;
    if (w !== wk) { wk = w; out.push(cur = { t: b.t, d: b.d, d0: b.d, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }); }   // d: the week's last day so far, d0: its first
    else { cur.d = b.d; cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c; cur.v += b.v; }
  }
  return out;
}

// ---------------------------------------------------------------- indicators
function sma(a, n) { const o = new Float64Array(a.length).fill(NaN); let s = 0; for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= n) s -= a[i - n]; if (i >= n - 1) o[i] = s / n; } return o; }
// the highest high / lowest low of the n candles BEFORE i
function prevHigh(b, n) { const o = new Float64Array(b.length).fill(NaN); for (let i = n; i < b.length; i++) { let m = -Infinity; for (let j = i - n; j < i; j++) if (b[j].h > m) m = b[j].h; o[i] = m; } return o; }
function prevLow(b, n) { const o = new Float64Array(b.length).fill(NaN); for (let i = n; i < b.length; i++) { let m = Infinity; for (let j = i - n; j < i; j++) if (b[j].l < m) m = b[j].l; o[i] = m; } return o; }
function atr(b, n) { const o = new Float64Array(b.length).fill(NaN); let a = 0;
  for (let i = 0; i < b.length; i++) { const tr = i ? Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c)) : b[i].h - b[i].l;
    if (i < n) { a += tr / n; if (i === n - 1) o[i] = a; } else { a = (a * (n - 1) + tr) / n; o[i] = a; } } return o; }
function rsi(c, n) { const o = new Float64Array(c.length).fill(NaN); let g = 0, l = 0;
  for (let i = 1; i < c.length; i++) { const ch = c[i] - c[i - 1], up = Math.max(ch, 0), dn = Math.max(-ch, 0);
    if (i <= n) { g += up / n; l += dn / n; if (i === n) o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); }
    else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } } return o; }

// ---------------------------------------------------------------- a market: its stocks and its daily context
const MARKETS = {
  us: { name: 'US', cost: 0.0005, start: '2000-01-01', note: '0.05% a side (spread and slippage; commissions are zero)' },
  in: { name: 'India', cost: 0.002, start: '2010-01-01', note: '0.2% a side (0.1% STT on delivery trades, exchange and stamp charges, slippage)' },
};
const cacheM = {};
function market(mk) {
  if (cacheM[mk]) return cacheM[mk];
  const cfg = MARKETS[mk], idx = loadDaily(mk, U.context[mk].index, true).bars, vix = loadDaily(mk, U.context[mk].vix, true).bars;
  const stocks = [], notes = [];
  for (const s of U[mk]) {
    const dl = loadDaily(mk, s.key, false); if (dl.bars.length < 260) { notes.push(`${s.key}: under a year of clean daily history, left out`); continue; }
    const hl = loadHourly(mk, s.key, dl);
    for (const x of dl.notes.concat(hl.notes.filter((q) => !/^only|^no hourly/.test(q)))) notes.push(`${s.key}: ${x}`);
    if (!hl.bars) notes.push(`${s.key}: no hourly series (${hl.notes.join('; ')})`);
    stocks.push({ key: s.key, sector: s.sector, name: s.name || s.key, d1: dl.bars, h1: hl.bars, w1: toWeekly(dl.bars) });
  }
  // the market's calendar is the index's
  const dates = idx.map((b) => b.d), di = new Map(dates.map((d, i) => [d, i])), prev = new Map(dates.map((d, i) => [d, i ? dates[i - 1] : null]));
  const ic = idx.map((b) => b.c), i200 = sma(ic, 200), bull = dates.map((_, i) => (isFinite(i200[i]) ? ic[i] > i200[i] : null));
  const vm = new Map(vix.map((b) => [b.d, b.c]));
  // per stock, per day: its own 200-day trend, its 6-month and 3-month return
  const feats = stocks.map((s) => { const c = s.d1.map((b) => b.c), m200 = sma(c, 200), m50 = sma(c, 50), n = c.length;
    const r126 = new Float64Array(n).fill(NaN), r63 = new Float64Array(n).fill(NaN);
    for (let i = 0; i < n; i++) { if (i >= 126) r126[i] = c[i] / c[i - 126] - 1; if (i >= 63) r63[i] = c[i] / c[i - 63] - 1; }
    return { c, m200, m50, r126, r63, at: new Map(s.d1.map((b, i) => [b.d, i])) }; });
  // per day across the market: relative-strength percentile, sector strength, breadth
  const sectors = [...new Set(stocks.map((s) => s.sector))];
  const rs = stocks.map((s) => new Float32Array(s.d1.length).fill(NaN)), secTop = new Map(), breadth = new Float32Array(dates.length).fill(NaN);
  dates.forEach((d, k) => {
    const row = []; let ab = 0, cnt = 0; const sec = {};
    stocks.forEach((s, j) => { const i = feats[j].at.get(d); if (i === undefined) return;
      if (isFinite(feats[j].r126[i])) row.push([feats[j].r126[i], j, i]);
      if (isFinite(feats[j].m50[i])) { cnt++; if (feats[j].c[i] > feats[j].m50[i]) ab++; }
      if (isFinite(feats[j].r63[i])) (sec[s.sector] = sec[s.sector] || []).push(feats[j].r63[i]); });
    if (row.length >= 8) { row.sort((a, b) => a[0] - b[0]); row.forEach(([, j, i], q) => { rs[j][i] = row.length > 1 ? q / (row.length - 1) : 0.5; }); }
    if (cnt >= 8) breadth[k] = ab / cnt;
    const sr = Object.entries(sec).filter(([, v]) => v.length >= 2).map(([name, v]) => [name, v.reduce((a, b) => a + b, 0) / v.length]).sort((a, b) => b[1] - a[1]);
    if (sr.length >= 4) secTop.set(d, new Set(sr.slice(0, Math.ceil(sr.length / 2)).map((x) => x[0])));
  });
  const byKey = new Map(stocks.map((s, j) => [s.key, j]));
  // context as of the close of `date`: null while the index's 200-day average is still warming up
  const ctx = (key, date) => { const j = byKey.get(key), k = di.get(date); if (j === undefined || k === undefined || bull[k] == null) return null;
    const i = feats[j].at.get(date); if (i === undefined) return null;
    const st = secTop.get(date);
    return { bull: bull[k], above: isFinite(feats[j].m200[i]) ? feats[j].c[i] > feats[j].m200[i] : null, rs: isFinite(rs[j][i]) ? rs[j][i] : null,
      sec: st ? st.has(stocks[j].sector) : null, breadth: isFinite(breadth[k]) ? breadth[k] : null, vix: vm.get(date) ?? null, r126: feats[j].r126[i] }; };
  return (cacheM[mk] = { mk, cfg, stocks, idx, dates, bull, breadth, sectors, notes, ctx, prevDay: (d) => prev.get(d) ?? null, dateIdx: di, byKey, feats });
}

module.exports = { market, MARKETS, U, sma, prevHigh, prevLow, atr, rsi, toWeekly, loadDaily, loadHourly, median };

// ---------------------------------------------------------------- `node stock_data.js check`: what was loaded
if (require.main === module) {
  for (const mk of ['us', 'in']) {
    const M = market(mk), n = M.stocks.length, h = M.stocks.filter((s) => s.h1).length;
    const first = M.stocks.map((s) => s.d1[0].d).sort();
    console.log(`\n${M.cfg.name}: ${n} stocks, ${h} with hourly candles; daily history starts ${first[0]} … median ${first[n >> 1]} … ${first[n - 1]}; index ${M.idx[0].d} → ${M.idx[M.idx.length - 1].d}`);
    console.log(`  listed by ${M.cfg.start}: ${first.filter((d) => d <= M.cfg.start).length}; by 2015: ${first.filter((d) => d < '2015-01-01').length}; by 2020: ${first.filter((d) => d < '2020-01-01').length}`);
    console.log(`  bull days (index over its 200-day average): ${(M.bull.filter((x) => x).length / M.bull.filter((x) => x != null).length * 100).toFixed(0)}%`);
    for (const x of M.notes) console.log('  - ' + x);
    const s = M.stocks[0], L = s.d1.length - 1, c = M.ctx(s.key, s.d1[L].d); console.log(`  e.g. ${s.key} ${s.d1[L].d}: close ${s.d1[L].c.toFixed(2)}, context ${JSON.stringify(c)}`);
  }
}
