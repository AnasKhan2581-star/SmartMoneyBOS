# Signal bot — buy/sell alerts with the browser closed

`scripts/signal-bot.js` runs **the same `detector.js` engine the webapp uses** against fresh
Binance klines, and pushes a message only when a position actually flips. The GitHub Action in
`.github/workflows/signals.yml` runs it four times an hour (:07, :22, :37, :52 UTC), but GitHub often
starts scheduled runs hours late; see "Punctual alerts" below for an outside trigger.

There is no second copy of the strategy rules. If `ALGORITHM.md` changes, the alerts change.

**Every strategy can alert** (Nov 2026, user request). Each watch names its own: **Liquidity Breakout**
(`liqbrk`), **Trend Follow** (`tsmom`), **Turtle** (`donch`) or **BTC Cycle** (`cycle`). Titles name the
strategy (`BUY RAY 4h · Trend Follow`), except liqbrk's, which keep their original form (`BUY ARB 4h`).
Each message states its own strategy's exit, with today's levels:
- Liquidity Breakout: the stop, the **take-half price (+3R)**, the trail (a close below the 1-day low) and
  whether BTC's 50-day MA let it through (or the coin was a +50%/30-day leader).
- Trend Follow: **no stop**. It sells on a close under the 200-day MA or under the close 90 days back.
- Turtle: the stop (2×ATR) and the trail (a close below the 20-day low).
- BTC Cycle: the tranche plan, the stop (0.65 × the 200-week MA) and the sell zone.

**What you can receive:**
- **BUY** — a new position, with the exit lines above. Times are candle CLOSE times.
- **2h vs 4h on the same coin** — when a coin is watched on both, 2h BUYs are titled **(heads-up)** and
  4h BUYs **(trade)**. Only 42% of 2h buys become a 4h buy within 24h, and 37% of 4h buys come with no 2h
  warning, so 2h is a watch-this-coin note and 4h is the one to act on. A 4h BUY says whether a 2h buy
  preceded it — that combination was the strongest (2h buys a 4h buy followed averaged +4.9% vs +1.7%).
- **TAKE HALF** — liqbrk: price reached entry + 3R; BTC Cycle: a close in the sell zone. Sell half there;
  the other half stays on. Trend Follow and Turtle never sell half.
- **SELL** — the position (or its remaining half) closed; the result counts both halves.
- **OPEN TRADE** — sent once for a position the bot never announced: the coin was added while its strategy was
  already in a trade. It shows the entry, how long ago, the stop, take-half and trail levels, and whether price is still within
  1R of the entry (joining is then close to the system's own trade) or well past it. A trade entered on a candle that
  closed after the bot's previous run is not "old" — it comes as a normal BUY.
- **Rules updated** — sent once per coin, only when a rules change flips that coin between long and
  flat. No trade happened; the bot just re-read the position under the new rules.

The bot also fetches BTC on every run (one request set per timeframe) for the 50-day gate. If that
fetch fails, the coins on that timeframe are skipped with an error rather than alerted without the gate.

## Turn on a channel

With **no setup at all** you still get alerts: the bot opens a GitHub issue labelled `signal`,
and the GitHub mobile app pushes that to your phone. This is a *fallback* — configure any
channel below and the issues stop, so you are not left closing a ticket per signal. For anything better, add repo secrets at
*Settings → Secrets and variables → Actions*. Any combination works; all configured channels fire.

| Channel | Secrets | Setup |
|---|---|---|
| **ntfy** (easiest phone push) | `NTFY_TOPIC` | Install the ntfy app, subscribe to a topic name only you know, put that name in the secret. Optional `NTFY_SERVER` for self-hosting. |
| **Telegram** | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Full walkthrough below. |
| **Discord** | `DISCORD_WEBHOOK` | Channel → Edit → Integrations → Webhooks → New. |

A topic name is the only thing protecting an ntfy topic — pick something unguessable.

### Telegram, step by step

1. In Telegram, search **@BotFather** and send `/newbot`. Give it any display name, then a
   username ending in `bot`. BotFather replies with a token like `8123456789:AAH...`.
2. **Search your new bot by its @username, open it, and press Start.** Send it any message.
   This step is not optional — a Telegram bot cannot message a person who has never written
   to it first, and skipping it is why step 3 comes back empty.
3. Open `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` in a browser and find
   `"chat":{"id":123456789`. That number is your chat id.
4. Add both as repo secrets: `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.
5. Verify: **Actions → liqbrk signals → Run workflow**, tick **ping**. A test message should
   arrive within a few seconds.

**Never put the bot token in `index.html`.** The webapp is public — anyone reading the page
source would own the bot. Tokens belong in Actions secrets, which is why alerts are sent from
the workflow and not from the browser.

### Testing a channel

`--ping` sends a test message through every configured channel and exits, so you never have to
wait for a real trade to find out whether delivery works:

```bash
NTFY_TOPIC=my-topic node scripts/signal-bot.js --ping
```

From GitHub: **Actions → liqbrk signals → Run workflow → tick `ping`**. Note that `dry_run`
sends nothing at all, so use `ping` (not `dry_run`) when testing a channel.

## What it watches

`signals/watchlist.json`. **Easiest way to change it is the webapp's Alerts tab** — it reads the
live file from the repo, lets you add and remove rows, and either commits for you (if you save a
fine-grained token) or hands you the JSON to paste into GitHub's editor. Editing this file by hand
works exactly the same; nothing is hardcoded in the script.

```json
{ "symbol": "ARBUSDT", "tf": "2h", "bars": 4500, "strategy": "liqbrk" }
```

The Alerts tab keeps one collapsible list per strategy, each with its own add form (several coins at
once: `RAY, STX, AR`), the timeframes that strategy suits and a bar count past its warm-up:

| strategy | timeframes | default bars | at least |
| --- | --- | --- | --- |
| `liqbrk` | 15m, 1h, 2h, 4h, 1d | 4500 | 600 |
| `tsmom`, `donch` | 4h, 1d | 4500 on 4h, 1500 on 1d | 1500 on 4h, 400 on 1d (the 200-day MA comes first) |
| `cycle` | 1d | 3000 | 1500 (the 200-week MA needs ~1,400 days) |

`cycle` (BTC Cycle) is a daily system: on an intraday watch it acts on **finished UTC days only**, and on
alts it follows BTC's cycle (it fetches BTC's daily history for that). The 2h/4h heads-up pairing above
applies to liqbrk only; it was measured there. A watch with fewer bars than its strategy's warm-up can
never fire, and the bot reports it as an error on every run.

## The trading book — 5 slots and a journal

Your capital is treated as one book split into **5 equal slots**, shared by every strategy on your
lists. A BUY alert means "put one slot in": 20% of the book's value at that moment. Trend Follow and the
Cycle can hold for months, so a few of them can keep slots busy for a long time. The rules
(ALGORITHM.md, "The trading book"):

- A slot is **held** by a trade you marked **Taken**, and also by one the bot alerted that you
  have not answered yet, so a forgotten tap can never book the same money twice. **Skipped**
  frees the slot. Every slot frees again at the strategy's own SELL.
- **All 5 held → no alert.** The new signal is written to the journal only. When several
  signals compete for the free slots in one run, the one with higher relative volume wins.
- A position the bot first sees already open is alerted only if a slot is free **and** price is
  still within 1R of the entry. Otherwise it goes in the journal only.
- TAKE HALF and SELL alerts go only for trades that hold a slot. The rest are journal-only.
- Money not in a slot stays as plain USDT, so nothing has to be sold when the next BUY comes.

Three files, and **none of them holds any money**. Your capital figure lives only in your
browser.

| file | written by | holds |
| --- | --- | --- |
| `signals/book.json` | you | `slots` (5) and the date the journal started |
| `signals/journal.json` | the bot, every run | every signal: entry, stop, +3R target, half, exit, result, and why it was or wasn't alerted |
| `signals/decisions.json` | the web page | your answers: `{ "<id>": { "d": "taken" or "skipped", "at": "<time>" } }` |

An entry's id is `SYMBOL|tf|entryCandleOpenTime` for liqbrk (every id from before Nov 2026 has this form),
and the same with `|strategy` added for the others (`RAYUSDT|4h|1759550400|tsmom`), so two strategies
that enter one coin on the same candle never share an entry or an answer.

**Answering.** Open the Portfolio tab. Each alert you haven't answered shows a **Did you buy
it?** card with **Taken** and **Skipped** buttons. Taken records the signal's own price, so one
tap is enough. With a GitHub token saved in the Alerts tab, the tap commits
`decisions.json` for you. Without a token, the page keeps the answer in this browser (marked
`*`) and gives you the file's full text to paste into GitHub's editor. Until the bot reads your
answer, an unanswered alert keeps holding its slot.

A coin removed from a strategy's list while that strategy's trade is open is marked **Removed from list**
(the same coin on another strategy's list keeps its own entries). The
bot can no longer follow that trade, so if you hold the coin, selling it is up to you.

## Two things that make it trustworthy

**The forming candle is dropped.** Binance returns the in-progress bar as the last element.
The webapp keeps it — you want live price on a chart. A bot must not: a breakout that is true
mid-bar and false by the close would alert and then silently un-alert. Only bars whose
`closeTime` has passed reach the engine, so an alert refers to a bar that is final.

**State persists between runs** in `signals/state.json`, committed back by the workflow (with
`signals/journal.json`), so each flip is announced exactly once. When the bot first meets a
position that is already open, a buy on a candle that closed after the previous run is a normal
BUY. An older one gets one `OPEN TRADE` note, and only when a slot is free and price is still
within 1R. Trades that closed before you started watching stay quiet. A fetch failure exits
non-zero rather than looking like "no signal".

## Running it yourself

```bash
node scripts/signal-bot.js --dry-run                 # compute and print, send nothing
node scripts/signal-bot.js --selftest                # synthetic bars, no network
node scripts/signal-bot.js --fixture bars.json       # replay saved candles
node scripts/signal-bot.js --ping                    # test your channels, send a hello
```

`--fixture` takes a JSON array of `{time,open,high,low,close,volume}` and is how the buy/sell
transitions are tested without a live market. `--state`, `--book`, `--journal` and `--decisions`
point the bot at other copies of those files, so a test never touches the real ones.

## What it does NOT do

It does not trade. It has no exchange credentials and no order code — it tells you, you decide.

It also inherits every caveat in `ALGORITHM.md`: `liqbrk` is a **bull-regime system** (−61%
drawdown on full ZEC history, losing for ~2.5 years through 2022–24), the `lbMaBars` 149-MA
filter is **still unmeasured**, and **ARB has never been backtested in this repo** — it is on the
default watchlist because it was asked for, not because it is evidenced. The evidenced symbols
are ETH, SOL, LINK and BTC.

## Punctual alerts (optional)

The workflow is scheduled every 15 minutes, but GitHub runs scheduled jobs late or skips them when its runners are
busy. On this repo a 2-hourly schedule once fired only every 5–6 hours, and in Nov 2026 the 15-minute schedule fired
only every **3–7 hours**. Until the bot runs, nothing that happened since its last run is alerted or in the journal.
On Nov 1, PARTI hit its stop in the 21:30–01:30 IST candle, and at 01:56 the journal still said Open because the bot
had last run at 22:32. The Portfolio page says when this is happening ("The bot is behind") and links to GitHub's
**Run workflow** button. If you want alerts within a few minutes of every candle close, let a free outside scheduler
start the workflow:

1. **A token** (a phone browser is fine): `https://github.com/settings/personal-access-tokens/new`
   - Expiration: the longest offered, and note the date. When it expires the trigger stops, and the Portfolio shows
     "The bot is behind" again.
   - Repository access: **Only select repositories**, this one.
   - Repository permissions: **Actions: Read and write**. Nothing else. Generate it and copy it (GitHub shows it once).
2. **A job** on cron-job.org (free account), Create cronjob:
   - URL `https://api.github.com/repos/<you>/SmartMoneyBOS/actions/workflows/signals.yml/dispatches`
   - Schedule: every hour at **minute 2, UTC**. Set the job's time zone to UTC, or in IST use minute **32**. Candles
     close at :30 in India (the 4h closes are 01:30, 05:30, 09:30, 13:30, 17:30 and 21:30 IST), so minute 2 on an IST
     clock would run 32 minutes after every close. Hourly covers 1h and 4h alerts; for 15m alerts use 2,17,32,47.
   - Advanced: method `POST`; headers `Authorization: Bearer <token>`, `Accept: application/vnd.github+json` and
     `Content-Type: application/json`; request body `{"ref":"main"}`.
   - Turn on its email for failed runs, so an expired or wrong token tells you instead of going quiet.
3. **Test it**: the job's test run should answer **204**, and GitHub's Actions tab then shows a new "liqbrk signals"
   run started by `workflow_dispatch`. 401 means the token is wrong or expired, 403 that it lacks Actions write, 404
   a wrong URL or a token that doesn't cover this repo.
4. Keep the GitHub schedule as a backup. Runs never overlap (the workflow's concurrency group queues them) and a
   run with nothing new commits nothing, so extra starts are harmless. An alert then arrives about two minutes after
   the candle closes.

The token lives only in cron-job.org — never put it in the repo or the web page.

When the bot is behind, the Portfolio's book can also start it by hand. Its **Run it now on GitHub** link opens
GitHub's Run workflow page, and needs no token. If the token saved in the Alerts tab also has **Actions: Read and
write**, a **Run the bot now** button starts it in one tap.

