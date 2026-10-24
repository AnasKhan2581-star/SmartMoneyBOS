# Version 2 research — five new swing strategies vs the current liqbrk (2026-10-24)

**Research only — nothing in the app, the bot or the alerts changed.** All strategies run on 4h candles, spot, long only, signal at a candle close, entry at the next open, 0.05% slippage + 0.1% fee per side, all-in per coin. Every strategy is judged from the same first candle of each coin (after a common warm-up). The engine used here reproduces the shipped liqbrk trade-for-trade (`node research/v2/v2_lab.js parity`). Cycle A = trades entered 2020-01-01 → 2022-12-31 (bull + the 2022 bear), cycle B = 2023 → today.

## 1. The five strategies (simplest → toughest)

**S1 — Simple breakout** — level 1 (simplest)
- BUY: 4h close above the highest high of the previous 20 candles (≈3.3 days)
- SELL: 4h close below the lowest low of the previous 10 candles
- no stop, no filters, no take-profit

**S2 — Trend breakout** — level 2
- BUY: close above the 20-candle high AND above the 50-day EMA
- SELL: close below the 10-candle low
- STOP: 2.5×ATR below entry

**S3 — Volume momentum** — level 3
- BUY: close above the prior 3-day high, volume ≥ 2× its 1-day average, close in the top 30% of the candle,
-      20-day EMA rising (vs 1 day ago), BTC above its 50-day MA
- STOP: 3×ATR · TAKE ⅓ at +2R · rest trails 3×ATR below the highest close (chandelier)

**S4 — Squeeze breakout** — level 4
- SETUP: Bollinger(20, 2σ) inside Keltner(20, 1.5×ATR) on at least one of the previous 6 candles (squeeze)
- BUY: close above the upper Bollinger band AND above the prior 2-day high, volume ≥ 1.5×, close above the 50-day EMA,
-      BTC above its 50-day MA
- STOP: the squeeze-box low (12-candle low) or 3×ATR, whichever is closer, never closer than 1×ATR
- TAKE ½ at +2.5R · rest exits on a close below the 20-candle EMA (Bollinger mid-line)

**S5 — Pro multi-factor** — level 5 (toughest)
- REGIME: BTC above its 50-day MA AND that MA rising over 10 days
- TREND: 10-day EMA > 20-day EMA > 50-day EMA, price above the 10-day EMA
- STRENGTH: coin beat BTC over 30 days AND its coin/BTC ratio is within 3% of a 20-day high
- SETUP: in the last 3 days the price pulled back to within 1×ATR of the 10-day EMA
- TRIGGER: close above the prior 2-day high, volume ≥ 1.5×, close in the top 25% of the candle, ADX(14) ≥ 20
- STOP: 3-day swing low or 3×ATR, whichever is closer, never closer than 1×ATR
- TAKE ⅓ at +2R and ⅓ at +4R · last ⅓ trails 3×ATR below the highest close

**v1 — current liqbrk (reference):** close above the prior 2-day high by ≥ 1×ATR, above the 5-day SMA and the 149-candle MA, volume ≥ 1.3×, BTC above its 50-day MA (or coin +50% in 30 days) · stop 4×ATR · ½ at +3R · rest exits on a close below the prior 1-day low.

## 2. The test coins

5 coins drawn at random (seed 20261024) from the 26 alert coins whose 4h history starts before June 2021 — a coin listed last year would give each strategy a handful of trades and no bear market to survive. **Drawn: CTSI, KNC, MASK, HBAR, XLM.**

## 3. How "most consistent" is decided (fixed before running)

Five measures, each ranked across the five new strategies (1 = best); the lowest average rank wins, ties go to M2. A strategy needs **at least 30 trades pooled over the 5 coins** to be eligible — fewer cannot show consistency.

- **M1** share of coin × cycle cells that did not lose money (net ≥ 0) — consistent across coins AND across bull/bear
- **M2** pooled profit factor after removing the best 2% of trades — does it make money without its jackpots
- **M3** median window stability — share of sliding 35% windows that were profitable
- **M4** median max drawdown (smaller is better)
- **M5** the worst coin's total return (higher is better)

## 4. Results on the 5 coins

| strategy | trades | win rate | PF | PF w/o top 2% | median net | median vs B&H | median max DD | median stable | cells not losing (M1) | worst coin | avg days held |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S1 — Simple breakout | 964 | 30% | 1.17 | 0.60 | −88% | −43% | −94% | 33% | 5/10 | −96% | 3.2 |
| S2 — Trend breakout | 638 | 27% | 1.25 | 0.61 | −78% | +40% | −82% | 20% | 5/10 | −94% | 2.7 |
| S3 — Volume momentum | 182 | 34% | 1.47 | 0.85 | +22% | +332% | −64% | 40% | 5/10 | −64% | 3.3 |
| S4 — Squeeze breakout | 288 | 25% | 0.99 | 0.63 | −20% | +71% | −71% | 40% | 3/10 | −64% | 1.5 |
| S5 — Pro multi-factor | 53 | 17% | 0.57 | 0.44 | −54% | +47% | −59% | 0% | 2/10 | −67% | 2.8 |
| v1 — current liqbrk (shipped) | 182 | 33% | 1.72 | 1.11 | +29% | +711% | −45% | 40% | 5/10 | −77% | 2.3 |

**Per coin** (net return over the coin's history · trades · max drawdown)

| strategy | CTSI | KNC | MASK | HBAR | XLM |
| --- | --- | --- | --- | --- | --- |
| S1 — Simple breakout | −96% · 178 · −100% | −88% · 194 · −94% | −95% · 162 · −99% | +62% · 201 · −88% | +470% · 229 · −85% |
| S2 — Trend breakout | −94% · 125 · −99% | −78% · 119 · −82% | −87% · 109 · −97% | +221% · 131 · −73% | +631% · 154 · −81% |
| S3 — Volume momentum | −63% · 44 · −89% | −64% · 39 · −72% | +22% · 28 · −64% | +64% · 31 · −64% | +650% · 40 · −40% |
| S4 — Squeeze breakout | −20% · 65 · −71% | −64% · 56 · −65% | −62% · 44 · −77% | +12% · 66 · −76% | −2% · 57 · −43% |
| S5 — Pro multi-factor | +13% · 14 · −59% | −67% · 9 · −70% | −58% · 9 · −60% | −19% · 14 · −51% | −54% · 7 · −58% |
| v1 — current liqbrk (shipped) | −77% · 43 · −92% | −33% · 23 · −45% | +29% · 30 · −64% | +728% · 36 · −43% | +460% · 50 · −41% |

**Per coin and cycle** (net return in cycle A / cycle B)

| strategy | CTSI | KNC | MASK | HBAR | XLM |
| --- | --- | --- | --- | --- | --- |
| S1 — Simple breakout | −72% / −87% | −40% / −81% | +51% / −97% | +21% / +68% | +33% / +403% |
| S2 — Trend breakout | −62% / −84% | −57% / −49% | +227% / −96% | +87% / +72% | +59% / +368% |
| S3 — Volume momentum | −25% / −51% | −38% / −42% | +88% / −35% | +46% / +13% | +113% / +274% |
| S4 — Squeeze breakout | +94% / −59% | −33% / −46% | −5% / −60% | +53% / −27% | −2% / +2% |
| S5 — Pro multi-factor | +14% / −1% | −56% / −26% | −40% / −29% | −42% / +40% | −45% / −17% |
| v1 — current liqbrk (shipped) | −42% / −60% | −31% / −4% | +71% / −25% | +52% / +443% | +8% / +292% |

## 5. Consistency ranking

| strategy | trades | M1 cells not losing | M2 PF w/o top 2% | M3 stability | M4 max DD | M5 worst coin | average rank |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S1 — Simple breakout | 964 | 50% (#1) | 0.60 (#4) | 33% (#3) | −94% (#5) | −96% (#5) | **3.6** |
| S2 — Trend breakout | 638 | 50% (#1) | 0.61 (#3) | 20% (#4) | −82% (#4) | −94% (#4) | **3.2** |
| S3 — Volume momentum | 182 | 50% (#1) | 0.85 (#1) | 40% (#1) | −64% (#2) | −64% (#2) | **1.4** |
| S4 — Squeeze breakout | 288 | 30% (#4) | 0.63 (#2) | 40% (#1) | −71% (#3) | −64% (#1) | **2.2** |
| S5 — Pro multi-factor | 53 | 20% (#5) | 0.44 (#5) | 0% (#5) | −59% (#1) | −67% (#3) | **3.8** |

For comparison, v1 on the same coins: M1 50%, M2 1.11, M3 40%, M4 −45%, M5 −77% (182 trades).

**Most consistent: S3 — Volume momentum** → this becomes **version 2**.

## 6. Version 2 (S3 — Volume momentum) on all 61 alert coins, next to v1

|  | coins | trades | win rate | PF | PF w/o top 2% | median net | median vs B&H | median max DD | median stable | coins net > 0 | cycle A cells not losing | cycle B cells not losing |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **version 2** | 61 | 1636 | 36% | 1.41 | 1.02 | +0% | +402% | −52% | 40% | 31/61 | 23/35 | 27/61 |
| v1 (current) | 61 | 1603 | 37% | 1.39 | 0.98 | −4% | +587% | −53% | 40% | 29/61 | 12/35 | 31/61 |

Head-to-head per coin: version 2 made more money on **29/61** coins and had the smaller max drawdown on **26/61**.

| coin | listed | v2 trades | v2 net | v2 vs B&H | v2 max DD | v2 stable | │ | v1 trades | v1 net | v1 vs B&H | v1 max DD | v1 stable |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ONE | 2019-07-24 | 38 | +2068% | +18607% | −41% | 93% | │ | 44 | −27% | +527% | −71% | 40% |
| ZEC | 2019-05-13 | 42 | +692% | −55% | −48% | 60% | │ | 44 | +74% | −90% | −77% | 7% |
| XLM | 2018-07-24 | 40 | +650% | +1215% | −40% | 93% | │ | 50 | +460% | +882% | −41% | 80% |
| LINK | 2019-03-10 | 54 | +626% | −68% | −49% | 93% | │ | 58 | +333% | −81% | −32% | 87% |
| DASH | 2019-05-20 | 45 | +521% | +1986% | −40% | 73% | │ | 35 | +305% | +1261% | −53% | 60% |
| CFX | 2021-05-21 | 28 | +404% | +3963% | −46% | 87% | │ | 28 | +268% | +2861% | −56% | 73% |
| IOST | 2019-05-14 | 45 | +356% | +8070% | −50% | 87% | │ | 38 | −83% | +208% | −84% | 7% |
| ZIL | 2019-04-13 | 44 | +325% | +4290% | −55% | 93% | │ | 49 | −20% | +728% | −78% | 40% |
| STRK | 2024-04-13 | 15 | +208% | +9265% | −28% | 100% | │ | 12 | +46% | +4355% | −40% | 0% |
| ETH | 2017-10-09 | 73 | +190% | −62% | −41% | 93% | │ | 79 | +1794% | +146% | −24% | 100% |
| ARB | 2023-05-15 | 20 | +155% | +1728% | −32% | 60% | │ | 25 | +252% | +2425% | −29% | 67% |
| ETC | 2018-08-04 | 53 | +155% | +460% | −43% | 100% | │ | 53 | +716% | +1694% | −32% | 100% |
| PHA | 2021-08-17 | 21 | +147% | +3948% | −52% | 73% | │ | 19 | −43% | +826% | −54% | 13% |
| INJ | 2020-12-13 | 41 | +136% | −34% | −55% | 80% | │ | 52 | −74% | −93% | −78% | 53% |
| PROM | 2023-05-09 | 18 | +126% | +83% | −41% | 73% | │ | 16 | +38% | +12% | −35% | 53% |
| BANK | 2026-01-05 | 1 | +118% | +307% | −49% | 53% | │ | 7 | +22% | +128% | −55% | 47% |
| BCH | 2020-01-20 | 53 | +100% | +155% | −44% | 87% | │ | 49 | +438% | +587% | −32% | 100% |
| EPIC | 2025-05-05 | 11 | +97% | +1747% | −35% | 60% | │ | 8 | +259% | +3266% | −29% | 53% |
| SAND | 2020-10-06 | 33 | +87% | +76% | −61% | 33% | │ | 34 | −44% | −47% | −60% | 33% |
| SOL | 2020-10-03 | 50 | +72% | −95% | −59% | 47% | │ | 50 | +297% | −90% | −32% | 100% |
| NIGHT | 2026-05-03 | 1 | +69% | +39% | −12% | 33% | │ | 6 | +54% | +26% | −18% | 67% |
| COTI | 2020-04-19 | 43 | +66% | +228% | −57% | 80% | │ | 33 | −52% | −5% | −70% | 27% |
| HBAR | 2019-11-21 | 31 | +64% | −42% | −64% | 47% | │ | 36 | +728% | +190% | −43% | 100% |
| JASMY | 2022-01-14 | 27 | +52% | +2370% | −50% | 80% | │ | 29 | +23% | +1893% | −40% | 60% |
| TUT | 2025-05-20 | 11 | +50% | +138% | −50% | 53% | │ | 11 | +174% | +334% | −46% | 20% |
| W | 2024-05-26 | 10 | +47% | +6676% | −31% | 40% | │ | 7 | +13% | +5115% | −25% | 7% |
| XEC | 2021-10-26 | 24 | +34% | +3976% | −34% | 67% | │ | 25 | +48% | +4391% | −55% | 73% |
| MASK | 2021-07-17 | 28 | +22% | +1190% | −64% | 40% | │ | 30 | +29% | +1260% | −64% | 40% |
| SEI | 2023-10-07 | 24 | +19% | +162% | −46% | 27% | │ | 19 | +58% | +249% | −33% | 80% |
| 1INCH | 2021-02-16 | 32 | +15% | +6204% | −39% | 67% | │ | 20 | −0% | +5387% | −30% | 67% |
| COMP | 2020-08-17 | 37 | +0% | +698% | −63% | 53% | │ | 28 | −37% | +398% | −62% | 27% |
| AXL | 2024-04-23 | 11 | −7% | +2383% | −35% | 47% | │ | 8 | −4% | +2467% | −26% | 27% |
| CVX | 2022-02-14 | 28 | −7% | +927% | −66% | 40% | │ | 24 | +114% | +2263% | −39% | 87% |
| NIL | 2025-05-16 | 11 | −11% | +386% | −54% | 33% | │ | 6 | −9% | +398% | −40% | 7% |
| ERA | 2025-09-08 | 5 | −22% | +569% | −23% | 27% | │ | 5 | −33% | +470% | −38% | 13% |
| BOME | 2024-05-08 | 15 | −27% | +1170% | −60% | 13% | │ | 17 | −47% | +817% | −68% | 13% |
| INIT | 2025-06-16 | 9 | −31% | +158% | −41% | 0% | │ | 11 | −39% | +128% | −57% | 0% |
| REZ | 2024-06-22 | 15 | −33% | +1404% | −55% | 20% | │ | 13 | −34% | +1391% | −42% | 0% |
| AMP | 2022-01-15 | 14 | −33% | +3689% | −57% | 27% | │ | 23 | −18% | +4524% | −55% | 80% |
| ARPA | 2019-12-29 | 44 | −37% | −35% | −74% | 33% | │ | 39 | −81% | −80% | −83% | 27% |
| TAO | 2024-06-03 | 9 | −37% | −3% | −45% | 13% | │ | 15 | +18% | +83% | −26% | 67% |
| ZRO | 2024-08-12 | 9 | −39% | +28% | −53% | 0% | │ | 12 | −17% | +74% | −50% | 27% |
| ARK | 2023-11-14 | 15 | −40% | +402% | −44% | 7% | │ | 15 | +12% | +843% | −48% | 20% |
| PARTI | 2025-05-17 | 6 | −42% | +398% | −46% | 0% | │ | 9 | −57% | +265% | −65% | 7% |
| S | 2025-03-10 | 10 | −42% | +427% | −48% | 0% | │ | 11 | −11% | +701% | −28% | 7% |
| APT | 2022-12-11 | 24 | −43% | +296% | −62% | 7% | │ | 27 | −38% | +331% | −72% | 7% |
| ZK | 2024-08-09 | 15 | −43% | +433% | −63% | 0% | │ | 12 | −12% | +725% | −43% | 0% |
| LUMIA | 2024-12-10 | 9 | −44% | +1265% | −53% | 40% | │ | 12 | −7% | +2154% | −47% | 40% |
| LSK | 2020-03-30 | 36 | −45% | +213% | −79% | 0% | │ | 24 | +44% | +719% | −66% | 13% |
| AVA | 2021-01-16 | 29 | −46% | +102% | −54% | 47% | │ | 30 | −76% | −8% | −78% | 40% |
| SYN | 2023-04-16 | 15 | −48% | +252% | −62% | 0% | │ | 22 | +44% | +872% | −72% | 13% |
| LA | 2025-09-01 | 6 | −51% | +132% | −51% | 0% | │ | 8 | −66% | +59% | −66% | 0% |
| RLC | 2020-01-06 | 44 | −53% | −67% | −78% | 7% | │ | 36 | +42% | −2% | −64% | 47% |
| STX | 2019-12-17 | 57 | −61% | −89% | −83% | 27% | │ | 56 | +173% | −25% | −61% | 73% |
| TIA | 2023-12-24 | 18 | −61% | +854% | −73% | 0% | │ | 15 | −20% | +1884% | −36% | 47% |
| CTSI | 2020-06-15 | 44 | −63% | −52% | −89% | 0% | │ | 43 | −77% | −69% | −92% | 7% |
| KNC | 2020-08-04 | 39 | −64% | +332% | −72% | 0% | │ | 23 | −33% | +711% | −45% | 40% |
| BICO | 2022-01-31 | 23 | −65% | +4736% | −66% | 7% | │ | 20 | −31% | +9540% | −59% | 40% |
| ALT | 2024-03-18 | 13 | −66% | +2338% | −66% | 0% | │ | 11 | −61% | +2682% | −61% | 0% |
| WOO | 2022-04-02 | 34 | −72% | +1599% | −81% | 0% | │ | 26 | −20% | +4819% | −56% | 53% |
| GTC | 2021-08-02 | 36 | −88% | +260% | −88% | 0% | │ | 36 | −79% | +523% | −89% | 0% |

## 7. One pot of money across all 61 coins (what an account would have done)

Each new trade gets equity ÷ N if a slot is free (otherwise skipped; ties go to the stronger signal), marked to market every 4h. **Hindsight warning:** this coin list was assembled in October 2026 from coins that recently ran or ranked well, so every row here is flattered; compare the rows with each other, not with what to expect.

| strategy | from | slots N | trades taken | skipped (slots full) | end value | CAGR | max DD | avg % invested | worst year |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| version 2 | 2020 | 5 | 772 | 827 | 27.9× | +63% | −57% | 34% | 2025 −24% |
| version 2 | 2020 | 10 | 1224 | 375 | 7.3× | +34% | −49% | 27% | 2025 −29% |
| version 2 | 2023 | 5 | 511 | 646 | 2.2× | +22% | −57% | 37% | 2025 −24% |
| version 2 | 2023 | 10 | 819 | 338 | 1.5× | +12% | −49% | 31% | 2025 −29% |
| v1 (current) | 2020 | 5 | 1068 | 483 | 13.5× | +47% | −66% | 28% | 2021 −24% |
| v1 (current) | 2020 | 10 | 1396 | 155 | 7.5× | +34% | −50% | 19% | 2025 −22% |
| v1 (current) | 2023 | 5 | 688 | 417 | 10.7× | +86% | −66% | 32% | 2025 −23% |
| v1 (current) | 2023 | 10 | 961 | 144 | 6.2× | +61% | −50% | 23% | 2025 −22% |
| BTC buy & hold | 2020 | — | — | — | 11.1× | +42% | −77% | 100% | 2022 −64% |
| BTC buy & hold | 2023 | — | — | — | 4.8× | +51% | −53% | 100% | 2026 −9% |

**Year by year (from 2020, 10 slots)**

| year | version 2 | v1 (current) | BTC buy & hold |
| --- | --- | --- | --- |
| 2020 | +54% | +34% | +302% |
| 2021 | +208% | −10% | +60% |
| 2022 | +0% | +1% | −64% |
| 2023 | +62% | +128% | +156% |
| 2024 | −1% | +55% | +121% |
| 2025 | −29% | −22% | −6% |
| 2026 | +34% | +123% | −9% |

## 8. Cost check — version 2 with 0.2% slippage per side (small coins, market orders)

|  | PF | PF w/o top 2% | median net | coins net > 0 |
| --- | --- | --- | --- | --- |
| version 2 @ 0.2% | 1.33 | 0.95 | −8% | 30/61 |
| v1 @ 0.2% | 1.31 | 0.92 | −6% | 29/61 |

## 9. Two improvement checks

**a) Does coin age matter?** Coins listed before 2023 (they have lived through a bear market) vs coins listed since.

| strategy | group | coins | trades | PF | PF w/o top 2% | median net | median max DD | coins net > 0 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| version 2 | listed before 2023 | 35 | 1334 | 1.51 | 1.07 | +52% | −57% | 22/35 |
| version 2 | listed 2023 or later | 26 | 302 | 1.05 | 0.81 | −31% | −46% | 9/26 |
| v1 (current) | listed before 2023 | 35 | 1290 | 1.41 | 1.00 | −0% | −59% | 17/35 |
| v1 (current) | listed 2023 or later | 26 | 313 | 1.34 | 0.95 | −7% | −40% | 12/26 |

**b) Run both, half the money each.** v1 and version 2 were strong in different years (section 7), so two independent half-pots (10 slots each, never rebalanced) may be steadier than either alone.

| book | from | end value | CAGR | max DD | worst year |
| --- | --- | --- | --- | --- | --- |
| version 2 alone | 2020 | 7.3× | +34% | −49% | 2025 −29% |
| v1 alone | 2020 | 7.5× | +34% | −50% | 2025 −22% |
| **half v1 + half version 2** | 2020 | 7.4× | +34% | −44% | 2025 −26% |
| version 2 alone | 2023 | 1.5× | +12% | −49% | 2025 −29% |
| v1 alone | 2023 | 6.2× | +61% | −50% | 2025 −22% |
| **half v1 + half version 2** | 2023 | 3.9× | +42% | −47% | 2025 −24% |
