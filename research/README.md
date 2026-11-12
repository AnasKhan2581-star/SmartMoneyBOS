# Research

The backtests behind the app's strategies, including every idea that was rejected. Nothing here runs in the app or the
bot. A result reaches `detector.js` only after the user approves it, and its rules go into
[ALGORITHM.md](../ALGORITHM.md) first.

## Studies (newest first)

| Folder | Question | Verdict |
|---|---|---|
| [`stopcap/`](stopcap/) | After INIT's −41.7% stop-out: is the Breakout rule's "leader" exception worth keeping, and should a stop have a maximum distance? | **Both changes shipped** (Nov 2026). The leader exception's trades lose, and trades with a stop over 30% away lose on all three coin sets. Shipped: no leader exception, and no buy when the stop would be more than 25% away. A tighter stop or a smaller buy on the same trades does less. |
| [`weekgate/`](weekgate/) | Should the Breakout market filter be "BTC above the 9 MA on the weekly chart" instead of the 50-day average? | **Rejected.** It is nearly the same filter (they differ on 4% of candles) and slightly worse where they differ. The coin's own weekly 9 MA loses clearly. |
| [`latelead/`](latelead/) | Why didn't the Breakout rule buy INIT's +79% day, and should it buy such sudden runs? | **Not shipped; one change proposed.** It saw the run and the BTC filter blocked it. Buying such runs loses on all three coin sets. Proposed: the "leader" exception should need a day of leadership first ([`stopcap/`](stopcap/) now proposes dropping it). |
| [`smcpoi/`](smcpoi/) | The user's 15m pattern: a sweep of the higher low, a close above the major high, a buy back in the up move's fair value gap | **Not shipped.** Real (it beats the same orders at random times), but it breaks even on the user's 103 coins. [README](smcpoi/README.md) |
| [`nyopen/`](nyopen/) | Three 15m strategies around the New York open: ICT's Judas swing, the opening-range breakout, the 08:30 ET candle | **Rejected.** Only the 08:30 ET candle hints at an edge (p 0.02), about 5 times a year. |
| [`flush/`](flush/) | Buy the alts that fell most when BTC flushes on 15m; a layered version; the comparison with the 4h liqbrk book | **Not shipped.** It makes money: ×5.36, +20% a year, −12% max drawdown (bootstrap −14% typical, −23% in a bad case). It needs alerts within minutes. |
| [`s15/`](s15/) | Is there a 15m strategy that makes money? | **Not shipped.** Only the 4h breakout read on 15m candles (`H4e`): earlier entries, no extra edge. |
| [`liqbrk15m/`](liqbrk15m/) | Should liqbrk on 15m keep the BTC 50-day gate? | **Keep it.** Also requiring BTC above its 149-bar MA helped a little: measured, not shipped. |
| [`gold/`](gold/) | A long-term gold strategy: five candidates over 50 years | **Shipped** as `gold` (the clean-trend rule). |
| [`smcexit/`](smcexit/) | Take liqbrk's profit at buy-side liquidity or bearish FVGs instead of half at +3R? | **Rejected.** The shipped exit stays. |
| [`tfcmp/`](tfcmp/) | 15m vs 4h on the 103-coin list, last 4 years | **4h stays.** On 15m liqbrk ends with ~23% less money. |
| [`cycle/`](cycle/) | Why the BTC Cycle strategy showed impossible trades | **Bug fixed, rebuilt and shipped.** |
| [`rank116/`](rank116/) | liqbrk 4h: the top 30 coins over two windows | A ranking, not a rule. |
| [`v2/`](v2/) | Five other 4h swing strategies against liqbrk | **Keep liqbrk.** The best of the five (volume momentum) is a possible second signal. |
| [`rotation/`](rotation/), [`daytrade/`](daytrade/) | Can Binance's next top gainers be seen coming? | **Rejected.** Rotation, volume-burst day trades and pre-burst setups all lose. |
| [`steady/`](steady/) | Steadier daily BTC allocations: moving-average filters, 50/50, dual momentum, DCA | A reference table, no rule. |
| [`RESULTS_liqbrk_2026-10.md`](RESULTS_liqbrk_2026-10.md) | liqbrk's fills, exits, a BTC filter, a wider coin basket | **Two changes shipped** (Oct 2026): the BTC 50-day gate and selling half at +3R. |

Each folder holds its lab, the script that writes its report, and `RESULTS_*.md`. The ALGORITHM.md entry for each
study gives the short version.

## How the studies are tested

- **Full history.** Binance spot candles from each coin's listing. Delisted coins are included wherever the question
  is about picking coins, because a test that only sees survivors looks better than it is.
- **Costs.** 0.1% fee a side, plus slippage where stated.
- **Honest fills.** An order fills only at a price the candles actually traded, and a stop counts first when a candle
  touches both the stop and the target.
- **Rules fixed before the results**, one change per variant. Where a rule is chosen, one part of history chooses and
  another judges.
- **Controls.** Where a pattern is claimed, the same orders are also placed at random times (or random levels).
  Random numbers come from [`rng.js`](rng.js).
- **Parity.** Labs that copy a shipped strategy are first checked trade-for-trade against `detector.js` (their
  `parity` modes).
- **Rule eras.** `liqbrk_lab.js` follows the engine's current rules. A study of the Breakout rules as they were from
  Oct to mid Nov 2026 (the "leader" exception, no stop limit) says so at its top with `L.useRules('2026-10')`, so
  re-running it reproduces its report. "Shipped" in those reports means the rules of their day.

## Data

The caches live in `research/cache/` (git-ignored, so a fresh clone has to fetch them).

- **4h / 2h / 1h / 1d candles:** `python research/fetch_klines.py 4h SOL ARB …`
- **15m candles for the 103-coin list:** `node research/liqbrk15m/fetch15.js` → `cache/lb15`. It reuses the middle
  years from `cache/tfcmp` (`node research/tfcmp/fetch.js`).
- **The 171 delisted or collapsed coins:** `node research/liqbrk15m/fetch15.js DIR=lb15dead <coins>` → `cache/lb15dead`.
- **The alert list's 4h candles to now:** `node research/latelead/latelead_lab.js fetch` → `cache/latelead`.
- **Gold:** `node research/gold/gold_lab.js` keeps its own cache in `cache/gold`.
