# The reclaim zone: buy the first return to the bottom of a flush that was fully reclaimed (Nov 2026)

Research only: the app, `detector.js` and the signal bot don't use it.

The user's chart (a 27-year view): a sudden drop, then a rally that closes above the last major high (the strong high),
and years later the market taps the untouched region at the bottom of the drop (the yellow box) and reverses.

**Verdict: not a strategy on the coins you named, on any timeframe.**
- **On PAXG, BTC, ETH, SOL, STX, XRP, BNB and ARB**, on 3m, 15m, 1h, 4h and 1d, the first tap of the zone does no better
  than the same limit order placed at a random time. That holds even before costs, and after costs it loses:
  - 3m: −0.30% a trade on 1,397 trades;
  - 15m: −0.28% on 351;
  - 1h: −0.97% on 70.

  Those are the rules chosen on the first half of each coin's history, judged on the second half.
- **On 4h and 1d the shape is too rare to trade on 8 coins.** It appears about once per 20,000 candles on every
  timeframe, and a daily chart since 2017 has about 3,400. BTC's daily chart has none; your 27-year chart has one.
- **The only place it showed an edge** was 1h on smaller coins, from 2020 to 2024. It was carried by a few big winners:
  the median trade loses, and half the coins lose. It faded: on 295 Binance coins never used to choose anything, it
  lost in 2025 and 2026. Requiring a bigger flush (8 ATR) gave the strongest version, and it also lost in 2026 on those
  coins.

Every table: [RESULTS_reclaim_2026-11.md](RESULTS_reclaim_2026-11.md).

## Why it might work: the liquidation logic

1. **The drop is forced selling.** Leveraged longs keep their stops and liquidation prices under the obvious lows of
   the range they bought in. A sudden fall through those lows turns each one into a market sell, which pushes price
   into the next cluster: a cascade. It ends when the forced sellers run out. The low is set by people who had to
   sell, and resting buyers absorb them there.
2. **The reclaim says the drop was liquidity, not news.** Shorts who sold the breakdown keep their stops above the
   high the fall started from. A close back above it runs those stops (a squeeze) and shows that the market paid the
   whole fall back. In SMC terms: sell-side liquidity swept, then a break of structure. In Wyckoff's: a spring and a
   sign of strength.
3. **The first return to the bottom zone.** The absorbers bought at the bottom, and price left too fast for every bid
   to fill (the zone is "unmitigated"). Longs opened after the reclaim keep their stops under the later lows, which
   sit above the zone. So a fall back into the zone is a new flush of late longs into the area where the big bids
   rest. The trade: buy the first tap, stop under the flush low (below it the absorbers were wrong), target the high
   made after the reclaim (the buy stops above it).

## Why it might not

- A return to the bottom of the drop takes back the whole reversal. In trend terms the reversal has failed.
- This repo measured crypto as a momentum market. Buying "discount" did worse than random on ZEC 15m, and seven
  sweep-fade strategies lost.
- In the Nov 2026 SMC study (`research/smcpoi/`), the deep POI (the order block at 79% of the move) was rejected.
- The flush study (`research/flush/`) found that the liquidation edge sits in buying INTO the cascade, with quick
  exits. Waiting for the bounce to confirm was already too late.
- A chart drawn after the fact shows a winner. A test has to take every instance.

## The rules, and how they were tested

The base rules were fixed from the logic above before any result was seen. They are counted in the chart's own candles
and its 14-candle ATR, because the shape is drawn the same way on every timeframe:
- **Strong high**: the highest high of the 50 candles before it.
- **Sudden drop**: within 12 candles the low is ≥ 5 ATR under that high and below the 50-candle low (the range's stops
  are taken).
- **Reclaim**: a close above the strong high within 36 candles of the low.
- **Zone**: the bottom third of the drop, untouched until the reclaim.
- **Trade**: a limit buy at the top of the zone on its first touch, valid 500 candles. The stop sits 0.1 ATR under the
  low, the target is the highest high since the reclaim, and the trade closes after 100 candles.

Then:
- **Variants.** 19 one-step variants (the fall's size and speed, the high's lookback, the reclaim's speed, the zone's
  depth, a confirmation entry, a trailing exit, the zone's life, the time stop, no sweep, no "unmitigated").
- **The choice**, made on the first half of each coin's history. Kept changes: the drop within 6 candles, a 20-candle
  high, the reclaim within 36 candles, the bottom half as the zone, out after 300 candles, and revisits allowed.
- **The judge**: the second halves, never used to choose.
- **Costs**: 0.1% fee a side, plus 0.05–0.15% slippage on stops and timed exits.
- **Fills**: a limit fills only when price trades at or through it, and the stop counts first on the fill candle.
- **Control**: each trade's exact order (depth, stop and target in ATR) placed at 50 random times on the same chart.
- **Wider checks** for 1h, 4h and 1d, where 8 coins have too few trades: your 103-coin Compare list, and the 295 other
  USDT coins on Binance spot, which no rule was ever chosen on.

## The numbers that decide it

The 8 coins, the chosen rules, the second halves (avg trade after costs):

| | trades | avg trade | same order at random times | before costs (random) |
|---|---|---|---|---|
| 3m | 1,397 | −0.30% | −0.28% | −0.03% (0.00%) |
| 15m | 351 | −0.28% | −0.29% | −0.01% (−0.02%) |
| 1h | 70 | −0.97% | −0.24% | −0.68% (+0.04%) |
| 4h | 19 | −2.85% | +0.55% | −2.57% (+0.83%) |
| 1d | 1 | −6.78% | −0.94% | −6.46% (−0.64%) |

1h on the wider lists (avg trade after costs, first / second half of each coin's history):

| | chosen rules | 8-ATR flushes |
|---|---|---|
| 103-coin list | +1.33% / +0.56% (random 0.00% / −0.33%) | +3.96% / +5.21% (found here, after looking) |
| 295 fresh coins | +1.26% / −0.37% (random +0.11% / −0.39%) | +3.24% / +0.99% (random +0.11% / −0.41%) |
| fresh coins in 2026 | −0.9% (547 trades) | −1.7% (92 trades) |

Trades taken with BTC above its 50-day average did better on both lists. In 2026, though, both versions lose on the
fresh coins even with BTC above it.

**What is worth keeping**: the liquidation logic is real, but the money in it is at the flush itself (the flush
playbook, `research/flush/`), not at the late retest of its bottom.

## Coin by coin (the 103-coin list)

[RESULTS_reclaim_coins_2026-11.md](RESULTS_reclaim_coins_2026-11.md) ranks every coin on 15m, 1h, 4h and 1d, for the
chosen rules and the 8-ATR version.
- **1h is the only timeframe ahead on average:** +0.91% a trade over 911 trades, against −0.07% on 15m and −0.21% on
  4h. On 1h, 40 of 97 coins end ahead by Net P/L.
- **The best pairs:**
  - BAT 1h: +350%, 25 trades, 48% winners.
  - FET 1h: +129%, 13 trades, 69%.
  - DCR 1h: +100%, 12 trades, 58%.
  - PENDLE 1h: +94%, 9 trades, 67%.
  - EPIC 15m: +91%, 15 trades, 53%.
  - LDO 1h: +90%, 15 trades, 53%.

  Each rests on one or two big trades: without its single best trade BAT makes +172% and DCR +16%.
- **Picking coins by their first half** is no use on 15m. On 1h the 10 best first-half coins kept an above-average
  second half (+2.89% against +0.75% a trade, p 0.01), but the best 5 and the best 20 did not stand out. That is a
  hint, not proof.

## Run it

```
NODE_USE_ENV_PROXY=1 node research/reclaim/data.js fetch             # 3m history of the 8 coins (~4 min, ~580 MB)
NODE_USE_ENV_PROXY=1 node research/reclaim/data.js broad 1h 4h 1d    # the 103-coin list
NODE_USE_ENV_PROXY=1 node research/reclaim/data.js fresh 1h 4h       # the 295 other Binance coins
node research/reclaim/reclaim_lab.js run; node research/reclaim/reclaim_lab.js run gross; node research/reclaim/reclaim_lab.js run slip2
for c in "" gross slip2; do node research/reclaim/reclaim_lab.js broad $c; node research/reclaim/reclaim_lab.js fresh $c; done
node research/reclaim/diag_1h.js; node research/reclaim/regime_1h.js
node research/reclaim/reclaim_lab.js report > research/reclaim/RESULTS_reclaim_2026-11.md
NODE_USE_ENV_PROXY=1 node research/reclaim/data.js broad 15m         # 15m for the 103 coins (~6 min, 1.2 GB with the rest)
node research/reclaim/coins.js > research/reclaim/RESULTS_reclaim_coins_2026-11.md
node research/reclaim/reclaim_lab.js show ETHUSDT 1h                 # the setups and trades of one chart, by eye
```

Data runs to 25 Nov 2026 00:00 UTC (`END` in data.js). The fresh list is today's Binance coins, saved on the first
fetch, so a later fetch picks a different list.
