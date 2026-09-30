# SMC Trend Engine — Algorithm Spec (single source of truth)

Canonical definition of the detection + entry logic. The backtester (`detector.js`), the
TradingView Pine indicator, and the Node bot must all follow this. If a rule changes, change
it here first. Trades **both directions** on Binance **global spot** data.

## Universe & timeframe scaling (July 2026)

The app universe is 7 coins: **BTC ZEC SOL XRP XMR SUI LINK** (XMR delisted from Binance
Feb 2024 — historical backtest only). All quant lookback params are denominated in **days**
and converted to bars per timeframe (`SMA200` = 200 days on 4h, 1d and 1w alike); stop
multiples scale by `√(bars/day)` floored at 0.8 so stop distances stay constant in daily-vol
terms. Result: `composite` is profitable on 6/7 coins on 4h and 1d and 5/6 on 1w (only the
dead XMR listing is mixed) — same economic strategy on every TF. The Compare page runs all
4 strategies × 7 coins (daily, all-in, 0.1% fees/side) with 6M/1Y/CAGR/DD/WR/Sharpe.

## REJECTED: `zecdiv` — ZEC 15m MACD absorption divergence (built & removed July 2026)

Built, benched, shipped, then **removed by the user** ("that strategy is not working"). Recorded
here so it is not rebuilt. Setup: price lower high + MACD line higher high (absorption), buy the
0.6 retrace into an unmitigated candle + its FVG, fixed 1% SL / 5% TP.

Backtest was *positive* on paper — 46 trades, WR 32.6%, +0.759R, PF 1.88, +39.1%, maxDD 8.1%,
2024-08→2026-07 net of fees, positive in all 3 chronological folds. It still failed the user's
real bar. Why it was dropped, and the lessons that carry forward:

- **Too few trades to trust.** 46 trades in two years on 15m is ~2/month. At a 32.6% win rate
  that is a long, demoralising losing run between wins — statistically fine, practically unusable.
- **All the edge sat in one knob.** The MACD extension cap; every SMC gate was inert or negative
  (freshness disabling produced a *bit-identical* trade list; purity cost ~10 points of return).
  A strategy resting on one threshold is a fitted threshold, not a mechanism.
- **Fixed 1% stop ignores ZEC's volatility regime.** ZEC ranged $27→$700 over the sample; a
  constant % stop is far too tight in high-vol regimes and too loose in quiet ones. **Any future
  ZEC intraday strategy must scale stops by ATR, not by a fixed percentage.**
- **Fees dominate tight stops.** 0.1%/side on a 1% stop is ~0.2R per trade — 20% of risk, which
  pushed breakeven WR from 16.7% to ~20%.

Do not rebuild it. If revisiting divergence on ZEC, the only reusable finding is that a MACD
higher high *far above the zero line* marks an exhausted leg — useful as a **filter inside another
strategy**, not as a strategy on its own.

## `liqbrk` - buy-side liquidity continuation (July 2026)

A **swing** system that runs on 15m bars: it holds ~30h and trades ~6x/month. It is **not** a
day-trading setup - three day-trade variants were built and all lost to it (see below). Built for
**ZEC 15m**, day-denominated so it runs on any TF. Long only.

**The finding that drove it.** Three original liquidity strategies were built and all three lost
money in *every* fold (see the rejection list below). A forward-return study explained why: on ZEC
15m the classic SMC premise is inverted. Measuring the +96-bar forward return from the next open,
against an unconditional baseline of **+0.647%**:

| feature | weakest bucket | strongest bucket |
|---|---|---|
| position in the 96-bar range | bottom 20% ("discount") **-0.022%** | top 20% (breakout) **+1.645%**, 54% up |
| distance from rolling VWAP | below VWAP +0.19% | > +3 ATR above **+1.501%**, 55% up |
| RSI(14) | 25-40 -> +0.31% | **>75 -> +1.867%**, 57% up |
| 96-bar momentum | -3...+3% -> +0.129% | **>+8% -> +1.932%** |
| ATR% of price | mid -> +0.30% | **>1.2% -> +2.218%** |
| hour of day (UTC) | 0.629% | 0.667% - **no session edge at all** |

Monotone in the same direction on every feature. **Buying "discount" on ZEC 15m returns less than a
random entry.** Strength continues; weakness does not revert. A breakout *is* a liquidity event -
short stops and resting breakout orders sit above the prior high - so the correct trade is to join
the raid, not fade it.

**Rules** (lookbacks day-denominated unless marked bar-native; `S(d)` = d days in bars):
1. **Entry** - the FIRST close above the prior `lbBreak` **2-day** high (the BSL pool),
   **and** close > the `lbTrend` **5-day** SMA, **and** close > the `lbMaBars` **149-bar** SMA
   *of the timeframe being traded* (see below), **and** volume >= `lbRelVol` **1.3x** its 1-day average.
2. **Stop** - `lbStop` **3 x ATR** of the trading timeframe. Deliberately bar-native, not a fixed %:
   ZEC ran $21->$750 in the sample and a constant-% stop is the documented reason `zecdiv` failed.
3. **Exit** - trail out on a close below the prior `lbExit` **1-day** low, or the stop. The 149 MA
   gates **entries only** - an open position is never closed because price slips back under it.

**The 149 MA filter is bar-native on purpose, and it is the one exception to the day-denominated
rule.** Every other lookback here is stated in days and converted with `S(d)` so a strategy means
the same thing on 15m, 4h and 1d. `lbMaBars` is deliberately *not*: it is 149 bars of whatever
chart is selected, because that is what the trader reads off the screen. Consequence, and it is a
real one: the filter is **not the same economic signal across timeframes** - 149 bars is ~37 hours
on 15m, ~25 days on 4h, ~149 days on 1d. On 15m it is a fast filter that sits *inside* the 5-day
(480-bar) `lbTrend` SMA and mostly removes entries that break out while short-term price is still
below its own mean; on 1d it is close to a 200-day-MA regime gate and will cut trade count hard.
Set `lbMaBars: 0` to switch it off.

**Not yet benchmarked.** Added Sep 2026 at the user's request. Every liqbrk number in this file
(and the CORRECTION below) was measured **without** this filter; none of them have been re-run with
it. Before quoting a result for the filtered system, re-run the full-history ZEC 15m benchmark
(258k bars) per the CORRECTION's process lesson - not the cached 2-year window.

**Benchmark, ZEC 15m, 69,120 bars (2024-08 -> 2026-07), net of 0.1%/side:**

| model | trades | WR | PF | return | maxDD | time in market |
|---|---|---|---|---|---|---|
| risk-based (1% equity/trade) | 134 | 33.6% | 2.91 | **+304%** | **13.5%** | 24% |
| exposure, Invest 100% | 134 | 33.6% | 2.91 | +683% | 38.3% | 24% |
| buy & hold | - | - | - | +1086% | **74.0%** | 100% |

Positive in **all three chronological folds**; 6/9 quarters positive with the losing quarters
trivial (-1.0%, -2.2%, -0.6%) against wins of +86.8%, +39.5%, +39.8%.

**It is a plateau, not a fitted cell** - this is the key robustness evidence. Holding everything
else fixed: breakout length 96/144/192 bars all return 245-262%; stop 2.5-4 ATR all work (wider
stop => higher WR, lower DD, monotone); exit length 96/192 both ~250-284%; and the relVol and trend
filters change the result by only a few points. The **mechanism** carries the edge, not a threshold -
the opposite of `zecdiv`, where one knob carried everything.

**Cross-market check** (1% risk): positive on 4/6 coins at 1d (BTC 40% WR / PF 1.46 - ZEC 38%/2.59 -
SOL 44%/2.83 - XRP 28%/2.85 - SUI 35%/1.77 - LINK 41%/1.25) and 4/6 at 4h. Strongest where it was
designed, merely decent elsewhere - the signature of a real effect rather than a curve fit.

**REJECTED on the way here - do not rebuild** (all three lost in every fold, and the excursion study
showed their signal bars were statistically indistinguishable from random bars):
- **S1 stop-run reclaim** - SSL pool raided then reclaimed, bullish candle, volume >=1.5x, buy only
  in discount. n=643, WR 33.0%, PF 0.75, **9/9 losing quarters**. The discount filter was actively
  harmful.
- **S2 session liquidity** - Asian-range (00:00-08:00 UTC) low swept and reclaimed during the
  London/NY window. n=201, WR 45.8% but PF 0.66. Decent hit rate, negative expectancy, and the
  hour-of-day scan later showed **no session edge at all** on this pair.
- **S3 liquidation-cascade fade** - price >=2 ATR below rolling VWAP on a volume spike, reversal bar,
  target VWAP. n=435, WR 36.1%, PF 0.65, 9/9 losing quarters. Fading extension is backwards here.



### CORRECTION: the 13.5% drawdown was a test-window artifact (Aug 2026)

The benchmark above was run on **2024-08 -> 2026-07** because that was the cached window. The
Python desktop tester (`pytester/`, no 10k-bar cap) re-ran `liqbrk` on the **full listed ZEC 15m
history: 258,228 bars, 2019-03-21 -> 2026-08-03**. The result is materially worse and the earlier
"positive in all three folds" claim does NOT survive:

| window | n | WR | PF | net | maxDD | losing quarters |
|---|---|---|---|---|---|---|
| 2024-08 -> 2026-07 (as first reported) | 134 | 33.6% | 2.91 | +304% | **13.5%** | 3/9 |
| **2019-03 -> 2026-08 (full history)** | **553** | **23.9%** | **1.39** | **+199%** | **61.1%** | **15/31** |

Fold breakdown on full history: A +28.1% / **B -33.0% (55.4% drawdown)** / C +248.8%. Fold B spans
roughly 2021-09 -> 2024-01 - ZEC's grind from ~$200 to ~$20. The strategy bleeds for about two and
a half years: 22Q2 -13%, 23Q1 -10%, 23Q3 -21%, 23Q4 -13%, 24Q2 -14%.

**A stronger regime filter does not fix it.** Sweeping `lbTrend` from 5 to 200 days leaves fold B
negative at every setting (expR -0.21 to -0.41); the best it buys is drawdown 61% -> 52%. This is
structural: a long-only breakout system in a multi-year bear market has nothing to do but lose
slowly.

**What is still true:** over 7.4 years it is net positive (+199%) and its 61% drawdown beats buy &
hold's 96%. **What is not true:** that it is a low-drawdown system. Size it as a bull-regime
strategy that will go quiet-to-negative for years at a time, not as an all-weather one.

**Process lesson:** validate on ALL available history, not the window that happens to be cached.
Two years of a bull market flattered every statistic here.

### `liqbrk` is a SWING system, not day trading (recorded July 2026)

It runs on 15m bars but **holds ~1-2 days (avg 30.7h) and trades ~6x/month**. Labelling it
"intraday" was wrong and is corrected in the UI.

**Three genuine day-trading variants were built and ALL lost to it** (identical engine, next-open
fills, 0.1%/side, 1% risk; every candidate forced to avg hold <=12h and >=15 trades/month, and
required positive in all three chronological folds):

| system | n | WR | PF | net | maxDD | /mo | hold |
|---|---|---|---|---|---|---|---|
| **SWING liqbrk (kept)** | 136 | 34.6% | **2.66** | **+250.9%** | **13.3%** | 5.7 | 30.7h |
| DT1 intraday breakout (2h break / 6h trail / 12h cap) | 533 | 36.0% | 1.28 | +126.8% | 18.6% | 22.5 | 7.1h |
| DT2 momentum pullback (dip to fast EMA in uptrend) | 365 | 37.0% | 1.13 | +31.5% | 20.3% | 15.4 | 6.0h |
| DT3 squeeze expansion (range compression -> first break) | 360 | **43.3%** | 1.14 | +25.6% | 17.6% | 15.2 | 4.6h |

DT3 has the best win rate but PF 1.14 and a **negative first fold** - a coin flip after costs.

**Why day trading loses here, quantitatively:**

| | avg gross move/trade | 0.2% round-trip fee as % of that move | total fee drag | biggest winner | top-5 winners = % of gross profit |
|---|---|---|---|---|---|
| SWING | **2.179%** | **9%** | 28% of notional | **+147.9%** | **44%** |
| DT1 | 0.596% | **34%** | **103% of notional** | +49.4% | 15% |

Two independent killers. (1) **Fees**: a day trade's average move is 0.6%, so the round trip takes
34% of it, and across 517 trades the drag exceeds the entire notional. (2) **The fat tail is the
edge**: 44% of the swing system's gross profit comes from its top 5 trades, and its best ran +148%.
A 12h hold cap makes that structurally impossible - you cannot hold a +148% move for 12 hours.

**Do not retry day trading on this pair** unless fees drop by an order of magnitude (maker rebates)
or a genuinely different, higher-frequency edge is found and PROVEN against a random baseline first.

**Engine bug this exposed** (fixed July 2026): `runQuant` guarded *every* strategy with
`if (n < maLen + 2) return` and started its loop at `maLen`, where `maLen` is the **200-day** MA -
19,200 bars on 15m. Any intraday strategy therefore returned **zero trades** on windows shorter
than 200 days, silently. Warm-up is now per strategy.

## Session overlay + `lbBrkExt` + rejected intraday strategies (Sept 2026)

### Session overlay (SHIPPED, visual only)
`index.html` → `SESSIONS` / `sessionBlocks()` / `drawSessions()`. LuxAlgo-style boxes over
each contiguous run of bars inside a session, drawn **first** in `drawOverlay` so they sit
under cycle zones, liq heat and trade zones. Auto-hidden when bar interval ≥ 1d. Toggle:
`#showSessions`. Trade markers on intraday charts read `buy US 18:30` — session + IST clock.

| Block | UTC | IST | Role |
|---|---|---|---|
| Asia | 00–07 | 05:30–12:30 | builds the overnight range |
| Pre-US | 07–13 | 12:30–18:30 | lowest volume/volatility |
| US | 13–21 | 18:30–02:30 | expansion window |

Binance spot 1h 2019–2026: US block averages 97bp range/hour vs 78bp pre-US (1.24×); most
volatile hour is 14:00 UTC / 19:30 IST at 112bp. Note this does **not** contradict the
"no session edge" finding on ZEC — that measured *directional* edge by hour; this is range.

### `lbBrkExt` — decisive-break gate (SHIPPED, **DEFAULT 1.0 — ON**, with `lbStop` 3→4)
New liqbrk param. The close must clear the `lbBreak` high by **≥ n × ATR**, not merely clear it.
**Defaults changed Sep 2026: `lbBrkExt` 0 → 1.0 and `lbStop` 3.0 → 4.0.** Setting `lbBrkExt: 0`
and `lbStop: 3.0` restores the pre-Sep-2026 system exactly (verified byte-identical on SOL 1h,
41,552 bars, 247 trades). `detector.js` and `pytester/strategies.py` were changed together and
cross-checked: identical entry-index lists on SOL 1h (109), BTC 1h (121), LINK 4h (66).

Researched on **Binance spot 1h, 2022-01-01 → 2026-09-28, 10 symbols** (BTC ETH SOL AVAX
LINK XRP ADA DOT BNB DOGE), 0.1%/side, next-bar-open entry, stop-first on intrabar
ambiguity. Port validated against this file's 1d cross-market check (BTC 43.4% WR measured
vs 40% published, SOL 40.4% vs 44%, XRP 28.7% vs 28%).

| | baseline | +brkExt 1.0 | +brkExt +stop 4ATR |
|---|---|---|---|
| trades | 2512 | 655 | 1257 |
| win rate | 30.2% | 33.1% | **35.6%** |
| expectancy | +0.143R | +0.202R | **+0.250R** |
| profit factor | 1.10 | 1.14 | **1.33** |
| max drawdown | −77.8% | — | **−51.8%** |
| 2022 (bear) | −0.211 | — | −0.074 |

Plateau, not a fitted cell — monotone in WR and expR from 0.0 → 1.0 ATR, and IS/OOS agree
at the top (1.0 ATR: IS +0.197 / OOS +0.212). Win rate improved on **10/10 symbols**.

### Still NOT shipped: BTC market veto + concurrency cap
Two further changes measured but **NOT shipped to `detector.js`**, because the app is
single-symbol and has no book-level state:

- **Skip the signal when BTC 30-day momentum < −10%** (BTC read at the signal bar close).
  Pooled: WR 35.6→36.1%, expR +0.250→+0.316, PF 1.33→1.49, and **2022 turns positive
  (−0.074 → +0.085)**. Plateau: monotone from −30% to −5%.
- **Cap open positions at 5 across the book.** Max drawdown −51.8% → −39.6%. Monotone:
  cap3 −33.9%, cap2 −26.1%, cap1 −13.7%.

Together (veto + cap5): n=851, WR 35.8%, expR +0.289, PF 1.50, CAGR +60.6%, maxDD −39.6%,
Sharpe 1.02, **5/5 positive years**, 2022 **+0.195**. 9/10 symbols clear WR ≥30% with
positive expectancy.

**Why the BTC veto works where an own-asset trend gate does not.** Gating on the traded
asset's own rising 50-day MA made 2022 *worse* (−0.211 → −0.479): in a bear, "my MA is
rising" selects for failed counter-trend rallies. BTC momentum is market beta, and the rule
is asymmetric — it vetoes the worst regime instead of requiring the best. Requiring BTC
*strength* (mom ≥ +5%) decays out-of-sample (+0.100); vetoing BTC *weakness* does not.

**Not ZEC-validated.** ZEC is unreachable from the research sandbox (Binance blocked; the
only public ZEC mirror covers 2019-03→2019-12 only, n=12–31 — directionally consistent,
far too small to count). Run `python pytester/liqbrk_v2_test.py` on ZEC 15m full history
(258k bars) before quoting any of these numbers for ZEC, per the CORRECTION's process lesson.

### Sep 2026 — symbol selection: the app's bar-count window cannot pick one
Asked "which symbol does `liqbrk` work on, tested at 650 / 1350 / 4350 bars on 1h and 2h."
Run through `detector.js` itself with the app's own params (`liq=show`, atrLen 14,
lbBrkExt 1.0, exposure equity, 0.1%/side) so the numbers are the app's numbers — pipeline
verified against this file's recorded cross-check: **SOL 1h 109 and BTC 1h 121 entries,
exact match**; pooled 10-symbol 1h WR 36.5% / PF 1.37 vs the research harness's 35.6% / 1.33
(gap = same-bar-close vs next-bar-open entry).

**A single bar-count cell carries almost no information.** Sliding the *same* window back
through history in 1-month steps, per symbol on 1h:

| bars | avg trades/window | WR range across windows | windows disagreeing on sign |
|---|---|---|---|
| 650 | **0.9 – 1.5** | 0% – 100% | 12–26 of 57 |
| 1350 | 2.2 – 3.5 | 0% – 100% | 17–28 of 56 |
| 4350 | 7.7 – 12.4 | 8% – 83% | 13–25 of 51 |

650 bars on 1h is ~27 days; at ~1 trade it is a coin flip, and DOGE 1h/650 returns **zero
trades**. Even at 4350 bars roughly half the windows disagree with the other half on whether
a symbol is profitable (ETH 1h/4350 spans −33.7% to +58.3% on window placement alone). This
is the same window-size trap as the CORRECTION above. **Do not select a symbol, or judge the
strategy, from one bar-count cell.**

**The 2h "edge" was an era, not a timeframe.** Against a matched random-entry control (same
trade count, same hold-length distribution, 3000 draws), full history: 1h beat the control on
2/10 symbols, 2h on **8/10**. But the 2h cache starts 2017–2020 while 1h starts 2022.
Restricting 2h to 2022+ — the identical span — collapses it to **1/10** (BTC, p=0.003).
There is no 2h edge; there was a 2017–2021 bull market.

**Regime is the variable that matters, and it holds out of sample.** Labelling each entry by
whether BTC closed above its own 200-day MA on the prior daily close, pooled over 10 symbols:

| | 1h bull | 1h bear | 2h bull | 2h bear |
|---|---|---|---|---|
| n | 539 | 475 | 687 | 475 |
| win rate | 40.1% | 32.4% | 42.8% | 40.0% |
| profit factor | **1.71** | **1.00** | **2.15** | **1.44** |
| avg net / trade | +1.4% | −0.0% | +2.9% | +1.0% |

Split at 2024-07-01, nothing fitted to either half: 1h bull PF 1.16 (IS) → **2.49** (OS);
1h bear 0.94 → 1.08. 2h bull 2.18 → 2.05; 2h bear 1.56 → 1.13. Bull beats bear in **4/4**
half-by-timeframe cells and the bull edge does not decay. In bear regime on 1h the system is
exactly breakeven (PF 1.00) — consistent with the 2.5-year ZEC bear bleed.

**Most symbols' headline PF is two or three trades.** Bull-regime PF with the best 1 and
best 3 trades removed:

| symbol | 1h PF → drop best 3 | 2h PF → drop best 3 | biggest trade |
|---|---|---|---|
| **BTC** | 2.44 → **1.50** | 2.41 → **1.73** | +30% |
| ETH | 1.69 → 0.97 | 2.64 → **1.62** | +58% |
| LINK | 1.54 → 0.85 | 1.91 → 1.27 | +48% |
| DOGE | 1.56 → 0.81 | 2.61 → 1.17 | +156% |
| AVAX | 2.02 → 1.03 | 4.50 → 1.32 | +200% |
| XRP | 2.97 → 0.89 | 1.59 → 0.60 | +161% |
| SOL | 1.29 → 0.81 | 1.48 → 0.92 | +54% |

AVAX's 4.50 and XRP's 2.97 are single lottery tickets, not systems. **BTC is the only symbol
that stays above 1.0 on both timeframes after dropping its three best trades, and the only
one to beat the random-entry control on same-span (2022+) data.** It also carries the lowest
full-history drawdown (1h −23.2%, vs ETH −39.8%, SOL −41.9%, XRP −58.8%). BTC 1h full
history is the best cell in the whole grid: 121 trades, WR 38.0%, PF 1.68, **+183.6% vs
buy & hold +77.8%, maxDD −23.2%**, 18.8% time in market.

Practical read: **run it on BTC (2h preferred, 1h acceptable), only while BTC is above its
200-day MA, and treat symbol choice as far less important than the regime gate.** ETH on 2h
is a defensible second. SOL does not clear the bar on either timeframe. INJ / ARB / HBAR
were requested but are **not in the research cache and untestable from the sandbox** — and
they are exactly the high-beta short-history profile where the AVAX/XRP fat-tail illusion
shows up, so do not assume they work.

### Sep 2026 — the Compare tab now sweeps windows, and 4h is where `liqbrk` lives
Compare gained a **Window sweep** column, a **Trades** column, **1h and 2h** timeframes, a
**user-set bar count** (`#cmpBars`, with a live span readout) and an **editable symbol list**
(both persisted to `localStorage`). The sweep slides a window of 35% of the loaded history,
stepped by an eighth of itself, across the equity path `pathStats` already builds — so it
costs no extra engine runs and no extra fetches — and reports the share of window placements
that were profitable plus the spread. The ✓ verdict now also requires ≥30 closed trades and
≥70% of windows profitable.

Running it across the symbol list exposed a monotone timeframe ranking, `liqbrk` at each TF's
default bar count (4 symbols BTC/ETH/SOL/LINK, trade counts and window-stability per symbol):

| TF | span | trades | window stability | ✓ rows |
|---|---|---|---|---|
| 1h | ~14 mo | 22–30 | 20–33% | 0 |
| **2h** | ~2.3 y | 27–47 | 33–87% | 1 |
| **4h** | ~4.6 y | 33–45 | **100% on all four** | **4** |
| 1d | ~12.3 y | 9–19 | 13–81% | 0 |
| 1w | ~11.5 y | 0–2 | 0–6% | 0 |

Quality climbs 1h → 2h → 4h and then falls off a cliff at 1d/1w, where the strategy simply
does not fire often enough to measure (1w: 0–2 trades across four symbols). **4h is the peak
on every axis at once** — most trades, best stability, shallowest drawdowns. The full 10-symbol
4h detail:

`liqbrk` on 4h across 10 symbols, 31–45 trades each, sweep stability in brackets:

| symbol | CAGR | maxDD | WR | windows profitable |
|---|---|---|---|---|
| DOGE | +35.9% | −39% | 32% | **100%** (+17% … +147%) |
| ETH | +33.7% | −24% | 47% | **100%** (+10% … +157%) |
| BTC | +31.3% | **−14%** | 52% | **100%** (+19% … +145%) |
| XRP | +27.5% | −36% | 31% | 87% (−4% … +218%) |
| SOL | +24.7% | −32% | 52% | **100%** (+35% … +118%) |
| LINK | +15.2% | −26% | 61% | **100%** (+9% … +42%) |
| BNB | +13.2% | −19% | 57% | **100%** (+6% … +33%) |

### Oct 2026 — CORRECTION: 4h was never capped at 4.6 years, and the shallow drawdowns were fake
The 10,000-bar ceiling was a self-imposed `max=` on the Bars input, **not a Binance limit**.
`fetchKlines` pages backwards through `endTime`, so depth is bounded only by the pair's listing
date: **BTCUSDT 4h reaches 2017-08-17 — 19,959 bars, 9.1 years, two halving cycles.** The old
code comment ("4h maxed: ~4.6y is all Binance serves") was wrong and the Sep 2026 note above
repeated it. The cap is now 60,000 and the 4h/2h defaults are 20,000.

Re-running 4h over 9.1 years instead of 4.6 splits the earlier caveat cleanly in two — one half
was right, the other was not:

| symbol | yrs | trades 4.6y→9.1y | stability 4.6y→9.1y | **maxDD 4.6y→9.1y** |
|---|---|---|---|---|
| ETH | 9.1 | 45 → **92** | 100% → **100%** | −24% → −25% |
| BTC | 9.1 | 42 → **89** | 100% → **100%** | **−14% → −39%** |
| BNB | 8.9 | 37 → **83** | 100% → **100%** | **−19% → −38%** |
| XRP | 8.4 | 42 → 73 | 87% → **100%** | −36% → −36% |
| ADA | 8.4 | 31 → 70 | 53% → **80%** | −44% → −44% |
| LINK | 7.7 | 33 → 66 | 100% → 93% | −26% → −34% |
| DOGE | 7.2 | 34 → 60 | 100% → 87% | **−39% → −74%** |
| SOL | 6.1 | 44 → 58 | 100% → 93% | −32% → −39% |
| DOT | 6.1 | 33 → 45 | 60% → **80%** | −30% → −30% |
| AVAX | 6.0 | 31 → 44 | 87% → 93% | −35% → −35% |

**Wrong half of the caveat:** the bull-only window did *not* overstate consistency. Across two
cycles — including the 2018 and 2022 bears — window stability **held or improved on 7 of 10
symbols**, and ETH/BTC/BNB stayed at 100% over 9.1 years and 83–92 trades. That is far stronger
evidence for the mechanism than the 4.6-year run provided, not weaker.

**Right half, and it matters more:** the short window understated **drawdown** badly. BTC's real
4h drawdown is **−39%, not −14%**; BNB −38% not −19%; DOGE −74% not −39%. Any position sizing
derived from the 4.6-year figures was roughly 2–3× too aggressive on those three. Quote the
9.1-year drawdown.

✓ count went 7/40 → 8/40 and its composition changed: ADA and DOGE dropped out (drawdown), DOT
and AVAX came in (stability). **Note the Yrs column before comparing two rows** — only BTC/ETH
reach 9.1y; SOL, DOT and AVAX only reach ~6y, so they cover one cycle plus change, not two.
Cost: ~208 requests for 10 symbols at 20,000 bars, roughly 20 per symbol.

What 4h still establishes over 1h/2h is sample size — 44–92 trades vs 17–30 — and it remains
the peak of the timeframe ranking.

Counter-example the ✓ correctly rejects: BNB Trend Follow on 1d shows 93% window stability
and +44.3% CAGR, but −84% drawdown and a +5009% top-end window — one enormous trade carrying
a skewed distribution. Stability alone is not a pass.

### Oct 2026 — Compare columns rebuilt around "is this worth my money"
Dropped **CAGR, 6M, 1Y, Sharpe**. CAGR annualises a return whose window length varies per
symbol (SOL/DOT/AVAX reach ~6y where BTC/ETH reach 9.1y), so it silently compared different
periods; the two trailing windows just restated it over arbitrary cuts. Added **Net P/L**,
**vs B&H**, **PF** and **In mkt** (share of bars with capital deployed). Twelve columns, same
width. ✓ is now an investment test: `net>0 AND edge>0 AND PF≥1.3 AND WR≥30% AND DD≤60% AND
n≥30 AND ≥70% of windows profitable` — 5 of 40 rows pass on 4h.

`vs B&H` = `(1+net)/(1+bh) − 1`, i.e. how much richer you ended than holding the same coin over
the same window. Adding it produced the most decision-relevant result in this whole study and
**it contradicts the earlier "trade BTC" conclusion**:

| symbol | trades | Net P/L | **vs B&H** | PF | maxDD | In mkt | stable | yrs |
|---|---|---|---|---|---|---|---|---|
| XRP | 73 | +2,186% | **+1,323%** | 3.14 | −36% | 9% | 100% | 8.4 |
| AVAX | 44 | +1,368% | **+595%** | 5.10 | −35% | 7% | 93% | 6.0 |
| DOT | 45 | +129% | **+491%** | 1.95 | −30% | 7% | 80% | 6.1 |
| ETH | 92 | +2,979% | **+259%** | 3.92 | −25% | 13% | 100% | 9.1 |
| ADA | 70 | +108% | **+120%** | 1.71 | −44% | 7% | 80% | 8.4 |
| DOGE | 60 | +4,930% | +103% | 4.13 | −74% | 8% | 87% | 7.2 |
| **BTC** | 89 | +837% | **−51%** | 2.72 | −39% | 13% | 100% | 9.1 |
| LINK | 66 | +732% | **−70%** | 2.86 | −34% | 9% | 7.7 | 7.7 |
| BNB | 83 | +540% | **−99%** | 2.70 | −38% | 10% | 100% | 8.9 |
| SOL | 58 | +187% | **−93%** | 1.95 | −39% | 9% | 93% | 6.1 |

**On BTC, `liqbrk` made +837% over 9.1 years while simply holding BTC made ~+1,800%.** Trading
it halved the outcome. Same on LINK, BNB and SOL. The Sep 2026 conclusion ("BTC is the symbol
that survives every robustness test") was measuring the wrong thing — robustness of the *edge*,
never whether the edge beat the asset. Both are needed; `vs B&H` supplies the missing half.

**But `vs B&H` is not the whole answer either, which is why `In mkt` shipped alongside it.**
`liqbrk` holds capital for only **7–13% of all bars** and draws down −25% to −44% where BTC
buy & hold drew ~−77%. So the BTC row is "half the money for roughly one-eighth the exposure
and half the drawdown" — a worse *return*, a better *return per unit of risk taken*. Which
matters depends entirely on whether the idle 87% of capital has somewhere else to be. Where
`liqbrk` genuinely wins outright is assets that chopped or round-tripped (XRP, ADA, DOT):
sidestepping their drawdowns beats riding them.

18 of 40 rows beat buy & hold. Sharpe was cut rather than kept because PF (trade quality) and
maxDD (path risk) together cover the same ground more legibly for a trade-based system; the
`vol` pill still reports annualised equity volatility if a quick risk read is wanted.

### REJECTED — do not rebuild
- **Breakeven stops.** BE after +1R: WR **30.2% → 21.3%**, expR +0.143 → +0.019, PF 0.97.
  +1.5R and +2R also worse. Converts fat-tail winners into scratches — same mechanism as
  the 12h hold cap.
- **Chandelier / ATR trailing stop.** 3×ATR from the high: expR **−0.141**, PF 0.68,
  **0/5 positive years**, mean hold 45h → 15h. 4×ATR: −0.085, 1/5.
- **Own-asset trend gate** (rising 50d MA, or close > 200d MA). Amplifies the bear loss.
- **relVol ≥ 3.0.** In-sample +0.226, out-of-sample +0.064. Decays.
- **Tighter exits generally.** 0.5-day trail raises WR to 32.2% but cuts expR to +0.057.
- **Compression-fade and sweep-displacement intraday strategies** (S2/S3 in
  `pytester/session_bt.py`). S3 has a **negative edge before fees** (−0.028R gross). This
  reproduces the three earlier sweep-fade rejections — that is six now. Do not build a seventh.
- **Cross-symbol breadth filter** ("trade only when ≥4 of 5 symbols signal the same way").
  Showed +120% CAGR / Sharpe 2.41. It was **look-ahead** — the daily count included symbols
  that signalled later. Causally it is −4.0% CAGR / Sharpe −0.26.

### Structural note
Every filter tested trades win rate against expectancy *except* `lbBrkExt` and the BTC veto.
`lbBrkExt` works because it removes breakouts that barely cleared the pool — those fail
often **and** rarely run. The veto works because it removes a regime rather than trimming
trades. Neither touches the fat tail, which is where the edge lives.

## `cycle` — the BTC halving playbook (July 2026)

BTC-specific full-cycle machine built from the signals that repeated at every cycle turn
in-data (2015→2026; 2013 supported by documented history only — no keyless source reaches it):

- **Bottom signals (all four fired at every cycle low, incl. Feb–Jun 2026):** price at the
  200-week MA (×1.1), Mayer multiple < 0.8, weekly RSI < 35, and SMC sweep-reclaim of a major
  low (fired 3 days before the exact FTX bottom).
- **Top signals diminish each cycle:** Pi-Cycle (111d MA × 2 > 350d MA) sold 2017-12-17 and
  2021-04-12 to the day but did NOT fire at the Oct 2025 top; Mayer > 2.4 and weekly RSI > 84
  fire too early mid-bull. So the sell side is Pi-Cycle when it fires, else a persistent
  (5-day, `cyclePersist`) 40-week MA break.
- **Deployment ladder (July 2026):** every real bottom PIERCES the 200w MA (2020 −30%,
  2022 −31%, 2026 −8%), so accumulation is a staged program: **40% at zone A** (200w→×1.1),
  **40% on a zone-B recovery day** (zone B = 0.72–1.0×200w), **20% reserve on the 40-week
  reclaim** — and the **bullish-completion clause**: any unfilled tranche deploys at that
  reclaim, so the program is never left behind. Entry = equal-dollar (harmonic) weighted
  average of fills; **SL 0.65×200w** for all tranches — under the deepest pierce on record
  (the 2022 program survived the $15.5k FTX wick by 3% by design); TP display = the euphoria
  zone (1.85×200d). The Advisor panel prints the live ladder with exact prices and the
  deployed fraction; every trade row carries Buy @ / SL / Exit-TP prices.
- **Machine:** CASH → ACCUM (zone entries, zone-based stop) → TREND (price > 40w MA) → exit
  on Pi or persistent 40w break; post-Pi cooldown until price < 40w MA. Full-run 2015→2026
  all-in with fees: 10 positions, the 2015 $262→Pi-2017 $18,860 and 2022 avg-$22.2k→$92.2k
  holds carry it; maxDD 56%.
- Chart draws the live zones: green buy band A, faint deep band B, red euphoria band
  (1.85–2.4 × 200d MA), blue dashed 40w line. Zone prices at the right edge are TODAY'S
  actionable levels and drift with the MAs.

**Removed from the app (July 2026, user decision — history in git):** `composite` and
`meanrev`. The universe strategy set is now `cycle` / `tsmom` / `donch`.

## The flagship: `composite` — vol-targeted ensemble (tuned July 2026)

Blends the three trend signals (close > SMA200, 90d return > 0, close > 55d-channel mid):
**invests after the score holds ≥2 for `persist`=3 straight days** (whipsaw filter), **exits
when the score drops to `compExit`=0 or on the `chandMult`=2.5×ATR chandelier trail** from the
highest close since entry (plus the initial 2×ATR hard stop), and sizes each hold by
**volatility targeting** — exposure = `volTarget` 30% annualized / realized 30d vol, capped
at 1. Signal blending + persistence + vol targeting + trailed exits are the defining
techniques of institutional CTA books.

Validation (all-in, **0.1% fees per side**, tuned on BTC/ETH/BNB/SOL/LINK, then run on
XRP/DOGE/ADA unseen): BTC 23% CAGR/dd33/WR38 · ETH 20/30/39 · SOL 27/36/35 · DOGE 19/38/46 ·
ADA 33/39/37 · BNB 21/58/35 · XRP 11/52/25 ✗ · LINK 7/52/32 ✗. Six of eight pass
(CAGR ≥ 15%, dd ≤ 60%, WR ≥ 30%); buy & hold drawdowns on the same coins are 80–96%. The two
failures (XRP, LINK) are the weakest structural trenders — no timing system fixed them
without overfitting, and we don't overfit.

**Liquidity gate** (`liqTargets` / UI "Trade on it"): entries also require the estimated
liquidation fuel resting above price (±25% band) to outweigh the fuel below. Helps BTC
(+1277→+1348%), hurts ETH — ships as an option, default is context-display only.

**Equity model (UI):** `Invest %` of current equity per hold × the strategy's vol-sizing
`frac`, compounded, marked to market daily inside holds. Invest 100% = genuine all-in.

## Investment mode: the three quant strategies (`strategy` param / UI dropdown)

The tool is a long-only spot **investment backtester** on daily bars. The dropdown ships the
three systems the big systematic firms actually run (no SMC rules involved — the structure
drawing stays as chart context only). All-in compounding vs buy & hold, full listed history
(≈6–8y, BTC/ETH/BNB/SOL):

| strategy | rule | BTC | ETH | BNB | SOL |
|---|---|---|---|---|---|
| `tsmom` **Trend Follow (CTA)** | long while close > SMA200 AND 90d return > 0, flat otherwise | **+2152%** dd48% | **+1084%** dd71% | +2979% dd80% | +1066% dd72% |
| `meanrev` **Dip Buyer** | in uptrend (close > SMA200), buy z-score ≤ −2.5 panic vs SMA20, sell the bounce at the mean (stop 3×ATR, 10d timeout) | +24% dd24% | +52% dd20% | +17% dd35% | +32% dd23% |
| `donch` **Turtle Breakout** | buy a close above the 55d high, exit on a close below the 20d low (stop 2×ATR) | +552% dd46% | **+1269%** dd52% | +3272% dd57% | +1039% dd57% |
| — buy & hold | | +609% dd77% | +181% dd90% | +4283% dd76% | +2249% dd96% |

Read it honestly: **trend following and turtle breakout beat or match buy & hold with roughly
half the drawdown** (tsmom 3.5×'s BTC, donch 7×'s ETH); mean reversion is the small-but-steady
leg — positive on all four coins with the shallowest drawdowns, sized for many assets at once.
No strategy beats BNB's one-way grind — nothing times a market that never dips.

The SMC strategies (`regime` / `fvg` / `momo` / `scalp`) remain available as params for
experiments; earlier benchmarks (intraday + weekly-context) are in git history. Tested and
REJECTED: turtle-soup sweep fades (PF < 1 everywhere) and order-block taps (22% WR).

---

## 0. Inputs / outputs / parameters

- Input: candles ascending in time `{ time, open, high, low, close }` (UNIX seconds).
- Output of `detectAll`: `{ trades[], legs[], events[], summary, extPivots, intPivots, fvgs, unmitigated, htfBias, trend, strong, ssIdx, ssPrice, majorLowIdx }`.

| param | default | meaning |
|---|---|---|
| `strategy` | `fvg` | `regime` / `fvg` / `momo` (see table above; `scalp` = intraday variant) |
| `longOnly` | false | spot/investment mode — never short (the UI always sets true) |
| `regimeExit` | `daily` | trend-hold exit: `daily` = base-TF CHoCH too (best DD control) / `weekly` = HTF flip only |
| `htfExtMult` | 0 | structure sensitivity of the HTF context walk (0 = same as `extMult`; `regime` auto-uses 2.0) |
| `momoBosOnly` | false | momentum: take only continuation breaks (skip CHoCH reversals) |
| `eqTol` | 0.5 | equal highs/lows merge tolerance, ×ATR (unraided near-equal pivots pool together) |
| `atrLen` | 14 | ATR length (noise scale) |
| `extMult` | 4.0 | external/major pivot threshold, ×ATR — defines the structure (`scalp` forces 3.0 unless user-tuned) |
| `intMult` | 1.5 | internal pivot threshold (display dots only) |
| `fvgMult` | 0.5 | "major" FVG = gap height ≥ `fvgMult × ATR` |
| `fibLevel` | 0.5 | depth of the limit order inside the displacement FVG (0.5 = consequent encroachment) |
| `minRR` | 1.5 | minimum reward:risk — trades that can't pay this are skipped |
| `poiHorizon` | 200 | bars a resting order stays valid after confirmation |
| `discount` | 1.0 | entry must sit in this sweep-side fraction of the leg (1 = off; `minRR` already gates quality) |
| `htfMult` | 1 | higher-timeframe confluence (1 = off; the trailing HTF trend lags too much to help — sweep-tested) |
| `reqSweep` | true | the manipulation is mandatory: the Strong point must have swept a liquidity pool |
| `useLiq` | true | compute Coinglass-style estimated liquidation clusters (chart context) |
| `liqSweep` | false | liq bands may validate the manipulation — benched worse (51.6% vs 66.7% WR), off |
| `liqTargets` | false | liq bands may serve as targets — benched worse (60.6% WR), off |

## 1. Structure: one evolving trend walked from the first major low

External pivots come from an ATR-zigzag (`extMult × ATR` reversal filter).

- **BULLISH:** track a **Strong Low**. A candle **close** above the last external high =
  **BOS↑** → the Strong Low trails up to the most recent external low. A close below the
  Strong Low = **CHoCH↓** → the SuperSaiyyan high becomes the **Strong High**, flip bearish.
- **BEARISH:** mirror. Close below the last external low = **BOS↓** (Strong High trails
  down); close above the Strong High = **CHoCH↑** → flip bullish.
- The **SuperSaiyyan (SS)** extreme is the running high (bull) / low (bear) of the current leg.
- Wick-only breaks never count; every break needs a **close** through the level.

## 2. Liquidity pools (the fuel)

Stops rest just beyond swing pivots. Every external high spawns a **BSL** pool (buy-side
liquidity above it), every external low an **SSL** pool. Near-equal pivots (within 0.5×ATR)
merge into one stronger pool. A pool is **swept** at the first later wick through it.

**Estimated liquidation clusters (Coinglass-style, context only).** Leveraged entries pile in
at swing points; a long opened at `P` with leverage `L` is force-closed at `≈ P×(1−1/L)`.
From every internal pivot we project 25×/50×/100× liquidation levels (pivot highs → long-liq
bands below price, SSL-type; pivot lows → short-liq bands above, BSL-type), merge bands within
0.25×ATR, weight by the volume that entered at the source pivots, and keep the heavy half.
They are drawn as heat bands and returned in `pools` (flag `liq: true`), but they do **not**
drive entries or targets by default: benchmarks showed the synthetic bands dilute the clean
swing-pool sweep signal (WR 66.7% → 51.6% when trusted for sweeps). `liqSweep` / `liqTargets`
exist to re-test that choice as data changes.

## 3. The trade playbook: manipulation → displacement FVG → confirmation → tap

Big players sweep resting liquidity to fill size, leave with displacement, and their unfilled
orders sit in the imbalance that leg leaves behind. So:

1. **MANIPULATION** — the Strong point must have **swept a pool** (SSL below for longs, BSL
   above for shorts) within `poiHorizon` bars before it. No sweep ⇒ no trade (`reqSweep`).
2. **DISPLACEMENT** — the leg away from the sweep must leave at least one **major FVG**
   (gap ≥ `fvgMult×ATR`), still **fresh** (never traded into) as-of the confirmation.
3. **CONFIRMATION** — the leg **closes** through structure: BOS (continuation) or CHoCH
   (reversal). Only now is an order armed — never before the break.
4. **THE ORDER** — a limit rests `fibLevel` deep inside the FVG. Of all fresh major FVGs of
   the leg, take the **shallowest one that still pays ≥ `minRR`** — the zone price retraces
   into most often, i.e. the highest fill-rate that clears the quality bar.
5. **TAP** — the first candle whose wick reaches the entry fills it. **First tap only**: if
   the tap arrives while a position is open, the zone is mitigated and the order dies. Orders
   also expire after `poiHorizon` bars and are cancelled by any structure flip (CHoCH).
6. **STOP** — beyond the sweep wick: `min(strong, sweptPool) − 0.1×ATR` for longs (mirror for
   shorts). The manipulated pool's far side is where the idea is wrong.
7. **TARGET** — the **nearest unswept opposite pool** (BSL for longs / SSL for shorts) that
   still pays ≥ `minRR`: the closest magnet gives the highest hit-rate with positive
   expectancy. No such pool ⇒ major-FVG fallback (`pickTarget`); still under `minRR` ⇒ skip.
8. **OUTCOME** — forward simulation, stop checked before target on the same candle
   (conservative). `win / loss / open`.

## 4. Rejection rules

- No structure break (close through the level) → nothing is ever armed.
- `reqSweep` and no pool swept into the Strong point → no trade (no manipulation, no edge).
- No fresh major FVG in the displacement leg → no trade (no big-player footprint to join).
- No target paying ≥ `minRR` from the entry → no trade (bad math beats good stories).
- Tap while busy / after expiry / after a flip → order cancelled, zone burned.

## 5. Other definitions

- **FVG (3-candle):** bullish at `i` when `high[i-1] < low[i+1]`; filled once later price
  trades back into the gap. **Fresh** = unfilled as-of a given candle.
- **Unmitigated candle (display only):** price impulsively left its range and never returned
  (even by wick) — demand if left above, supply if left below.
- **HTF bias (off by default):** aggregate candles ×`htfMult`, run this same engine, expand
  the trend back per base candle using only the last *closed* HTF bar (no lookahead).
