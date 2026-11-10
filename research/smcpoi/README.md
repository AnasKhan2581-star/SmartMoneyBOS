# Your 15m SMC continuation pattern (Nov 2026)

Research only: the app, `detector.js` and the signal bot don't use it.

**Verdict: not worth adding.** The pattern picks better moments than chance, but on your 103 coins it breaks even
after fees. Its profit came from coins that were later delisted.

## The rules (the final version, round 8)

1. **Uptrend.** On 15m candles, the last two swing highs and the last two swing lows are rising. A swing counts once
   price turns by 3 × the 15m ATR.
2. **Sudden drop.** Within 8 hours of the last major high, price trades below the higher low before it, taking the
   stops under it.
3. **Sudden up move.** Within 6 hours of the drop's low, a 15m candle closes above that major high.
4. **Higher-timeframe liquidity decides.** Trade only if the drop took the previous day's low, or the previous day's
   high is still untaken above the up move.
5. **POI.** Going down from the top of the up move, the first fair value gap whose middle still pays at least 2R to the
   move's high. A limit buy waits at that middle for 12 hours.
6. **Stop.** 0.1 × the 15m ATR under the drop's low, and only if that is 1–5% below the entry.
7. **Exit.** Target the up move's high; out after 24 hours if neither is hit. One trade per coin at a time.

## Results

273 coins (your 103 plus 171 delisted or collapsed), full Binance 15m history, 2018 → Nov 2026. Costs: 0.1% fee a
side, plus 0.05–0.15% slippage on stops and timed exits.

| | Trades a year | Win rate | Per trade | 2018–21 | 2022–26 | Your 103 coins |
|---|---|---|---|---|---|---|
| Final version | 52 | 36% | +0.40% | +0.34% | +0.43% | −0.03% (237 trades) |
| Selective version (the shallowest gap, ≥ 2R) | 10 | 42% | +1.06% | +1.65% | +0.72% | +0.44% (35 trades) |
| The final version's orders at random times | — | 28% | −0.22% | −0.30% | −0.19% | −0.27% |

- **The pattern carries information.** It beats its own orders placed at random times by about 0.6% a trade, in both
  halves (bootstrap odds under 1 in 1,000).
- **On your coins it ends at zero after costs**, at every stop size. The coins later delisted made +0.87% a trade.
- **The selective version isn't proof either.** +0.44% on 35 trades in almost nine years is about a 1-in-4 chance of
  luck.
- **It is small.** With 20% of the pot on each trade it adds about 3.6% a year across all 273 coins (max drawdown
  −8%).

## What the 8 rounds found

- **A small stop backfires on 15m.** Stops under 1% of the price lost in every version, because fees and slippage
  (about 0.3%) are a third of the stop or more. The tight stop under the gap was hit about 80% of the time.
- **What made it work:** the higher-timeframe liquidity context, and a sharp V-shaped up move bought at its first gap.
- **What failed:**
  - deeper entries (the order block, 79% of the move);
  - fixed 2R / 3R / 5R targets;
  - New York hours only;
  - 4h liquidity pools instead of the previous day's;
  - a confirmation close above the gap;
  - selling half at +1R (a higher win rate, less money).
- **More trades meant less edge.** Every loosening that added trades took the result back toward zero.
- **Caveat:** both halves of history were printed every round, so 2022–26 is not a clean test.
- **The bot couldn't run it as is.** It needs a limit order within minutes of a 15m close, and GitHub starts the bot
  hours late.

## Files

- [`RESULTS_smcpoi_2026-11.md`](RESULTS_smcpoi_2026-11.md): every round and variant, the odds, and the detail by year,
  coin and stop size.
- [`poi_lab.js`](poi_lab.js): the backtest. Its header lists the rules and the fill model.

## Re-run it

It needs the 15m caches `research/cache/lb15` and `research/cache/lb15dead` (git-ignored; see
[`../README.md`](../README.md#data)).

```
node research/smcpoi/poi_lab.js run                 # round 1
node research/smcpoi/poi_lab.js run round2          # … through round8, and final
node research/smcpoi/poi_lab.js run final gross     # final, round7 and round8 also with gross and slip2
node research/smcpoi/poi_lab.js report > research/smcpoi/RESULTS_smcpoi_2026-11.md
```
