# Signal bot — buy/sell alerts with the browser closed

`scripts/signal-bot.js` runs **the same `detector.js` engine the webapp uses** against fresh
Binance klines, and pushes a message only when a position actually flips. The GitHub Action in
`.github/workflows/signals.yml` runs it five past every even hour (just after a 2h candle closes).

There is no second copy of the strategy rules. If `ALGORITHM.md` changes, the alerts change.

**What you can receive** (liqbrk, since Oct 2026):
- **BUY** — a new position. Includes the stop, the **take-half price (+3R)** and whether BTC's 50-day
  MA let it through (or the coin was a +50%/30-day leader).
- **2h vs 4h on the same coin** — when a coin is watched on both, 2h BUYs are titled **(heads-up)** and
  4h BUYs **(trade)**. Only 42% of 2h buys become a 4h buy within 24h, and 37% of 4h buys come with no 2h
  warning, so 2h is a watch-this-coin note and 4h is the one to act on. A 4h BUY says whether a 2h buy
  preceded it — that combination was the strongest (2h buys a 4h buy followed averaged +4.9% vs +1.7%).
- **TAKE HALF** — price reached entry + 3R: sell half there; the other half stays on.
- **SELL** — the position (or its remaining half) closed; the result counts both halves.
- **OPEN TRADE** — sent once for a position the bot never announced: the coin was added while liqbrk was already in
  a trade. It shows the entry, how long ago, the stop, take-half and trail levels, and whether price is still within
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

`strategy` can be any system in the app's dropdown. `cycle` (BTC Cycle) is a daily system: on an
intraday watch it acts on **finished UTC days only**, and on alts it follows BTC's cycle (it fetches
BTC's daily history for that). Its alerts state its own rules: half sold in the sell zone, exit after
5 days under the 40-week MA.

## The trading book — 5 slots and a journal

Your capital is treated as one book split into **5 equal slots**. A BUY alert means "put one
slot in": 20% of the book's value at that moment. The rules (ALGORITHM.md, "The trading book"):

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

**Answering.** Open the Portfolio tab. Each alert you haven't answered shows a **Did you buy
it?** card with **Taken** and **Skipped** buttons. Taken records the signal's own price, so one
tap is enough. With a GitHub token saved in the Alerts tab, the tap commits
`decisions.json` for you. Without a token, the page keeps the answer in this browser (marked
`*`) and gives you the file's full text to paste into GitHub's editor. Until the bot reads your
answer, an unanswered alert keeps holding its slot.

A coin removed from the watchlist while its trade is open is marked **Removed from list**. The
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
busy (on this repo a 2-hourly schedule once fired only every 5–6 hours). If you want alerts within a few minutes of
every candle close, let a free outside scheduler start the workflow:

1. GitHub → Settings → Developer settings → Fine-grained tokens → new token, **only this repository**, permission
   **Actions: Read and write**. Copy it.
2. On cron-job.org (free), create a job that runs at **minute 2 of every hour** with:
   - URL `https://api.github.com/repos/<you>/SmartMoneyBOS/actions/workflows/signals.yml/dispatches`
   - Method `POST`, headers `Authorization: Bearer <token>` and `Accept: application/vnd.github+json`
   - Body `{"ref":"main"}`
3. Keep the 15-minute schedule as a backup. Runs never overlap (the workflow's concurrency group queues them) and a
   run with nothing new commits nothing, so extra starts are harmless.

The token lives only in cron-job.org — never put it in the repo or the web page.

