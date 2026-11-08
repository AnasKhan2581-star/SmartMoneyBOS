#!/usr/bin/env node
// Gold, long term (Nov 2026): five candidate strategies and two retail baselines, tested on 50 years of gold.
//
//   NODE_USE_ENV_PROXY=1 node research/gold/gold_lab.js          → research/gold/RESULTS_gold_2026-11.md
//
// Data (cached in research/cache/gold, git-ignored):
//   gold   World Bank monthly AVERAGE price, 1960- (github.com/datasets/gold-prices, public domain)
//   dollar EUR/USD monthly average: Deutsche Mark ÷ 1.95583 before 1999, the euro after (datasets/exchange-rates)
//   PAXGUSDT / EURUSDT daily from Binance: months after the World Bank series ends, and the modern daily check
//
// Monthly AVERAGES smooth the price path, and that flatters trend-following: averaging a random walk gives its
// changes a +0.25 autocorrelation (Working 1960). So a decision made at the end of month i (from data through i)
// earns the average-to-average return of month i+2, which starts after the decision. That costs about half a
// month of reaction and can never look ahead. Calendar rules use no data, so they earn the month they name.
// Fees 0.1% per side, idle money earns 0% (as everywhere in this app; T-bills paid 5-15% in 1975-2000, so 0% is
// harsh on any strategy that sits out). Drawdowns are on monthly averages, so they UNDERSTATE the daily truth —
// the PAXG section measures the real daily drawdown for 2020-2026.
'use strict';
const fs = require('fs'), path = require('path');
const CACHE = path.join(__dirname, '..', 'cache', 'gold');
const OUT = path.join(__dirname, 'RESULTS_gold_2026-11.md');
const FEE = 0.001;
const IS = ['1975-01', '2000-12'], OOS = ['2001-01', null];   // null = the last complete month
const SRC = {
  'monthly.csv': 'https://raw.githubusercontent.com/datasets/gold-prices/main/data/monthly.csv',
  'fx_monthly.csv': 'https://raw.githubusercontent.com/datasets/exchange-rates/main/data/monthly.csv',
};

// ---------- data ----------
async function binanceDaily(sym){
  let out = [], start = 0;
  for(;;){
    const r = await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${sym}&interval=1d&limit=1000&startTime=${start}`);
    if(!r.ok) throw new Error(`${sym} HTTP ${r.status}`);
    const k = await r.json(); if(!k.length) break;
    out = out.concat(k.map(x=>({ t: x[0], o: +x[1], h: +x[2], l: +x[3], c: +x[4], closeT: x[6] })));
    start = k[k.length-1][0] + 1; if(k.length < 1000) break;
  }
  return out.filter(x=>x.closeT < Date.now());                // closed days only
}
async function fetchAll(force){
  fs.mkdirSync(CACHE, { recursive: true });
  for(const [f, url] of Object.entries(SRC)){
    const p = path.join(CACHE, f); if(fs.existsSync(p) && !force) continue;
    const r = await fetch(url); if(!r.ok) throw new Error(`${f} HTTP ${r.status}`);
    fs.writeFileSync(p, await r.text());
  }
  for(const s of ['PAXGUSDT', 'EURUSDT']){
    const p = path.join(CACHE, s + '_1d.json');
    if(fs.existsSync(p) && !force && Date.now() - fs.statSync(p).mtimeMs < 6*3600e3) continue;
    fs.writeFileSync(p, JSON.stringify(await binanceDaily(s)));
  }
}
const ym = (ms)=> new Date(ms).toISOString().slice(0, 7);
// monthly average of daily closes, whole months only: the month's first AND last day must be in (PAXG listed on
// 28 Aug 2020, and a 4-day "August" is not August's average). The engine's runGold applies the same rule.
function monthlyAvg(days){
  const by = new Map();
  for(const d of days){ const k = ym(d.t); if(!by.has(k)) by.set(k, []); by.get(k).push(d); }
  const out = new Map();
  for(const [k, ds] of by){
    const last = new Date(ds[ds.length-1].t), next = new Date(last.getTime() + 86400e3);
    if(next.getUTCMonth() === last.getUTCMonth()) continue;    // month not finished
    if(new Date(ds[0].t).getUTCDate() !== 1) continue;          // joined midway
    out.set(k, ds.reduce((a, d)=>a + d.c, 0) / ds.length);
  }
  return out;
}
function loadData(){
  const rd = (f)=> fs.readFileSync(path.join(CACHE, f), 'utf8');
  const gold = new Map(rd('monthly.csv').trim().split('\n').slice(1).map(l=>l.split(',')).map(([d, p])=>[d.slice(0, 7), +p]));
  const fx = rd('fx_monthly.csv').trim().split('\n').slice(1).map(l=>l.split(','));
  const eur = new Map();
  for(const [d, c, v] of fx) if(c === 'Germany' && d < '1999') eur.set(d.slice(0, 7), 1.95583 / +v);
  for(const [d, c, v] of fx) if(c === 'Euro') eur.set(d.slice(0, 7), 1 / +v);
  const paxgD = JSON.parse(rd('PAXGUSDT_1d.json')), eurD = JSON.parse(rd('EURUSDT_1d.json'));
  const pm = monthlyAvg(paxgD), em = monthlyAvg(eurD);
  const lastWB = [...gold.keys()].pop(), lastFX = [...eur.keys()].pop();
  for(const [k, v] of pm) if(k > lastWB) gold.set(k, v);       // months the World Bank hasn't published yet
  for(const [k, v] of em) if(k > lastFX) eur.set(k, v);
  const months = [...gold.keys()].filter(k=>k >= '1968-01' && eur.has(k) || k >= '1968-01' && k < '1971-01').sort();
  return { months, A: months.map(k=>gold.get(k)), E: months.map(k=>eur.get(k) ?? null), paxgD, eurD, lastWB, lastFX };
}

// ---------- strategies: sig(i, D, st) → 1 in gold / 0 in cash, from data through month i only ----------
const mean = (a, i, n)=>{ if(i - n + 1 < 0) return NaN; let s = 0; for(let k = i-n+1; k <= i; k++) s += a[k]; return s / n; };
const maxOf = (a, lo, hi)=>{ let m = -Infinity; for(let k = Math.max(0, lo); k <= hi; k++) m = Math.max(m, a[k]); return m; };
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const inWindow = (m, a, b)=> a <= b ? (m >= a && m <= b) : (m >= a || m <= b);   // month numbers 0-11, may wrap
const STRATS = {
  // --- retail baselines: what everyone already knows ---
  bh:    { name: 'Buy & hold', retail: true, grid: [{}], sig: ()=>1 },
  sma10: { name: '10-month average (Faber)', retail: true, grid: [{}], sig: (i, D)=> i >= 9 && D.A[i] > mean(D.A, i, 10) ? 1 : 0 },
  mom12: { name: '12-month momentum', retail: true, grid: [{}], sig: (i, D)=> i >= 12 && D.A[i] > D.A[i-12] ? 1 : 0 },
  // --- G1 seasonal tide: physical demand (India's wedding season and Diwali, then Lunar New Year) and Baur's
  //     (2013) "autumn effect" (Sep and Nov significantly positive). No data used, so no lag.
  season: { name: 'G1 Seasonal tide', lag: 0,
    grid: [5, 6, 7, 8].flatMap(a=>[11, 0, 1, 2].map(b=>({ from: a, to: b }))),
    label: (p)=> `${MON[p.from]}–${MON[p.to]}`,
    sig: (k, D, st, p)=> inWindow(+D.months[k].slice(5) - 1, p.from, p.to) ? 1 : 0 },
  // --- G2 anchor: George & Hwang (2004) — investors anchor on the 52-week high and under-react near it, so
  //     prices close to their 12-month high keep drifting up. In while within b of the 12-month high.
  anchor: { name: 'G2 52-week-high anchor',
    grid: [6, 12, 24].flatMap(w=>[0.05, 0.075, 0.10, 0.125, 0.15, 0.20].map(b=>({ w, b }))),
    label: (p)=> `${p.w}m high, within ${(p.b*100).toFixed(1).replace('.0','')}%`,
    sig: (i, D, st, p)=> i >= p.w - 1 && D.A[i] >= (1 - p.b) * maxOf(D.A, i - p.w + 1, i) ? 1 : 0 },
  // --- G3 dollar tide: gold is priced in dollars, and currency trends persist (FX momentum). In while the
  //     euro is above its n-month average, i.e. the dollar is weakening.
  dollar: { name: 'G3 Dollar tide',
    grid: [3, 6, 9, 12, 18, 24].map(n=>({ n })),
    label: (p)=> `EUR/USD above its ${p.n}-month average`,
    sig: (i, D, st, p)=> i >= p.n - 1 && D.E[i] > mean(D.E, i, p.n) ? 1 : 0 },
  // --- G4 secular breakout: gold moves in multi-year secular trends. Buy a new L-month high, then give it room:
  //     sell only after a fall of d from the highest monthly average since the entry.
  breakout: { name: 'G4 Secular breakout',
    grid: [6, 12, 24, 36].flatMap(L=>[0.10, 0.15, 0.20, 0.25, 0.30].map(d=>({ L, d }))),
    label: (p)=> `new ${p.L}m high, out ${p.d*100}% below the peak`,
    sig: (i, D, st, p)=>{
      if(st.on){ st.peak = Math.max(st.peak, D.A[i]); if(D.A[i] < (1 - p.d) * st.peak) st.on = false; }
      else if(i >= p.L && D.A[i] > maxOf(D.A, i - p.L, i - 1)){ st.on = true; st.peak = D.A[i]; }
      return st.on ? 1 : 0; } },
  // --- G5 clean trend: Kaufman's efficiency ratio = net move ÷ the sum of every monthly move. A rise that came
  //     in a straight line is a trend; the same rise through big swings is noise. In on a clean rise, out when
  //     the n-month change turns negative or the path gets choppy (half the entry threshold).
  effic: { name: 'G5 Clean trend (efficiency ratio)',
    grid: [6, 9, 12, 18].flatMap(n=>[0.1, 0.2, 0.3, 0.4, 0.5].map(e=>({ n, e }))),
    label: (p)=> `${p.n}m, ER ≥ ${p.e}`,
    sig: (i, D, st, p)=>{
      if(i < p.n) return 0;
      let path = 0; for(let k = i - p.n + 1; k <= i; k++) path += Math.abs(D.A[k] - D.A[k-1]);
      const net = D.A[i] - D.A[i - p.n], er = path > 0 ? Math.abs(net) / path : 0;
      if(st.on){ if(net < 0 || er < p.e / 2) st.on = false; }
      else if(net > 0 && er >= p.e) st.on = true;
      return st.on ? 1 : 0; } },
};

// ---------- engine ----------
// positions for every RETURN month k (the average-to-average change A[k]/A[k-1]), from the strategy's signals
function positions(D, s, p, lagOverride){
  const n = D.months.length, sig = new Array(n).fill(0), st = {};
  for(let i = 0; i < n; i++) sig[i] = s.sig(i, D, st, p);
  const lag = s.lag === 0 ? 0 : (lagOverride ?? s.lag ?? 2), pos = new Array(n).fill(0);
  for(let k = 0; k < n; k++) pos[k] = k - lag >= 0 ? sig[k - lag] : 0;
  return { sig, pos };
}
function evaluate(D, pos, from, to){
  const k0 = D.months.indexOf(from), k1 = to ? D.months.indexOf(to) : D.months.length - 1;
  let eq = 1, peak = 1, dd = 0, prev = 0, inM = 0, tradeStart = null;
  const rets = [], trades = [];
  for(let k = k0; k <= k1; k++){
    const p = pos[k];
    if(p !== prev){ eq *= 1 - FEE; if(p){ tradeStart = eq / (1 - FEE); } else if(tradeStart != null){ trades.push(eq / tradeStart - 1); tradeStart = null; } }
    const r = p ? D.A[k] / D.A[k-1] - 1 : 0;
    const before = eq; eq *= 1 + r; rets.push(eq / before - 1);
    peak = Math.max(peak, eq); dd = Math.min(dd, eq / peak - 1); inM += p; prev = p;
  }
  if(prev && tradeStart != null) trades.push(eq * (1 - FEE) / tradeStart - 1);   // marked as if sold at the end
  const n = k1 - k0 + 1, yrs = n / 12, cagr = Math.pow(eq, 1 / yrs) - 1;
  const mu = rets.reduce((a, b)=>a + b, 0) / n, sd = Math.sqrt(rets.reduce((a, b)=>a + (b - mu) ** 2, 0) / n);
  const wins = trades.filter(x=>x > 0), gw = wins.reduce((a, b)=>a + b, 0), gl = -trades.filter(x=>x <= 0).reduce((a, b)=>a + b, 0);
  return { from: D.months[k0], to: D.months[k1], yrs, mult: eq, cagr, dd, mar: dd < 0 ? cagr / -dd : Infinity,
    sharpe: sd > 0 ? mu / sd * Math.sqrt(12) : 0, inMkt: inM / n, trades: trades.length,
    wr: trades.length ? wins.length / trades.length : null, pf: gl > 0 ? gw / gl : (gw > 0 ? Infinity : null) };
}
function study(D){
  const bh = positions(D, STRATS.bh, {}).pos;
  const out = {};
  for(const [key, s] of Object.entries(STRATS)){
    const rows = s.grid.map(p=>{ const { pos, sig } = positions(D, s, p);
      return { p, pos, sig, is: evaluate(D, pos, ...IS), oos: evaluate(D, pos, ...OOS), full: evaluate(D, pos, IS[0], OOS[1]) }; });
    // parameters are chosen on 1975-2000 ONLY: best MAR with at least 4 trades, ties to the higher CAGR
    const ok = rows.filter(r=>r.is.trades >= 4 || s.retail);
    const pick = (ok.length ? ok : rows).slice().sort((a, b)=> b.is.mar - a.is.mar || b.is.cagr - a.is.cagr)[0];
    const medOos = median(rows.map(r=>r.oos.mar));
    out[key] = { key, s, rows, pick, medOos };
  }
  out._bh = bh;
  return out;
}
const median = (xs)=>{ const a = xs.filter(Number.isFinite).sort((x, y)=>x - y); return a.length ? (a.length % 2 ? a[(a.length-1)/2] : (a[a.length/2-1] + a[a.length/2]) / 2) : NaN; };

// random timing with the same switching rhythm: a two-state Markov chain whose in→out and out→in odds match the
// strategy's own. If real timing adds nothing, the strategy lands mid-pack.
function placebo(D, pos, from, to, n = 2000){
  const k0 = D.months.indexOf(from), k1 = to ? D.months.indexOf(to) : D.months.length - 1;
  let inM = 0, outM = 0, ent = 0, ex = 0;
  for(let k = k0 + 1; k <= k1; k++){ if(pos[k-1]){ inM++; if(!pos[k]) ex++; } else { outM++; if(pos[k]) ent++; } }
  const p01 = ent / Math.max(1, outM), p10 = ex / Math.max(1, inM);
  const rnd = require('../rng.js').mulberry32(12345);
  const res = [];
  for(let t = 0; t < n; t++){
    const q = pos.slice(); let st = rnd() < inM / (inM + outM) ? 1 : 0;
    for(let k = k0; k <= k1; k++){ q[k] = st; st = st ? (rnd() < p10 ? 0 : 1) : (rnd() < p01 ? 1 : 0); }
    res.push(evaluate(D, q, from, to));
  }
  return res;
}

// the modern check on REAL daily prices: month-end decisions from monthly averages of daily closes, filled at the
// month's last daily close, marked to market every day. Seeds the averages before PAXG listed with the World
// Bank series (the same quantity), so a 24-month rule can act from PAXG's first month.
function dailyCheck(D, key, p){
  const s = STRATS[key], days = D.paxgD;
  const pm = monthlyAvg(days), D2 = { ...D, A: D.months.map((m, i)=> pm.get(m) ?? D.A[i]) };
  const st = {}; let on = 0, eq = 1, peak = 1, dd = 0, bh = 1, bhPeak = 1, bhDD = 0, trades = 0, entries = [], log = [], openAt = null;
  const sigByMonth = new Map();
  for(let i = 0; i < D2.months.length; i++) sigByMonth.set(D2.months[i], s.sig(i, D2, st, p));
  for(let j = 1; j < days.length; j++){
    const d = days[j], r = d.c / days[j-1].c - 1;
    if(on){ eq *= 1 + r; } bh *= 1 + r;
    peak = Math.max(peak, eq); dd = Math.min(dd, eq / peak - 1); bhPeak = Math.max(bhPeak, bh); bhDD = Math.min(bhDD, bh / bhPeak - 1);
    const nxt = days[j+1];
    const monthEnd = !nxt || ym(nxt.t) !== ym(d.t);
    if(monthEnd && nxt){
      const m = ym(d.t), want = s.lag === 0 ? (inWindow(new Date(nxt.t).getUTCMonth(), p.from, p.to) ? 1 : 0) : (sigByMonth.get(m) ?? on);
      if(want !== on){ eq *= 1 - FEE; on = want;
        if(on){ trades++; entries.push(m); openAt = { date: new Date(d.t).toISOString().slice(0,10), px: d.c, eq: eq / (1 - FEE) }; }
        else if(openAt){ log.push({ ...openAt, out: new Date(d.t).toISOString().slice(0,10), outPx: d.c, ret: eq / openAt.eq - 1 }); openAt = null; } }
    }
  }
  if(openAt){ const d = days[days.length-1]; log.push({ ...openAt, out: null, outPx: d.c, ret: eq / openAt.eq - 1 }); }
  const yrs = (days[days.length-1].t - days[0].t) / (365.25 * 86400e3);
  return { from: new Date(days[0].t).toISOString().slice(0,10), to: new Date(days[days.length-1].t).toISOString().slice(0,10), yrs, mult: eq, cagr: Math.pow(eq, 1/yrs) - 1, dd, trades, entries, log, on,
    bh: { mult: bh, cagr: Math.pow(bh, 1/yrs) - 1, dd: bhDD } };
}

// ---------- report ----------
const pc = (x, d = 1)=> x == null || !isFinite(x) ? '—' : `${x >= 0 ? '+' : ''}${(x*100).toFixed(d)}%`;
const f2 = (x)=> x == null ? '—' : !isFinite(x) ? '∞' : x.toFixed(2);
const mult = (x)=> x >= 100 ? `×${Math.round(x)}` : `×${x.toFixed(x >= 10 ? 1 : 2)}`;
function line(name, e, bhE){
  return `| ${name} | ${pc(e.cagr)} | ${pc(e.dd, 0)} | ${f2(e.mar)} | ${f2(e.sharpe)} | ${Math.round(e.inMkt*100)}% | ${e.trades} | ${e.wr == null ? '—' : Math.round(e.wr*100) + '%'} | ${f2(e.pf)} | ${mult(e.mult)} | ${bhE ? pc((e.mult) / bhE.mult - 1, 0) : ''} |`;
}
const HEAD = '| | CAGR | Max DD | MAR | Sharpe | In gold | Trades | Win rate | PF | Money | vs B&H |\n|---|---|---|---|---|---|---|---|---|---|---|';

function main(){
  const D = loadData(), R = study(D);
  const last = D.months[D.months.length-1];
  const keys = ['season', 'anchor', 'dollar', 'breakout', 'effic'], base = ['bh', 'sma10', 'mom12'];
  const bhE = { is: R.bh.pick.is, oos: R.bh.pick.oos, full: R.bh.pick.full };
  const L = [];
  L.push('# Gold, long term: five strategies tested on 50 years (Nov 2026)', '');
  L.push(`Generated by \`research/gold/gold_lab.js\`. Gold: World Bank monthly average price (1968–${D.lastWB}, then PAXG monthly averages to ${last}). Dollar: EUR/USD monthly average (Deutsche Mark ÷ 1.95583 before 1999). In-sample **1975–2000** (parameters chosen here only), out-of-sample **2001–${last.slice(0,4)}** (judged here). A decision at a month's end earns the average-to-average return two months on (no look-ahead; about half a month slower than real life). Fees 0.1%/side, idle money earns 0%. Drawdowns are on monthly averages and understate the daily truth — see the PAXG section for real daily numbers.`, '');
  L.push('MAR = CAGR ÷ max drawdown (higher is better: return per unit of the worst fall). Money = what $1 became. vs B&H = how much more (or less) money than just holding gold over the same years.', '');
  L.push('**Conclusion and the shipped rule: ALGORITHM.md, section `gold`.** G5 (clean trend, 9 months, efficiency ≥ 0.30) shipped: the only rule near the top in both halves, the best whole-period MAR, a plateau across its settings. It does not beat 12-month momentum on 2001–2026 alone, and on PAXG 2020–26 it made less than holding.', '');
  for(const [title, w] of [['In-sample 1975–2000 (parameters chosen here)', 'is'], [`Out-of-sample 2001–${last.slice(0,4)} (never seen while choosing)`, 'oos'], [`Whole period 1975–${last.slice(0,4)}`, 'full']]){
    L.push(`## ${title}`, '', HEAD);
    for(const k of base) L.push(line(R[k].s.name + ' *(retail)*', R[k].pick[w], bhE[w]));
    for(const k of keys) L.push(line(`${R[k].s.name} · ${R[k].s.label(R[k].pick.p)}`, R[k].pick[w], bhE[w]));
    L.push('');
  }
  L.push('## Every parameter, not just the chosen one', '', 'A real effect holds across its neighbours; a lucky fit is one good cell among bad ones. **Median OOS MAR** over each grid, against buy & hold\'s ' + f2(bhE.oos.mar) + ', the 10-month average\'s ' + f2(R.sma10.pick.oos.mar) + ' and 12-month momentum\'s ' + f2(R.mom12.pick.oos.mar) + ':', '');
  L.push('| Strategy | Settings tried | Median OOS MAR | Share beating B&H OOS MAR | Share beating the 10-month average | Chosen (in-sample) |', '|---|---|---|---|---|---|');
  for(const k of keys){ const r = R[k];
    const beatBH = r.rows.filter(x=>x.oos.mar > bhE.oos.mar).length / r.rows.length, beatSma = r.rows.filter(x=>x.oos.mar > R.sma10.pick.oos.mar).length / r.rows.length;
    L.push(`| ${r.s.name} | ${r.rows.length} | ${f2(r.medOos)} | ${Math.round(beatBH*100)}% | ${Math.round(beatSma*100)}% | ${r.s.label(r.pick.p)} |`); }
  L.push('');
  for(const k of keys){ const r = R[k];
    L.push(`### ${r.s.name}`, '', '| Setting | IS CAGR | IS DD | IS MAR | OOS CAGR | OOS DD | OOS MAR | OOS trades |', '|---|---|---|---|---|---|---|---|');
    for(const x of r.rows) L.push(`| ${r.s.label(x.p)}${x === r.pick ? ' **← chosen**' : ''} | ${pc(x.is.cagr)} | ${pc(x.is.dd, 0)} | ${f2(x.is.mar)} | ${pc(x.oos.cagr)} | ${pc(x.oos.dd, 0)} | ${f2(x.oos.mar)} | ${x.oos.trades} |`);
    L.push('');
  }
  // ---- the finalists: decade by decade, random timing, the lag assumption, real daily prices ----
  const fin = ['bh', 'sma10', 'mom12', ...keys];
  const nm = (k)=> R[k].s.name + (R[k].s.retail ? ' *(retail)*' : '');
  const DEC = [['1975-01','1979-12'], ['1980-01','1989-12'], ['1990-01','1999-12'], ['2000-01','2009-12'], ['2010-01','2019-12'], ['2020-01', null]];
  L.push('## Decade by decade (CAGR / max drawdown, chosen settings)', '', '| | ' + DEC.map(([a, b])=>`${a.slice(0,4)}–${(b || last).slice(0,4)}`).join(' | ') + ' | Decades beating B&H MAR |', '|---|' + DEC.map(()=>'---').join('|') + '|---|');
  const decMar = {};
  for(const k of fin){ const ev = DEC.map(([a, b])=>evaluate(D, R[k].pick.pos, a, b)); decMar[k] = ev;
    const beat = k === 'bh' ? '' : ev.filter((e, j)=> e.mar > decMar.bh[j].mar).length + ' of ' + DEC.length;
    L.push(`| ${nm(k)} | ${ev.map(e=>`${pc(e.cagr)} / ${pc(e.dd, 0)}`).join(' | ')} | ${beat} |`); }
  L.push('');
  L.push('## Random timing with the same rhythm', '', 'Each strategy against 2,000 random in/out paths that switch at its own pace and spend about the same time in gold (1975–' + last.slice(0,4) + '). The percentile is the share of random paths it beats. Timing that carries information lands high; a rule that only adds cash time lands near the middle.', '', '| | CAGR | percentile | MAR | percentile |', '|---|---|---|---|---|');
  for(const k of fin.filter(k=>k !== 'bh')){ const e = R[k].pick.full, pl = placebo(D, R[k].pick.pos, IS[0], OOS[1]);
    const pct = (f)=> Math.round(pl.filter(x=>f(x) < f(e)).length / pl.length * 100) + '%';
    L.push(`| ${nm(k)} | ${pc(e.cagr)} | ${pct(x=>x.cagr)} | ${f2(e.mar)} | ${pct(x=>x.mar)} |`); }
  L.push('');
  L.push('## The lag assumption', '', 'Monthly averages force a choice of when a month-end decision starts to earn. Lag 1 earns the next average-to-average month (it overlaps the decision month by half: an OPTIMISTIC bound, not achievable). Lag 2 is the one used above (conservative by half a month). Lag 3 waits a further month (pessimistic). Whole period 1975–' + last.slice(0,4) + ', MAR (CAGR / drawdown):', '', '| | Lag 1 (optimistic) | Lag 2 (used) | Lag 3 (pessimistic) |', '|---|---|---|---|');
  for(const k of fin.filter(k=>k !== 'bh' && k !== 'season')){ const cell = (lag)=>{ const e = evaluate(D, positions(D, R[k].s, R[k].pick.p, lag).pos, IS[0], OOS[1]); return `${f2(e.mar)} (${pc(e.cagr)} / ${pc(e.dd, 0)})`; };
    L.push(`| ${nm(k)} | ${cell(1)} | ${cell(2)} | ${cell(3)} |`); }
  L.push('');
  L.push('## Real daily prices: PAXGUSDT on Binance', '', `What the webapp will do: monthly averages of PAXG's daily closes (the World Bank series before PAXG listed), a decision at each month's last daily close, filled at that close, marked to market every day. ${D.paxgD.length} daily candles, ${new Date(D.paxgD[0].t).toISOString().slice(0,10)} → ${new Date(D.paxgD[D.paxgD.length-1].t).toISOString().slice(0,10)}.`, '', '| | CAGR | Max DD (daily) | Money | Trades | In gold now |', '|---|---|---|---|---|---|');
  const dc = {};
  for(const k of fin){ const c = dailyCheck(D, k, R[k].pick.p); dc[k] = c;
    L.push(`| ${nm(k)} | ${pc(c.cagr)} | ${pc(c.dd, 0)} | ${mult(c.mult)} | ${c.trades} | ${c.on ? 'yes' : 'no'} |`); }
  L.push('');
  for(const k of keys){ L.push(`**${R[k].s.name} trades on PAXG:** ` + (dc[k].log.map(t=>`${t.date} @ ${Math.round(t.px)} → ${t.out ? `${t.out} @ ${Math.round(t.outPx)}` : `open (${Math.round(t.outPx)})`} ${pc(t.ret)}`).join(' · ') || 'none'), ''); }
  fs.writeFileSync(OUT, L.join('\n') + '\n');
  return { D, R, dc, decMar };
}

// PARITY: the engine (detector.js, strategy 'gold') against this lab on PAXG ALONE, as the app sees it: monthly
// averages of PAXG's whole months only, a decision at each month's last daily close. 1d and 4h must agree.
async function parity(){
  const SMC = require('../../detector.js'), D = loadData(), p = { n: SMC.DEFAULTS.goldMonths, e: SMC.DEFAULTS.goldER };
  const days = D.paxgD, pm = monthlyAvg(days), months = [...pm.keys()].sort();
  const DD = { months, A: months.map(k=>pm.get(k)) }, st = {}, sig = new Map();
  for(let i = 0; i < months.length; i++) sig.set(months[i], STRATS.effic.sig(i, DD, st, p));
  const lab = []; let on = 0, open = null;
  for(let j = 0; j < days.length; j++){
    const d = days[j], nxt = days[j+1]; if(!nxt || ym(nxt.t) === ym(d.t)) continue;
    const want = sig.get(ym(d.t)) ?? on;
    if(want && !on) open = { in: d.t, px: d.c };
    if(!want && on){ lab.push({ ...open, out: d.t, outPx: d.c }); open = null; }
    on = want;
  }
  if(open) lab.push({ ...open, out: null });
  const toC = (k)=> k.map(x=>({ time: Math.floor(x.t/1000), open: x.o, high: x.h, low: x.l, close: x.c }));
  const day = (t)=> new Date(t*1000).toISOString().slice(0, 10);
  const eng = (cs)=> SMC.detectAll(cs, { strategy: 'gold', longOnly: true }).trades.map(t=>({ in: day(cs[t.entryIdx].time), px: t.entry,
    out: t.outcome === 'open' ? null : day(cs[t.exitIdx].time), outPx: t.outcome === 'open' ? null : t.exitPrice }));
  const c1 = toC(days), e1 = eng(c1);
  let h4 = [], start = days[0].t;
  for(;;){ const r = await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=PAXGUSDT&interval=4h&limit=1000&startTime=${start}`);
    const k = await r.json(); if(!k.length) break; h4 = h4.concat(k.map(x=>({ t: x[0], o: +x[1], h: +x[2], l: +x[3], c: +x[4], closeT: x[6] })));
    start = k[k.length-1][0] + 1; if(k.length < 1000) break; }
  h4 = h4.filter(x=>x.closeT < Date.now() && x.t < days[days.length-1].t + 86400e3);
  const e4 = eng(toC(h4));
  const L = lab.map(t=>({ in: new Date(t.in).toISOString().slice(0,10), px: t.px, out: t.out ? new Date(t.out).toISOString().slice(0,10) : null, outPx: t.out ? t.outPx : null }));
  const same = (a, b)=> a.length === b.length && a.every((t, i)=> t.in === b[i].in && Math.abs(t.px - b[i].px) < 1e-9 && t.out === b[i].out && (t.out == null || Math.abs(t.outPx - b[i].outPx) < 1e-9));
  const show = (xs)=> xs.map(t=>`${t.in}@${Math.round(t.px)}→${t.out ? t.out + '@' + Math.round(t.outPx) : 'open'}`).join(' | ');
  console.log('lab  :', show(L)); console.log('1d   :', show(e1)); console.log('4h   :', show(e4));
  // the 4h series is cut to PAXG's 4h history, which starts with the daily one
  console.log(same(L, e1) ? 'PARITY 1d: engine = lab, trade for trade' : 'PARITY 1d: MISMATCH');
  console.log(same(e1, e4) ? 'PARITY 4h: 4h = 1d, trade for trade' : 'PARITY 4h: MISMATCH');
}

// REAL DAILY GOLD: the shipped engine on the app's own XAUUSD file (data/xauusd_1d.csv, Dukascopy, 2003-), marked to
// market every day, against holding gold; and 1w / 1M charts (fed the days, as the app does) must trade like 1d.
function xauCheck(){
  const SMC = require('../../detector.js'), f = path.join(__dirname, '..', '..', 'data', 'xauusd_1d.csv');
  if(!fs.existsSync(f)) return null;
  const c = fs.readFileSync(f, 'utf8').trim().split('\n').slice(1).map((l)=>{ const [d, o, h, lo, cl] = l.split(',');
    return { time: Date.parse(d + 'T00:00:00Z') / 1000, open: +o, high: +h, low: +lo, close: +cl, volume: 0 }; });
  const agg = (tf)=>{ const out = [];
    for(const d of c){ const t = new Date(d.time * 1000), k = tf === '1w' ? d.time - ((t.getUTCDay() + 6) % 7) * 86400 : Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1) / 1000;
      const cur = out[out.length - 1]; if(!cur || cur.time !== k) out.push({ ...d, time: k }); else { cur.high = Math.max(cur.high, d.high); cur.low = Math.min(cur.low, d.low); cur.close = d.close; } }
    return out; };
  const run = (cs, daily)=> SMC.detectAll(cs, { strategy: 'gold', longOnly: true, goldDaily: daily || null }).trades;
  const T = run(c), W = run(agg('1w'), c), Mo = run(agg('1M'), c);
  const sig = (ts)=> ts.map((t)=> `${t.entry.toFixed(3)}>${t.outcome === 'open' ? 'open' : t.exitPrice.toFixed(3)}`).join('|');
  // equity on the daily closes: all-in while a trade is open, 0.1% a side, cash earns 0
  const at = new Map(c.map((x, i)=>[x.time, i]));
  let eq = 1, peak = 1, dd = 0, inDays = 0; const ent = new Set(T.map((t)=>t.entryIdx)), ext = new Set(T.filter((t)=>t.outcome !== 'open').map((t)=>t.exitIdx));
  let on = false;
  for(let i = 1; i < c.length; i++){
    if(on){ eq *= c[i].close / c[i-1].close; inDays++; }
    if(ent.has(i)){ on = true; eq *= 1 - FEE; }
    if(ext.has(i) && on){ on = false; eq *= 1 - FEE; }
    peak = Math.max(peak, eq); dd = Math.min(dd, eq / peak - 1);
  }
  let bh = 1, bp = 1, bdd = 0; for(let i = 1; i < c.length; i++){ bh *= c[i].close / c[i-1].close; bp = Math.max(bp, bh); bdd = Math.min(bdd, bh / bp - 1); }
  const yrs = (c[c.length-1].time - c[0].time) / (365.25 * 86400);
  const day = (t)=> new Date(t * 1000).toISOString().slice(0, 10);
  return { from: day(c[0].time), to: day(c[c.length-1].time), days: c.length, yrs, trades: T.map((t)=>({ in: day(c[t.entryIdx].time), entry: t.entry,
      out: t.outcome === 'open' ? null : day(c[t.exitIdx].time), exit: t.exitPrice, ret: t.exitPrice / t.entry - 1 })),
    mult: eq, cagr: Math.pow(eq, 1 / yrs) - 1, dd, inMkt: inDays / (c.length - 1),
    bh: { mult: bh, cagr: Math.pow(bh, 1 / yrs) - 1, dd: bdd }, sameW: sig(W) === sig(T), sameM: sig(Mo) === sig(T), nW: W.length, nM: Mo.length };
}

module.exports = { loadData, STRATS, positions, evaluate, study, placebo, dailyCheck, fetchAll, monthlyAvg, parity, xauCheck, IS, OOS };
if(require.main === module && process.argv[2] === 'parity'){ parity().catch(e=>{ console.error(e); process.exit(1); }); }
else if(require.main === module && process.argv[2] === 'xau'){
  const x = xauCheck(); if(!x){ console.log('no data/xauusd_1d.csv'); process.exit(1); }
  console.log(`XAUUSD daily ${x.from} → ${x.to} (${x.days} days, ${x.yrs.toFixed(1)} yrs)`);
  for(const t of x.trades) console.log(`  ${t.in} @ ${t.entry.toFixed(2)} → ${t.out ? t.out + ' @ ' + t.exit.toFixed(2) : 'open (' + t.exit.toFixed(2) + ')'}  ${(t.ret*100).toFixed(1)}%`);
  console.log(`gold system: ×${x.mult.toFixed(2)}  CAGR ${(x.cagr*100).toFixed(1)}%  max DD (daily) ${(x.dd*100).toFixed(1)}%  in gold ${(x.inMkt*100).toFixed(0)}% of days`);
  console.log(`holding gold: ×${x.bh.mult.toFixed(2)}  CAGR ${(x.bh.cagr*100).toFixed(1)}%  max DD (daily) ${(x.bh.dd*100).toFixed(1)}%`);
  console.log(`1w chart = 1d trades: ${x.sameW} (${x.nW}) · 1M chart = 1d trades: ${x.sameM} (${x.nM})`);
}
else if(require.main === module){
  (async()=>{
    await fetchAll(process.argv.includes('--refresh'));
    const { D, R } = main();
    const keys = ['bh', 'sma10', 'mom12', 'season', 'anchor', 'dollar', 'breakout', 'effic'];
    console.log(`months ${D.months[0]} → ${D.months[D.months.length-1]} (World Bank to ${D.lastWB}, FX to ${D.lastFX})`);
    for(const k of keys){ const r = R[k], p = r.pick;
      console.log(`${r.s.name.padEnd(36)} ${(r.s.label ? r.s.label(p.p) : '').padEnd(34)} IS cagr ${pc(p.is.cagr)} dd ${pc(p.is.dd,0)} mar ${f2(p.is.mar)} | OOS cagr ${pc(p.oos.cagr)} dd ${pc(p.oos.dd,0)} mar ${f2(p.oos.mar)} in ${Math.round(p.oos.inMkt*100)}% tr ${p.oos.trades} | medOOS ${f2(r.medOos)}`); }
    console.log('wrote', OUT);
  })().catch(e=>{ console.error(e); process.exit(1); });
}
