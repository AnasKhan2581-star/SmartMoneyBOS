// Runs every study in the Oct 2026 liqbrk research and prints markdown tables.
//   node research/liqbrk_report.js > research/RESULTS_liqbrk_2026-10.md
'use strict';
const L = require('./liqbrk_lab.js');
const TREND = 'SOL FET XLM HBAR PEPE AERO INJ STRK ARB SUI ZEC RENDER RAY CFX'.split(' ');   // user's pick
const ADDED = 'WIF BONK TAO NEAR AVAX DOGE JUP TIA SEI APT ONDO ENA WLD FLOKI OP'.split(' '); // mine
const CTRL = 'BTC ETH LINK'.split(' ');
const ALL = [...TREND, ...ADDED, ...CTRL];
const HONEST = { fill: 'next', slip: 0.0005 };
const MIN = { '2h': 20, '4h': 20 };                 // minTrades() in the app, Oct 2026

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
function run(coin, tf, cfg, win) {
  let c = L.load(coin, tf); if (win) c = win(c);
  if (c.length < 400) return null;
  const key = coin + tf + (win ? win.name : '') + c.length;
  const ind = cache[key] || (cache[key] = L.indicators(c));
  const cf = { ...cfg }; if (cf.veto === true) cf.veto = vetoFor(c);
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

console.log(out.join('\n'));
