/*
 * liqbrk research lab — exit variants, honest fills, regime veto, coin selection.
 *
 * Re-implements liqbrk's ENTRY rules from detector.js so that exits and fills can be varied,
 * and proves itself first: with close fills + the shipped exit it must reproduce
 * detector.detectAll(...).trades trade-for-trade on every coin, or nothing it says is trusted.
 *
 *   python research/fetch_klines.py 2h SOL FET ...    # fill research/cache first
 *   node research/liqbrk_lab.js parity
 *   node research/liqbrk_lab.js <report>
 */
'use strict';
const fs = require('fs'), path = require('path');
const SMC = require('../detector.js');
const P = SMC.DEFAULTS;
const CACHE = path.join(__dirname, 'cache');
const FEE = 0.001;                                   // 0.1% per side, as everywhere in this repo

// ---------- data ----------
// Symbols whose Binance ticker was reused after a collapse: keep only the original coin, so the
// collapse is in the data and the relisted token's price is never stitched onto it.
const TRUNC = { LUNA: Date.UTC(2022, 4, 14) / 1000, FTT: Date.UTC(2022, 10, 16) / 1000 };
function load(coin, tf = '2h') {
  let raw = JSON.parse(fs.readFileSync(path.join(CACHE, `${coin}_2h.json`)));
  if (TRUNC[coin]) raw = raw.filter(r => r[0] < TRUNC[coin]);
  let c = raw.map(r => ({ time: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] }));
  const H = { '4h': 4, '6h': 6, '8h': 8, '12h': 12, '1d': 24 }[tf];
  if (H) {                                           // exact aggregation of 2h -> 4h..1d (UTC-aligned, like Binance)
    const out = [], sec = H * 3600, need = H / 2;
    for (const b of c) {
      const k = Math.floor(b.time / sec) * sec, last = out[out.length - 1];
      if (last && last.time === k) {
        last.high = Math.max(last.high, b.high); last.low = Math.min(last.low, b.low);
        last.close = b.close; last.volume += b.volume; last.n++;
      } else out.push({ time: k, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume, n: 1 });
    }
    c = out.filter(b => b.n === need).map(({ n, ...b }) => b);   // drop part-filled buckets
  }
  return c;
}
const slice = (c, fromSec, toSec = Infinity) => c.filter(b => b.time >= fromSec && b.time < toSec);

// ---------- indicators: a line-for-line replica of runQuant's liqbrk precompute ----------
function indicators(c, prm = {}) {
  const p = { ...P, ...prm }, n = c.length;
  const dt = n > 1 ? Math.max(60, c[1].time - c[0].time) : 86400, bpd = 86400 / dt;
  const S = d => Math.max(2, Math.round(d * bpd));
  const closes = c.map(b => b.close);
  const sma = len => { const o = new Array(n).fill(NaN); let s = 0;
    for (let i = 0; i < n; i++) { s += closes[i]; if (i >= len) s -= closes[i - len]; if (i >= len - 1) o[i] = s / len; } return o; };
  const a = SMC.atr(c, p.atrLen);
  const bL = S(p.lbBreak), eL = S(p.lbExit), vL = Math.max(2, S(1));
  const hiB = new Array(n).fill(Infinity), loE = new Array(n).fill(-Infinity), rv = new Array(n).fill(1);
  for (let i = 1; i < n; i++) {
    let h = -Infinity, l = Infinity;
    for (let j = Math.max(0, i - bL); j < i; j++) if (c[j].high > h) h = c[j].high;
    for (let j = Math.max(0, i - eL); j < i; j++) if (c[j].low < l) l = c[j].low;
    hiB[i] = h; loE[i] = l;
  }
  let vs = 0;
  for (let i = 0; i < n; i++) { const v = c[i].volume || 0; vs += v; if (i >= vL) vs -= (c[i - vL].volume || 0);
    const avg = vs / Math.min(i + 1, vL); rv[i] = avg > 0 ? v / avg : 1; }
  const maT = sma(S(p.lbTrend)), mab = Math.max(0, Math.round(p.lbMaBars || 0));
  const maBars = mab >= 2 ? sma(mab) : null;
  const warm = Math.max(S(p.lbTrend), S(p.lbBreak), S(1), mab) + 2;
  const sig = new Array(n).fill(false);
  for (let i = warm; i < n; i++) {
    const px = closes[i];
    sig[i] = px > hiB[i] && closes[i - 1] <= hiB[i - 1] && px > maT[i] && rv[i] >= p.lbRelVol
      && (!maBars || px > maBars[i]) && (!(p.lbBrkExt > 0) || (px - hiB[i]) >= p.lbBrkExt * a[i]);
  }
  return { a, hiB, loE, rv, maT, sig, warm, bpd, p };
}

// ---------- simulator ----------
// cfg.fill:  'close' (what the app does) | 'next' (next bar's open, plus slippage — achievable)
// cfg.exit:  'base' = shipped rule: 4xATR intrabar stop, close below the prior 1-day low
//            'scale3R' = sell half at entry+3R, the rest keeps the base rule
//            'chand' = 4xATR stop + close below (highest close since entry − k·ATR)
//            'hybrid' = base rule, but once a trade has run +tR also exit on the chandelier(k)
// cfg.veto:  per-bar boolean array — only ENTER when true (BTC above its 200-day MA)
// cfg.fee:   per-side fee override (default 0.1%)
// cfg.timeStop: days — exit at the close if the trade has not yet closed above entry+1R by then
// cfg.be:    R multiple — once a close reaches entry+be·R the stop moves up to entry (breakeven)
// cfg.cool:  days — ignore signals on this coin for this long after a STOP exit
// cfg.closeOpen: close a still-open trade at the last bar (for delisted coins, so a collapse counts)
function simulate(c, ind, cfg = {}) {
  const { a, loE, sig, warm, p } = ind, n = c.length;
  const fill = cfg.fill || 'close', slip = cfg.slip ?? 0.0005, exit = cfg.exit || 'base';
  const k = cfg.k ?? 3, tR = cfg.tR ?? 3, fee = cfg.fee ?? FEE;
  const tsBars = cfg.timeStop ? Math.round(cfg.timeStop * ind.bpd) : 0, coolBars = cfg.cool ? Math.round(cfg.cool * ind.bpd) : 0;
  let lastStop = -Infinity;
  const trades = [];
  let pos = null;
  const sellPx = (px) => fill === 'next' ? px * (1 - slip) : px;
  const done = (i, px, why) => {
    const legs = pos.legs.concat([{ w: pos.w, px, i }]);
    const gross = legs.reduce((s, l) => s + l.w * l.px, 0) / pos.entry;          // weighted exit / entry
    const net = legs.reduce((s, l) => s + l.w * (l.px * (1 - fee)) / (pos.entry * (1 + fee)), 0) - 1;
    if (why === 'STOP') lastStop = i;
    trades.push({ entryIdx: pos.entryIdx, exitIdx: i, sigIdx: pos.sigIdx, fee, entry: pos.entry, stop: pos.stop0, exit: px, why,
      ret: net, gross: gross - 1, R: (gross * pos.entry - pos.entry) / (pos.entry - pos.stop0), legs });
    pos = null;
  };
  for (let i = warm; i < n; i++) {
    const b = c[i];
    if (pos && i >= pos.entryIdx) {
      if (pos.pendingExit) { done(i, sellPx(b.open), pos.pendingExit); }      // decided at last close
      else {
        if (b.close > pos.hiC) pos.hiC = b.close;
        if (cfg.be && pos.hiC >= pos.entry + cfg.be * pos.R && pos.stop < pos.entry) pos.stop = pos.entry;
        if (b.low <= pos.stop) { done(i, sellPx(fill === 'next' ? Math.min(b.open, pos.stop) : pos.stop), 'STOP'); }
        else {
          if (exit === 'scale3R' && pos.w === 1 && b.high >= pos.entry + 3 * pos.R) {
            const t = pos.entry + 3 * pos.R;
            pos.legs.push({ w: 0.5, px: sellPx(fill === 'next' ? Math.max(b.open, t) : t), i }); pos.w = 0.5;
          }
          let why = null;
          const chand = pos.hiC - k * a[i];
          if (exit === 'chand') { if (b.close < chand) why = 'CHAND'; }
          else {
            if (b.close < loE[i]) why = 'TRAIL';
            if (!why && exit === 'hybrid' && pos.hiC >= pos.entry + tR * pos.R && b.close < chand) why = 'TIGHT';
          }
          if (!why && tsBars && i - pos.entryIdx >= tsBars && pos.hiC < pos.entry + pos.R) why = 'TIME';
          if (why) {
            if (fill === 'next' && i + 1 < n) pos.pendingExit = why;
            else done(i, sellPx(b.close), why);
          }
        }
      }
    } else if (!pos && sig[i] && (!cfg.veto || cfg.veto[i]) && i - lastStop >= coolBars) {
      if (fill === 'close') {
        const e = b.close; pos = { entry: e, stop: e - p.lbStop * a[i], entryIdx: i + 1 };   // exits from next bar
      } else if (i + 1 < n) {
        const e = c[i + 1].open * (1 + slip);
        pos = { entry: e, stop: e - p.lbStop * a[i], entryIdx: i + 1 };
      } else continue;
      pos.stop0 = pos.stop; pos.R = pos.entry - pos.stop; pos.hiC = pos.entry; pos.w = 1; pos.legs = [];
      pos.realEntryIdx = fill === 'close' ? i : i + 1; pos.sigIdx = i;
    }
  }
  if (pos && cfg.closeOpen && n - 1 >= pos.entryIdx) done(n - 1, sellPx(c[n - 1].close), 'DELIST');
  const open = pos ? { ...pos } : null;
  return { trades, open };
}

// ---------- statistics ----------
function stats(c, ind, run) {
  const t = run.trades, n = c.length;
  // Equity path marked to market every bar, all-in per trade (the app's exposure model). Value of a
  // trade at bar i = legs already sold + the remaining weight at that bar's close; at its exit bar
  // it is exactly 1 + ret, so the path ends where the compounded return says it does.
  const eq = new Array(n).fill(1); let e = 1, held = 0;
  const byEntry = new Map(); for (const tr of t) byEntry.set(tr.entryIdx, tr);
  let cur = null, e0 = 1;
  for (let i = 0; i < n; i++) {
    if (!cur && byEntry.has(i)) { cur = byEntry.get(i); e0 = e; }
    if (cur) {
      held++;
      if (i >= cur.exitIdx) { e = e0 * (1 + cur.ret); cur = null; }
      else {
        let v = 0, w = 1;
        const f = cur.fee ?? FEE;
        for (const l of cur.legs) if (l.i <= i && l !== cur.legs[cur.legs.length - 1]) { v += l.w * l.px * (1 - f); w -= l.w; }
        v += w * c[i].close * (1 - f);
        e = e0 * v / (cur.entry * (1 + f));
      }
    }
    eq[i] = e;
  }
  // that path is only used for drawdown + stability; the return is the clean compounded product
  const net = t.reduce((m, x) => m * (1 + x.ret), 1) - 1;
  let pk = 1, dd = 0; for (const v of eq) { if (v > pk) pk = v; dd = Math.max(dd, (pk - v) / pk); }
  const wins = t.filter(x => x.ret > 0), loss = t.filter(x => x.ret <= 0);
  const gp = wins.reduce((s, x) => s + x.ret, 0), gl = -loss.reduce((s, x) => s + x.ret, 0);
  const pf = gl > 0 ? gp / gl : (gp > 0 ? Infinity : 0);
  const top3 = t.slice().sort((x, y) => y.ret - x.ret).slice(0, 3);
  const rest = t.filter(x => !top3.includes(x));
  const gp3 = rest.filter(x => x.ret > 0).reduce((s, x) => s + x.ret, 0), gl3 = -rest.filter(x => x.ret <= 0).reduce((s, x) => s + x.ret, 0);
  const pf3 = gl3 > 0 ? gp3 / gl3 : (gp3 > 0 ? Infinity : 0);
  const w0 = ind.warm, bh = c[n - 1].close / c[w0].close - 1;
  // window stability: 35% windows stepped by 1/8 of a window — the same recipe as the Compare tab
  const W = Math.max(50, Math.round((n - w0) * 0.35)), step = Math.max(1, Math.round(W / 8));
  let wn = 0, wp = 0; for (let s = w0; s + W < n; s += step) { wn++; if (eq[s + W] > eq[s]) wp++; }
  return { n: t.length, wr: t.length ? wins.length / t.length : 0, pf, pf3, net, bh,
    edge: (1 + net) / (1 + bh) - 1, dd, stab: wn ? wp / wn : NaN,
    yrs: (c[n - 1].time - c[w0].time) / 31557600, expo: held / Math.max(1, n - w0), _eqEnd: eq[n - 1] };
}

module.exports = { load, slice, indicators, simulate, stats, SMC, P };

// ---------- parity: the harness must reproduce detector.js exactly ----------
if (require.main === module && process.argv[2] === 'parity') {
  const coins = fs.readdirSync(CACHE).filter(f => f.endsWith('_2h.json')).map(f => f.split('_')[0]);
  let bad = 0, total = 0;
  for (const coin of coins) for (const tf of ['2h', '4h']) {
    const c = load(coin, tf);
    if (c.length < 400) continue;
    const ref = SMC.detectAll(c, { strategy: 'liqbrk', longOnly: true, useLiq: false }).trades;
    const mine = simulate(c, indicators(c), { fill: 'close', exit: 'base' });
    const refClosed = ref.filter(x => x.outcome !== 'open');
    const same = refClosed.length === mine.trades.length && refClosed.every((r, i) => {
      const m = mine.trades[i];
      return r.entryIdx === m.entryIdx - 1 && r.exitIdx === m.exitIdx && Math.abs(r.exitPrice - m.exit) < 1e-9 * r.exitPrice
          && Math.abs(r.entry - m.entry) < 1e-9 * r.entry;
    });
    const openSame = (ref.some(x => x.outcome === 'open')) === !!mine.open;
    total++; if (!same || !openSame) { bad++; console.log(`MISMATCH ${coin} ${tf}: detector ${refClosed.length} closed, lab ${mine.trades.length}`); }
  }
  console.log(bad ? `${bad}/${total} MISMATCHED` : `PARITY OK — ${total} coin/timeframe runs reproduce detector.js trade-for-trade`);
}
