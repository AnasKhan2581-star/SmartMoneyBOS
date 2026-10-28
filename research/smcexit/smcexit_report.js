// liqbrk profit-taking: the shipped "half at +3R, rest on the 4×ATR stop / 1-day-low trail" vs SMC exits —
// selling at resting buy-side liquidity (unswept swing highs) or at a major bearish FVG (the supply POI shorts sell from).
//   node research/smcexit/smcexit_report.js > research/smcexit/RESULTS_smcexit_2026-10.md
// Needs research/cache/ (python research/fetch_klines.py); the simulator is research/smcexit/smcexit_lab.js.
'use strict';
const fs = require('fs'), path = require('path');
const S = require('./smcexit_lab.js'), L = S.L;
const ROOT = path.join(__dirname, '..', '..'), CACHE = path.join(__dirname, '..', 'cache');

// ---------------------------------------------------------------- universes
// OOS = every other coin with 4h candles in the cache, NORMAL SPOT COINS only, by the app's own lists in index.html
// (stablecoins, fiat, wrapped/staked/gold copies, Binance's tokenized stocks & ETFs are not coins)
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const STOCKS = new Set(html.match(/const STOCK_SNAPSHOT=new Set\('([^']+)'/)[1].split(' '));
const NOTCOIN = new Set(html.match(/const NOT_COIN_SET=new Set\(\[([^\]]+)\]/)[1].split(',').map((x) => x.trim().replace(/'/g, '')));
const watched = new Set(JSON.parse(fs.readFileSync(path.join(ROOT, 'signals', 'watchlist.json'))).watch.map((w) => w.symbol.replace(/USDT$/, '')));
const cached = fs.readdirSync(CACHE).filter((f) => f.endsWith('_4h.json')).map((f) => f.replace('_4h.json', ''));
const dropped = cached.filter((c) => !watched.has(c) && c !== 'BTC' && (/USD/.test(c) || NOTCOIN.has(c) || STOCKS.has(c)));
const OOS = cached.filter((c) => !watched.has(c) && c !== 'BTC' && !dropped.includes(c)).sort();

const BTC = S.load4h('BTC');
const prep = (coins) => coins.map((coin) => {
  const c = S.load4h(coin); if (!c || c.length < 600) return null;
  const ind = L.indicators(c);
  return { coin, c, ind, lv: S.levels(c, ind.a), veto: L.marketGate(c, BTC), mid: c[Math.floor((ind.warm + c.length) / 2)].time };
}).filter(Boolean);
const U = { alert: prep(S.alertCoins()), oos: prep(OOS) };

// ---------------------------------------------------------------- helpers
const out = [], say = (s = '') => out.push(s);
const row = (a) => '| ' + a.join(' | ') + ' |';
const pc = (x, d = 1) => { const v = Math.abs(x * 100).toFixed(d); return (+v === 0 ? '' : x >= 0 ? '+' : '−') + v + '%'; };
const pp = (x) => (x * 100).toFixed(0) + '%';
const f2 = (x) => isFinite(x) ? x.toFixed(2) : '∞';
const med = (v) => { const s = v.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const mean = (v) => v.reduce((s, x) => s + x, 0) / Math.max(1, v.length);
const pfOf = (X) => { const g = X.filter((t) => t.ret > 0).reduce((s, t) => s + t.ret, 0), l = -X.filter((t) => t.ret <= 0).reduce((s, t) => s + t.ret, 0); return l > 0 ? g / l : Infinity; };
const sgn = (x) => (x < 0 ? '−' : '') + Math.abs(x).toFixed(1);
const iso = (t) => new Date(t * 1000).toISOString().slice(0, 10);
const rng = (seed) => { let x = 0; for (const ch of seed) x = (Math.imul(x, 31) + ch.charCodeAt(0)) >>> 0; x = x || 1;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; };
const distR = (t) => t.target == null ? null : (t.target - t.entry) / (t.entry - t.stop);

// one exit variant over a universe; cfg may depend on the coin (the controls do)
const runAll = (K, cfg) => K.map((k, i) => {
  const o = typeof cfg === 'function' ? cfg(k, i) : cfg;
  const r = S.simulate(k.c, k.ind, k.lv, { ...o, veto: k.veto });
  return { k, r, s: L.stats(k.c, k.ind, r) };
});
const summary = (per) => {
  const T = per.flatMap((x) => x.r.trades.map((t) => ({ ...t, late: x.k.c[t.entryIdx].time >= x.k.mid })));
  const tg = T.filter((t) => t.target != null);
  return { n: T.length, wr: T.filter((t) => t.ret > 0).length / Math.max(1, T.length), pf: pfOf(T),
    pf1: pfOf(T.filter((t) => !t.late)), pf2: pfOf(T.filter((t) => t.late)),
    net: med(per.map((x) => x.s.net)), dd: med(per.map((x) => x.s.dd)), slog: per.reduce((s, x) => s + Math.log(1 + x.s.net), 0),
    found: tg.length / Math.max(1, T.length), dist: med(tg.map(distR)),
    hit: tg.filter((t) => t.legs.length > 1 || t.why === 'TARGET').length / Math.max(1, tg.length) };
};
const versus = (per, base) => { let nb = 0, nw = 0, db = 0, dw = 0;
  per.forEach((x, i) => { const b = base[i].s;
    if (x.s.net > b.net + 1e-9) nb++; else if (x.s.net < b.net - 1e-9) nw++;
    if (x.s.dd < b.dd - 1e-9) db++; else if (x.s.dd > b.dd + 1e-9) dw++; });
  return { nb, nw, db, dw }; };
// the SMC run's own target distances on each coin, drawn at random: same distances, chart structure ignored
const control = (smc, exit) => (k, i) => {
  const pool = smc[i].r.trades.map(distR), r = rng(k.coin + '|' + exit);
  return { exit, draw: () => pool.length ? pool[Math.floor(r() * pool.length)] : null };
};

// ---------------------------------------------------------------- the variants
const SHIPPED = { exit: 'scale3R' };
const SMC = [
  ['½ at nearest BSL', { exit: 'half', src: 'bsl' }],
  ['½ at nearest major bearish FVG', { exit: 'half', src: 'fvg' }],
  ['½ at nearest POI (BSL or FVG)', { exit: 'half', src: 'poi' }],
  ['½ at nearest POI ≥ 2R up', { exit: 'half', src: 'poi', minR: 2 }],
  ['ALL at nearest BSL', { exit: 'all', src: 'bsl' }],
  ['ALL at nearest major bearish FVG', { exit: 'all', src: 'fvg' }],
  ['ALL at nearest POI ≥ 2R up', { exit: 'all', src: 'poi', minR: 2 }],
];
const REACT = [
  ['+3R ½, rest also out on a BSL sweep that closes back below', { exit: 'scale3R', react: 'sweep' }],
  ['+3R ½, rest also out on a bearish-FVG tap that closes back below', { exit: 'scale3R', react: 'reject' }],
];
const PLACEBO = ['  control: the same rule at fake FVGs (each real one moved 1–2 ATR)', { exit: 'scale3R', react: 'placebo' }];

const R = {};
for (const [u, K] of Object.entries(U)) {
  const base = runAll(K, SHIPPED), rows = [{ name: 'SHIPPED: ½ at +3R, rest on stop / 1-day-low trail', per: base }];
  for (const [name, cfg] of SMC) {
    const per = runAll(K, cfg), ctl = runAll(K, control(per, cfg.exit));
    rows.push({ name, per, ctl: true }, { name: '  control: same distances, random levels', per: ctl, isCtl: true });
  }
  for (const [name, cfg] of REACT) rows.push({ name, per: runAll(K, cfg), react: cfg.react });
  rows.push({ name: PLACEBO[0], per: runAll(K, PLACEBO[1]), isCtl: true });
  const placebo = rows[rows.length - 1];
  for (const r of rows) { r.sum = summary(r.per); r.vs = versus(r.per, base); }
  for (const r of rows) { if (r.ctl) r.ctlSum = rows[rows.indexOf(r) + 1].sum; if (r.react === 'reject') r.ctlSum = placebo.sum; }
  R[u] = { K, base, rows };
}

// ---------------------------------------------------------------- the test a change has to pass
const baseSum = (u) => R[u].rows[0].sum;
const checks = (u, r) => {
  const b = baseSum(u);
  return { net: r.vs.nb > r.vs.nw, dd: r.vs.db > r.vs.dw, halves: r.sum.pf1 >= b.pf1 && r.sum.pf2 >= b.pf2,
    control: r.ctlSum ? r.sum.slog > r.ctlSum.slog : null };
};
const mark = (c) => ['net', 'dd', 'halves', 'control'].map((k) => c[k] === null ? '–' : c[k] ? '✓' : '✗').join('');
const passes = (r, i) => ['alert', 'oos'].every((u) => { const c = checks(u, R[u].rows[i]); return c.net && c.dd && c.halves && c.control !== false; });

// ---------------------------------------------------------------- report
const par = S.parity();
const span = (K) => { const st = K.map((k) => k.c[k.ind.warm].time).sort((a, b) => a - b); return `${iso(st[0])} … ${iso(st[st.length - 1])}, median ${iso(med(st))}`; };
const yrs = (K) => K.reduce((s, k) => s + (k.c[k.c.length - 1].time - k.c[k.ind.warm].time) / 31557600, 0);
say(`# \`liqbrk\` profit-taking — shipped ½ at +3R vs SMC exits at BSL / major bearish FVG (Oct 2026)\n`);
say(`Generated by \`research/smcexit/smcexit_report.js\` on ${new Date().toISOString().slice(0, 10)}. Simulator: \`research/smcexit/smcexit_lab.js\`. `
  + (par.diff.length ? `**PARITY FAILED on ${par.diff.length}/${par.total} coins — do not trust these numbers.**` :
    `With the shipped exit it reproduces \`research/liqbrk_lab.js\`'s shipped rules trade-for-trade on all ${par.total} alert coins (\`node research/smcexit/smcexit_lab.js parity\`).`)
  + ` Entries are the shipped liqbrk entries in every row (149-bar MA, 1×ATR decisive break, BTC-50d gate / +50% leader rescue); `
  + `only the exit changes. Fills are honest: next candle's open ± 0.05% slippage, 0.1% fee per side, a target fills at max(open, level), `
  + `and when the stop and a target fall in the same candle the stop is taken first. Money: all-in per trade, every candle marked to market.\n`);
say(`**The question (user, Oct 2026):** instead of the fixed "sell half at +3R, then let the ATR stop / trail close the rest", take profit `
  + `where SMC says price is likely to fall back — at resting **buy-side liquidity** above (swing highs not yet traded through) or at a `
  + `**major bearish FVG**, the supply POI shorts sell from.\n`);
say(`**How the levels are drawn — never from the future:**`);
say(`- **Swing highs** come from the engine's own zigzag (a 4×ATR reversal, \`extMult\`) and are known only from the candle that confirmed the reversal.`);
say(`- **BSL** = a swing high price has not traded above yet. It is live from that confirmation until the first later wick above it (the sweep).`);
say(`- **Major bearish FVG** = a 3-candle gap down (low two candles back > this candle's high) at least 0.5×ATR tall (\`fvgMult\`). It is known at the close`);
say(`  of the third candle and live until price first trades back up into it; the target is its bottom edge, where it is first reached.`);
say(`- A trade's target is the nearest live level above the entry **as known at the signal candle's close**, fixed for the life of the trade.`);
say(`  "POI" = the nearer of the two kinds. "≥ 2R up" skips levels closer than 2R for the next one up. No level above → the shipped +3R.\n`);
say(`**Universes:**`);
say(`- **alert** — the bot's ${U.alert.length} 4h coins, full Binance history (trading from ${span(U.alert)}; ${yrs(U.alert).toFixed(0)} coin-years).`);
say(`- **oos** — ${U.oos.length} other normal spot coins in the research cache with ≥ 600 4h candles (trading from ${span(U.oos)}; ${yrs(U.oos).toFixed(0)} coin-years). `
  + `Nothing in this study was chosen on them. Stablecoins, fiat, gold and Binance's tokenized stocks/ETFs are excluded by the app's own lists `
  + `(${dropped.length} cache files dropped, e.g. ${dropped.slice(0, 6).join(', ')}).\n`);
say(`Every coin in both universes still trades today, so survivorship flatters the absolute numbers. What this study reads is the difference between rows, which share every entry.\n`);

// ---- 1. event study
say(`## 1. Does price actually fall back from these levels?\n`);
say(`Inside every shipped liqbrk trade, the first candle that reaches each level above the entry — a BSL (wick above it = the sweep), `
  + `a major bearish FVG (wick into it), or a **plain** level (entry + 1/2/3/4/5/6/8 R with no SMC level within 0.3R of it). `
  + `If SMC levels are where the coin turns down, price a day later should sit clearly lower than after a plain level, and `
  + `"−1 ATR before +1 ATR" should be well above the plain level's rate. The three kinds sit at different average distances, so this is a first look; `
  + `the exit tests in section 2 are distance-matched by their controls.\n`);
const H = 6;
const study = (K) => {
  const ev = { BSL: [], FVG: [], plain: [] }, perCoin = [];
  for (const k of K) {
    const { c, lv } = k, a = k.ind.a, n = c.length, pcn = { BSL: [], FVG: [], plain: [] };
    for (const t of S.simulate(c, k.ind, lv, { ...SHIPPED, veto: k.veto }).trades) {
      const Rr = t.entry - t.stop, sig = t.entryIdx - 1;
      const live = (list) => list.filter((q) => q.conf <= sig && q.end > sig && q.price > t.entry);
      const B = live(lv.bsl), F = live(lv.fvg), near = (px) => B.concat(F).some((q) => Math.abs(q.price - px) <= 0.3 * Rr);
      const marks = B.map((q) => ({ type: 'BSL', px: q.price })).concat(F.map((q) => ({ type: 'FVG', px: q.price })));
      for (const m of [1, 2, 3, 4, 5, 6, 8]) { const px = t.entry + m * Rr; if (!near(px)) marks.push({ type: 'plain', px }); }
      for (const m of marks) {
        let j = -1; for (let i = t.entryIdx; i <= t.exitIdx; i++) if (m.type === 'BSL' ? c[i].high > m.px : c[i].high >= m.px) { j = i; break; }
        if (j < 0 || j + H >= n) continue;
        let down = false, up = false;
        for (let i = j + 1; i <= j + H; i++) { if (c[i].low <= m.px - a[j]) { down = true; break; } if (c[i].high >= m.px + a[j]) { up = true; break; } }
        const e = { fwd: c[j + H].close / m.px - 1, back: c[j].close < m.px, down, up, r: (m.px - t.entry) / Rr };
        ev[m.type].push(e); pcn[m.type].push(e);
      }
    }
    perCoin.push(pcn);
  }
  return { ev, perCoin };
};
const ST = {};
for (const u of ['alert', 'oos']) {
  const { ev, perCoin } = ST[u] = study(U[u]);
  say(`**${u}**\n`);
  say(row(['level', 'touches', 'avg distance', 'price 1 day later (mean / median)', 'closed back below on the touch candle', '−1 ATR before +1 ATR', 'coins where 1-day return is LOWER than at plain levels']));
  say(row(['---', '---', '---', '---', '---', '---', '---']));
  for (const t of ['BSL', 'FVG', 'plain']) {
    const E = ev[t], dd = E.filter((e) => e.down || e.up);
    let lo = 0, hi = 0;
    if (t !== 'plain') for (const p of perCoin) { if (p[t].length < 5 || p.plain.length < 5) continue; if (mean(p[t].map((e) => e.fwd)) < mean(p.plain.map((e) => e.fwd))) lo++; else hi++; }
    say(row([t === 'plain' ? 'plain (no SMC level near)' : t, E.length, `${mean(E.map((e) => e.r)).toFixed(1)}R`, `${pc(mean(E.map((e) => e.fwd)))} / ${pc(med(E.map((e) => e.fwd)))}`,
      pp(E.filter((e) => e.back).length / Math.max(1, E.length)), pp(dd.filter((e) => e.down).length / Math.max(1, dd.length)), t === 'plain' ? '—' : `${lo} of ${lo + hi}`]));
  }
  say();
}

// ---- 2. exits
const table = (u) => {
  const { rows } = R[u];
  say(row(['exit', 'trades', 'win rate', 'PF (1st half / 2nd half)', 'median net', 'median max DD', 'Σ ln(1+net)', 'coins richer / poorer', 'DD better / worse', 'level found · median distance · reached', 'test']));
  say(row(['---', '---', '---', '---', '---', '---', '---', '---', '---', '---', '---']));
  rows.forEach((r, i) => {
    const s = r.sum, first = i === 0;
    say(row([r.isCtl ? `*${r.name.trim()}*` : first ? `**${r.name}**` : r.name, s.n, pp(s.wr), `${f2(s.pf)} (${f2(s.pf1)} / ${f2(s.pf2)})`, pc(s.net, 0), pc(-s.dd, 0), sgn(s.slog),
      first ? '—' : `${r.vs.nb} / ${r.vs.nw}`, first ? '—' : `${r.vs.db} / ${r.vs.dw}`,
      s.found > 0 ? `${pp(s.found)} · ${s.dist.toFixed(1)}R · ${pp(s.hit)}` : '—', first || r.isCtl ? '' : mark(checks(u, r))]));
  });
  say();
};
say(`## 2. Taking profit at the level instead of at +3R\n`);
say(`**The test a change has to pass, on BOTH universes** (the cycle rebuild's bar, plus a control): it leaves more coins richer than `
  + `poorer, it cuts drawdown on more coins than it deepens it, its profit factor is at least the shipped one's both over the trades in the first `
  + `half of each coin's history and over those in the second half, and it beats its **control** — the same rule with the SMC information removed. For a target, the control draws each trade's `
  + `distance at random from the same coin's own SMC target distances, so it sells just as close or far, at a level with no structure behind it. `
  + `For the FVG-reaction exit, the control uses fake FVGs: every real one moved 1–2 ATR up or down. The **test** column reads net · DD · halves · control.\n`);
say(`Σ ln(1+net) is the whole universe compounded (one unit in every coin), so it is the fairest single total; "median net" is the typical coin. `
  + `"level found" = trades that had a level above them at the signal close; "reached" = of those, how many got there.\n`);
for (const u of ['alert', 'oos']) { say(`**${u}** — ${U[u].length} coins\n`); table(u); }

// ---- verdict
const all = R.alert.rows.map((r, i) => ({ r, i })).filter(({ r, i }) => i > 0 && !r.isCtl);
const winners = all.filter(({ i }) => passes(R.alert.rows[i], i));
say(`## 3. Verdict\n`);
say(winners.length ? `Passes the test on both universes: ${winners.map(({ r }) => r.name).join('; ')}.` :
  `**No SMC exit passes the test on both universes. The shipped exit stays.**`);
say();
const line = (u, i) => { const r = R[u].rows[i], b = baseSum(u); return `${u} PF ${f2(r.sum.pf)} vs ${f2(b.pf)}, Σ ${sgn(r.sum.slog)} vs ${sgn(b.slog)}, control Σ ${r.ctlSum ? sgn(r.ctlSum.slog) : '—'}`; };
for (const { r, i } of all) say(`- ${r.name}: ${['alert', 'oos'].map((u) => `${u} ${mark(checks(u, R[u].rows[i]))}`).join(' · ')} — ${line('alert', i)}; ${line('oos', i)}.`);
say();

// ---- what it means, from the numbers above
const get = (u, name) => R[u].rows.find((r) => r.name === name);
const ctlOf = (u, r) => R[u].rows[R[u].rows.indexOf(r) + 1];
const downFirst = (E) => { const d = E.filter((e) => e.down || e.up); return d.filter((e) => e.down).length / Math.max(1, d.length); };
const lowerOn = (u, t) => { let lo = 0, n = 0; for (const p of ST[u].perCoin) { if (p[t].length < 5 || p.plain.length < 5) continue; n++; if (mean(p[t].map((e) => e.fwd)) < mean(p.plain.map((e) => e.fwd))) lo++; } return `${lo} of ${n}`; };
const sg = sgn;
const B = '½ at nearest BSL', F = ['½ at nearest major bearish FVG', 'ALL at nearest major bearish FVG', '+3R ½, rest also out on a bearish-FVG tap that closes back below'];
const sh = (u) => R[u].rows[0].sum, at = (u, n) => get(u, n).sum, ctl = (u, n) => ctlOf(u, get(u, n)).sum;
let fWin = 0, fAll = 0;
for (const u of ['alert', 'oos']) for (const n of F) { const r = get(u, n); fAll++; if (r.sum.slog > r.ctlSum.slog) fWin++; }
say(`## 4. Reading it\n`);
say(`- **Resting BSL is where the move continues, not where it turns.** After a sweep, price fell 1 ATR before it rose 1 ATR in `
  + `${pp(downFirst(ST.alert.ev.BSL))} of cases, against ${pp(downFirst(ST.alert.ev.plain))} at plain levels (oos: ${pp(downFirst(ST.oos.ev.BSL))} vs `
  + `${pp(downFirst(ST.oos.ev.plain))}). The next day was weaker than at plain levels on only ${lowerOn('alert', 'BSL')} alert coins and `
  + `${lowerOn('oos', 'BSL')} oos coins. Inside a breakout trade, the liquidity above is fuel, not a ceiling.`);
say(`- **A breakout entry almost always has an old swing high just above it** (${pp(at('alert', B).found)} of trades, median `
  + `${at('alert', B).dist.toFixed(1)}R away), so "½ at BSL" really means "½ almost at once". That lifts the win rate `
  + `(${pp(sh('alert').wr)} → ${pp(at('alert', B).wr)}; oos ${pp(sh('oos').wr)} → ${pp(at('oos', B).wr)}) and cuts the median drawdown `
  + `(${pc(-sh('alert').dd, 0)} → ${pc(-at('alert', B).dd, 0)}; oos ${pc(-sh('oos').dd, 0)} → ${pc(-at('oos', B).dd, 0)}), but lowers the profit factor `
  + `(${f2(sh('alert').pf)} → ${f2(at('alert', B).pf)}; oos ${f2(sh('oos').pf)} → ${f2(at('oos', B).pf)}) — and random levels at the same distances do `
  + `better than the BSL on both universes (Σ ${sg(ctl('alert', B).slog)} vs ${sg(at('alert', B).slog)}; oos ${sg(ctl('oos', B).slog)} vs `
  + `${sg(at('oos', B).slog)}). What helps the drawdown is selling half early, not the BSL.`);
say(`- **Bearish FVGs are no better than any level as a turning point** (−1 ATR first ${pp(downFirst(ST.alert.ev.FVG))} vs ${pp(downFirst(ST.alert.ev.plain))}; `
  + `oos ${pp(downFirst(ST.oos.ev.FVG))} vs ${pp(downFirst(ST.oos.ev.plain))}; next day weaker than at plain levels on ${lowerOn('alert', 'FVG')} and `
  + `${lowerOn('oos', 'FVG')} coins — a coin flip), yet the three FVG exits beat their controls in ${fWin} of ${fAll} comparisons: the only SMC `
  + `input here with any information in it. Against the shipped exit the gain is small and not stable. On the alert coins the PF is `
  + `${F.map((n) => f2(at('alert', n).pf)).join(' / ')} vs ${f2(sh('alert').pf)}, but in the first half of each coin's history it is `
  + `${F.map((n) => at('alert', n).pf1.toFixed(3)).join(' / ')} vs ${sh('alert').pf1.toFixed(3)}: they help in the later half of each coin's history and hurt in the earlier half.`);
say(`- **On the oos coins liqbrk loses money** (shipped PF ${f2(sh('oos').pf)}), so any rule that gets out sooner loses less there. `
  + `That is why most rows beat the shipped exit on oos Σ, and why the controls decide. Example: selling ALL at the nearest BSL improves `
  + `oos Σ (${sg(sh('oos').slog)} → ${sg(at('oos', 'ALL at nearest BSL').slog)}), random levels do it better (${sg(ctl('oos', 'ALL at nearest BSL').slog)}), `
  + `and on the alert coins, where liqbrk makes money, the same rule wrecks it (Σ ${sg(sh('alert').slog)} → ${sg(at('alert', 'ALL at nearest BSL').slog)}, `
  + `PF ${f2(sh('alert').pf)} → ${f2(at('alert', 'ALL at nearest BSL').pf)}): it sells the trades that would have run.`);
say();
process.stdout.write(out.join('\n') + '\n');
