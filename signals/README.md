# Signal bot — buy/sell alerts with the browser closed

`scripts/signal-bot.js` runs **the same `detector.js` engine the webapp uses** against fresh
Binance klines, and pushes a message only when a position actually flips. The GitHub Action in
`.github/workflows/signals.yml` runs it five past every even hour (just after a 2h candle closes).

There is no second copy of the strategy rules. If `ALGORITHM.md` changes, the alerts change.

## Turn on a channel

With **no setup at all** you still get alerts: the bot opens a GitHub issue labelled `signal`,
and the GitHub mobile app pushes that to your phone. For anything better, add repo secrets at
*Settings → Secrets and variables → Actions*. Any combination works; all configured channels fire.

| Channel | Secrets | Setup |
|---|---|---|
| **ntfy** (easiest phone push) | `NTFY_TOPIC` | Install the ntfy app, subscribe to a topic name only you know, put that name in the secret. Optional `NTFY_SERVER` for self-hosting. |
| **Telegram** | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Create a bot with @BotFather, message it once, then read your chat id from `https://api.telegram.org/bot<TOKEN>/getUpdates`. |
| **Discord** | `DISCORD_WEBHOOK` | Channel → Edit → Integrations → Webhooks → New. |

A topic name is the only thing protecting an ntfy topic — pick something unguessable.

## What it watches

`signals/watchlist.json`. Edit it and commit; nothing is hardcoded in the script.

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
