// Runs every study in the Oct 2026 liqbrk research and prints markdown tables.
//   node research/liqbrk_report.js > research/RESULTS_liqbrk_2026-10.md
'use strict';
const L = require('./liqbrk_lab.js');
const TREND = 'SOL FET XLM HBAR PEPE AERO INJ STRK ARB SUI ZEC RENDER RAY CFX'.split(' ');   // user's pick
const ADDED = 'WIF BONK TAO NEAR AVAX DOGE JUP TIA SEI APT ONDO ENA WLD FLOKI OP'.split(' '); // mine
const CTRL = 'BTC ETH LINK'.split(' ');
const ALL = [...TREND, ...ADDED, ...CTRL];
const HONEST = { fill: 'next', slip: 0.0005 };
const MIN = new Proxy({}, { get: (_, tf) => tf === '1h' ? 12 : 20 });   // minTrades() in the app above 1h, Oct 2026                 // minTrades() in the app, Oct 2026

const pc = x => !isFinite(x) ? '∞' : (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(0) + '%';
const pp = x => !isFinite(x) ? '—' : (x * 100).toFixed(0) + '%';      // plain share, no sign
const f2 = x => !isFinite(x) ? '∞' : x.toFixed(2);
const med = a => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN; };
const row = cells => '| ' + cells.join(' | ') + ' |';
const head = cols => row(cols) + '\n' + row(cols.map(() => '---'));

// BTC above its own 200-DAY MA, aligned to any coin's bar times (the gate validated in Sep 2026)
const btc2h = L.load('BTC', '2h');
const btcOk = (() => { const m = new Map(); let s = 0; const N = 2400;           // 200 days of 2h bars
  for (let i = 0; i < btc2h.length; i++) { s += btc2h[i].close; if (i >= N) s -= btc2h[i - N].close;
    m.set(btc2h[i].time, i >= N - 1 ? btc2h[i].close > s / N : false); } return m; })();
const vetoFor = c => { let last = false; return c.map(b => { if (btcOk.has(b.time)) last = btcOk.get(b.time); return last; }); };

const cache = {};
const loaded = {};
const loadC = (coin, tf) => loaded[coin + tf] || (loaded[coin + tf] = L.load(coin, tf));
function run(coin, tf, cfg, win, prm) {
  let c = loadC(coin, tf); if (win) c = win(c);
  if (c.length < 400) return null;
  const key = coin + tf + (win ? win.name : '') + c.length + (prm ? JSON.stringify(prm) : '');
  const ind = cache[key] || (cache[key] = L.indicators(c, prm));
  const cf = { ...cfg }; if (cf.veto === true) cf.veto = vetoFor(c);
  if (loadC(coin, tf).slice(-1)[0].time < Date.now() / 1000 - 7 * 86400) cf.closeOpen = true;   // delisted: a held collapse counts
  if (typeof cf.veto === 'function') cf.veto = cf.veto(coin, tf, c);
  const r = L.simulate(c, ind, cf);
  return { coin, ...L.stats(c, ind, r), trades: r.trades };
}
function pooled(rows) {
  const t = rows.flatMap(r => r.trades);
  const gp = t.filter(x => x.ret > 0).reduce((s, x) => s + x.ret, 0), gl = -t.filter(x => x.ret <= 0).reduce((s, x) => s + x.ret, 0);
  const top = t.slice().sort((a, b) => b.ret - a.ret).slice(0, Math.max(3, Math.round(t.length * 0.02)));
  const rest = t.filter(x => !top.includes(x));
  const gp2 = rest.filter(x => x.ret > 0).reduce((s, x) => s + x.ret, 0), gl2 = -rest.filter(x => x.ret <= 0).reduce((s, x) => s + x.ret, 0);
  return { n: t.length, wr: t.filter(x => x.ret > 0).length / Math.max(1, t.length), pf: gp / gl, pfTop: gp2 / gl2 };
}
const pass = (r, tf) => r.n >= MIN[tf] && r.net > 0 && r.edge > 0 && r.pf >= 1.3 && r.wr >= 0.30 && r.dd <= 0.60 && r.stab >= 0.70;

const out = [];
const say = s => out.push(s);
const today = new Date().toISOString().slice(0, 10);
say(`# liqbrk research — ${today}\n`);
say(`Data: Binance spot 2h klines, full listed history (4h = exact aggregation of 2h). Engine reproduces detector.js trade-for-trade (\`node research/liqbrk_lab.js parity\`). Fees 0.1%/side. **Honest fills** unless stated: enter at the NEXT bar's open + 0.05% slippage, exit decisions at the close fill at the next open − 0.05%, stops fill at min(open, stop) − 0.05%.\n`);

// ---------- 1. fill realism + 149-MA filter ----------
say(`## 1. How much of the edge was the fill assumption? (2h, full history, all ${ALL.length} coins)\n`);
say(head(['setup', 'trades', 'WR', 'PF', 'PF w/o top 2%', 'median coin net', 'median vs B&H', 'coins net > 0']));
for (const [label, cfg, prm] of [['close fill (what the app shows)', { fill: 'close' }], ['honest fill', HONEST],
  ['honest fill, 149-MA filter OFF', HONEST, { lbMaBars: 0 }]]) {
  const rows = ALL.map(c => { if (!prm) return run(c, '2h', cfg);
    const cc = L.load(c, '2h'); const ind = L.indicators(cc, prm); const r = L.simulate(cc, ind, cfg); return { coin: c, ...L.stats(cc, ind, r), trades: r.trades }; }).filter(Boolean);
  const p = pooled(rows);
  say(row([label, p.n, pp(p.wr), f2(p.pf), f2(p.pfTop), pc(med(rows.map(r => r.net))), pc(med(rows.map(r => r.edge))), `${rows.filter(r => r.net > 0).length}/${rows.length}`]));
}

// ---------- 2. exit variants ----------
const EXITS = [['current: 4×ATR stop + 1-day-low trail', { exit: 'base' }],
  ['scale out ½ at 3R, rest on current trail', { exit: 'scale3R' }],
  ['ATR trail from highest close, k=2', { exit: 'chand', k: 2 }],
  ['ATR trail from highest close, k=3', { exit: 'chand', k: 3 }],
  ['ATR trail from highest close, k=4', { exit: 'chand', k: 4 }],
  ['hybrid: current, + 3×ATR trail once +3R', { exit: 'hybrid', tR: 3, k: 3 }],
  ['hybrid: current, + 2×ATR trail once +3R', { exit: 'hybrid', tR: 3, k: 2 }]];
for (const tf of ['2h', '4h']) {
  say(`\n## 2${tf === '2h' ? 'a' : 'b'}. Exit variants — ${tf}, full history, honest fills, all coins\n`);
  say(head(['exit', 'trades', 'WR', 'PF', 'PF w/o top 2%', 'median net', 'median maxDD', 'median stable', 'coins better than current', 'pass ✓']));
  const base = ALL.map(c => run(c, tf, { ...HONEST, exit: 'base' })).filter(Boolean);
  for (const [label, ex] of EXITS) {
    const rows = ALL.map(c => run(c, tf, { ...HONEST, ...ex })).filter(Boolean);
    const p = pooled(rows);
    const better = rows.filter((r, i) => r.net > base[i].net + 1e-9).length;
    say(row([label, p.n, pp(p.wr), f2(p.pf), f2(p.pfTop), pc(med(rows.map(r => r.net))), pc(-med(rows.map(r => r.dd))),
      pp(med(rows.map(r => r.stab))), ex.exit === 'base' ? '—' : `${better}/${rows.length}`, `${rows.filter(r => pass(r, tf)).length}`]));
  }
}

// ---------- 3. BTC regime veto ----------
say(`\n## 3. BTC regime veto — only enter while BTC is above its 200-day MA (honest fills)\n`);
say(head(['tf', 'veto', 'trades', 'WR', 'PF', 'PF w/o top 2%', 'median net', 'median maxDD', 'coins better', 'pass ✓']));
for (const tf of ['2h', '4h']) {
  const base = ALL.map(c => run(c, tf, { ...HONEST })).filter(Boolean);
  for (const v of [false, true]) {
    const rows = ALL.map(c => run(c, tf, { ...HONEST, veto: v })).filter(Boolean); const p = pooled(rows);
    say(row([tf, v ? 'ON' : 'off', p.n, pp(p.wr), f2(p.pf), f2(p.pfTop), pc(med(rows.map(r => r.net))), pc(-med(rows.map(r => r.dd))),
      v ? `${rows.filter((r, i) => r.net > base[i].net + 1e-9).length}/${rows.length}` : '—', rows.filter(r => pass(r, tf)).length]));
  }
}

// ---------- 4. per coin: full history vs last ~4 years (18,000 2h bars) ----------
say(`\n## 4. Per coin, 2h, honest fills, current exit — full history vs last 18,000 bars (~4.1 years)\n`);
say(`The 18k window starts around ${new Date((btc2h[btc2h.length - 18000].time) * 1000).toISOString().slice(0, 10)}. Coins listed later have identical rows in both — the window is their whole life.\n`);
say(head(['coin', 'group', 'yrs (full)', 'trades', 'WR', 'PF', 'PF w/o top 3', 'net', 'vs B&H', 'maxDD', 'stable', '✓', '│', 'trades 4y', 'PF 4y', 'net 4y', 'vs B&H 4y', 'maxDD 4y', '✓ 4y']));
const last18k = function last18k(c) { return c.slice(-18000); };
const perCoin = [];
for (const coin of ALL) {
  const f = run(coin, '2h', HONEST), r4 = run(coin, '2h', HONEST, last18k); if (!f) continue;
  perCoin.push({ coin, f, r4 });
  const g = TREND.includes(coin) ? 'yours' : ADDED.includes(coin) ? 'added' : 'control';
  say(row([coin, g, f.yrs.toFixed(1), f.n, pp(f.wr), f2(f.pf), f2(f.pf3), pc(f.net), pc(f.edge), pc(-f.dd), pp(f.stab), pass(f, '2h') ? '✓' : '',
    '│', r4.n, f2(r4.pf), pc(r4.net), pc(r4.edge), pc(-r4.dd), pass(r4, '2h') ? '✓' : '']));
}
const grp = (list, key) => perCoin.filter(x => list.includes(x.coin)).map(x => x[key]);
say(`\n**Group medians (full history):** yours PF ${f2(med(grp(TREND, 'f').map(r => r.pf)))}, net ${pc(med(grp(TREND, 'f').map(r => r.net)))}, vs B&H ${pc(med(grp(TREND, 'f').map(r => r.edge)))} · added PF ${f2(med(grp(ADDED, 'f').map(r => r.pf)))}, net ${pc(med(grp(ADDED, 'f').map(r => r.net)))} · control PF ${f2(med(grp(CTRL, 'f').map(r => r.pf)))}, net ${pc(med(grp(CTRL, 'f').map(r => r.net)))}`);

// ---------- 5. does a coin's past predict its future? ----------
const A0 = Date.UTC(2020, 0, 1) / 1000, B0 = Date.UTC(2023, 0, 1) / 1000;
const cycA = function cycleA(c) { return L.slice(c, A0, B0); }, cycB = function cycleB(c) { return L.slice(c, B0); };
say(`\n## 5. Can past results pick this cycle's winners? (2h, honest fills, current exit)\n`);
say(`Cycle A = 2020-01-01 → 2022-12-31 (2020-21 bull + 2022 bear). Cycle B = 2023-01-01 → today (2023-25 bull and after). Only coins with ≥ 2 years in cycle A qualify.\n`);
const both = [];
for (const coin of ALL) {
  const a = run(coin, '2h', HONEST, cycA), b = run(coin, '2h', HONEST, cycB);
  if (a && b && a.yrs >= 2) both.push({ coin, a, b });
}
say(head(['coin', 'A trades', 'A PF', 'A net', 'A vs B&H', '│', 'B trades', 'B PF', 'B net', 'B vs B&H']));
for (const x of both.sort((p, q) => q.a.pf - p.a.pf)) say(row([x.coin, x.a.n, f2(x.a.pf), pc(x.a.net), pc(x.a.edge), '│', x.b.n, f2(x.b.pf), pc(x.b.net), pc(x.b.edge)]));
const rank = arr => { const idx = arr.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]); const r = new Array(arr.length); idx.forEach(([, i], k) => r[i] = k); return r; };
const spearman = (u, v) => { const ru = rank(u), rv = rank(v), n = u.length; const d2 = ru.reduce((s, x, i) => s + (x - rv[i]) ** 2, 0); return 1 - 6 * d2 / (n * (n * n - 1)); };
const cap = x => Math.min(x, 10);
const rhoPF = spearman(both.map(x => cap(x.a.pf)), both.map(x => cap(x.b.pf)));
const rhoEdge = spearman(both.map(x => x.a.edge), both.map(x => x.b.edge));
const half = Math.floor(both.length / 2), byA = both.slice().sort((p, q) => q.a.pf - p.a.pf);
const topB = byA.slice(0, half).map(x => x.b), botB = byA.slice(half).map(x => x.b);
say(`\n- Rank correlation of PF, cycle A → cycle B: **ρ = ${rhoPF.toFixed(2)}** · of edge vs buy & hold: **ρ = ${rhoEdge.toFixed(2)}** (n = ${both.length}; 0 = no relationship, 1 = perfect)`);
say(`- Top half by cycle-A PF went on to a median cycle-B PF of **${f2(med(topB.map(r => r.pf)))}** and net **${pc(med(topB.map(r => r.net)))}**; bottom half **${f2(med(botB.map(r => r.pf)))}** and **${pc(med(botB.map(r => r.net)))}**.`);


// ---------- 6. exit reasons: what actually closes trades today ----------
say(`\n## 6. What closes trades today (2h, honest fills, current exit)\n`);
{ const t = ALL.map(c => run(c, '2h', HONEST)).filter(Boolean).flatMap(r => r.trades);
  const by = {}; for (const x of t) (by[x.why] = by[x.why] || []).push(x);
  say(head(['exit reason', 'share of trades', 'avg result', 'share of total profit']));
  const tot = t.reduce((s, x) => s + x.ret, 0);
  for (const [k, v] of Object.entries(by)) say(row([k === 'STOP' ? '4×ATR stop (intrabar)' : 'close below prior 1-day low', pp(v.length / t.length),
    pc(v.reduce((s, x) => s + x.ret, 0) / v.length), pc(v.reduce((s, x) => s + x.ret, 0) / tot)])); }

// ---------- 7. walk-forward: does each change hold in BOTH cycles? ----------
// Nothing below was fitted: 3R, k=3/4 and the 200-day veto are round numbers chosen up front.
// A real improvement must show in cycle A AND cycle B; one that appears in only one era is a fit.
say(`\n## 7. Walk-forward — does each change hold in both cycles? (honest fills; per-coin medians; coins with ≥ 1 yr in the cycle)\n`);
const V = [['current', { exit: 'base' }], ['scale ½ at 3R', { exit: 'scale3R' }], ['ATR trail k=3', { exit: 'chand', k: 3 }],
  ['ATR trail k=4', { exit: 'chand', k: 4 }], ['BTC veto', { exit: 'base', veto: true }], ['scale ½ at 3R + BTC veto', { exit: 'scale3R', veto: true }]];
for (const tf of ['2h', '4h']) {
  say(`\n**${tf}**\n`);
  say(head(['change', 'A: PF w/o top 2%', 'A: median net', 'A: median maxDD', 'A: coins better', '│', 'B: PF w/o top 2%', 'B: median net', 'B: median maxDD', 'B: coins better']));
  const cells = {};
  for (const [nm, cfg] of V) {
    const res = [];
    for (const [w, label] of [[cycA, 'A'], [cycB, 'B']]) {
      const rows = ALL.map(c => run(c, tf, { ...HONEST, ...cfg }, w)).filter(r => r && r.yrs >= 1);
      const base = ALL.map(c => run(c, tf, { ...HONEST, exit: 'base' }, w)).filter(r => r && r.yrs >= 1);
      const p = pooled(rows);
      const better = rows.filter(r => { const b = base.find(x => x.coin === r.coin); return b && r.net > b.net + 1e-9; }).length;
      res.push(f2(p.pfTop), pc(med(rows.map(r => r.net))), pc(-med(rows.map(r => r.dd))), nm === 'current' ? '—' : `${better}/${rows.length}`);
    }
    say(row([nm, ...res.slice(0, 4), '│', ...res.slice(4)]));
  }
}

// ---------- 8. integrity: compounded return must equal the end of the marked-to-market path ----------
{ let worst = 0; for (const coin of ALL) for (const ex of ['base', 'scale3R', 'chand']) {
    const c = L.load(coin, '2h'); if (c.length < 400) continue; const ind = L.indicators(c);
    const r = L.simulate(c, ind, { ...HONEST, exit: ex }); const st = L.stats(c, ind, r);
    worst = Math.max(worst, Math.abs(st._eqEnd - (1 + st.net)) / (1 + st.net)); }
  say(`\n_Integrity check: largest gap between compounded return and the end of the drawdown path across ${ALL.length * 3} runs: ${(worst * 100).toExponential(1)}%._`); }

// ---------- 9. is k=4 a plateau or the edge of the grid? + combinations ----------
say(`\n## 9. ATR-trail plateau check and combinations (honest fills, full history)\n`);
say(head(['tf', 'variant', 'trades', 'WR', 'PF', 'PF w/o top 2%', 'median net', 'median maxDD', 'median stable', 'median days held', 'pass ✓']));
const daysHeld = (rows, tf) => med(rows.flatMap(r => r.trades.map(x => (x.exitIdx - x.entryIdx) * (tf === '2h' ? 2 : 4) / 24)));
for (const tf of ['2h', '4h']) for (const [nm, cfg] of [['current', { exit: 'base' }], ['ATR trail k=3', { exit: 'chand', k: 3 }],
    ['ATR trail k=4', { exit: 'chand', k: 4 }], ['ATR trail k=5', { exit: 'chand', k: 5 }], ['ATR trail k=6', { exit: 'chand', k: 6 }],
    ['ATR trail k=4 + BTC veto', { exit: 'chand', k: 4, veto: true }], ['scale ½ at 3R + BTC veto', { exit: 'scale3R', veto: true }]]) {
  const rows = ALL.map(c => run(c, tf, { ...HONEST, ...cfg })).filter(Boolean); const p = pooled(rows);
  say(row([tf, nm, p.n, pp(p.wr), f2(p.pf), f2(p.pfTop), pc(med(rows.map(r => r.net))), pc(-med(rows.map(r => r.dd))),
    pp(med(rows.map(r => r.stab))), daysHeld(rows, tf).toFixed(1), rows.filter(r => pass(r, tf)).length]));
}

// ---------- 10. "learning", done causally: skip a coin while its own recent signals are losing ----------
// At each entry, look only at that coin's signals that had ALREADY CLOSED in the last D days (shadow
// results of every signal, taken or not). If there are >= 3 and they sum to a loss, skip the entry.
// Uses nothing from the future. Approximation: a skipped trade frees no capital for an overlapping
// signal, which slightly understates the filtered version.
say(`\n## 10. Recent-form filter — skip a coin while its last D days of signals are net losing (honest fills, current exit)\n`);
say(head(['tf', 'window D', 'trades', 'WR', 'PF', 'PF w/o top 2%', 'median net', 'median maxDD', 'coins better', 'pass ✓']));
for (const tf of ['2h', '4h']) {
  const baseRows = ALL.map(c => run(c, tf, HONEST)).filter(Boolean);
  for (const D of [0, 180, 365]) {
    const rows = baseRows.map(r => {
      const c = L.load(r.coin, tf), ind = cache[r.coin + tf + c.length];
      if (!D) return r;
      const t0 = r.trades, keep = [];
      for (const tr of t0) {
        const tEntry = c[tr.entryIdx].time;
        const recent = t0.filter(x => c[x.exitIdx].time < tEntry && c[x.exitIdx].time >= tEntry - D * 86400);
        if (recent.length >= 3 && recent.reduce((s, x) => s + x.ret, 0) <= 0) continue;
        keep.push(tr);
      }
      const st = L.stats(c, ind, { trades: keep }); return { coin: r.coin, ...st, trades: keep };
    });
    const p = pooled(rows);
    say(row([tf, D ? D + ' days' : 'off', p.n, pp(p.wr), f2(p.pf), f2(p.pfTop), pc(med(rows.map(r => r.net))), pc(-med(rows.map(r => r.dd))),
      D ? `${rows.filter((r, i) => r.net > baseRows[i].net + 1e-9).length}/${rows.length}` : '—', rows.filter(r => pass(r, tf)).length]));
  }
}

// =====================================================================================================
// PART 2 — more tests (Oct 2026). Same rules as part 1: honest fills, one change at a time against the
// current rules, judged in BOTH walk-forward cycles, and on how it does once each coin's top 3 trades go.
// =====================================================================================================
say(`\n---\n\n# Part 2 — more tests\n`);
say(`Every change below is tested **one at a time against the current rules** (honest fills, current exit, no veto, unless the row says otherwise). Columns: **PF w/o top 2%** pools all coins and drops the biggest 2% of trades; **coins PF>1 w/o top 3** counts coins still profitable after losing their own three best trades (the "does it die without its jackpots" test); **A / B** are the same PF w/o top 2% inside cycle A (2020–22, includes the 2022 bear) and cycle B (2023→). **Verdict**: ✅ = better than current in BOTH cycles · ⚠ = better in one only · ❌ = better in neither (±0.03 counts as equal).\n`);

// ---- BTC context, aligned without look-ahead: a coin bar starting at T (length d) closes at T+d, so the
// latest BTC 2h bar it may use is the one starting at T+d−2h.
const btcIdx = new Map(btc2h.map((b, i) => [b.time, i]));
const btcC = btc2h.map(b => b.close);
const smaArr = (x, len) => { const o = new Array(x.length).fill(NaN); let s = 0;
  for (let i = 0; i < x.length; i++) { s += x[i]; if (i >= len) s -= x[i - len]; if (i >= len - 1) o[i] = s / len; } return o; };
const TFS = { '1h': 3600, '2h': 7200, '4h': 14400, '6h': 21600, '8h': 28800, '12h': 43200, '1d': 86400 };
const btcAt = (c, tf) => { const d = TFS[tf]; let last = -1; return c.map(b => { const j = btcIdx.get(b.time + d - 7200); if (j !== undefined) last = j; return last; }); };
const btcMA = {}; const btcMAof = days => btcMA[days] || (btcMA[days] = smaArr(btcC, days * 12));
const gateCache = {};
// gate(name, fn(coin, tf, cFull) -> bool[]) — computed on the coin's FULL history, then looked up by time,
// so a cycle slice never loses its first 200 days to a fresh warm-up.
const gate = (name, fn) => { const g = (coin, tf, c) => {
  const k = name + coin + tf; let m = gateCache[k];
  if (!m) { const full = loadC(coin, tf), v = fn(coin, tf, full); m = gateCache[k] = new Map(full.map((b, i) => [b.time, !!v[i]])); }
  return c.map(b => m.get(b.time) || false); }; g.gateName = name; return g; };
const G = {
  btc200: gate('btc200', (coin, tf, c) => { const ma = btcMAof(200); return btcAt(c, tf).map(j => j >= 0 && btcC[j] > ma[j]); }),
  btc100: gate('btc100', (coin, tf, c) => { const ma = btcMAof(100); return btcAt(c, tf).map(j => j >= 0 && btcC[j] > ma[j]); }),
  btc50: gate('btc50', (coin, tf, c) => { const ma = btcMAof(50); return btcAt(c, tf).map(j => j >= 0 && btcC[j] > ma[j]); }),
  btcMom30: gate('btcMom30', (coin, tf, c) => btcAt(c, tf).map(j => j >= 360 && btcC[j] > btcC[j - 360])),
  btc24up: gate('btc24up', (coin, tf, c) => btcAt(c, tf).map(j => j >= 12 && btcC[j] > btcC[j - 12])),
  own200: gate('own200', (coin, tf, c) => { const bpd = 86400 / TFS[tf], ma = smaArr(c.map(b => b.close), Math.round(200 * bpd)); return c.map((b, i) => b.close > ma[i]); }),
  own50: gate('own50', (coin, tf, c) => { const bpd = 86400 / TFS[tf], ma = smaArr(c.map(b => b.close), Math.round(50 * bpd)); return c.map((b, i) => b.close > ma[i]); }),
  rs30: gate('rs30', (coin, tf, c) => { const bpd = 86400 / TFS[tf], L30 = Math.round(30 * bpd), js = btcAt(c, tf);
    return c.map((b, i) => { const j = js[i]; return i >= L30 && j >= 360 && js[i - L30] >= 0 && coin !== 'BTC'
      ? (b.close / c[i - L30].close) > (btcC[j] / btcC[js[i - L30]]) : coin === 'BTC'; }); }),
};
G.btc24gt2 = gate('btc24gt2', (coin, tf, c) => btcAt(c, tf).map(j => j >= 12 && btcC[j] > btcC[j - 12] * 1.02));
G.age90 = gate('age90', (coin, tf, c) => { const bpd = 86400 / TFS[tf]; return c.map((b, i) => i >= 90 * bpd); });
G.btc50age90 = gate('btc50age90', (coin, tf, c) => { const a = G.btc50(coin, tf, c), b = G.age90(coin, tf, c); return a.map((x, i) => x && b[i]); });
G.btc200rs30 = gate('btc200rs30', (coin, tf, c) => { const a = G.btc200(coin, tf, c), b = G.rs30(coin, tf, c); return a.map((x, i) => x && b[i]); });

// ---- the walk-forward evaluator every table in part 2 uses
const res = {};
function evalV(tf, cfg = {}, prm = null, coins = ALL) {
  const key = tf + JSON.stringify(cfg, (k, v) => typeof v === 'function' ? v.gateName : v) + JSON.stringify(prm) + coins.join();
  if (res[key]) return res[key];
  const full = coins.map(c => run(c, tf, { ...HONEST, ...cfg }, null, prm)).filter(Boolean);
  const A = coins.map(c => run(c, tf, { ...HONEST, ...cfg }, cycA, prm)).filter(r => r && r.yrs >= 1);
  const B = coins.map(c => run(c, tf, { ...HONEST, ...cfg }, cycB, prm)).filter(r => r && r.yrs >= 1);
  return res[key] = { full, A, B, p: pooled(full), pA: pooled(A), pB: pooled(B) };
}
const VCOLS = ['variant', 'trades', 'WR', 'PF', 'PF w/o top 2%', 'coins PF>1 w/o top 3', 'median net', 'median maxDD', 'coins better', 'A', 'B', 'verdict'];
function vrow(label, v, base, noVerdict) {
  const better = v.full.filter(r => { const b = base.full.find(x => x.coin === r.coin); return b && r.net > b.net + 1e-9; }).length;
  const dA = v.pA.pfTop - base.pA.pfTop, dB = v.pB.pfTop - base.pB.pfTop, up = [dA, dB].filter(d => d > 0.03).length;
  const verdict = v === base || noVerdict ? '—' : up === 2 ? '✅' : up === 1 ? '⚠' : '❌';
  return row([label, v.p.n, pp(v.p.wr), f2(v.p.pf), f2(v.p.pfTop), `${v.full.filter(r => r.pf3 > 1).length}/${v.full.length}`,
    pc(med(v.full.map(r => r.net))), pc(-med(v.full.map(r => r.dd))), v === base ? '—' : `${better}/${v.full.length}`,
    f2(v.pA.pfTop), f2(v.pB.pfTop), verdict]);
}
function table(title, note, tfs, variants, noVerdict, coins = ALL) {
  say(`\n## ${title}\n`); if (note) say(note + '\n');
  for (const tf of tfs) {
    if (tfs.length > 1) say(`\n**${tf}**\n`);
    say(head(VCOLS));
    const base = evalV(tf, {}, null, coins);
    for (const [label, cfg, prm] of variants) {
      const v = (!cfg || !Object.keys(cfg).length) && !prm ? base : evalV(tf, cfg || {}, prm || null, coins);
      say(vrow(label, v, base, noVerdict));
    }
  }
}

// ---------- 11. market filters: which "only trade when…" gate actually helps? ----------
table('11. Market filters — only take a signal when …',
  `Tests your observation directly ("it works when BTC is moving"). BTC gates use the last CLOSED BTC 2h bar, nothing later. "Own 200d MA" needs 200 days of the coin's own history, so a new listing cannot trade its first 200 days under it. "Beating BTC (30d)" = the coin's 30-day return is above BTC's.`,
  ['2h', '4h'], [
    ['current (no filter)', {}],
    ['BTC above its 200-day MA', { veto: G.btc200 }],
    ['BTC above its 100-day MA', { veto: G.btc100 }],
    ['BTC above its 50-day MA', { veto: G.btc50 }],
    ['BTC up over the last 30 days', { veto: G.btcMom30 }],
    ['BTC up over the last 24 hours', { veto: G.btc24up }],
    ['coin above its own 200-day MA', { veto: G.own200 }],
    ['coin above its own 50-day MA', { veto: G.own50 }],
    ['coin beating BTC over 30 days', { veto: G.rs30 }],
    ['BTC > 200d MA AND coin beating BTC', { veto: G.btc200rs30 }],
    ['BTC up > 2% over the last 24 hours', { veto: G.btc24gt2 }],
    ['coin listed ≥ 90 days', { veto: G.age90 }]]);

// ---------- 12. entry-parameter plateau: is each default on a plateau or a lucky peak? ----------
table('12. Entry parameters — is each default on a plateau?',
  `One parameter moved at a time, everything else at today's defaults (relVol 1.3, breakout extension 1.0×ATR, 2-day high, 4×ATR stop, 149-bar MA). A default you can trust sits in a flat region: its neighbours should be close to it, not much worse.`,
  ['2h', '4h'], [
    ['current defaults', {}],
    ['volume ≥ 1.0× (off)', {}, { lbRelVol: 1.0 }], ['volume ≥ 1.6×', {}, { lbRelVol: 1.6 }], ['volume ≥ 2.0×', {}, { lbRelVol: 2.0 }], ['volume ≥ 3.0×', {}, { lbRelVol: 3.0 }],
    ['breakout ext 0 (off)', {}, { lbBrkExt: 0 }], ['breakout ext 0.5×ATR', {}, { lbBrkExt: 0.5 }], ['breakout ext 1.5×ATR', {}, { lbBrkExt: 1.5 }], ['breakout ext 2.0×ATR', {}, { lbBrkExt: 2.0 }],
    ['breakout of 1-day high', {}, { lbBreak: 1 }], ['breakout of 3-day high', {}, { lbBreak: 3 }], ['breakout of 5-day high', {}, { lbBreak: 5 }], ['breakout of 10-day high', {}, { lbBreak: 10 }],
    ['MA filter 50 bars', {}, { lbMaBars: 50 }], ['MA filter 100 bars', {}, { lbMaBars: 100 }], ['MA filter 200 bars', {}, { lbMaBars: 200 }], ['MA filter 300 bars', {}, { lbMaBars: 300 }],
    ['5-day SMA filter → 2-day', {}, { lbTrend: 2 }], ['5-day SMA filter → 10-day', {}, { lbTrend: 10 }]]);

// ---------- 13. stop & trade management ----------
table('13. Stop and trade management',
  `Stop width, a breakeven stop, a time stop (exit if the trade has not closed above +1R within N days), and a cool-down after a stop-out. All on the current trail exit.`,
  ['2h', '4h'], [
    ['current (4×ATR stop)', {}],
    ['2×ATR stop', {}, { lbStop: 2 }], ['3×ATR stop', {}, { lbStop: 3 }], ['5×ATR stop', {}, { lbStop: 5 }], ['6×ATR stop', {}, { lbStop: 6 }],
    ['exit trail: below prior ½-day low', {}, { lbExit: 0.5 }], ['exit trail: below prior 2-day low', {}, { lbExit: 2 }], ['exit trail: below prior 3-day low', {}, { lbExit: 3 }],
    ['breakeven stop after +1R', { be: 1 }], ['breakeven stop after +2R', { be: 2 }],
    ['time stop 2 days', { timeStop: 2 }], ['time stop 5 days', { timeStop: 5 }],
    ['cool-down 1 day after a stop', { cool: 1 }], ['cool-down 3 days after a stop', { cool: 3 }], ['cool-down 7 days after a stop', { cool: 7 }]]);

// ---------- 14. what do winning trades look like at entry? (descriptive, 2h) ----------
say(`\n## 14. What do winning trades look like at the moment of entry? (2h, honest fills, current rules, all ${ALL.length} coins pooled)\n`);
say(`Descriptive only — every trade the current rules take, sorted into buckets by what was true when the signal fired. A bucket matters only if it is different in BOTH cycles. Buckets under ~60 trades are noise.\n`);
{
  const T = [];
  for (const coin of ALL) {
    const c = loadC(coin, '2h'); if (c.length < 400) continue;
    const r = run(coin, '2h', HONEST), ind = cache[coin + '2h' + c.length], js = btcAt(c, '2h');
    const ma200 = btcMAof(200);
    for (const t of r.trades) {
      const i = t.sigIdx, j = js[i], bpd = 12;
      T.push({ coin, ret: t.ret, time: c[i].time,
        btc24: j >= 12 ? btcC[j] / btcC[j - 12] - 1 : NaN, btc7d: j >= 84 ? btcC[j] / btcC[j - 84] - 1 : NaN,
        btcRegN: j >= 0 && btcC[j] > ma200[j] ? 1 : 0, rv: ind.rv[i], ext: (c[i].close - ind.hiB[i]) / ind.a[i],
        pump30: i >= 30 * bpd ? c[i].close / c[i - 30 * bpd].close - 1 : NaN, pop1d: i >= bpd ? c[i].close / c[i - bpd].close - 1 : NaN,
        atrPct: ind.a[i] / c[i].close, age: (c[i].time - c[0].time) / 86400, hour: new Date(c[i].time * 1000 + 7200e3).getUTCHours(),
        dow: new Date(c[i].time * 1000).getUTCDay(), coinTrend: i >= 200 * bpd ? c[i].close / c[i - 200 * bpd].close - 1 : NaN });
    }
  }
  const bstat = xs => { const gp = xs.filter(x => x.ret > 0).reduce((s, x) => s + x.ret, 0), gl = -xs.filter(x => x.ret <= 0).reduce((s, x) => s + x.ret, 0);
    return { n: xs.length, wr: xs.filter(x => x.ret > 0).length / Math.max(1, xs.length), avg: xs.reduce((s, x) => s + x.ret, 0) / Math.max(1, xs.length), pf: gl > 0 ? gp / gl : Infinity }; };
  const inA = x => x.time >= A0 && x.time < B0, inB = x => x.time >= B0;
  const bucket = (title, key, edges, fmt) => {
    say(`\n**${title}**\n`); say(head(['bucket', 'trades', 'WR', 'avg trade', 'PF', 'A: trades', 'A: PF', 'B: trades', 'B: PF']));
    for (let k = 0; k < edges.length - 1; k++) {
      const xs = T.filter(x => Number.isFinite(x[key]) && x[key] >= edges[k] && x[key] < edges[k + 1]);
      const s = bstat(xs), a = bstat(xs.filter(inA)), b = bstat(xs.filter(inB));
      say(row([fmt(edges[k], edges[k + 1]), s.n, pp(s.wr), pc(s.avg), f2(s.pf), a.n, f2(a.pf), b.n, f2(b.pf)]));
    }
  };
  const rng = (u, sfx = '%', m = 100) => { const d = m === 1 ? 1 : 0;
    return (a, b) => `${a === -Infinity ? '<' : (a * m).toFixed(d) + sfx}${b === Infinity ? '+' : (a === -Infinity ? '' : ' to ') + (b * m).toFixed(d) + sfx}`; };
  bucket('BTC move over the 24h before the signal', 'btc24', [-Infinity, -0.02, 0, 0.02, 0.05, Infinity], rng());
  bucket('BTC move over the 7 days before the signal', 'btc7d', [-Infinity, -0.05, 0, 0.05, 0.10, Infinity], rng());
  bucket('Volume vs its 1-day average at the signal', 'rv', [1.3, 2, 3, 5, Infinity], rng('×', '×', 1));
  bucket('How far the close cleared the 2-day high (in ATRs)', 'ext', [1, 1.5, 2, 3, Infinity], rng('×', '×', 1));
  bucket('Coin move over the 24h before the signal (how big the pop already was)', 'pop1d', [-Infinity, 0.05, 0.10, 0.20, Infinity], rng());
  bucket('Coin move over the 30 days before the signal (already pumped?)', 'pump30', [-Infinity, 0, 0.25, 0.50, 1, Infinity], rng());
  bucket('Coin vs 200 days ago (its own big trend)', 'coinTrend', [-Infinity, -0.5, 0, 1, 3, Infinity], rng());
  bucket('Volatility: ATR as % of price', 'atrPct', [0, 0.01, 0.015, 0.02, 0.03, Infinity], (a, b) => `${(a * 100).toFixed(1)}%${b === Infinity ? '+' : ' to ' + (b * 100).toFixed(1) + '%'}`);
  bucket('Coin age at the signal (days since Binance listing)', 'age', [0, 90, 180, 365, 730, Infinity], (a, b) => `${a}${b === Infinity ? '+ days' : '–' + b + ' days'}`);
  bucket('UTC hour the signal bar CLOSED', 'hour', [0, 6, 12, 18, 24], (a, b) => `${String(a).padStart(2, '0')}:00–${String(b).padStart(2, '0')}:00`);
  bucket('Day of week (UTC; 0 = Sun)', 'dow', [0, 1, 2, 3, 4, 5, 6, 7], a => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][a]);
  bucket('BTC regime (above its 200-day MA = 1)', 'btcRegN', [0, 1, 2], a => a ? 'BTC above 200d MA' : 'BTC below 200d MA');
}

// ---------- 15. other timeframes ----------
say(`\n## 15. Timeframes — the same rules on 2h … 1d (honest fills; 4h–1d are exact aggregations of 2h)\n`);
say(`Day-denominated lookbacks scale automatically; the 149-bar MA does not (149 bars = 12 days on 2h, 149 days on 1d), as designed. "trades / coin / yr" is the median.\n`);
say(head(['tf', 'variant', 'trades', 'trades / coin / yr', 'WR', 'PF', 'PF w/o top 2%', 'coins PF>1 w/o top 3', 'median net', 'median maxDD', 'A', 'B', 'pass ✓']));
for (const tf of ['2h', '4h', '6h', '8h', '12h', '1d']) for (const [nm, cfg] of [['current', {}], ['BTC>200d', { veto: G.btc200 }], ['ATR trail k=4', { exit: 'chand', k: 4 }], ['k=4 + BTC>200d', { exit: 'chand', k: 4, veto: G.btc200 }]]) {
  const v = evalV(tf, cfg);
  say(row([tf, nm, v.p.n, med(v.full.map(r => r.n / r.yrs)).toFixed(1), pp(v.p.wr), f2(v.p.pf), f2(v.p.pfTop), `${v.full.filter(r => r.pf3 > 1).length}/${v.full.length}`,
    pc(med(v.full.map(r => r.net))), pc(-med(v.full.map(r => r.dd))), f2(v.pA.pfTop), f2(v.pB.pfTop), v.full.filter(r => pass(r, tf)).length]));
}

// ---------- 16. costs ----------
table('16. Costs — how much fee / slippage can the edge take?', `Today: 0.1% fee per side + 0.05% slippage. 0.075% = Binance with BNB fee discount.`, ['2h', '4h'], [
  ['current (0.1% fee, 0.05% slip)', {}],
  ['0.075% fee (BNB discount)', { fee: 0.00075 }], ['0.2% fee', { fee: 0.002 }],
  ['0.2% slippage', { slip: 0.002 }], ['0.5% slippage (thin coin / market order in a spike)', { slip: 0.005 }]], true);

// ---------- 17. stacking the changes that held in both cycles ----------
G.btc100age90 = gate('btc100age90', (coin, tf, c) => { const a = G.btc100(coin, tf, c), b = G.age90(coin, tf, c); return a.map((x, i) => x && b[i]); });
const STACK = [
  ['current', {}],
  ['① BTC above its 100-day MA', { veto: G.btc100 }],
  ['② = ① + ATR trail k=4 exit', { veto: G.btc100, exit: 'chand', k: 4 }],
  ['②b = ① + exit below 2-day low instead', { veto: G.btc100 }, { lbExit: 2 }],
  ['②c = ① + scale ½ at 3R (lower-drawdown option)', { veto: G.btc100, exit: 'scale3R' }],
  ['③ = ② + skip coins listed < 90 days', { veto: G.btc100age90, exit: 'chand', k: 4 }],
  ['④ = ③ + 300-bar MA instead of 149', { veto: G.btc100age90, exit: 'chand', k: 4 }, { lbMaBars: 300 }]];
table('17. Stacking the changes that held up — one layer at a time',
  `Only changes that were ✅ on both 2h and 4h above are stacked. BTC's **100-day** MA is used because 50/100/200 all helped (a plateau) and 100 is its middle — picking the best-looking one of three would be fitting. Each layer must still add something in BOTH cycles to earn its place.`,
  ['2h', '4h'], STACK);

// ---------- 18. does the stack help every group, or only one? ----------
say(`\n## 18. Does it help every group of coins, or only one? (current vs ③)\n`);
say(head(['tf', 'group', 'rules', 'coins', 'trades', 'PF', 'PF w/o top 2%', 'coins PF>1 w/o top 3', 'median net', 'median vs B&H', 'median maxDD', 'A', 'B']));
for (const tf of ['2h', '4h']) for (const [gname, list] of [['your 14', TREND], ['added 15', ADDED], ['BTC ETH LINK', CTRL]])
  for (const [nm, cfg] of [['current', {}], ['③', STACK[5][1]]]) {
    const v = evalV(tf, cfg, null, list);
    say(row([tf, gname, nm, v.full.length, v.p.n, f2(v.p.pf), f2(v.p.pfTop), `${v.full.filter(r => r.pf3 > 1).length}/${v.full.length}`,
      pc(med(v.full.map(r => r.net))), pc(med(v.full.map(r => r.edge))), pc(-med(v.full.map(r => r.dd))), f2(v.pA.pfTop), f2(v.pB.pfTop)]));
  }

// ---------- 19. year by year ----------
say(`\n## 19. Year by year — pooled trades by entry year (current vs ③)\n`);
say(head(['year', 'BTC that year', '2h current: trades', 'PF', 'avg trade', '2h ③: trades', 'PF', 'avg trade', '│', '4h current: trades', 'PF', 'avg trade', '4h ③: trades', 'PF', 'avg trade']));
{
  const yrTrades = (tf, cfg) => { const v = evalV(tf, cfg), m = {};
    for (const r of v.full) { const c = loadC(r.coin, tf); for (const t of r.trades) { const y = new Date(c[t.entryIdx].time * 1000).getUTCFullYear(); (m[y] = m[y] || []).push(t.ret); } } return m; };
  const cell = xs => { if (!xs || !xs.length) return ['0', '—', '—']; const gp = xs.filter(x => x > 0).reduce((a, b) => a + b, 0), gl = -xs.filter(x => x <= 0).reduce((a, b) => a + b, 0);
    return [xs.length, f2(gl > 0 ? gp / gl : Infinity), pc(xs.reduce((a, b) => a + b, 0) / xs.length)]; };
  const M = [yrTrades('2h', {}), yrTrades('2h', STACK[5][1]), yrTrades('4h', {}), yrTrades('4h', STACK[5][1])];
  const btcYr = y => { const xs = btc2h.filter(b => new Date(b.time * 1000).getUTCFullYear() === y); return xs.length ? pc(xs[xs.length - 1].close / xs[0].open - 1) : '—'; };
  for (let y = 2018; y <= new Date().getUTCFullYear(); y++)
    say(row([y, btcYr(y), ...cell(M[0][y]), ...cell(M[1][y]), '│', ...cell(M[2][y]), ...cell(M[3][y])]));
}

// ---------- 20. the whole portfolio: one pot of money, N slots, all coins competing ----------
// Every number above is per coin, as if each coin had its own all-in account. Real money is one pot.
// Here: start 2020-01-01 with 1.0; each new trade gets (current equity ÷ N) if a slot is free, else it
// is skipped; competing signals on the same bar go to the higher relative volume. Marked to market every
// bar. Approximation: a coin whose trade was skipped still "holds" it in its own simulation, so its next
// signal comes no sooner than it would have — this slightly understates the portfolio's trade count.
function portfolio(tf, cfg, coins, N, start) { return portfolioP(tf, cfg, null, coins, N, start); }
function portfolioP(tf, cfg, prm, coins, N, start) {
  const ser = {}, ent = new Map(); let tradesAll = 0;
  for (const coin of coins) {
    const c = loadC(coin, tf); if (c.length < 400) continue;
    const r = run(coin, tf, { ...HONEST, ...cfg }, null, prm), ind = cache[coin + tf + c.length + (prm ? JSON.stringify(prm) : '')];
    ser[coin] = { c, idx: new Map(c.map((b, i) => [b.time, i])) };
    for (const t of r.trades) { const tIn = c[t.entryIdx].time; if (tIn < start) continue; tradesAll++;
      const x = { coin, t, tOut: c[t.exitIdx].time, rv: ind.rv[t.sigIdx] }; (ent.get(tIn) || ent.set(tIn, []).get(tIn)).push(x); }
  }
  const times = btc2h.map(b => b.time).filter(t => t >= start && (tf === '2h' || t % TFS[tf] === 0));
  let cash = 1, open = [], taken = 0, pk = 1, dd = 0, investSum = 0; const eqAt = [];
  for (const T of times) {
    for (let k = open.length - 1; k >= 0; k--) if (open[k].x.tOut <= T) { cash += open[k].alloc * (1 + open[k].x.t.ret); open.splice(k, 1); }
    const cand = (ent.get(T) || []).sort((a, b) => b.rv - a.rv);
    for (const x of cand) {
      if (open.length >= N) continue;
      const E = cash + open.reduce((s, p) => s + p.val, 0), alloc = Math.min(cash, E / N);
      if (alloc <= 1e-12) continue;
      cash -= alloc; open.push({ x, alloc, val: alloc }); taken++;
    }
    for (const p of open) { const s = ser[p.x.coin], i = s.idx.get(T); if (i === undefined) continue;
      const t = p.x.t, f = t.fee; let v = 0, w = 1;
      for (const l of t.legs.slice(0, -1)) if (l.i <= i) { v += l.w * l.px * (1 - f); w -= l.w; }
      v += w * s.c[i].close * (1 - f); p.val = p.alloc * v / (t.entry * (1 + f)); }
    const inv = open.reduce((s, p) => s + p.val, 0), E = cash + inv;
    investSum += E > 0 ? inv / E : 0; if (E > pk) pk = E; dd = Math.max(dd, (pk - E) / pk); eqAt.push([T, E]);
  }
  const E = eqAt[eqAt.length - 1][1], yrs = (times[times.length - 1] - times[0]) / 31557600;
  const yearly = {}; let prev = 1, py = new Date(times[0] * 1000).getUTCFullYear();
  for (const [T, e] of eqAt) { const y = new Date(T * 1000).getUTCFullYear(); if (y !== py) { yearly[py] = e / prev - 1; prev = e; py = y; } yearly[py] = e / prev - 1; }
  return { E, cagr: Math.pow(E, 1 / yrs) - 1, dd, expo: investSum / times.length, taken, skipped: tradesAll - taken, yearly, yrs };
}
const P0 = Date.UTC(2020, 0, 1) / 1000;
const btcBH = (() => { const xs = btc2h.filter(b => b.time >= P0); let pk = 0, dd = 0; for (const b of xs) { pk = Math.max(pk, b.close); dd = Math.max(dd, (pk - b.close) / pk); }
  const E = xs[xs.length - 1].close / xs[0].open, yrs = (xs[xs.length - 1].time - xs[0].time) / 31557600; const yearly = {};
  for (let y = 2020; y <= new Date().getUTCFullYear(); y++) { const z = xs.filter(b => new Date(b.time * 1000).getUTCFullYear() === y); if (z.length) yearly[y] = z[z.length - 1].close / z[0].open - 1; }
  return { E, cagr: Math.pow(E, 1 / yrs) - 1, dd, yearly }; })();
say(`\n## 20. The whole portfolio — one pot of money, all coins competing for N slots (2020-01-01 → today)\n`);
say(`Everything above is per coin, as if each coin had its own all-in account. This is the real-money version: one account, each new trade gets *equity ÷ N*, a signal is skipped when all N slots are full (ties go to the higher volume spike), marked to market every bar, honest fills and fees. **Survivorship warning:** the coin list is today's list — coins that died since 2020 are not in it, which flatters every row. Coins join the moment they list. **Do not read the end values below as an expectation — section 21 repeats this on a list fixed in advance, and the numbers shrink by one to two orders of magnitude.**\n`);
say(head(['tf', 'rules', 'coins', 'slots N', 'trades taken', 'signals skipped (slots full)', 'end value (×)', 'CAGR', 'max DD', 'CAGR ÷ DD', 'avg % invested', 'worst year']));
const PRUN = [];
for (const tf of ['2h', '4h']) for (const [nm, cfg] of [['current', {}], ['② BTC>100d + k=4', STACK[2][1]], ['②c BTC>100d + scale 3R', STACK[4][1]], ['③', STACK[5][1]]])
  for (const [gname, list] of [['all 32', ALL], ['your 14', TREND]]) for (const N of [3, 5, 10]) {
    if (gname !== 'all 32' && N !== 5) continue;
    const r = portfolio(tf, cfg, list, N, P0); PRUN.push({ tf, nm, gname, N, r });
    const worst = Object.entries(r.yearly).sort((a, b) => a[1] - b[1])[0];
    say(row([tf, nm, gname, N, r.taken, r.skipped, r.E.toFixed(1) + '×', pc(r.cagr), pc(-r.dd), (r.cagr / r.dd).toFixed(2), pp(r.expo), `${worst[0]} ${pc(worst[1])}`]));
  }
say(row(['—', '**BTC buy & hold**', 'BTC', '—', '—', '—', btcBH.E.toFixed(1) + '×', pc(btcBH.cagr), pc(-btcBH.dd), (btcBH.cagr / btcBH.dd).toFixed(2), '100%',
  (() => { const w = Object.entries(btcBH.yearly).sort((a, b) => a[1] - b[1])[0]; return `${w[0]} ${pc(w[1])}`; })()]));
say(`\n**Portfolio, year by year (all 32 coins, N = 5)**\n`);
{ const pick = PRUN.filter(x => x.gname === 'all 32' && x.N === 5), years = Object.keys(btcBH.yearly);
  say(head(['year', 'BTC buy & hold', ...pick.map(x => `${x.tf} ${x.nm}`)]));
  for (const y of years) say(row([y, pc(btcBH.yearly[y]), ...pick.map(x => x.r.yearly[y] === undefined ? '—' : pc(x.r.yearly[y]))])); }

// ---------- 21. survivorship: a coin list you could have written in 2021, losers and corpses included ----------
const U21 = ('BTC ETH BNB XRP ADA DOT LTC BCH LINK XLM DOGE EOS TRX XTZ ATOM ALGO VET THETA FIL AXS SAND MANA CHZ EGLD ENJ ZIL IOTA NEO ' +
  'DASH ETC ONE KAVA CRV SUSHI UNI AAVE COMP SNX YFI 1INCH GRT LUNA FTT MATIC FTM SOL AVAX HBAR NEAR ICP').split(' ');
say(`\n## 21. Survivorship check — the big names of 2021, including the ones that died (${U21.length} coins)\n`);
say(`Every test above uses coins that are famous **today** — which means they survived and mostly pumped. That flatters any long-only system. This list is roughly the Binance top ~50 by market cap during 2021, written down without looking at what happened next: it includes **LUNA** (−100% in May 2022, held to the collapse), **FTT** (FTX, Nov 2022), coins that were renamed and delisted (MATIC→POL, FTM→S, EOS→A, closed at their last price) and a long tail of 2021 names that faded for years (ALGO, EOS, ZIL, IOTA, NEO, DASH, ONE, SUSHI, 1INCH, YFI, AXS, SAND, MANA…). **Cycle B on this list is a genuine out-of-sample test:** the list was fixed before 2023 and none of the rules were tuned on it.\n`);
table('21a. Rules on the 2021 list', null, ['2h', '4h'], STACK.filter((_, i) => [0, 1, 2, 4, 5].includes(i)), false, U21);
say(`\n**21b. Whole portfolio on the 2021 list** (same engine as section 20)\n`);
say(head(['tf', 'rules', 'period', 'slots N', 'trades taken', 'skipped', 'end value (×)', 'CAGR', 'max DD', 'CAGR ÷ DD', 'avg % invested', 'worst year', 'BTC B&H same period']));
const B23 = Date.UTC(2023, 0, 1) / 1000;
const bh = from => { const xs = btc2h.filter(b => b.time >= from); let pk = 0, dd = 0; for (const b of xs) { pk = Math.max(pk, b.close); dd = Math.max(dd, (pk - b.close) / pk); }
  const E = xs[xs.length - 1].close / xs[0].open, yrs = (xs[xs.length - 1].time - xs[0].time) / 31557600; return `${E.toFixed(1)}× · CAGR ${pc(Math.pow(E, 1 / yrs) - 1)} · DD ${pc(-dd)}`; };
for (const tf of ['2h', '4h']) for (const [nm, cfg] of [['current', {}], ['② BTC>100d + k=4', STACK[2][1]], ['②c BTC>100d + scale 3R', STACK[4][1]], ['③', STACK[5][1]]])
  for (const [pname, from] of [['2020→', P0], ['2023→ (out of sample)', B23]]) for (const N of [5, 10]) {
    const r = portfolio(tf, cfg, U21, N, from), worst = Object.entries(r.yearly).sort((a, b) => a[1] - b[1])[0];
    say(row([tf, nm, pname, N, r.taken, r.skipped, r.E.toFixed(1) + '×', pc(r.cagr), pc(-r.dd), (r.cagr / r.dd).toFixed(2), pp(r.expo), `${worst[0]} ${pc(worst[1])}`, bh(from)]));
  }

// ---------- 22. portfolio cost stress ----------
say(`\n## 22. Portfolio cost stress (all 32 coins, N = 5, 2020→)\n`);
say(head(['tf', 'rules', 'costs', 'end value (×)', 'CAGR', 'max DD']));
for (const tf of ['2h', '4h']) for (const [nm, cfg] of [['current', {}], ['③', STACK[5][1]]]) for (const [cn, cc] of [['0.1% fee + 0.05% slip', {}], ['0.1% fee + 0.2% slip', { slip: 0.002 }], ['0.2% fee + 0.5% slip', { fee: 0.002, slip: 0.005 }]]) {
  const r = portfolio(tf, { ...cfg, ...cc }, ALL, 5, P0);
  say(row([tf, nm, cn, r.E.toFixed(1) + '×', pc(r.cagr), pc(-r.dd)]));
}

// ---------- 23. the user's coins: default vs BTC>100d + scale ½ at 3R, on 1h / 2h / 4h, full history vs last 4500 bars ----------
{
  const MINE = [...TREND, 'STX'];
  const NEW = { veto: G.btc100, exit: 'scale3R' };
  const last4500 = function last4500(c) { return c.slice(-4500); };
  say(`\n## 23. Your coins — current rules vs "BTC above its 100-day MA + sell ½ at +3R", 1h / 2h / 4h, full history vs last 4,500 bars\n`);
  say(`Honest fills (next open ± 0.05%), 0.1%/side fees — so every number is a little below what the app's Compare tab shows, which fills at the signal close. ✓ = the Compare tab's test (net > 0, beats B&H, PF ≥ 1.3, WR ≥ 30%, DD ≤ 60%, trades ≥ 12 on 1h / 20 above, stable ≥ 70%). 4,500 bars = ${(4500 / 24).toFixed(0)} days on 1h, ${(4500 / 12).toFixed(0)} days on 2h, ${(4500 / 6).toFixed(0)} days on 4h. The BTC gate is computed on full history, so a 4,500-bar window never loses its start to a warm-up.\n`);
  const cols = ['coin', 'window', 'rules', 'trades', 'net', 'vs B&H', 'PF', 'max DD', 'WR', 'in mkt', 'stable', 'yrs', '✓'];
  const summary = [];
  for (const tf of ['1h', '2h', '4h']) {
    say(`\n**${tf}**\n`); say(head(cols));
    for (const [wn, w] of [['full', null], ['4500', last4500]]) {
      const agg = { def: [], neu: [] };
      for (const coin of MINE) for (const [rn, cfg] of [['current', {}], ['new', NEW]]) {
        const c0 = loadC(coin, tf); if (!c0 || (w ? Math.min(4500, c0.length) : c0.length) < 400) continue;
        const r = run(coin, tf, { ...HONEST, ...cfg }, w); if (!r) continue;
        (rn === 'new' ? agg.neu : agg.def).push(r);
        say(row([coin, wn, rn, r.n, pc(r.net), pc(r.edge), f2(r.pf), pc(-r.dd), pp(r.wr), pp(r.expo), pp(r.stab), r.yrs.toFixed(1), pass(r, tf) ? '✓' : '']));
      }
      summary.push([tf, wn, agg.def, agg.neu]);
    }
  }
  say(`\n**Summary — medians across the coins, pooled PF**\n`);
  say(head(['tf', 'window', 'rules', 'coins', 'trades', 'pooled PF', 'PF w/o top 2%', 'median net', 'median vs B&H', 'median max DD', 'median WR', 'coins net > 0', 'coins ✓', 'coins where new beats current']));
  for (const [tf, wn, d, n] of summary) for (const [rn, rows] of [['current', d], ['new', n]]) {
    const p = pooled(rows), better = rn === 'new' ? `${n.filter(r => { const b = d.find(x => x.coin === r.coin); return b && r.net > b.net + 1e-9; }).length}/${n.length}` : '—';
    say(row([tf, wn, rn, rows.length, p.n, f2(p.pf), f2(p.pfTop), pc(med(rows.map(r => r.net))), pc(med(rows.map(r => r.edge))), pc(-med(rows.map(r => r.dd))),
      pp(med(rows.map(r => r.wr))), `${rows.filter(r => r.net > 0).length}/${rows.length}`, `${rows.filter(r => pass(r, tf)).length}/${rows.length}`, better]));
  }
}

// ---------- 24. the same coins: 149-bar MA ON vs OFF × current vs new ----------
{
  const MINE = [...TREND, 'STX'];
  const NEW = { veto: G.btc100, exit: 'scale3R' };
  const last4500 = function last4500(c) { return c.slice(-4500); };
  const COMBOS = [['current + 149 MA', {}, null], ['current, no MA', {}, { lbMaBars: 0 }], ['new + 149 MA', NEW, null], ['new, no MA', NEW, { lbMaBars: 0 }]];
  say(`\n## 24. Your coins — the 149-bar MA condition ON vs OFF, for both the current rules and the new option (1h / 2h / 4h)\n`);
  say(`"new" = BTC above its 100-day MA + sell ½ at +3R. "no MA" sets \`lbMaBars = 0\`, which is how the app switches the condition off; nothing else changes. Honest fills as in section 23.\n`);
  const all = {};
  for (const tf of ['1h', '2h', '4h']) for (const [wn, w] of [['full', null], ['4500', last4500]]) for (const [cn, cfg, prm] of COMBOS)
    all[tf + wn + cn] = MINE.map(coin => run(coin, tf, { ...HONEST, ...cfg }, w, prm)).filter(Boolean);
  say(head(['tf', 'window', 'rules', 'trades', 'pooled PF', 'PF w/o top 2%', 'median net', 'median vs B&H', 'median max DD', 'median WR', 'coins net > 0', 'coins ✓', 'coins better than current + 149 MA']));
  for (const tf of ['1h', '2h', '4h']) for (const wn of ['full', '4500']) for (const [cn] of COMBOS) {
    const rows = all[tf + wn + cn], base = all[tf + wn + COMBOS[0][0]], p = pooled(rows);
    say(row([tf, wn, cn, p.n, f2(p.pf), f2(p.pfTop), pc(med(rows.map(r => r.net))), pc(med(rows.map(r => r.edge))), pc(-med(rows.map(r => r.dd))),
      pp(med(rows.map(r => r.wr))), `${rows.filter(r => r.net > 0).length}/${rows.length}`, `${rows.filter(r => pass(r, tf)).length}/${rows.length}`,
      cn === COMBOS[0][0] ? '—' : `${rows.filter(r => { const b = base.find(x => x.coin === r.coin); return b && r.net > b.net + 1e-9; }).length}/${rows.length}`]));
  }
  for (const tf of ['1h', '2h', '4h']) for (const wn of ['full', '4500']) {
    say(`\n**${tf}, ${wn === 'full' ? 'full history' : 'last 4,500 bars'} — net · PF · max DD (trades)**\n`);
    say(head(['coin', ...COMBOS.map(x => x[0])]));
    for (const coin of MINE) say(row([coin, ...COMBOS.map(([cn]) => { const r = all[tf + wn + cn].find(x => x.coin === coin);
      return r ? `${pc(r.net)} · ${f2(r.pf)} · ${pc(-r.dd)} (${r.n})${pass(r, tf) ? ' ✓' : ''}` : '—'; })]));
  }
  // walk-forward for the MA question on these coins
  say(`\n**Walk-forward on these coins — PF w/o top 2% in cycle A (2020–22) / cycle B (2023→)**\n`);
  say(head(['tf', ...COMBOS.map(x => x[0])]));
  for (const tf of ['1h', '2h', '4h']) say(row([tf, ...COMBOS.map(([cn, cfg, prm]) => {
    const A = MINE.map(c => run(c, tf, { ...HONEST, ...cfg }, cycA, prm)).filter(r => r && r.yrs >= 1), B = MINE.map(c => run(c, tf, { ...HONEST, ...cfg }, cycB, prm)).filter(r => r && r.yrs >= 1);
    return `${f2(pooled(A).pfTop)} / ${f2(pooled(B).pfTop)}`; })]));
}

// ---------- 24b. is that true beyond these 15 coins? ----------
say(`\n**24b. Same four combinations on the broader lists (32 coins of section 1, and the 2021 list of section 21) — 2h and 4h, full history**\n`);
say(head(['list', 'tf', 'rules', 'trades', 'PF', 'PF w/o top 2%', 'coins PF>1 w/o top 3', 'median net', 'median max DD', 'A', 'B']));
for (const [ln, list] of [['32 coins', ALL], ['2021 list (50)', U21]]) for (const tf of ['2h', '4h'])
  for (const [cn, cfg, prm] of [['current + 149 MA', {}, null], ['current, no MA', {}, { lbMaBars: 0 }], ['new + 149 MA', { veto: G.btc100, exit: 'scale3R' }, null], ['new, no MA', { veto: G.btc100, exit: 'scale3R' }, { lbMaBars: 0 }]]) {
    const v = evalV(tf, cfg, prm, list);
    say(row([ln, tf, cn, v.p.n, f2(v.p.pf), f2(v.p.pfTop), `${v.full.filter(r => r.pf3 > 1).length}/${v.full.length}`, pc(med(v.full.map(r => r.net))), pc(-med(v.full.map(r => r.dd))), f2(v.pA.pfTop), f2(v.pB.pfTop)]));
  }

// =====================================================================================================
// 25. FINAL DECISION — what does the BTC filter leave behind, can it be rescued, and which rule set wins?
// =====================================================================================================
G.pump50 = gate('pump50', (coin, tf, c) => { const L30 = Math.round(30 * 86400 / TFS[tf]); return c.map((b, i) => i >= L30 && b.close >= 1.5 * c[i - L30].close); });
G.strong = gate('strong', (coin, tf, c) => { const a = G.own200(coin, tf, c), b = G.rs30(coin, tf, c); return a.map((x, i) => x && b[i]); });
const orG = (name, ...gs) => gate(name, (coin, tf, c) => { const arr = gs.map(g => g(coin, tf, c)); return c.map((_, i) => arr.some(x => x[i])); });
G.btc100_or_pump50 = orG('btc100|pump50', G.btc100, G.pump50);
G.btc100_or_strong = orG('btc100|strong', G.btc100, G.strong);
G.btc50_or_pump50 = orG('btc50|pump50', G.btc50, G.pump50);
say(`\n---\n\n# 25. Final decision — what the BTC filter leaves behind, and which rule set to ship\n`);

// 25a. the trades the BTC>100d filter throws away
say(`## 25a. The trades "BTC above its 100-day MA" skips (current rules, honest fills, all 32 coins)\n`);
say(`Every trade the current rules take while BTC is BELOW its 100-day MA — exactly the set the filter removes.\n`);
say(head(['tf', 'trades kept', 'kept PF', 'kept avg', '│', 'trades skipped', 'skipped WR', 'skipped PF', 'skipped avg', 'skipped PF w/o top 2%', 'share of all profit from skipped', 'skipped in cycle A: PF', 'skipped in cycle B: PF']));
const skippedTop = {};
for (const tf of ['2h', '4h']) {
  const v = evalV(tf), kept = [], skip = [];
  for (const r of v.full) { const c = loadC(r.coin, tf), g = G.btc100(r.coin, tf, c);
    for (const t of r.trades) (g[t.sigIdx] ? kept : skip).push({ ...t, coin: r.coin, time: c[t.sigIdx].time }); }
  const ps = xs => { const gp = xs.filter(x => x.ret > 0).reduce((s, x) => s + x.ret, 0), gl = -xs.filter(x => x.ret <= 0).reduce((s, x) => s + x.ret, 0); return gl > 0 ? gp / gl : Infinity; };
  const tot = [...kept, ...skip].filter(x => x.ret > 0).reduce((s, x) => s + x.ret, 0);
  const sk = pooled([{ trades: skip }]);
  say(row([tf, kept.length, f2(ps(kept)), pc(kept.reduce((s, x) => s + x.ret, 0) / kept.length), '│', skip.length, pp(skip.filter(x => x.ret > 0).length / skip.length), f2(ps(skip)),
    pc(skip.reduce((s, x) => s + x.ret, 0) / skip.length), f2(sk.pfTop), pp(skip.filter(x => x.ret > 0).reduce((s, x) => s + x.ret, 0) / tot),
    f2(ps(skip.filter(x => x.time >= A0 && x.time < B0))), f2(ps(skip.filter(x => x.time >= B0)))]));
  skippedTop[tf] = skip.sort((a, b) => b.ret - a.ret).slice(0, 12);
}
for (const tf of ['2h', '4h']) {
  say(`\n**Biggest ${tf} winners the filter would have skipped — and whether a rescue rule catches them**\n`);
  say(head(['coin', 'signal date', 'trade', 'BTC vs its 100d MA', 'coin up ≥ 50% in 30d?', 'coin > own 200d MA & beating BTC?']));
  for (const t of skippedTop[tf]) { const c = loadC(t.coin, tf), j = btcAt(c, tf)[t.sigIdx], ma = btcMAof(100)[j];
    say(row([t.coin, new Date(t.time * 1000).toISOString().slice(0, 10), pc(t.ret), pc(btcC[j] / ma - 1), G.pump50(t.coin, tf, c)[t.sigIdx] ? 'yes' : 'no', G.strong(t.coin, tf, c)[t.sigIdx] ? 'yes' : 'no'])); }
}

// 25b. the candidates, judged on everything at once
const CANDS = [
  ['A. current (149 MA, 1-day-low trail)', {}, null],
  ['B. current + sell ½ at 3R', { exit: 'scale3R' }, null],
  ['C. BTC>100d + sell ½ at 3R', { veto: G.btc100, exit: 'scale3R' }, null],
  ['D. C without the 149 MA', { veto: G.btc100, exit: 'scale3R' }, { lbMaBars: 0 }],
  ['E. (BTC>100d OR coin +50% in 30d) + ½ at 3R', { veto: G.btc100_or_pump50, exit: 'scale3R' }, null],
  ['F. (BTC>100d OR coin strong vs BTC) + ½ at 3R', { veto: G.btc100_or_strong, exit: 'scale3R' }, null],
  ['G. (BTC>50d OR coin +50% in 30d) + ½ at 3R', { veto: G.btc50_or_pump50, exit: 'scale3R' }, null],
  ['H. BTC>100d + ATR trail k=4', { veto: G.btc100, exit: 'chand', k: 4 }, null],
  ['I. (BTC>100d OR coin +50% in 30d) + ATR trail k=4', { veto: G.btc100_or_pump50, exit: 'chand', k: 4 }, null],
  ['J. BTC>100d + ½ at 3R, rest on ATR trail k=4', { veto: G.btc100, exit: 'scaleChand', k: 4 }, null],
  ['K. H without the 149 MA', { veto: G.btc100, exit: 'chand', k: 4 }, { lbMaBars: 0 }],
  ['L. J without the 149 MA', { veto: G.btc100, exit: 'scaleChand', k: 4 }, { lbMaBars: 0 }]];
const MINE15 = [...TREND, 'STX'];
say(`\n## 25b. Every candidate on every test\n`);
say(`Score = PF without the top 2% of trades (does it make money without its jackpots). **Worst-case** = the lowest of the four robustness scores (32 coins cycle A, 32 coins cycle B, your 15 coins full history, and the 2021 list in 2023→ — the only test where neither the coins nor the rules could have been chosen with hindsight). The rule set to ship is the one with the best worst-case, not the best single number.\n`);
const FINAL = [];
for (const tf of ['2h', '4h']) {
  say(`\n**${tf}**\n`);
  say(head(['rules', 'trades (32)', '32: PF w/o top', '32: A', '32: B', 'yours 15: PF w/o top', 'yours 15: median net', 'yours 15: median DD', '2021 list 2023→: PF w/o top', '**worst-case**', 'portfolio 2021 list 2023→ (N=10)', 'portfolio 32 coins 2020→ (N=10)']));
  for (const [nm, cfg, prm] of CANDS) {
    const v = evalV(tf, cfg, prm), m = evalV(tf, cfg, prm, MINE15), u = evalV(tf, cfg, prm, U21);
    const worst = Math.min(v.pA.pfTop, v.pB.pfTop, m.p.pfTop, u.pB.pfTop);
    // portfolio needs prm: run() takes prm via cfg._prm below
    const pu = portfolioP(tf, cfg, prm, U21, 10, B23), pa = portfolioP(tf, cfg, prm, ALL, 10, P0);
    FINAL.push({ tf, nm, worst });
    say(row([nm, v.p.n, f2(v.p.pfTop), f2(v.pA.pfTop), f2(v.pB.pfTop), f2(m.p.pfTop), pc(med(m.full.map(r => r.net))), pc(-med(m.full.map(r => r.dd))), f2(u.pB.pfTop),
      `**${f2(worst)}**`, `${pu.E.toFixed(1)}× · DD ${pc(-pu.dd)}`, `${pa.E.toFixed(1)}× · DD ${pc(-pa.dd)}`]));
  }
}
say(`\nBTC buy & hold for reference: 2023→ ${bh(B23)} · 2020→ ${bh(P0)}.`);

console.log(out.join('\n'));
