# Signal bot — buy/sell alerts with the browser closed

`scripts/signal-bot.js` runs **the same `detector.js` engine the webapp uses** against fresh
Binance klines, and pushes a message only when a position actually flips. The GitHub Action in
`.github/workflows/signals.yml` runs it five past every even hour (just after a 2h candle closes).

There is no second copy of the strategy rules. If `ALGORITHM.md` changes, the alerts change.

**What you can receive** (liqbrk, since Oct 2026):
- **BUY** — a new position. Includes the stop, the **take-half price (+3R)** and whether BTC's 50-day
  MA let it through (or the coin was a +50%/30-day leader).
- **TAKE HALF** — price reached entry + 3R: sell half there; the other half stays on.
- **SELL** — the position (or its remaining half) closed; the result counts both halves.
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

## Two things that make it trustworthy

**The forming candle is dropped.** Binance returns the in-progress bar as the last element.
The webapp keeps it — you want live price on a chart. A bot must not: a breakout that is true
mid-bar and false by the close would alert and then silently un-alert. Only bars whose
`closeTime` has passed reach the engine, so an alert refers to a bar that is final.

**State persists between runs** in `signals/state.json`, committed back by the workflow, so each
flip is announced exactly once. On the **first** run for a new watch item the state is recorded
*silently* — you are not told about a position that opened weeks ago. A fetch failure exits
non-zero rather than looking like "no signal".

## Running it yourself

```bash
node scripts/signal-bot.js --dry-run                 # compute and print, send nothing
node scripts/signal-bot.js --selftest                # synthetic bars, no network
node scripts/signal-bot.js --fixture bars.json       # replay saved candles
node scripts/signal-bot.js --ping                    # test your channels, send a hello
```

`--fixture` takes a JSON array of `{time,open,high,low,close,volume}` and is how the buy/sell
transitions are tested without a live market.

## What it does NOT do

It does not trade. It has no exchange credentials and no order code — it tells you, you decide.

It also inherits every caveat in `ALGORITHM.md`: `liqbrk` is a **bull-regime system** (−61%
drawdown on full ZEC history, losing for ~2.5 years through 2022–24), the `lbMaBars` 149-MA
filter is **still unmeasured**, and **ARB has never been backtested in this repo** — it is on the
default watchlist because it was asked for, not because it is evidenced. The evidenced symbols
are ETH, SOL, LINK and BTC.
