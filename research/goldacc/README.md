# Gold accumulation: buy the dips of an uptrend in tranches, stop from the average (Nov 2026)

Research only: the app, `detector.js` and the signal bot don't use it.

**The rules** (chosen on spot gold 2003-2019, then tested on 2020-2026 and on PAXG, which they never saw):
- **Uptrend**: the close is above its 200-day average, and that average is higher than 20 days ago.
- **Accumulate**: each dip in the uptrend buys one tranche of 25%, up to 4. A dip is a close under the 50-day average;
  the next one counts after a close back above it.
- **Stop from the average**: sell everything if price touches 8% under the average entry. Once a close is 10% above the
  average, the stop rises to the average itself (break-even).
- **Out**: a close 3% under the 200-day average.

**Verdict.** It earns gold's growth with about half of gold's falls:

| | Strategy | Holding |
|---|---|---|
| Spot gold 2003-2019 (design) | +197% at a −26% worst fall | +338% at −45% |
| Spot gold 2020 → Nov 2026 (test) | +131% at −20% | +133% at −36% |

Against the Compare tab's rows on PAXG (all history, the user's settings):

| | Strategy | Holding |
|---|---|---|
| 4h and 1d | +100% / +121%: the most of any strategy | +82% |
| 1w | +92%: ties BTC Cycle, which falls less | +82% |
| 1M | +58%: last but one | +83% |

**What does the work**: the uptrend filter, the dip entry and the break-even stop. Buying in tranches doesn't add
anything. Buying everything on the first dip made more on spot gold in both periods, at the same worst fall. The 8%
stop fired once in 2020-2026 and cost a little; the break-even stop turned two losing campaigns into exits at cost.

Every table, the campaigns and the checks: [RESULTS_goldacc_2026-11.md](RESULTS_goldacc_2026-11.md).

## Run it

```
NODE_USE_ENV_PROXY=1 node research/goldacc/data.js fetch     # PAXG and BTC, every timeframe -> research/cache/goldacc
node research/goldacc/goldacc_lab.js design                  # the 2003-2019 grid, best of each family
node research/goldacc/goldacc_lab.js report > research/goldacc/RESULTS_goldacc_2026-11.md
```

Spot gold comes from the repo's `data/xauusd_1d.csv`. A new fetch moves the PAXG numbers, because they run to the moment
of the fetch, the forming candle included, as in Compare. This run fetched them on 23 Nov 2026. Compare's statistics
(`pathStats`, read out of index.html) mark every exit at its candle's close.
