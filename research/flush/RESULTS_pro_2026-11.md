# The layered BTC flush strategy, run as a real portfolio (Nov 2026)

**Research only: detector.js, the webapp and the bot are unchanged.** Follows `RESULTS_flush_2026-11.md`.

The user asked: "Did you even do a proper deep backtest or make an actual strategy? Make a deep logical layered
strategy like a world-class trader would, not a basic one, and give actual backtested results."

Reproduce (needs the 15m caches research/cache/lb15 and research/cache/lb15dead, see `RESULTS_flush_2026-11.md`):
```
node research/flush/pro_lab.js prep    # every coin's features and 12-hour price windows at every flush → cache/flush/pro_prep.json
node research/flush/pro_lab.js run     # the seven-layer design and its ablations → cache/flush/pro.json
node research/flush/pro_lab.js walk    # layers chosen on 2017–2021 only → cache/flush/walk.json
node research/flush/pro_lab.js final   # the chosen strategy: stress, bootstrap, years, every order → cache/flush/final.json
node research/flush/gen_dash.js <dir>  # the CSV files behind the visual report
```

## The backtest

- **One pot, simulated as a portfolio.** It tracks cash and coin quantities, values the pot every 15 minutes from
  1 Sep 2017 to 5 Nov 2026, and trades each flush with what the pot holds at that moment. Gains compound and losses cost
  real money. This replaces the per-trade averages of the first study.
- **Coins.** 274 coins: the user's 103 plus 171 that were delisted or collapsed, with LUNA cut at 2022-05-14. So it
  can buy coins that later died, as a trader at the time would have. A coin counts only with at least $1M of average
  daily turnover over the 30 days before. Stablecoins are excluded.
- **Fills.**
  - A limit order fills at its own price, never better.
  - Market orders fill at the 15m close.
  - A stop fills at the stop, or at a worse open.
  - Fees are 0.1% a side. Market buys, stops and timed exits also pay 0.15% slippage.
  - When a 15m candle touches both the stop and a target, the stop comes first.
  - A take-profit cannot fill on the candle that added to the position.
- **Drawdown.** Measured from the 15-minute marks, so a high reached inside a trade counts as a peak. That is stricter
  than the pot between flushes: −12.3% where the old measure said −11.8%.

## Seven layers, designed from the trading logic

1. **Regime.** BTC over its 50-day MA means mode A (risk-on); under it, mode B (risk-off).
2. **Event.** The flush from the first study: a 15m close ≥ 1 daily ATR under the 2-hour high, a red candle, ≥ 3× volume,
   and the 3-day low swept.
3. **Selection.** The 5 most dislocated coins: drop − β × BTC's drop, with β from 30 days of hourly returns. A coin that
   fell more than 3× what its β predicts is skipped as its own news.
4. **Execution.** A ladder of 3 orders per coin. Mode A: ⅓ at market, then bids ½ and 1 ATR down. Mode B: bids ¾, 1 and
   1¼ ATR down. Bids live 2 hours.
5. **Risk.** Each coin is sized so its stop costs 1% of the pot (A) or 0.75% (B), with at most 25% of the pot in a coin.
6. **Exits.** A stop 1 ATR under the average fill (1¼ in B). Half is sold at +½ ATR, then the stop moves to breakeven
   and the unfilled bids are cancelled. The rest goes at +1 ATR, or 6 hours after the first fill.
7. **Kill switch.** A BTC close one more daily ATR under the flush low sells everything.

**All seven together:** 93 flushes, +2.25% a trade, 75% winners, but the pot only ×1.30 (+2.9% a year) at a −4.5%
drawdown. Risk sizing and the ladders kept only 18% of the pot at work. Ablations, switching one layer off each
(whole span):

| variant | flushes | trades | a trade | win | PF | pot | a year | max DD | pot used |
|---|---|---|---|---|---|---|---|---|---|
| all seven layers | 93 | 366 | +2.25% | 75% | 2.40 | ×1.30 | +2.9% | −4.5% | 18% |
| the simple playbook | 89 | 374 | +2.04% | 75% | 2.89 | ×4.33 | +17.3% | −11.8% | 84% |
| −regime: mode A everywhere | 138 | 665 | +1.21% | 67% | 1.66 | ×1.30 | +2.9% | −4.9% | 21% |
| −regime: mode B everywhere | 35 | 81 | +3.21% | 79% | 1.81 | ×1.06 | +0.6% | −3.4% | 12% |
| the 5 that fell most, not dislocation | 89 | 368 | +2.51% | 78% | 2.89 | ×1.34 | +3.2% | −3.9% | 17% |
| 5 random liquid coins | 86 | 368 | +1.85% | 71% | 2.02 | ×1.22 | +2.2% | −5.2% | 21% |
| −news filter | 94 | 370 | +2.20% | 75% | 2.13 | ×1.27 | +2.6% | −4.5% | 17% |
| −ladder (one order a coin) | 93 | 366 | +1.97% | 73% | 2.23 | ×1.81 | +6.7% | −12.5% | 44% |
| −risk sizing (20% a coin) | 93 | 366 | +2.25% | 75% | 2.84 | ×1.93 | +7.4% | −5.3% | 32% |
| −scale-out (all at +½ ATR) | 93 | 366 | +1.86% | 75% | 2.14 | ×1.24 | +2.3% | −4.1% | 18% |
| −breakeven | 93 | 366 | +2.28% | 72% | 2.28 | ×1.30 | +2.9% | −4.7% | 18% |
| −kill switch | 93 | 367 | +2.28% | 76% | 2.51 | ×1.31 | +3.0% | −4.5% | 18% |
| same rules at 400 random times | 219 | 1048 | −0.21% | 43% | 0.76 | ×0.87 | −1.5% | −13.6% | 18% |

What the ablations say:
- **The regime split matters.** Mode A everywhere drops to +1.21% a trade.
- **The flush matters.** Random coins drop to +1.85% a trade, and random times lose money.
- **The "smart" selection doesn't help.** Ranking by the plain drop beats ranking by dislocation.
- **Kill switch and breakeven change almost nothing.**
- **Ladders and risk sizing look worse only because they hold money back.** With them switched off, growth rises along
  with drawdown. So the layers can't be judged by growth at unequal sizes. They are judged by return ÷ drawdown, on years
  set aside, as below.

## Choosing layers without hindsight

This is how a desk adds complexity:
- Start from the simple playbook and add ONE layer at a time, on top of what was kept.
- Judge each layer on 2017–2021 only. It stays only if it raises BOTH the average trade and CAGR ÷ max drawdown there.
- Run the result on 2022–2026, which played no part in the choice.

| layer, 2017–2021 only | flushes | trades | a trade | win | pot | a year | max DD | CAGR ÷ DD | |
|---|---|---|---|---|---|---|---|---|---|
| simple playbook (start) | 54 | 220 | +2.28% | 75% | ×2.61 | +24.7% | −11.8% | 2.10 | |
| news filter | 54 | 214 | +1.95% | 74% | ×2.20 | +19.9% | −15.3% | 1.30 | dropped |
| dislocation ranking | 54 | 218 | +1.91% | 73% | ×2.21 | +20.1% | −12.3% | 1.64 | dropped |
| ladder | 54 | 220 | +2.47% | 78% | ×1.50 | +9.8% | −7.2% | 1.36 | dropped |
| **scale-out** (½ at +½ ATR, stop to breakeven, rest at +1 ATR) | 54 | 220 | +2.69% | 75% | ×3.07 | +29.6% | −12.3% | 2.40 | **kept** |
| wider stop in mode B (1¼ ATR) | 54 | 220 | +2.68% | 75% | ×3.07 | +29.5% | −12.3% | 2.39 | dropped |
| 6h hold instead of 4h | 54 | 220 | +2.73% | 77% | ×3.12 | +30.0% | −15.5% | 1.94 | dropped |
| kill switch | 54 | 219 | +2.67% | 75% | ×3.04 | +29.2% | −12.3% | 2.37 | dropped |
| risk sizing (stop costs 2% / 1.5% of the pot) | 54 | 220 | +2.69% | 75% | ×2.25 | +20.6% | −11.0% | 1.87 | dropped |

Only the scale-out earned its place.

## The final strategy

- **Trigger:** a BTC flush. A 15m close ≥ 1 daily ATR (Wilder 14) under the 2-hour high, a red candle, a candle in the
  move at ≥ 3× the previous day's average volume, and the low under the lowest low of the 3 days before. Another flush
  can count only 6 hours later.
- **Coins:** the 5 that fell most from their own high during the flush, among coins with ≥ $1M average daily turnover
  over 30 days, no stablecoins. Each gets 20% of the pot.
- **Good market** (BTC over its 50-day MA): buy at market at the flush candle's close.
- **Bad market** (BTC under it): a limit bid ¾ daily ATR under each coin's price, live for 2 hours.
- **Exits:**
  - Stop 1 of the coin's own daily ATR under the buy.
  - Sell half at +½ ATR, then move the stop to the buy price.
  - Sell the rest at +1 ATR.
  - Whatever is still open 4 hours after the buy is sold.

**Results, 1 Sep 2017 – 5 Nov 2026** (fees and slippage included):

| | flushes | trades | a trade | win | PF | pot | a year | max DD |
|---|---|---|---|---|---|---|---|---|
| whole span | 89 | 374 | +2.35% | 75% | 3.17 | ×5.36 | +20.1% | −12.3% |
| 2017–2021 (rules chosen here) | 54 | 220 | +2.69% | 75% | | ×3.07 | +29.6% | −12.3% |
| **2022–2026 (never seen)** | 35 | 154 | +1.86% | 75% | | ×1.75 | **+12.2%** | −9.3% |
| simple playbook, 2022–2026 | 35 | 154 | +1.69% | 75% | | ×1.66 | +11.1% | −8.6% |
| BTC buy & hold, whole span | | | | | | ×16.1 | +35.3% | −84% |

- **How the flushes went.** 138 flushes were found and 89 were traded. All 68 in good markets were traded. In bad markets
  the bids were reached on only 21 of 70 flushes; the other 49 bought nothing.
- **How the trades ended.** 217 of 374 trades reached the first target, and 108 of those the second. 131 were sold on
  time. 26 hit the stop.
- **Best and worst flush.** The worst flush cost −11.8% (18 Apr 2021: 5 market buys, all stopped within 15 minutes). The
  best made +10.3% (12 Mar 2020: 5 deep bids filled; 4 of the 5 reached both targets within 45 minutes).
- **Years:**

  | year | 2017 | 2018 | 2019 | 2020 | 2021 | 2022 | 2023 | 2024 | 2025 | 2026 (to 5 Nov) |
  |---|---|---|---|---|---|---|---|---|---|---|
  | return | +22% | +14% | +6% | +56% | +35% | −1% | +24% | +25% | +7% | +7% |
  | flushes | 8 | 11 | 10 | 13 | 12 | 6 | 9 | 9 | 7 | 4 |
- **Time in the market.** The pot is in a trade 289 hours in 9.2 years, 0.4% of the time.

**Stress tests:**

| test | a trade | pot | a year | max DD |
|---|---|---|---|---|
| base (0.15% slippage) | +2.35% | ×5.36 | +20.1% | −12.3% |
| 0.5% slippage on every market order | +1.85% | ×3.70 | +15.3% | −14.5% |
| 1% slippage on every market order | +1.13% | ×2.18 | +8.8% | −21.8% |
| a bid fills only after trading 0.1% through it | +2.36% | ×5.32 | +20.0% | −12.3% |
| the user's 103 coins only (no dead coins) | +2.22% | ×4.88 | +18.9% | −11.2% |
| 10% of the pot a coin | +2.35% | ×2.36 | +9.8% | −6.2% |
| 30% of the pot a coin (capped at 100%) | +2.35% | ×5.81 | +21.1% | −12.3% |
| the same rules at 400 random times | −0.42% | ×0.39 | −9.7% | −64.0% |

- **Luck check.** The 89 flushes were resampled with replacement 5,000 times, whole 15-minute paths, not just
  results.
  - CAGR: +12.5% / +19.9% / +28.0% at the 5th / 50th / 95th percentile.
  - Max drawdown: −8.4% / −14.2% / −23.4% (the mildest 5%, the median, the worst 5%). The −12.3% of the real order
    of flushes is a fairly kind draw: plan on about −14% as normal and −23% as the 1-in-20 case.
  - No resampled run lost money.
  - Corrected Nov 2026: the first version drew the resamples, the random coins and the random times from a generator
    that loops after a few thousand draws. It reported a −6.2% / −9.5% / −12.5% drawdown range, random coins at
    +1.27% and random times at −0.18% / ×0.38. The strategy's own trades never used it and are unchanged.
- **Dead coins helped a little** (×5.36 against ×4.88 without them). A coin's later death doesn't matter to a trade
  that lasts hours.

## Verdict

- **The sophistication that pays is in two places:** the regime switch (market buys in a good market, deep bids in a
  bad one) and the scale-out.
- **The other layers failed on the selection years:** β dislocation, the news filter, ladders, risk sizing, the kill
  switch, a wider risk-off stop and a longer hold. Each added complexity without adding return per unit of drawdown, so
  none is in the final strategy.
- **Out of sample** it made +12.2% a year at a −9.3% drawdown, a little better than the simple version (+11.1%, −8.6%).
  The scale-out is a small, real improvement, not a transformation.
- **It made less money than holding BTC** (×16.1). But it fell −12.3% instead of −84%, and its money is free 99.6% of the
  time.

Limits:
- **Speed.** It needs action within minutes of a 15m close. GitHub's scheduler starts the bot hours late, so alerts
  would need the punctual outside trigger.
- **Few events.** About 10 flushes a year, and one bad flush costs ~12% at 20% a coin.
- **Candle detail.** 15m candles cannot show a crash's order book; the fills are modelled conservatively, and the
  slippage stress shows what worse fills cost.
- Everything here is a backtest.
