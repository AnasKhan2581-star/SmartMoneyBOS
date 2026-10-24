#!/usr/bin/env node
/*
 * signal-bot — buy/sell alerts for `liqbrk` that reach you with the browser closed.
 *
 * Runs detector.js (the same engine the webapp uses — there is no second copy of the rules)
 * against freshly fetched Binance klines, compares the result to the state of the previous
 * run, and pushes a message only when the position actually FLIPS. No flip, no message.
 *
 * Two details that decide whether this works or just spams you:
 *
 *  1. THE FORMING CANDLE IS DROPPED. Binance returns the in-progress bar as the last element.
 *     The webapp keeps it (you want to see live price on a chart), but a bot must not: a
 *     breakout that is true mid-bar and false by the close would alert and then un-alert.
 *     Only bars whose closeTime has passed are fed to the engine.
 *
 *  2. STATE IS PERSISTED between runs (signals/state.json, committed by the workflow).
 *     Without it every run would re-announce a position opened days ago. On the FIRST run for
 *     a watch item the state is recorded silently — you are not told about history.
 *
 *  3. liqbrk's MARKET GATE needs BTC (Oct 2026: enter only while BTC > its 50-day MA, or the coin
 *     is a +50%/30d leader). BTC is fetched once per timeframe with 51 days of extra history so
 *     its MA is warm. If that fetch fails the watch items on that timeframe are SKIPPED with an
 *     error — an alert computed without the gate would be a trade the rules never take.
 *     It also SELLS HALF at +3R: that is its own alert ("TAKE HALF"), sent once per position.
 *
 *  4. A RULES CHANGE re-baselines. State carries the rules version; when it differs, the new
 *     rules' view is recorded, and if it disagrees with what the old rules said (long vs flat)
 *     you get one "rules updated" note instead of a fake BUY or SELL.
 *
 * Channels are all optional and all additive; whichever secrets exist get used.
 *   NTFY_TOPIC (+ optional NTFY_SERVER)  — easiest phone push, no account
 *   TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
 *   DISCORD_WEBHOOK
 *   GITHUB_TOKEN + GITHUB_REPOSITORY    — FALLBACK ONLY: opens an issue (GitHub's mobile app
 *                                         pushes it), and only when no channel above is set
 * With none set it prints to stdout and exits 0, which is also what --dry-run forces.
 *
 *   node scripts/signal-bot.js [--dry-run] [--selftest] [--ping]
 *                              [--state <path>] [--watch <path>] [--fixture <path>]
 *
 * --ping sends a test message through every configured channel and exits, so a new channel can
 * be verified immediately instead of waiting for a real trade.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const SMC = require(path.join(__dirname, '..', 'detector.js'));

const ROOT = path.join(__dirname, '..');
const ARGS = process.argv.slice(2);
const has = (f) => ARGS.includes(f);
const argOf = (f, d) => { const i = ARGS.indexOf(f); return i >= 0 && ARGS[i + 1] ? ARGS[i + 1] : d; };

const DRY = has('--dry-run') || has('--selftest');
const PING = has('--ping');   // send a test message through every configured channel, then exit
// --fixture replays saved candles instead of fetching: lets a scenario be reproduced exactly,
// which is how the buy/sell transitions are tested without a live market.
const FIXTURE = argOf('--fixture', null);
const SELFTEST = has('--selftest');
const STRAT_NAME = { liqbrk:'Liquidity Breakout', cycle:'BTC Cycle', tsmom:'Trend Follow', donch:'Turtle' };

const STATE_PATH = path.resolve(argOf('--state', path.join(ROOT, 'signals', 'state.json')));
const WATCH_PATH = path.resolve(argOf('--watch', path.join(ROOT, 'signals', 'watchlist.json')));

const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };

const ENDPOINTS = ['https://api.binance.com', 'https://data-api.binance.vision'];
const TF_MS = { '15m': 9e5, '30m': 18e5, '1h': 36e5, '2h': 72e5, '4h': 144e5, '1d': 864e5 };
// bump when the trading rules change, so stored positions are re-read under the new rules (note 4)
const RULES = 'liqbrk-2026-10-btc50-lead50-scale3R';
// Fallback only, for a state file with no _meta.lastRun yet. The real "fresh" test uses the time of the
// previous persisted run, because GitHub's scheduler runs late and irregularly (measured Oct 2026: a
// 2-hourly cron actually fired every 5-6 hours), so "the latest N candles" is not a safe proxy.
const RUN_EVERY_MS = 2 * 36e5;

// ---------- data ----------------------------------------------------------
async function fetchKlines(symbol, interval, total) {
  let out = [], endTime;
  while (out.length < total) {
    const limit = Math.min(1000, total - out.length);
    const qs = `symbol=${symbol}&interval=${interval}&limit=${limit}` + (endTime ? `&endTime=${endTime}` : '');
    let rows = null, err = null;
    for (const base of ENDPOINTS) {
      try {
        const r = await fetch(`${base}/api/v3/klines?${qs}`);
        if (!r.ok) { err = `${base} HTTP ${r.status}`; continue; }
        rows = await r.json(); break;
      } catch (e) { err = `${base}: ${e.message}`; }
    }
    if (!rows) throw new Error(err || 'fetch failed');
    if (!rows.length) break;
    out = rows.concat(out);
    endTime = rows[0][0] - 1;
    if (rows.length < limit) break;
  }
  const now = Date.now();
  const seen = new Set();
  return out
    .filter((k) => k[6] <= now)                       // CLOSED bars only — see note 1 above
    .map((k) => ({ time: Math.floor(k[0] / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] }))
    .filter((c) => !seen.has(c.time) && seen.add(c.time))
    .sort((a, b) => a.time - b.time);
}

// deterministic synthetic bars so the whole pipeline can be exercised with no network
function syntheticKlines(symbol, n, drift) {
  let seed = [...symbol].reduce((a, ch) => a + ch.charCodeAt(0), 0) || 1;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const out = []; let px = 10, t = Math.floor(Date.now() / 1000) - n * 7200;
  for (let i = 0; i < n; i++) {
    px *= 1 + drift + Math.sin(i / 150) * 0.006 + (rnd() - 0.5) * 0.035;
    const hi = px * (1 + rnd() * 0.02), lo = px * (1 - rnd() * 0.02);
    out.push({ time: t, open: px, high: hi, low: lo, close: px, volume: 400 + rnd() * 3000 });
    t += 7200;
  }
  return out;
}

// ---------- formatting ----------------------------------------------------
const fmtPx = (x) => x == null || !isFinite(x) ? '—'
  : x >= 1000 ? Math.round(x).toLocaleString() : x >= 1 ? x.toFixed(2) : x >= 0.01 ? x.toFixed(4) : x.toPrecision(3);
const fmtDay = (sec) => new Date(sec * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

function gateLine(lb) {
  const g = lb.btcGate;
  if (!g) return null;
  if (g.missing) return 'Market gate: BTC data missing — gate skipped';
  return g.btcOk ? `Market gate: BTC above its ${g.maDays}-day MA`
    : `Market gate: BTC below its ${g.maDays}-day MA — allowed as a 30-day leader (+${Math.round(g.leadPump * 100)}%)`;
}
// 2h vs 4h on the same coin (measured Oct 2026, 32 coins, full history, shipped rules): a 2h buy
// is followed by a 4h buy within 24h only 42% of the time, and 37% of 4h buys have no 2h buy before
// them — so 2h is a heads-up and 4h is the trade. 2h buys that a 4h buy followed averaged +4.9%,
// unconfirmed ones +1.7%: a 4h buy with a recent 2h buy is the strongest case.
// `pair` = { other: true if this coin is also watched on the other TF, recent2h: 2h bought ≤ 24h ago }
function pairLine(w, pair) {
  if (!pair || !pair.other) return null;
  if (w.tf === '2h') return 'Heads-up, not the trade: 42% of 2h buys turn into a 4h buy within 24h. Act on the 4h alert.';
  if (w.tf === '4h') return pair.recent2h ? 'Confirmed by a 2h buy in the last 24h — the strongest setup (2h buys a 4h buy followed averaged +4.9%, vs +1.7% without).'
    : 'No 2h buy before this one — still a valid 4h trade (37% of them come without warning).';
  return null;
}
function buyMessage(w, c, trade, advice, btcReg, pair) {
  const lb = advice.lb || {};
  const coin = w.symbol.replace(/USDT$/, '');
  const name = STRAT_NAME[w.strategy || 'liqbrk'] || (w.strategy || 'liqbrk');
  const tag = pair && pair.other ? (w.tf === '2h' ? '  (heads-up)' : w.tf === '4h' ? '  (trade)' : '') : '';
  return {
    title: `BUY ${coin} ${w.tf}${tag}`,
    body: [
      ...(pairLine(w, pair) ? [pairLine(w, pair), ''] : []),
      `${name} triggered at ${fmtPx(trade.entry)}`,
      `Bar closed ${fmtDay(c[trade.entryIdx].time)}`,
      ``,
      `Initial stop  ${fmtPx(trade.stop)}`,
      trade.tp ? `Take half     at ${fmtPx(trade.tp)} (+${lb.scaleR || 3}R) — separate alert when hit` : null,
      lb.trailLow ? `Trail exit    close below ${fmtPx(lb.trailLow)} (1-day low)` : null,
      lb.breakHigh ? `Took the pool above ${fmtPx(lb.breakHigh)} on ${lb.relVol}x volume` : null,
      gateLine(lb),
      btcReg ? `` : null,                  // drop the separator too, or the message ends blank
      // The regime that matters is BTC's own 200d MA — pooled across 10 symbols it separates
      // PF 1.71 from 1.00 (ALGORITHM.md). A coin's own MA was never shown to do that, so this
      // line is BTC's read or it is omitted; labelling the coin's own regime "BTC" was a lie.
      btcReg ? `BTC regime: ${btcReg}${btcReg === 'BEAR' ? ' — the system is weakest here, size down' : ''}` : null,
    ].filter((x) => x !== null).join('\n'),   // '' is a deliberate blank line, don't filter it out
    tag: 'buy',
  };
}
function sellMessage(w, c, trade) {
  const coin = w.symbol.replace(/USDT$/, '');
  const pc = (trade.exitPrice / trade.entry - 1) * 100;
  const name = STRAT_NAME[w.strategy || 'liqbrk'] || (w.strategy || 'liqbrk');
  const why = trade.targetPool === 'STOP' ? 'stop hit' : trade.targetPool === 'TRAIL' ? 'trailed out below the 1-day low' : String(trade.targetPool || '').toLowerCase();
  const rest = trade.exitRest != null ? trade.exitRest : trade.exitPrice;
  return {
    title: `SELL ${coin} ${w.tf}  ${pc >= 0 ? '+' : ''}${pc.toFixed(1)}%`,
    body: [
      `${name} exited ${trade.scale ? 'the remaining half ' : ''}at ${fmtPx(rest)} — ${why}`,
      `Bar closed ${fmtDay(c[trade.exitIdx].time)}`,
      ``,
      `Entered ${fmtPx(trade.entry)} on ${fmtDay(c[trade.entryIdx].time)}`,
      trade.scale ? `First half sold at ${fmtPx(trade.scale.px)} on ${fmtDay(c[trade.scale.idx].time)}` : null,
      `Result  ${pc >= 0 ? '+' : ''}${pc.toFixed(1)}%  (${trade.rr >= 0 ? '+' : ''}${trade.rr}R)${trade.scale ? ' — both halves' : ''}`,
    ].filter((x) => x !== null).join('\n'),
    tag: pc >= 0 ? 'win' : 'loss',
  };
}

function halfMessage(w, c, trade) {
  const coin = w.symbol.replace(/USDT$/, '');
  const pc = (trade.scale.px / trade.entry - 1) * 100;
  return {
    title: `TAKE HALF ${coin} ${w.tf}  +${pc.toFixed(1)}%`,
    body: [
      `Sell half at ${fmtPx(trade.scale.px)} (+3R target reached)`,
      `Bar ${fmtDay(c[trade.scale.idx].time)}`,
      ``,
      `Entered ${fmtPx(trade.entry)} on ${fmtDay(c[trade.entryIdx].time)}`,
      `The other half stays on: stop ${fmtPx(trade.stop)}, trail = close below the 1-day low`,
    ].join('\n'),
    tag: 'win',
  };
}
// A position the bot never announced (it was already open when the coin was added, or when the alert
// was set up). Sent ONCE so no open trade is ever silent — framed as late, not as a fresh BUY.
function openMessage(w, c, trade, advice) {
  const lb = (advice && advice.lb) || {};
  const coin = w.symbol.replace(/USDT$/, '');
  const now = c[c.length - 1].close, R = trade.entry - trade.stop, inR = R > 0 ? (now - trade.entry) / R : 0;
  const hrs = (c[c.length - 1].time - c[trade.entryIdx].time) / 3600;
  const ago = hrs >= 48 ? `${Math.round(hrs / 24)} days` : `${Math.round(hrs)} hours`;
  const pc = (now / trade.entry - 1) * 100;
  return {
    title: `OPEN TRADE ${coin} ${w.tf}  ${pc >= 0 ? '+' : ''}${pc.toFixed(1)}% (started before this alert)`,
    body: [
      `Liquidity Breakout has been long since ${fmtDay(c[trade.entryIdx].time)} (${ago} ago)`,
      `Entry ${fmtPx(trade.entry)} · now ${fmtPx(now)} (${inR >= 0 ? '+' : ''}${inR.toFixed(1)}R)`,
      ``,
      `Stop          ${fmtPx(trade.stop)}`,
      trade.scale ? `Half already sold at ${fmtPx(trade.scale.px)}` : trade.tp ? `Take half     at ${fmtPx(trade.tp)} (+3R)` : null,
      lb.trailLow ? `Trail exit    close below ${fmtPx(lb.trailLow)} (1-day low)` : null,
      ``,
      inR <= 1 ? 'Still within 1R of the entry — joining now is close to the system\'s own trade.'
               : 'Already well past the entry — joining now takes more risk than the system did; usually better to wait for the next BUY.',
      'You will get TAKE HALF / SELL for this position as normal.',
    ].filter((x) => x !== null).join('\n'),
    tag: 'buy',
  };
}
function rulesMessage(w, cur) {
  const coin = w.symbol.replace(/USDT$/, '');
  return {
    title: `Rules updated — ${coin} ${w.tf}`,
    body: [
      'liqbrk now also requires BTC above its 50-day MA (or the coin up 50%+ in 30 days)',
      'and sells half at +3R.',
      '',
      cur.inPosition ? `Under the new rules this coin is LONG since ${fmtDay(cur.entryTime)}.`
        : 'Under the new rules this coin is FLAT — the old rules had it long.',
      'No trade happened just now; this only re-reads the position.',
    ].join('\n'),
    tag: 'win',
  };
}

// ---------- channels ------------------------------------------------------
async function post(url, opts, label) {
  try {
    const r = await fetch(url, opts);
    if (!r.ok) console.error(`  ${label}: HTTP ${r.status} ${(await r.text()).slice(0, 120)}`);
    else console.log(`  ${label}: sent`);
  } catch (e) { console.error(`  ${label}: ${e.message}`); }
}
async function notify(msg) {
  const E = process.env;
  console.log(`\n=== ${msg.title} ===\n${msg.body}\n`);
  if (DRY) { console.log('  (dry run — nothing sent)'); return; }
  let any = false;
  if (E.NTFY_TOPIC) {
    any = true;
    await post(`${E.NTFY_SERVER || 'https://ntfy.sh'}/${E.NTFY_TOPIC}`,
      { method: 'POST', headers: { Title: msg.title, Priority: msg.tag === 'buy' ? 'high' : 'default',
        Tags: msg.tag === 'buy' ? 'green_circle' : msg.tag === 'win' ? 'white_check_mark' : 'red_circle' },
        body: msg.body }, 'ntfy');
  }
  if (E.TELEGRAM_BOT_TOKEN && E.TELEGRAM_CHAT_ID) {
    any = true;
    await post(`https://api.telegram.org/bot${E.TELEGRAM_BOT_TOKEN}/sendMessage`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: E.TELEGRAM_CHAT_ID, text: `*${msg.title}*\n\`\`\`\n${msg.body}\n\`\`\``, parse_mode: 'Markdown' }) },
      'telegram');
  }
  if (E.DISCORD_WEBHOOK) {
    any = true;
    await post(E.DISCORD_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: `**${msg.title}**\n\`\`\`\n${msg.body}\n\`\`\`` }) }, 'discord');
  }
  // GitHub issues are the FALLBACK, not a parallel channel: once a real one is configured,
  // opening an issue per signal just leaves a pile of tickets to close.
  if (!any && E.GITHUB_TOKEN && E.GITHUB_REPOSITORY) {
    any = true;
    await post(`https://api.github.com/repos/${E.GITHUB_REPOSITORY}/issues`,
      { method: 'POST', headers: { Authorization: `Bearer ${E.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json' },
        body: JSON.stringify({ title: msg.title, body: '```\n' + msg.body + '\n```', labels: ['signal'] }) },
      'github issue');
  }
  if (!any) console.log('  (no channel configured — see signals/README.md)');
}

// ---------- main ----------------------------------------------------------
(async () => {
  if (PING) {
    await notify({ title: 'ScreenerPro signal bot connected',
      body: ['This is a test message — no trade has happened.',
             '',
             'If you can read this, alerts will reach you here when',
             'Liquidity Breakout opens or closes a position.',
             `Sent ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`].join('\n'),
      tag: 'win' });
    return;
  }
  const watch = readJSON(WATCH_PATH, null);
  if (!watch || !Array.isArray(watch.watch) || !watch.watch.length) {
    console.error(`no watchlist at ${WATCH_PATH}`); process.exit(1);
  }
  const state = readJSON(STATE_PATH, {});
  let changed = false, alerts = 0;

  // One extra fetch per run buys a regime line that is actually BTC's.
  const btcRegime = async (tf) => {
    if (SELFTEST || FIXTURE) return null;
    try {
      const c = await fetchKlines('BTCUSDT', tf, 2500);
      const r = SMC.detectAll(c, { strategy: 'liqbrk', longOnly: true, useLiq: false });
      return ((r.advice || {}).regime || {}).state || null;
    } catch (e) { return null; }              // a missing regime line beats a wrong one
  };
  const regimeByTf = {};

  // BTC for liqbrk's market gate — one fetch per timeframe, deep enough for the 50-day MA
  const btcByTf = {};
  const btcFor = async (tf, bars) => {
    if (SELFTEST || FIXTURE) return null;      // offline modes run with the gate skipped (flagged)
    const extra = Math.ceil(51 * 86400e3 / (TF_MS[tf] || 864e5));
    const want = bars + extra;
    const hit = btcByTf[tf];
    if (hit && hit.bars >= want) return hit.c;
    const c = await fetchKlines('BTCUSDT', tf, want);   // throws -> caller skips the item
    btcByTf[tf] = { bars: want, c };
    return c;
  };

  // 2h before 4h, so a 4h buy can see whether the same coin's 2h bought first (pairLine)
  const TF_RANK = { '15m': 0, '30m': 1, '1h': 2, '2h': 3, '4h': 4, '1d': 5 };
  const items = watch.watch.slice().sort((a, b) => (TF_RANK[a.tf] ?? 9) - (TF_RANK[b.tf] ?? 9));
  const pairOf = (w, entryTime) => {
    const strat = w.strategy || 'liqbrk', otherTf = w.tf === '2h' ? '4h' : w.tf === '4h' ? '2h' : null;
    if (!otherTf) return null;
    const other = items.some((x) => x.symbol === w.symbol && x.tf === otherTf && (x.strategy || 'liqbrk') === strat);
    const s2 = state[`${w.symbol}|2h|${strat}`];
    // compare CLOSE times: a 2h and a 4h signal on the same closing moment count as "with", not "before"
    const gap = s2 && s2.lastEntry && entryTime ? (entryTime + 4 * 3600) - (s2.lastEntry + 2 * 3600) : null;
    return { other, recent2h: gap != null && gap >= 0 && gap <= 24 * 3600 };
  };

  for (const w of items) {
    const key = `${w.symbol}|${w.tf}|${w.strategy || 'liqbrk'}`;
    try {
      const bars = w.bars || 4500;
      const c = FIXTURE ? readJSON(path.resolve(FIXTURE), [])
              : SELFTEST ? syntheticKlines(w.symbol, bars, w.__drift != null ? w.__drift : 0.0015)
              : await fetchKlines(w.symbol, w.tf, bars);
      if (c.length < 300) { console.log(`${key}: only ${c.length} closed bars — skipped`); continue; }

      const strat = w.strategy || 'liqbrk';
      let btc = null;
      if (strat === 'liqbrk') {
        try { btc = w.symbol === 'BTCUSDT' ? c : await btcFor(w.tf, bars); }
        catch (e) { throw new Error(`BTC fetch failed (${e.message}) — skipped, the market gate cannot be checked`); }
      }
      const res = SMC.detectAll(c, { strategy: strat, longOnly: true, useLiq: false, btc });
      if (!res.advice) {                      // runQuant bailed: fewer bars than the warm-up needs
        console.error(`${key}: ${c.length} bars is below the strategy's warm-up — this watch can `
          + `NEVER fire. Raise "bars" in the watchlist.`);
        process.exitCode = 1;
        continue;
      }
      const open = res.trades.filter((t) => t.outcome === 'open').slice(-1)[0] || null;
      const closed = res.trades.filter((t) => t.outcome !== 'open');
      const last = closed.length ? closed[closed.length - 1] : null;
      const cur = { inPosition: !!open, entryTime: open ? c[open.entryIdx].time : null,
                    scaled: !!(open && open.scale), lastBar: c[c.length - 1].time, rules: RULES,
                    lastEntry: res.trades.length ? c[res.trades[res.trades.length - 1].entryIdx].time : null };
      const prev = state[key];
      const rulesChanged = prev && prev.rules !== RULES;
      // "fresh" = entered on a candle that closed after the previous persisted run, i.e. a signal no run
      // has been able to report yet. `noted` = this exact position has been announced (BUY or OPEN TRADE).
      const lastRun = state._meta && state._meta.lastRun;
      const tfSec = (TF_MS[w.tf] || RUN_EVERY_MS) / 1000;
      const isFresh = (o) => !!o && (lastRun ? c[o.entryIdx].time + tfSec > lastRun
        : o.entryIdx >= c.length - Math.max(1, Math.ceil(RUN_EVERY_MS / (TF_MS[w.tf] || RUN_EVERY_MS))));
      let noted = !!(cur.inPosition && prev && prev.noted && prev.entryTime === cur.entryTime);

      // A STALE entry is as bad as no entry. Drop a coin from the watchlist, re-add it a month
      // later, and its old state is still here — comparing against it would announce a trade that
      // opened and maybe closed while nobody was watching. Treat a long gap as a fresh baseline.
      // 7 days, not "10 bars": on a 2h watch 10 bars is 20 hours, and a GitHub scheduler gap or
      // a short run of failed jobs would silently swallow a real flip. The case this guards
      // against — a coin removed and re-added — is a weeks-long gap, so give it weeks of room.
      const stale = prev && (cur.lastBar - prev.lastBar) > 7 * 86400;

      if (prev && !stale && rulesChanged) {
        // note 4: re-read under the new rules; speak only if long/flat actually changed
        console.log(`${key}: rules changed — re-baselined (${cur.inPosition ? 'long' : 'flat'} under the new rules)`);
        if (prev.inPosition !== cur.inPosition) { await notify(rulesMessage(w, cur)); alerts++; if (cur.inPosition) noted = true; }
      } else if (!prev || stale) {
        // First sighting. History stays quiet (no SELL for a trade that closed before you watched),
        // but an OPEN position is always announced: a FRESH entry as a normal BUY (add a coin at 10:30,
        // its breakout closes at 12:00, the next run still says BUY), an older one once as OPEN TRADE.
        const gapDays = stale ? ((cur.lastBar - prev.lastBar) / 86400).toFixed(0) : null;
        const fresh = isFresh(open);
        console.log(`${key}: ${stale ? `stale by ${gapDays}d — re-baselined` : 'first run — baseline recorded'}`
          + ` (${cur.inPosition ? (fresh ? 'fresh entry — BUY' : 'already long — OPEN TRADE note') : 'flat'})`);
        if (fresh) {
          if (!(w.tf in regimeByTf)) regimeByTf[w.tf] = await btcRegime(w.tf);
          await notify(buyMessage(w, c, open, res.advice, regimeByTf[w.tf], pairOf(w, c[open.entryIdx].time))); alerts++;
          noted = true;
        } else if (open) {
          await notify(openMessage(w, c, open, res.advice)); alerts++; noted = true;
        }
      } else if (prev.inPosition && !cur.inPosition) {
        // the half may have been taken AND the rest closed between two runs: say both
        if (last && last.scale && !prev.scaled) { await notify(halfMessage(w, c, last)); alerts++; }
        if (last) { await notify(sellMessage(w, c, last)); alerts++; }
      } else if (!prev.inPosition && cur.inPosition) {
        if (!(w.tf in regimeByTf)) regimeByTf[w.tf] = await btcRegime(w.tf);
        await notify(buyMessage(w, c, open, res.advice, regimeByTf[w.tf], pairOf(w, c[open.entryIdx].time))); alerts++;
        if (open.scale) { await notify(halfMessage(w, c, open)); alerts++; }
        noted = true;
      } else if (prev.inPosition && cur.inPosition && prev.entryTime !== cur.entryTime) {
        // a close and a re-entry both landed between two runs — report both, in order
        if (last && last.scale && !prev.scaled) { await notify(halfMessage(w, c, last)); alerts++; }
        if (last) { await notify(sellMessage(w, c, last)); alerts++; }
        if (!(w.tf in regimeByTf)) regimeByTf[w.tf] = await btcRegime(w.tf);
        await notify(buyMessage(w, c, open, res.advice, regimeByTf[w.tf], pairOf(w, c[open.entryIdx].time))); alerts++;
        if (open.scale) { await notify(halfMessage(w, c, open)); alerts++; }
        noted = true;
      } else if (cur.inPosition && !noted) {
        // a position recorded silently before OPEN TRADE notes existed — announce it once
        await notify(openMessage(w, c, open, res.advice)); alerts++; noted = true;
      } else if (prev.inPosition && cur.inPosition && !prev.scaled && cur.scaled) {
        await notify(halfMessage(w, c, open)); alerts++;
      } else {
        console.log(`${key}: no change (${cur.inPosition ? 'holding' : 'flat'})`);
      }
      cur.noted = noted;
      if (!prev || stale || rulesChanged || prev.inPosition !== cur.inPosition || prev.entryTime !== cur.entryTime
          || !!prev.scaled !== cur.scaled || prev.lastBar !== cur.lastBar || !!prev.noted !== noted) {
        state[key] = cur; changed = true;
      }
    } catch (e) {
      console.error(`${key}: ${e.message}`);
      process.exitCode = 1;                       // a failed fetch must not look like "no signal"
    }
  }

  // remembered so the next run can tell a never-reported entry from an old one (isFresh). Only written
  // alongside a real change, so a run that saw nothing new does not commit just to bump a timestamp.
  if (changed) state._meta = { lastRun: Math.floor(Date.now() / 1000) };
  if (changed && !DRY) {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
    console.log(`\nstate written to ${STATE_PATH}`);
  }
  console.log(`\n${alerts} alert(s) this run.`);
})();
