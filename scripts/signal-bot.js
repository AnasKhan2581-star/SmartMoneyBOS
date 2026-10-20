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
 * Channels are all optional and all additive; whichever secrets exist get used.
 *   NTFY_TOPIC (+ optional NTFY_SERVER)  — easiest phone push, no account
 *   TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
 *   DISCORD_WEBHOOK
 *   GITHUB_TOKEN + GITHUB_REPOSITORY    — opens an issue; GitHub's mobile app pushes it
 * With none set it prints to stdout and exits 0, which is also what --dry-run forces.
 *
 *   node scripts/signal-bot.js [--dry-run] [--selftest] [--state <path>] [--watch <path>] [--fixture <path>]
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
// --fixture replays saved candles instead of fetching: lets a scenario be reproduced exactly,
// which is how the buy/sell transitions are tested without a live market.
const FIXTURE = argOf('--fixture', null);
const SELFTEST = has('--selftest');
const STATE_PATH = path.resolve(argOf('--state', path.join(ROOT, 'signals', 'state.json')));
const WATCH_PATH = path.resolve(argOf('--watch', path.join(ROOT, 'signals', 'watchlist.json')));

const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };

const ENDPOINTS = ['https://api.binance.com', 'https://data-api.binance.vision'];
const TF_MS = { '15m': 9e5, '30m': 18e5, '1h': 36e5, '2h': 72e5, '4h': 144e5, '1d': 864e5 };

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

function buyMessage(w, c, trade, advice) {
  const lb = advice.lb || {}, reg = (advice.regime || {}).state || 'UNKNOWN';
  const coin = w.symbol.replace(/USDT$/, '');
  return {
    title: `BUY ${coin} ${w.tf}`,
    body: [
      `Liquidity Breakout triggered at ${fmtPx(trade.entry)}`,
      `Bar closed ${fmtDay(c[trade.entryIdx].time)}`,
      ``,
      `Initial stop  ${fmtPx(trade.stop)}`,
      lb.trailLow ? `Trail exit    close below ${fmtPx(lb.trailLow)} (1-day low)` : null,
      lb.breakHigh ? `Took the pool above ${fmtPx(lb.breakHigh)} on ${lb.relVol}x volume` : null,
      ``,
      `BTC regime: ${reg}${reg === 'BEAR' ? ' — the system is weakest here, size down' : ''}`,
    ].filter((x) => x !== null).join('\n'),   // '' is a deliberate blank line, don't filter it out
    tag: 'buy',
  };
}
function sellMessage(w, c, trade) {
  const coin = w.symbol.replace(/USDT$/, '');
  const pc = (trade.exitPrice / trade.entry - 1) * 100;
  const why = trade.targetPool === 'STOP' ? 'stop hit' : trade.targetPool === 'TRAIL' ? 'trailed out below the 1-day low' : String(trade.targetPool || '').toLowerCase();
  return {
    title: `SELL ${coin} ${w.tf}  ${pc >= 0 ? '+' : ''}${pc.toFixed(1)}%`,
    body: [
      `Liquidity Breakout exited at ${fmtPx(trade.exitPrice)} — ${why}`,
      `Bar closed ${fmtDay(c[trade.exitIdx].time)}`,
      ``,
      `Entered ${fmtPx(trade.entry)} on ${fmtDay(c[trade.entryIdx].time)}`,
      `Result  ${pc >= 0 ? '+' : ''}${pc.toFixed(1)}%  (${trade.rr >= 0 ? '+' : ''}${trade.rr}R)`,
    ].join('\n'),
    tag: pc >= 0 ? 'win' : 'loss',
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
  if (E.GITHUB_TOKEN && E.GITHUB_REPOSITORY) {
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
  const watch = readJSON(WATCH_PATH, null);
  if (!watch || !Array.isArray(watch.watch) || !watch.watch.length) {
    console.error(`no watchlist at ${WATCH_PATH}`); process.exit(1);
  }
  const state = readJSON(STATE_PATH, {});
  let changed = false, alerts = 0;

  for (const w of watch.watch) {
    const key = `${w.symbol}|${w.tf}|${w.strategy || 'liqbrk'}`;
    try {
      const bars = w.bars || 4500;
      const c = FIXTURE ? readJSON(path.resolve(FIXTURE), [])
              : SELFTEST ? syntheticKlines(w.symbol, bars, w.__drift != null ? w.__drift : 0.0015)
              : await fetchKlines(w.symbol, w.tf, bars);
      if (c.length < 300) { console.log(`${key}: only ${c.length} closed bars — skipped`); continue; }

      const res = SMC.detectAll(c, { strategy: w.strategy || 'liqbrk', longOnly: true, useLiq: false });
      const open = res.trades.filter((t) => t.outcome === 'open').slice(-1)[0] || null;
      const closed = res.trades.filter((t) => t.outcome !== 'open');
      const last = closed.length ? closed[closed.length - 1] : null;
      const cur = { inPosition: !!open, entryTime: open ? c[open.entryIdx].time : null,
                    lastBar: c[c.length - 1].time };
      const prev = state[key];

      if (!prev) {
        // First sighting: record, stay quiet. Announcing a position opened weeks ago is noise.
        console.log(`${key}: first run — baseline recorded (${cur.inPosition ? 'already long' : 'flat'})`);
      } else if (prev.inPosition && !cur.inPosition) {
        if (last) { await notify(sellMessage(w, c, last)); alerts++; }
      } else if (!prev.inPosition && cur.inPosition) {
        await notify(buyMessage(w, c, open, res.advice)); alerts++;
      } else if (prev.inPosition && cur.inPosition && prev.entryTime !== cur.entryTime) {
        // a close and a re-entry both landed between two runs — report both, in order
        if (last) { await notify(sellMessage(w, c, last)); alerts++; }
        await notify(buyMessage(w, c, open, res.advice)); alerts++;
      } else {
        console.log(`${key}: no change (${cur.inPosition ? 'holding' : 'flat'})`);
      }
      if (!prev || prev.inPosition !== cur.inPosition || prev.entryTime !== cur.entryTime || prev.lastBar !== cur.lastBar) {
        state[key] = cur; changed = true;
      }
    } catch (e) {
      console.error(`${key}: ${e.message}`);
      process.exitCode = 1;                       // a failed fetch must not look like "no signal"
    }
  }

  if (changed && !DRY) {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
    console.log(`\nstate written to ${STATE_PATH}`);
  }
  console.log(`\n${alerts} alert(s) this run.`);
})();
