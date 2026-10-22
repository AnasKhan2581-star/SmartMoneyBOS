# liqbrk research — 2026-10-22

Data: Binance spot 2h klines, full listed history (4h = exact aggregation of 2h). Engine reproduces detector.js trade-for-trade (`node research/liqbrk_lab.js parity`). Fees 0.1%/side. **Honest fills** unless stated: enter at the NEXT bar's open + 0.05% slippage, exit decisions at the close fill at the next open − 0.05%, stops fill at min(open, stop) − 0.05%.

## 1. How much of the edge was the fill assumption? (2h, full history, all 32 coins)

| setup | trades | WR | PF | PF w/o top 2% | median coin net | median vs B&H | coins net > 0 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| close fill (what the app shows) | 2072 | 40% | 1.69 | 1.13 | +60% | +135% | 26/32 |
| honest fill | 2072 | 40% | 1.65 | 1.09 | +53% | +110% | 24/32 |
| honest fill, 149-MA filter OFF | 2362 | 39% | 1.56 | 1.04 | +58% | +84% | 23/32 |

## 2a. Exit variants — 2h, full history, honest fills, all coins

| exit | trades | WR | PF | PF w/o top 2% | median net | median maxDD | median stable | coins better than current | pass ✓ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| current: 4×ATR stop + 1-day-low trail | 2072 | 40% | 1.65 | 1.09 | +53% | −46% | 60% | — | 7 |
| scale out ½ at 3R, rest on current trail | 2072 | 40% | 1.57 | 1.17 | +62% | −44% | 67% | 19/32 | 11 |
| ATR trail from highest close, k=2 | 2231 | 38% | 1.48 | 0.98 | +39% | −41% | 60% | 10/32 | 8 |
| ATR trail from highest close, k=3 | 2027 | 38% | 1.70 | 1.13 | +71% | −49% | 60% | 16/32 | 8 |
| ATR trail from highest close, k=4 | 1877 | 38% | 1.94 | 1.25 | +110% | −56% | 60% | 23/32 | 9 |
| hybrid: current, + 3×ATR trail once +3R | 2079 | 40% | 1.63 | 1.08 | +57% | −46% | 60% | 16/32 | 7 |
| hybrid: current, + 2×ATR trail once +3R | 2095 | 39% | 1.59 | 1.10 | +45% | −45% | 60% | 14/32 | 6 |

## 2b. Exit variants — 4h, full history, honest fills, all coins

| exit | trades | WR | PF | PF w/o top 2% | median net | median maxDD | median stable | coins better than current | pass ✓ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| current: 4×ATR stop + 1-day-low trail | 1246 | 42% | 2.01 | 1.31 | +47% | −42% | 53% | — | 6 |
| scale out ½ at 3R, rest on current trail | 1246 | 42% | 1.85 | 1.34 | +56% | −42% | 67% | 13/32 | 8 |
| ATR trail from highest close, k=2 | 1254 | 39% | 1.95 | 1.29 | +42% | −46% | 60% | 14/32 | 6 |
| ATR trail from highest close, k=3 | 1128 | 41% | 2.34 | 1.45 | +113% | −59% | 73% | 21/32 | 6 |
| ATR trail from highest close, k=4 | 1047 | 41% | 2.41 | 1.51 | +114% | −59% | 60% | 19/32 | 5 |
| hybrid: current, + 3×ATR trail once +3R | 1247 | 42% | 2.07 | 1.31 | +47% | −42% | 53% | 5/32 | 6 |
| hybrid: current, + 2×ATR trail once +3R | 1251 | 42% | 1.93 | 1.30 | +45% | −42% | 53% | 9/32 | 7 |

## 3. BTC regime veto — only enter while BTC is above its 200-day MA (honest fills)

| tf | veto | trades | WR | PF | PF w/o top 2% | median net | median maxDD | coins better | pass ✓ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2h | off | 2072 | 40% | 1.65 | 1.09 | +53% | −46% | — | 7 |
| 2h | ON | 1352 | 41% | 1.85 | 1.22 | +45% | −48% | 16/32 | 8 |
| 4h | off | 1246 | 42% | 2.01 | 1.31 | +47% | −42% | — | 6 |
| 4h | ON | 857 | 42% | 2.17 | 1.37 | +20% | −40% | 13/32 | 5 |

## 4. Per coin, 2h, honest fills, current exit — full history vs last 18,000 bars (~4.1 years)

The 18k window starts around 2022-09-13. Coins listed later have identical rows in both — the window is their whole life.

| coin | group | yrs (full) | trades | WR | PF | PF w/o top 3 | net | vs B&H | maxDD | stable | ✓ | │ | trades 4y | PF 4y | net 4y | vs B&H 4y | maxDD 4y | ✓ 4y |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SOL | yours | 6.2 | 90 | 43% | 1.48 | 1.06 | +132% | −92% | −45% | 87% |  | │ | 67 | 1.41 | +62% | −50% | −45% |  |
| FET | yours | 7.6 | 91 | 44% | 2.15 | 1.36 | +1031% | +1342% | −76% | 93% |  | │ | 56 | 3.02 | +1023% | +385% | −41% | ✓ |
| XLM | yours | 8.4 | 115 | 33% | 2.01 | 0.95 | +448% | +605% | −67% | 60% |  | │ | 46 | 3.26 | +451% | +261% | −58% | ✓ |
| HBAR | yours | 7.0 | 89 | 39% | 1.86 | 0.98 | +325% | +88% | −76% | 53% |  | │ | 55 | 2.61 | +302% | +201% | −35% | ✓ |
| PEPE | yours | 3.4 | 51 | 39% | 1.98 | 1.10 | +248% | +26% | −53% | 67% |  | │ | 51 | 1.98 | +248% | +26% | −53% |  |
| AERO | yours | 0.2 | 6 | 50% | 2.48 | 0.00 | +14% | −38% | −15% | 60% |  | │ | 6 | 2.48 | +14% | −38% | −15% |  |
| INJ | yours | 6.0 | 90 | 33% | 0.89 | 0.60 | −65% | −97% | −94% | 53% |  | │ | 54 | 1.73 | +137% | −48% | −47% |  |
| STRK | yours | 2.6 | 21 | 43% | 2.69 | 0.75 | +126% | +7442% | −40% | 53% |  | │ | 21 | 2.69 | +126% | +7442% | −40% |  |
| ARB | yours | 3.5 | 38 | 47% | 1.82 | 0.79 | +83% | +1165% | −46% | 47% |  | │ | 38 | 1.82 | +83% | +1165% | −46% |  |
| SUI | yours | 3.4 | 48 | 44% | 1.50 | 0.82 | +53% | +84% | −31% | 87% | ✓ | │ | 48 | 1.50 | +53% | +84% | −31% | ✓ |
| ZEC | yours | 7.6 | 98 | 36% | 1.27 | 0.59 | −4% | −95% | −80% | 13% |  | │ | 49 | 1.62 | +45% | −93% | −64% |  |
| RENDER | yours | 4.9 | 45 | 36% | 1.44 | 0.64 | +44% | +209% | −44% | 67% |  | │ | 39 | 1.90 | +123% | −43% | −35% |  |
| RAY | yours | 5.2 | 77 | 30% | 0.95 | 0.62 | −53% | +85% | −86% | 27% |  | │ | 65 | 0.91 | −53% | −86% | −75% |  |
| CFX | yours | 5.5 | 78 | 32% | 2.13 | 0.78 | +228% | +7726% | −67% | 87% |  | │ | 56 | 2.81 | +392% | +304% | −62% |  |
| WIF | added | 2.6 | 26 | 35% | 1.31 | 0.44 | +14% | +1607% | −45% | 40% |  | │ | 26 | 1.31 | +14% | +1607% | −45% |  |
| BONK | added | 2.8 | 33 | 33% | 1.79 | 0.61 | +73% | +723% | −43% | 73% | ✓ | │ | 33 | 1.79 | +73% | +723% | −43% | ✓ |
| TAO | added | 2.5 | 29 | 41% | 2.05 | 0.99 | +86% | +257% | −29% | 73% | ✓ | │ | 29 | 2.05 | +86% | +257% | −29% | ✓ |
| NEAR | added | 6.0 | 75 | 41% | 1.24 | 0.83 | +20% | −81% | −58% | 60% |  | │ | 46 | 1.40 | +45% | +7% | −46% | ✓ |
| AVAX | added | 6.0 | 90 | 46% | 2.69 | 1.05 | +809% | +292% | −46% | 80% | ✓ | │ | 59 | 1.47 | +49% | +180% | −40% | ✓ |
| DOGE | added | 7.3 | 114 | 35% | 2.27 | 1.24 | +1468% | −43% | −70% | 73% |  | │ | 69 | 1.63 | +99% | +53% | −64% |  |
| JUP | added | 2.7 | 32 | 44% | 1.09 | 0.38 | −1% | +61% | −40% | 47% |  | │ | 32 | 1.09 | −1% | +61% | −40% |  |
| TIA | added | 2.9 | 29 | 41% | 1.15 | 0.48 | +2% | +881% | −46% | 40% |  | │ | 29 | 1.15 | +2% | +881% | −46% |  |
| SEI | added | 3.2 | 39 | 44% | 1.20 | 0.66 | +8% | +137% | −44% | 53% |  | │ | 39 | 1.20 | +8% | +137% | −44% |  |
| APT | added | 4.0 | 50 | 36% | 0.85 | 0.42 | −34% | +565% | −70% | 13% |  | │ | 50 | 0.85 | −34% | +565% | −70% |  |
| ONDO | added | 1.5 | 18 | 39% | 0.92 | 0.33 | −11% | +83% | −44% | 47% |  | │ | 18 | 0.92 | −11% | +83% | −44% |  |
| ENA | added | 2.5 | 33 | 45% | 1.57 | 0.77 | +54% | +839% | −45% | 93% | ✓ | │ | 33 | 1.57 | +54% | +839% | −45% | ✓ |
| WLD | added | 3.2 | 42 | 29% | 1.07 | 0.30 | −39% | +143% | −59% | 40% |  | │ | 42 | 1.07 | −39% | +143% | −59% |  |
| FLOKI | added | 3.4 | 51 | 39% | 1.41 | 0.77 | +47% | +110% | −48% | 87% | ✓ | │ | 51 | 1.41 | +47% | +110% | −48% | ✓ |
| OP | added | 4.4 | 53 | 36% | 1.06 | 0.62 | −10% | +311% | −62% | 20% |  | │ | 49 | 1.20 | +11% | +733% | −62% |  |
| BTC | control | 9.1 | 157 | 46% | 2.14 | 1.78 | +1037% | −37% | −31% | 100% |  | │ | 69 | 2.47 | +196% | −31% | −18% |  |
| ETH | control | 9.1 | 158 | 45% | 2.19 | 1.65 | +1140% | +90% | −46% | 93% | ✓ | │ | 77 | 1.05 | −4% | −48% | −39% |  |
| LINK | control | 7.7 | 106 | 45% | 1.95 | 1.48 | +525% | −78% | −40% | 73% |  | │ | 56 | 1.48 | +46% | −7% | −29% |  |

**Group medians (full history):** yours PF 1.82, net +83%, vs B&H +85% · added PF 1.24, net +14% · control PF 2.14, net +1037%

## 5. Can past results pick this cycle's winners? (2h, honest fills, current exit)

Cycle A = 2020-01-01 → 2022-12-31 (2020-21 bull + 2022 bear). Cycle B = 2023-01-01 → today (2023-25 bull and after). Only coins with ≥ 2 years in cycle A qualify.

| coin | A trades | A PF | A net | A vs B&H | │ | B trades | B PF | B net | B vs B&H |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AVAX | 33 | 4.38 | +533% | +130% | │ | 55 | 1.37 | +30% | +122% |
| DOGE | 46 | 3.55 | +1762% | −42% | │ | 65 | 1.09 | −8% | −7% |
| ETH | 46 | 3.38 | +362% | −45% | │ | 75 | 0.93 | −16% | −50% |
| LINK | 41 | 1.93 | +130% | −11% | │ | 52 | 1.42 | +35% | −29% |
| BTC | 52 | 1.71 | +74% | −15% | │ | 63 | 2.42 | +163% | −38% |
| HBAR | 36 | 1.31 | +4% | −69% | │ | 52 | 2.78 | +338% | +160% |
| SOL | 28 | 1.30 | +12% | −62% | │ | 60 | 1.47 | +66% | −73% |
| ZEC | 41 | 1.08 | −14% | −15% | │ | 46 | 1.63 | +47% | −95% |
| NEAR | 31 | 1.07 | −20% | −51% | │ | 42 | 1.46 | +53% | −44% |
| FET | 31 | 1.00 | −29% | −68% | │ | 50 | 2.65 | +531% | +723% |
| XLM | 45 | 0.99 | −25% | −50% | │ | 44 | 3.34 | +467% | +164% |
| INJ | 39 | 0.25 | −88% | −93% | │ | 51 | 1.96 | +195% | −43% |

- Rank correlation of PF, cycle A → cycle B: **ρ = -0.71** · of edge vs buy & hold: **ρ = -0.09** (n = 12; 0 = no relationship, 1 = perfect)
- Top half by cycle-A PF went on to a median cycle-B PF of **1.37** and net **+30%**; bottom half **1.63** and **+66%**.

## 6. What closes trades today (2h, honest fills, current exit)

| exit reason | share of trades | avg result | share of total profit |
| --- | --- | --- | --- |
| 4×ATR stop (intrabar) | 14% | −8% | −57% |
| close below prior 1-day low | 86% | +4% | +157% |

## 7. Walk-forward — does each change hold in both cycles? (honest fills; per-coin medians; coins with ≥ 1 yr in the cycle)


**2h**

| change | A: PF w/o top 2% | A: median net | A: median maxDD | A: coins better | │ | B: PF w/o top 2% | B: median net | B: median maxDD | B: coins better |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| current | 0.96 | −14% | −58% | — | │ | 1.09 | +53% | −45% | — |
| scale ½ at 3R | 1.04 | +3% | −53% | 9/15 | │ | 1.17 | +58% | −42% | 16/31 |
| ATR trail k=3 | 1.02 | +14% | −53% | 11/15 | │ | 1.12 | +54% | −44% | 17/31 |
| ATR trail k=4 | 1.21 | +86% | −56% | 10/15 | │ | 1.21 | +110% | −49% | 20/31 |
| BTC veto | 1.39 | +30% | −42% | 11/15 | │ | 1.19 | +43% | −44% | 16/31 |
| scale ½ at 3R + BTC veto | 1.43 | +32% | −42% | 10/15 | │ | 1.27 | +35% | −42% | 15/31 |

**4h**

| change | A: PF w/o top 2% | A: median net | A: median maxDD | A: coins better | │ | B: PF w/o top 2% | B: median net | B: median maxDD | B: coins better |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| current | 1.10 | −7% | −41% | — | │ | 1.24 | +45% | −40% | — |
| scale ½ at 3R | 1.08 | −1% | −41% | 5/15 | │ | 1.28 | +56% | −38% | 12/31 |
| ATR trail k=3 | 1.34 | +11% | −59% | 7/15 | │ | 1.35 | +98% | −51% | 19/31 |
| ATR trail k=4 | 1.62 | +45% | −54% | 10/15 | │ | 1.28 | +119% | −55% | 18/31 |
| BTC veto | 1.36 | −6% | −40% | 8/15 | │ | 1.33 | +52% | −39% | 16/31 |
| scale ½ at 3R + BTC veto | 1.29 | −7% | −37% | 7/15 | │ | 1.38 | +50% | −37% | 18/31 |

_Integrity check: largest gap between compounded return and the end of the drawdown path across 96 runs: 1.2e-14%._

## 9. ATR-trail plateau check and combinations (honest fills, full history)

| tf | variant | trades | WR | PF | PF w/o top 2% | median net | median maxDD | median stable | median days held | pass ✓ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2h | current | 2072 | 40% | 1.65 | 1.09 | +53% | −46% | 60% | 2.2 | 7 |
| 2h | ATR trail k=3 | 2027 | 38% | 1.70 | 1.13 | +71% | −49% | 60% | 2.4 | 8 |
| 2h | ATR trail k=4 | 1877 | 38% | 1.94 | 1.25 | +110% | −56% | 60% | 3.4 | 9 |
| 2h | ATR trail k=5 | 1775 | 36% | 2.02 | 1.24 | +75% | −58% | 60% | 4.3 | 6 |
| 2h | ATR trail k=6 | 1689 | 35% | 2.08 | 1.26 | +49% | −61% | 60% | 4.9 | 8 |
| 2h | ATR trail k=4 + BTC veto | 1222 | 39% | 2.18 | 1.43 | +118% | −50% | 60% | 3.6 | 9 |
| 2h | scale ½ at 3R + BTC veto | 1352 | 41% | 1.73 | 1.29 | +56% | −42% | 67% | 2.3 | 8 |
| 4h | current | 1246 | 42% | 2.01 | 1.31 | +47% | −42% | 53% | 2.7 | 6 |
| 4h | ATR trail k=3 | 1128 | 41% | 2.34 | 1.45 | +113% | −59% | 73% | 4.8 | 6 |
| 4h | ATR trail k=4 | 1047 | 41% | 2.41 | 1.51 | +114% | −59% | 60% | 7.0 | 5 |
| 4h | ATR trail k=5 | 976 | 39% | 2.74 | 1.53 | +117% | −61% | 80% | 9.0 | 6 |
| 4h | ATR trail k=6 | 936 | 37% | 2.77 | 1.57 | +114% | −67% | 73% | 10.2 | 4 |
| 4h | ATR trail k=4 + BTC veto | 709 | 43% | 2.69 | 1.71 | +77% | −55% | 67% | 7.2 | 4 |
| 4h | scale ½ at 3R + BTC veto | 857 | 42% | 1.94 | 1.40 | +21% | −39% | 73% | 2.7 | 5 |

## 10. Recent-form filter — skip a coin while its last D days of signals are net losing (honest fills, current exit)

| tf | window D | trades | WR | PF | PF w/o top 2% | median net | median maxDD | coins better | pass ✓ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2h | off | 2072 | 40% | 1.65 | 1.09 | +53% | −46% | — | 7 |
| 2h | 180 days | 1269 | 39% | 1.46 | 1.01 | +9% | −50% | 7/32 | 2 |
| 2h | 365 days | 1417 | 39% | 1.61 | 1.05 | +28% | −49% | 6/32 | 2 |
| 4h | off | 1246 | 42% | 2.01 | 1.31 | +47% | −42% | — | 6 |
| 4h | 180 days | 853 | 42% | 2.26 | 1.44 | +51% | −43% | 11/32 | 4 |
| 4h | 365 days | 819 | 43% | 2.15 | 1.43 | +50% | −38% | 9/32 | 3 |

---

# Part 2 — more tests

Every change below is tested **one at a time against the current rules** (honest fills, current exit, no veto, unless the row says otherwise). Columns: **PF w/o top 2%** pools all coins and drops the biggest 2% of trades; **coins PF>1 w/o top 3** counts coins still profitable after losing their own three best trades (the "does it die without its jackpots" test); **A / B** are the same PF w/o top 2% inside cycle A (2020–22, includes the 2022 bear) and cycle B (2023→). **Verdict**: ✅ = better than current in BOTH cycles · ⚠ = better in one only · ❌ = better in neither (±0.03 counts as equal).


## 11. Market filters — only take a signal when …

Tests your observation directly ("it works when BTC is moving"). BTC gates use the last CLOSED BTC 2h bar, nothing later. "Own 200d MA" needs 200 days of the coin's own history, so a new listing cannot trade its first 200 days under it. "Beating BTC (30d)" = the coin's 30-day return is above BTC's.


**2h**

| variant | trades | WR | PF | PF w/o top 2% | coins PF>1 w/o top 3 | median net | median maxDD | coins better | A | B | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| current (no filter) | 2072 | 40% | 1.65 | 1.09 | 8/32 | +53% | −46% | — | 0.96 | 1.09 | — |
| BTC above its 200-day MA | 1352 | 41% | 1.85 | 1.22 | 9/32 | +45% | −48% | 16/32 | 1.39 | 1.19 | ✅ |
| BTC above its 100-day MA | 1414 | 42% | 1.97 | 1.34 | 10/32 | +63% | −45% | 20/32 | 1.47 | 1.31 | ✅ |
| BTC above its 50-day MA | 1520 | 41% | 2.01 | 1.36 | 12/32 | +75% | −45% | 20/32 | 1.40 | 1.32 | ✅ |
| BTC up over the last 30 days | 1502 | 41% | 2.00 | 1.34 | 12/32 | +98% | −41% | 21/32 | 1.33 | 1.31 | ✅ |
| BTC up over the last 24 hours | 1828 | 39% | 1.68 | 1.09 | 9/32 | +25% | −47% | 12/32 | 0.98 | 1.06 | ❌ |
| coin above its own 200-day MA | 993 | 40% | 1.81 | 1.16 | 5/32 | +35% | −45% | 11/32 | 1.13 | 1.16 | ✅ |
| coin above its own 50-day MA | 1468 | 40% | 1.84 | 1.21 | 8/32 | +60% | −45% | 19/32 | 1.09 | 1.20 | ✅ |
| coin beating BTC over 30 days | 1206 | 40% | 1.72 | 1.12 | 5/32 | +21% | −45% | 12/32 | 1.00 | 1.08 | ⚠ |
| BTC > 200d MA AND coin beating BTC | 792 | 42% | 2.00 | 1.31 | 7/32 | +31% | −45% | 13/32 | 1.40 | 1.27 | ✅ |
| BTC up > 2% over the last 24 hours | 1093 | 43% | 2.03 | 1.36 | 7/32 | +43% | −39% | 17/32 | 1.10 | 1.45 | ✅ |
| coin listed ≥ 90 days | 1986 | 40% | 1.68 | 1.10 | 9/32 | +60% | −45% | 18/32 | 0.96 | 1.12 | ❌ |

**4h**

| variant | trades | WR | PF | PF w/o top 2% | coins PF>1 w/o top 3 | median net | median maxDD | coins better | A | B | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| current (no filter) | 1246 | 42% | 2.01 | 1.31 | 11/32 | +47% | −42% | — | 1.10 | 1.24 | — |
| BTC above its 200-day MA | 867 | 42% | 2.16 | 1.37 | 9/32 | +16% | −40% | 13/32 | 1.32 | 1.33 | ✅ |
| BTC above its 100-day MA | 921 | 43% | 2.31 | 1.51 | 10/32 | +40% | −41% | 20/32 | 1.42 | 1.46 | ✅ |
| BTC above its 50-day MA | 1013 | 43% | 2.33 | 1.52 | 12/32 | +66% | −40% | 20/32 | 1.34 | 1.43 | ✅ |
| BTC up over the last 30 days | 984 | 42% | 2.26 | 1.46 | 13/32 | +44% | −40% | 19/32 | 1.42 | 1.38 | ✅ |
| BTC up over the last 24 hours | 1067 | 42% | 2.00 | 1.35 | 9/32 | +39% | −42% | 14/32 | 1.11 | 1.27 | ❌ |
| coin above its own 200-day MA | 639 | 43% | 2.23 | 1.43 | 5/32 | +20% | −36% | 12/32 | 1.55 | 1.44 | ✅ |
| coin above its own 50-day MA | 1026 | 42% | 2.10 | 1.36 | 8/32 | +52% | −42% | 15/32 | 1.30 | 1.28 | ✅ |
| coin beating BTC over 30 days | 835 | 42% | 2.05 | 1.38 | 8/32 | +46% | −40% | 12/32 | 1.32 | 1.27 | ✅ |
| BTC > 200d MA AND coin beating BTC | 572 | 43% | 2.31 | 1.57 | 6/32 | +25% | −32% | 12/32 | 1.61 | 1.49 | ✅ |
| BTC up > 2% over the last 24 hours | 652 | 46% | 2.54 | 1.68 | 10/32 | +45% | −33% | 16/32 | 1.17 | 1.86 | ✅ |
| coin listed ≥ 90 days | 1199 | 42% | 2.07 | 1.34 | 10/32 | +47% | −42% | 16/32 | 1.18 | 1.29 | ✅ |

## 12. Entry parameters — is each default on a plateau?

One parameter moved at a time, everything else at today's defaults (relVol 1.3, breakout extension 1.0×ATR, 2-day high, 4×ATR stop, 149-bar MA). A default you can trust sits in a flat region: its neighbours should be close to it, not much worse.


**2h**

| variant | trades | WR | PF | PF w/o top 2% | coins PF>1 w/o top 3 | median net | median maxDD | coins better | A | B | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| current defaults | 2072 | 40% | 1.65 | 1.09 | 8/32 | +53% | −46% | — | 0.96 | 1.09 | — |
| volume ≥ 1.0× (off) | 2110 | 39% | 1.62 | 1.07 | 8/32 | +54% | −46% | 8/32 | 0.93 | 1.08 | ❌ |
| volume ≥ 1.6× | 1991 | 40% | 1.65 | 1.09 | 11/32 | +63% | −46% | 16/32 | 0.93 | 1.12 | ❌ |
| volume ≥ 2.0× | 1790 | 40% | 1.73 | 1.13 | 11/32 | +65% | −44% | 20/32 | 0.97 | 1.15 | ⚠ |
| volume ≥ 3.0× | 1083 | 38% | 1.64 | 1.03 | 5/32 | +34% | −44% | 13/32 | 0.76 | 1.09 | ❌ |
| breakout ext 0 (off) | 5192 | 34% | 1.32 | 0.86 | 12/32 | +39% | −66% | 15/32 | 0.87 | 0.81 | ❌ |
| breakout ext 0.5×ATR | 3616 | 36% | 1.47 | 0.96 | 13/32 | +56% | −57% | 19/32 | 0.92 | 0.93 | ❌ |
| breakout ext 1.5×ATR | 1039 | 41% | 1.67 | 1.09 | 9/32 | +27% | −44% | 13/32 | 0.75 | 1.18 | ⚠ |
| breakout ext 2.0×ATR | 507 | 40% | 1.61 | 1.11 | 4/32 | +3% | −35% | 7/32 | 0.61 | 1.21 | ⚠ |
| breakout of 1-day high | 2456 | 38% | 1.52 | 0.99 | 9/32 | +50% | −55% | 12/32 | 0.94 | 0.96 | ❌ |
| breakout of 3-day high | 1877 | 39% | 1.61 | 1.08 | 10/32 | +34% | −53% | 11/32 | 0.85 | 1.16 | ⚠ |
| breakout of 5-day high | 1551 | 39% | 1.58 | 1.05 | 5/32 | +28% | −49% | 11/32 | 0.87 | 1.07 | ❌ |
| breakout of 10-day high | 1108 | 41% | 1.85 | 1.21 | 6/32 | +28% | −43% | 11/32 | 1.21 | 1.17 | ✅ |
| MA filter 50 bars | 2362 | 39% | 1.56 | 1.04 | 11/32 | +58% | −54% | 12/32 | 0.84 | 1.10 | ❌ |
| MA filter 100 bars | 2239 | 39% | 1.61 | 1.07 | 10/32 | +59% | −52% | 17/32 | 0.86 | 1.14 | ⚠ |
| MA filter 200 bars | 1958 | 40% | 1.70 | 1.12 | 10/32 | +65% | −46% | 24/32 | 0.96 | 1.14 | ⚠ |
| MA filter 300 bars | 1780 | 40% | 1.78 | 1.17 | 10/32 | +48% | −43% | 21/32 | 1.03 | 1.18 | ✅ |
| 5-day SMA filter → 2-day | 2073 | 40% | 1.65 | 1.09 | 8/32 | +53% | −46% | 0/32 | 0.96 | 1.09 | ❌ |
| 5-day SMA filter → 10-day | 2060 | 40% | 1.65 | 1.09 | 8/32 | +53% | −46% | 7/32 | 0.97 | 1.09 | ❌ |

**4h**

| variant | trades | WR | PF | PF w/o top 2% | coins PF>1 w/o top 3 | median net | median maxDD | coins better | A | B | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| current defaults | 1246 | 42% | 2.01 | 1.31 | 11/32 | +47% | −42% | — | 1.10 | 1.24 | — |
| volume ≥ 1.0× (off) | 1301 | 41% | 1.98 | 1.29 | 10/32 | +49% | −43% | 10/32 | 1.11 | 1.24 | ❌ |
| volume ≥ 1.6× | 1141 | 42% | 2.05 | 1.33 | 12/32 | +78% | −47% | 18/32 | 1.20 | 1.28 | ✅ |
| volume ≥ 2.0× | 879 | 41% | 2.02 | 1.27 | 9/32 | +63% | −47% | 10/32 | 1.08 | 1.23 | ❌ |
| volume ≥ 3.0× | 285 | 42% | 2.24 | 1.33 | 1/32 | +1% | −26% | 10/32 | 0.82 | 1.54 | ⚠ |
| breakout ext 0 (off) | 3575 | 36% | 1.48 | 0.95 | 12/32 | +40% | −65% | 14/32 | 0.97 | 0.86 | ❌ |
| breakout ext 0.5×ATR | 2336 | 39% | 1.70 | 1.11 | 12/32 | +54% | −55% | 17/32 | 1.16 | 0.99 | ⚠ |
| breakout ext 1.5×ATR | 603 | 44% | 2.36 | 1.55 | 6/32 | +36% | −35% | 12/32 | 1.52 | 1.50 | ✅ |
| breakout ext 2.0×ATR | 294 | 44% | 2.45 | 1.69 | 4/32 | +21% | −29% | 10/32 | 1.40 | 1.49 | ✅ |
| breakout of 1-day high | 1490 | 41% | 1.87 | 1.23 | 9/32 | +87% | −49% | 18/32 | 1.06 | 1.18 | ❌ |
| breakout of 3-day high | 1130 | 41% | 2.00 | 1.27 | 10/32 | +43% | −46% | 13/32 | 1.27 | 1.18 | ⚠ |
| breakout of 5-day high | 1012 | 40% | 2.00 | 1.25 | 9/32 | +27% | −45% | 10/32 | 1.26 | 1.12 | ⚠ |
| breakout of 10-day high | 819 | 40% | 1.81 | 1.23 | 7/32 | +9% | −44% | 9/32 | 1.38 | 0.99 | ⚠ |
| MA filter 50 bars | 1560 | 41% | 1.86 | 1.22 | 14/32 | +66% | −49% | 15/32 | 0.95 | 1.27 | ❌ |
| MA filter 100 bars | 1389 | 41% | 1.96 | 1.27 | 13/32 | +62% | −49% | 13/32 | 0.96 | 1.28 | ⚠ |
| MA filter 200 bars | 1168 | 42% | 2.05 | 1.34 | 10/32 | +78% | −42% | 15/32 | 1.15 | 1.28 | ✅ |
| MA filter 300 bars | 1070 | 41% | 2.09 | 1.37 | 8/32 | +69% | −44% | 14/32 | 1.18 | 1.30 | ✅ |
| 5-day SMA filter → 2-day | 1248 | 42% | 2.01 | 1.30 | 11/32 | +47% | −42% | 0/32 | 1.10 | 1.24 | ❌ |
| 5-day SMA filter → 10-day | 1230 | 42% | 2.01 | 1.29 | 11/32 | +47% | −44% | 6/32 | 1.12 | 1.23 | ❌ |

## 13. Stop and trade management

Stop width, a breakeven stop, a time stop (exit if the trade has not closed above +1R within N days), and a cool-down after a stop-out. All on the current trail exit.


**2h**

| variant | trades | WR | PF | PF w/o top 2% | coins PF>1 w/o top 3 | median net | median maxDD | coins better | A | B | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| current (4×ATR stop) | 2072 | 40% | 1.65 | 1.09 | 8/32 | +53% | −46% | — | 0.96 | 1.09 | — |
| 2×ATR stop | 2199 | 31% | 1.47 | 0.89 | 4/32 | +29% | −44% | 11/32 | 0.74 | 0.93 | ❌ |
| 3×ATR stop | 2115 | 37% | 1.54 | 1.01 | 7/32 | +53% | −46% | 13/32 | 0.84 | 1.04 | ❌ |
| 5×ATR stop | 2062 | 40% | 1.68 | 1.10 | 11/32 | +47% | −47% | 16/32 | 0.98 | 1.10 | ❌ |
| 6×ATR stop | 2061 | 40% | 1.67 | 1.09 | 10/32 | +47% | −47% | 15/32 | 0.97 | 1.10 | ❌ |
| exit trail: below prior ½-day low | 2241 | 39% | 1.47 | 0.99 | 11/32 | +42% | −44% | 16/32 | 0.78 | 1.05 | ❌ |
| exit trail: below prior 2-day low | 1885 | 39% | 1.87 | 1.19 | 11/32 | +133% | −56% | 18/32 | 1.15 | 1.13 | ✅ |
| exit trail: below prior 3-day low | 1767 | 37% | 1.91 | 1.21 | 10/32 | +59% | −56% | 20/32 | 1.15 | 1.12 | ⚠ |
| breakeven stop after +1R | 2097 | 35% | 1.45 | 0.96 | 5/32 | +14% | −50% | 7/32 | 0.76 | 1.00 | ❌ |
| breakeven stop after +2R | 2074 | 39% | 1.61 | 1.06 | 8/32 | +53% | −46% | 2/32 | 0.94 | 1.06 | ❌ |
| time stop 2 days | 2161 | 44% | 1.67 | 1.08 | 9/32 | +69% | −44% | 22/32 | 0.84 | 1.14 | ⚠ |
| time stop 5 days | 2077 | 40% | 1.65 | 1.09 | 9/32 | +53% | −46% | 15/32 | 0.94 | 1.11 | ❌ |
| cool-down 1 day after a stop | 2070 | 40% | 1.65 | 1.09 | 8/32 | +53% | −46% | 1/32 | 0.96 | 1.09 | ❌ |
| cool-down 3 days after a stop | 2054 | 40% | 1.65 | 1.09 | 8/32 | +53% | −46% | 11/32 | 0.94 | 1.11 | ❌ |
| cool-down 7 days after a stop | 2012 | 40% | 1.66 | 1.10 | 8/32 | +44% | −46% | 10/32 | 0.95 | 1.11 | ❌ |

**4h**

| variant | trades | WR | PF | PF w/o top 2% | coins PF>1 w/o top 3 | median net | median maxDD | coins better | A | B | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| current (4×ATR stop) | 1246 | 42% | 2.01 | 1.31 | 11/32 | +47% | −42% | — | 1.10 | 1.24 | — |
| 2×ATR stop | 1281 | 36% | 1.86 | 1.14 | 10/32 | +36% | −47% | 13/32 | 0.89 | 1.13 | ❌ |
| 3×ATR stop | 1253 | 41% | 2.00 | 1.29 | 12/32 | +47% | −44% | 16/32 | 1.13 | 1.19 | ⚠ |
| 5×ATR stop | 1245 | 42% | 2.02 | 1.31 | 11/32 | +43% | −44% | 9/32 | 1.12 | 1.24 | ❌ |
| 6×ATR stop | 1244 | 42% | 2.05 | 1.33 | 10/32 | +43% | −46% | 13/32 | 1.13 | 1.26 | ⚠ |
| exit trail: below prior ½-day low | 1328 | 39% | 1.79 | 1.13 | 10/32 | +55% | −38% | 11/32 | 0.72 | 1.19 | ❌ |
| exit trail: below prior 2-day low | 1167 | 41% | 2.14 | 1.36 | 13/32 | +94% | −56% | 18/32 | 1.25 | 1.23 | ⚠ |
| exit trail: below prior 3-day low | 1099 | 42% | 2.16 | 1.36 | 8/32 | +71% | −57% | 20/32 | 1.36 | 1.23 | ⚠ |
| breakeven stop after +1R | 1251 | 38% | 1.90 | 1.19 | 10/32 | +40% | −45% | 4/32 | 1.04 | 1.12 | ❌ |
| breakeven stop after +2R | 1247 | 41% | 2.00 | 1.29 | 11/32 | +47% | −42% | 0/32 | 1.10 | 1.22 | ❌ |
| time stop 2 days | 1316 | 46% | 1.86 | 1.20 | 13/32 | +40% | −41% | 11/32 | 0.94 | 1.21 | ❌ |
| time stop 5 days | 1250 | 43% | 2.02 | 1.31 | 11/32 | +46% | −43% | 17/32 | 1.04 | 1.27 | ❌ |
| cool-down 1 day after a stop | 1246 | 42% | 2.01 | 1.31 | 11/32 | +47% | −42% | 0/32 | 1.10 | 1.24 | ❌ |
| cool-down 3 days after a stop | 1244 | 42% | 2.01 | 1.30 | 11/32 | +62% | −42% | 2/32 | 1.04 | 1.25 | ❌ |
| cool-down 7 days after a stop | 1240 | 42% | 2.01 | 1.30 | 11/32 | +62% | −42% | 5/32 | 1.04 | 1.25 | ❌ |

## 14. What do winning trades look like at the moment of entry? (2h, honest fills, current rules, all 32 coins pooled)

Descriptive only — every trade the current rules take, sorted into buckets by what was true when the signal fired. A bucket matters only if it is different in BOTH cycles. Buckets under ~60 trades are noise.


**BTC move over the 24h before the signal**

| bucket | trades | WR | avg trade | PF | A: trades | A: PF | B: trades | B: PF |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| <-2% | 49 | 41% | +1% | 1.13 | 22 | 1.47 | 25 | 0.82 |
| -2% to 0% | 248 | 40% | +1% | 1.33 | 78 | 1.03 | 155 | 1.65 |
| 0% to 2% | 749 | 34% | +2% | 1.45 | 134 | 1.50 | 582 | 1.42 |
| 2% to 5% | 673 | 43% | +2% | 1.86 | 192 | 1.71 | 434 | 1.88 |
| 5%+ | 353 | 45% | +4% | 2.14 | 107 | 1.71 | 210 | 2.46 |

**BTC move over the 7 days before the signal**

| bucket | trades | WR | avg trade | PF | A: trades | A: PF | B: trades | B: PF |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| <-5% | 90 | 37% | +0% | 1.08 | 40 | 0.94 | 41 | 1.02 |
| -5% to 0% | 359 | 37% | +2% | 1.58 | 88 | 1.44 | 246 | 1.51 |
| 0% to 5% | 795 | 41% | +2% | 1.61 | 149 | 1.72 | 610 | 1.60 |
| 5% to 10% | 481 | 39% | +1% | 1.41 | 118 | 0.73 | 334 | 1.76 |
| 10%+ | 347 | 42% | +5% | 2.28 | 138 | 2.18 | 175 | 2.42 |

**Volume vs its 1-day average at the signal**

| bucket | trades | WR | avg trade | PF | A: trades | A: PF | B: trades | B: PF |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1.3× to 2.0× | 339 | 38% | +1% | 1.32 | 82 | 1.35 | 224 | 1.24 |
| 2.0× to 3.0× | 745 | 42% | +3% | 1.88 | 175 | 1.89 | 514 | 1.97 |
| 3.0× to 5.0× | 701 | 41% | +3% | 1.87 | 178 | 1.86 | 491 | 1.79 |
| 5.0×+ | 287 | 33% | +1% | 1.22 | 98 | 0.81 | 177 | 1.51 |

**How far the close cleared the 2-day high (in ATRs)**

| bucket | trades | WR | avg trade | PF | A: trades | A: PF | B: trades | B: PF |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1.0× to 1.5× | 1159 | 39% | +2% | 1.59 | 295 | 1.85 | 797 | 1.50 |
| 1.5× to 2.0× | 490 | 40% | +3% | 1.86 | 120 | 1.26 | 334 | 2.19 |
| 2.0× to 3.0× | 320 | 39% | +1% | 1.38 | 86 | 0.93 | 214 | 1.57 |
| 3.0×+ | 103 | 42% | +4% | 2.02 | 32 | 1.81 | 61 | 1.92 |

**Coin move over the 24h before the signal (how big the pop already was)**

| bucket | trades | WR | avg trade | PF | A: trades | A: PF | B: trades | B: PF |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| <5% | 468 | 43% | +2% | 2.21 | 110 | 2.40 | 306 | 2.14 |
| 5% to 10% | 853 | 38% | +1% | 1.40 | 203 | 1.45 | 603 | 1.41 |
| 10% to 20% | 587 | 39% | +2% | 1.57 | 154 | 1.47 | 404 | 1.58 |
| 20%+ | 164 | 38% | +6% | 1.91 | 66 | 1.28 | 93 | 2.58 |

**Coin move over the 30 days before the signal (already pumped?)**

| bucket | trades | WR | avg trade | PF | A: trades | A: PF | B: trades | B: PF |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| <0% | 730 | 38% | +1% | 1.31 | 156 | 0.72 | 516 | 1.54 |
| 0% to 25% | 677 | 41% | +1% | 1.54 | 180 | 1.48 | 453 | 1.52 |
| 25% to 50% | 324 | 39% | +1% | 1.31 | 90 | 1.10 | 220 | 1.41 |
| 50% to 100% | 209 | 41% | +5% | 2.10 | 61 | 1.65 | 133 | 2.19 |
| 100%+ | 116 | 42% | +12% | 3.58 | 40 | 4.86 | 75 | 3.06 |

**Coin vs 200 days ago (its own big trend)**

| bucket | trades | WR | avg trade | PF | A: trades | A: PF | B: trades | B: PF |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| <-50% | 352 | 34% | −0% | 0.99 | 97 | 0.60 | 228 | 1.16 |
| -50% to 0% | 610 | 39% | +1% | 1.52 | 109 | 0.83 | 464 | 1.76 |
| 0% to 100% | 540 | 42% | +4% | 2.27 | 131 | 1.75 | 396 | 2.50 |
| 100% to 300% | 197 | 41% | +3% | 1.78 | 70 | 2.42 | 116 | 1.42 |
| 300%+ | 164 | 41% | +2% | 1.49 | 69 | 1.66 | 91 | 1.29 |

**Volatility: ATR as % of price**

| bucket | trades | WR | avg trade | PF | A: trades | A: PF | B: trades | B: PF |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0.0% to 1.0% | 141 | 40% | +2% | 2.45 | 21 | 2.75 | 104 | 2.25 |
| 1.0% to 1.5% | 380 | 43% | +2% | 2.06 | 91 | 2.13 | 245 | 2.08 |
| 1.5% to 2.0% | 499 | 41% | +2% | 1.69 | 104 | 1.15 | 361 | 1.94 |
| 2.0% to 3.0% | 675 | 37% | +1% | 1.38 | 191 | 1.65 | 461 | 1.27 |
| 3.0%+ | 377 | 39% | +4% | 1.72 | 126 | 1.34 | 235 | 1.94 |

**Coin age at the signal (days since Binance listing)**

| bucket | trades | WR | avg trade | PF | A: trades | A: PF | B: trades | B: PF |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0–90 days | 87 | 36% | −0% | 0.96 | 19 | 0.89 | 50 | 0.98 |
| 90–180 days | 102 | 44% | +6% | 2.66 | 30 | 3.99 | 51 | 1.48 |
| 180–365 days | 217 | 38% | +2% | 1.42 | 82 | 0.89 | 98 | 1.93 |
| 365–730 days | 434 | 39% | +3% | 1.73 | 167 | 1.94 | 217 | 1.60 |
| 730+ days | 1232 | 40% | +2% | 1.63 | 235 | 1.10 | 990 | 1.77 |

**UTC hour the signal bar CLOSED**

| bucket | trades | WR | avg trade | PF | A: trades | A: PF | B: trades | B: PF |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 00:00–06:00 | 531 | 37% | +2% | 1.45 | 141 | 1.55 | 353 | 1.37 |
| 06:00–12:00 | 392 | 42% | +5% | 2.33 | 111 | 2.17 | 264 | 2.42 |
| 12:00–18:00 | 633 | 39% | +1% | 1.33 | 154 | 1.09 | 431 | 1.40 |
| 18:00–24:00 | 516 | 42% | +2% | 1.70 | 127 | 1.28 | 358 | 1.88 |

**Day of week (UTC; 0 = Sun)**

| bucket | trades | WR | avg trade | PF | A: trades | A: PF | B: trades | B: PF |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Sun | 263 | 29% | −1% | 0.83 | 60 | 1.17 | 183 | 0.67 |
| Mon | 377 | 40% | +2% | 1.69 | 94 | 1.26 | 248 | 1.93 |
| Tue | 290 | 32% | +0% | 1.12 | 88 | 1.37 | 189 | 0.80 |
| Wed | 301 | 50% | +5% | 2.95 | 81 | 2.21 | 207 | 3.55 |
| Thu | 308 | 44% | +3% | 2.02 | 78 | 2.52 | 210 | 1.89 |
| Fri | 311 | 49% | +3% | 2.36 | 66 | 2.00 | 225 | 2.35 |
| Sat | 222 | 27% | +0% | 1.05 | 66 | 0.57 | 144 | 1.52 |

**BTC regime (above its 200-day MA = 1)**

| bucket | trades | WR | avg trade | PF | A: trades | A: PF | B: trades | B: PF |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| BTC below 200d MA | 748 | 37% | +1% | 1.26 | 243 | 0.77 | 421 | 1.52 |
| BTC above 200d MA | 1324 | 41% | +3% | 1.84 | 290 | 2.10 | 985 | 1.77 |

## 15. Timeframes — the same rules on 2h … 1d (honest fills; 4h–1d are exact aggregations of 2h)

Day-denominated lookbacks scale automatically; the 149-bar MA does not (149 bars = 12 days on 2h, 149 days on 1d), as designed. "trades / coin / yr" is the median.

| tf | variant | trades | trades / coin / yr | WR | PF | PF w/o top 2% | coins PF>1 w/o top 3 | median net | median maxDD | A | B | pass ✓ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2h | current | 2072 | 13.0 | 40% | 1.65 | 1.09 | 8/32 | +53% | −46% | 0.96 | 1.09 | 7 |
| 2h | BTC>200d | 1352 | 8.9 | 41% | 1.85 | 1.22 | 9/32 | +45% | −48% | 1.39 | 1.19 | 8 |
| 2h | ATR trail k=4 | 1877 | 12.0 | 38% | 1.94 | 1.25 | 10/32 | +110% | −56% | 1.21 | 1.21 | 9 |
| 2h | k=4 + BTC>200d | 1222 | 7.8 | 39% | 2.18 | 1.43 | 10/32 | +118% | −50% | 1.73 | 1.36 | 9 |
| 4h | current | 1246 | 8.1 | 42% | 2.01 | 1.31 | 11/32 | +47% | −42% | 1.10 | 1.24 | 6 |
| 4h | BTC>200d | 867 | 5.7 | 42% | 2.16 | 1.37 | 9/32 | +16% | −40% | 1.32 | 1.33 | 5 |
| 4h | ATR trail k=4 | 1047 | 6.9 | 41% | 2.41 | 1.51 | 10/32 | +114% | −59% | 1.62 | 1.28 | 5 |
| 4h | k=4 + BTC>200d | 718 | 4.7 | 43% | 2.65 | 1.69 | 9/32 | +79% | −55% | 2.25 | 1.46 | 4 |
| 6h | current | 941 | 5.9 | 41% | 2.02 | 1.25 | 6/31 | +35% | −46% | 1.07 | 1.34 | 4 |
| 6h | BTC>200d | 654 | 4.4 | 41% | 2.31 | 1.41 | 8/31 | +28% | −44% | 1.32 | 1.44 | 4 |
| 6h | ATR trail k=4 | 744 | 4.7 | 39% | 2.66 | 1.66 | 7/31 | +101% | −65% | 1.90 | 1.39 | 2 |
| 6h | k=4 + BTC>200d | 516 | 3.5 | 40% | 2.97 | 1.87 | 7/31 | +104% | −57% | 2.14 | 1.66 | 5 |
| 8h | current | 747 | 4.9 | 41% | 2.13 | 1.42 | 9/31 | +42% | −46% | 1.28 | 1.29 | 3 |
| 8h | BTC>200d | 558 | 3.6 | 41% | 2.29 | 1.47 | 8/31 | +64% | −43% | 1.54 | 1.29 | 3 |
| 8h | ATR trail k=4 | 562 | 3.8 | 42% | 3.55 | 2.05 | 7/31 | +102% | −64% | 3.13 | 1.48 | 3 |
| 8h | k=4 + BTC>200d | 414 | 2.6 | 45% | 4.13 | 2.39 | 7/31 | +121% | −55% | 3.73 | 1.79 | 1 |
| 12h | current | 502 | 3.4 | 41% | 2.28 | 1.43 | 4/31 | +43% | −42% | 0.86 | 1.35 | 1 |
| 12h | BTC>200d | 391 | 2.7 | 43% | 2.63 | 1.63 | 4/31 | +51% | −35% | 1.05 | 1.58 | 1 |
| 12h | ATR trail k=4 | 372 | 2.5 | 40% | 3.51 | 2.25 | 5/31 | +86% | −62% | 2.72 | 1.67 | 1 |
| 12h | k=4 + BTC>200d | 286 | 1.9 | 45% | 4.35 | 2.77 | 4/31 | +114% | −56% | 3.76 | 2.02 | 0 |
| 1d | current | 236 | 1.6 | 42% | 3.15 | 1.82 | 4/31 | +23% | −34% | 1.04 | 2.02 | 0 |
| 1d | BTC>200d | 205 | 1.4 | 43% | 3.47 | 2.17 | 2/31 | +16% | −34% | 1.21 | 2.04 | 0 |
| 1d | ATR trail k=4 | 162 | 1.0 | 40% | 3.40 | 2.35 | 1/31 | +15% | −56% | 1.85 | 1.97 | 0 |
| 1d | k=4 + BTC>200d | 136 | 0.9 | 44% | 3.98 | 2.71 | 1/31 | +8% | −56% | 2.34 | 2.28 | 0 |

## 16. Costs — how much fee / slippage can the edge take?

Today: 0.1% fee per side + 0.05% slippage. 0.075% = Binance with BNB fee discount.


**2h**

| variant | trades | WR | PF | PF w/o top 2% | coins PF>1 w/o top 3 | median net | median maxDD | coins better | A | B | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| current (0.1% fee, 0.05% slip) | 2072 | 40% | 1.65 | 1.09 | 8/32 | +53% | −46% | — | 0.96 | 1.09 | — |
| 0.075% fee (BNB discount) | 2072 | 40% | 1.67 | 1.11 | 9/32 | +57% | −46% | 32/32 | 0.97 | 1.11 | — |
| 0.2% fee | 2072 | 39% | 1.56 | 1.03 | 6/32 | +39% | −48% | 0/32 | 0.92 | 1.03 | — |
| 0.2% slippage | 2075 | 38% | 1.52 | 0.99 | 6/32 | +34% | −48% | 0/32 | 0.89 | 1.00 | — |
| 0.5% slippage (thin coin / market order in a spike) | 2083 | 35% | 1.30 | 0.83 | 4/32 | +1% | −58% | 0/32 | 0.77 | 0.82 | — |

**4h**

| variant | trades | WR | PF | PF w/o top 2% | coins PF>1 w/o top 3 | median net | median maxDD | coins better | A | B | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| current (0.1% fee, 0.05% slip) | 1246 | 42% | 2.01 | 1.31 | 11/32 | +47% | −42% | — | 1.10 | 1.24 | — |
| 0.075% fee (BNB discount) | 1246 | 42% | 2.04 | 1.32 | 11/32 | +49% | −42% | 32/32 | 1.11 | 1.26 | — |
| 0.2% fee | 1246 | 41% | 1.93 | 1.24 | 10/32 | +39% | −44% | 0/32 | 1.05 | 1.18 | — |
| 0.2% slippage | 1247 | 40% | 1.88 | 1.21 | 10/32 | +39% | −45% | 0/32 | 1.03 | 1.15 | — |
| 0.5% slippage (thin coin / market order in a spike) | 1247 | 37% | 1.65 | 1.05 | 9/32 | +23% | −49% | 0/32 | 0.91 | 0.98 | — |

## 17. Stacking the changes that held up — one layer at a time

Only changes that were ✅ on both 2h and 4h above are stacked. BTC's **100-day** MA is used because 50/100/200 all helped (a plateau) and 100 is its middle — picking the best-looking one of three would be fitting. Each layer must still add something in BOTH cycles to earn its place.


**2h**

| variant | trades | WR | PF | PF w/o top 2% | coins PF>1 w/o top 3 | median net | median maxDD | coins better | A | B | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| current | 2072 | 40% | 1.65 | 1.09 | 8/32 | +53% | −46% | — | 0.96 | 1.09 | — |
| ① BTC above its 100-day MA | 1414 | 42% | 1.97 | 1.34 | 10/32 | +63% | −45% | 20/32 | 1.47 | 1.31 | ✅ |
| ② = ① + ATR trail k=4 exit | 1273 | 40% | 2.37 | 1.58 | 12/32 | +211% | −51% | 21/32 | 1.85 | 1.47 | ✅ |
| ②b = ① + exit below 2-day low instead | 1281 | 41% | 2.27 | 1.43 | 11/32 | +129% | −52% | 19/32 | 1.65 | 1.34 | ✅ |
| ②c = ① + scale ½ at 3R (lower-drawdown option) | 1414 | 42% | 1.87 | 1.42 | 13/32 | +70% | −42% | 19/32 | 1.52 | 1.39 | ✅ |
| ③ = ② + skip coins listed < 90 days | 1216 | 40% | 2.42 | 1.60 | 11/32 | +148% | −50% | 22/32 | 1.96 | 1.50 | ✅ |
| ④ = ③ + 300-bar MA instead of 149 | 1125 | 41% | 2.58 | 1.71 | 13/32 | +209% | −44% | 22/32 | 2.06 | 1.58 | ✅ |

**4h**

| variant | trades | WR | PF | PF w/o top 2% | coins PF>1 w/o top 3 | median net | median maxDD | coins better | A | B | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| current | 1246 | 42% | 2.01 | 1.31 | 11/32 | +47% | −42% | — | 1.10 | 1.24 | — |
| ① BTC above its 100-day MA | 921 | 43% | 2.31 | 1.51 | 10/32 | +40% | −41% | 20/32 | 1.42 | 1.46 | ✅ |
| ② = ① + ATR trail k=4 exit | 764 | 44% | 2.82 | 1.83 | 11/32 | +96% | −53% | 21/32 | 2.43 | 1.57 | ✅ |
| ②b = ① + exit below 2-day low instead | 860 | 44% | 2.48 | 1.55 | 12/32 | +87% | −49% | 16/32 | 1.60 | 1.46 | ✅ |
| ②c = ① + scale ½ at 3R (lower-drawdown option) | 921 | 43% | 2.09 | 1.54 | 11/32 | +40% | −41% | 17/32 | 1.37 | 1.50 | ✅ |
| ③ = ② + skip coins listed < 90 days | 735 | 44% | 2.91 | 1.86 | 10/32 | +135% | −53% | 20/32 | 2.63 | 1.58 | ✅ |
| ④ = ③ + 300-bar MA instead of 149 | 697 | 44% | 2.84 | 1.84 | 10/32 | +91% | −53% | 15/32 | 2.35 | 1.58 | ✅ |

## 18. Does it help every group of coins, or only one? (current vs ③)

| tf | group | rules | coins | trades | PF | PF w/o top 2% | coins PF>1 w/o top 3 | median net | median vs B&H | median maxDD | A | B |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2h | your 14 | current | 14 | 937 | 1.62 | 1.05 | 3/14 | +83% | +85% | −53% | 0.59 | 1.36 |
| 2h | your 14 | ③ | 14 | 546 | 2.57 | 1.71 | 6/14 | +260% | +210% | −51% | 1.34 | 1.89 |
| 2h | added 15 | current | 15 | 714 | 1.55 | 1.01 | 2/15 | +14% | +257% | −46% | 1.71 | 0.90 |
| 2h | added 15 | ③ | 15 | 429 | 2.18 | 1.33 | 2/15 | +30% | +363% | −50% | 2.74 | 1.10 |
| 2h | BTC ETH LINK | current | 3 | 421 | 2.10 | 1.66 | 3/3 | +1037% | −37% | −40% | 1.77 | 1.14 |
| 2h | BTC ETH LINK | ③ | 3 | 241 | 2.56 | 1.99 | 3/3 | +1102% | −36% | −42% | 2.01 | 2.02 |
| 4h | your 14 | current | 14 | 564 | 1.94 | 1.29 | 6/14 | +92% | +180% | −53% | 0.52 | 1.58 |
| 4h | your 14 | ③ | 14 | 334 | 2.94 | 1.82 | 3/14 | +143% | +201% | −58% | 1.16 | 1.87 |
| 4h | added 15 | current | 15 | 435 | 1.86 | 1.11 | 2/15 | +13% | +204% | −43% | 1.80 | 0.83 |
| 4h | added 15 | ③ | 15 | 267 | 2.68 | 1.77 | 4/15 | +59% | +350% | −53% | 3.59 | 1.19 |
| 4h | BTC ETH LINK | current | 3 | 247 | 2.99 | 2.28 | 3/3 | +579% | −67% | −33% | 1.60 | 2.51 |
| 4h | BTC ETH LINK | ③ | 3 | 134 | 3.63 | 2.90 | 3/3 | +1194% | −51% | −46% | 1.93 | 2.88 |

## 19. Year by year — pooled trades by entry year (current vs ③)

| year | BTC that year | 2h current: trades | PF | avg trade | 2h ③: trades | PF | avg trade | │ | 4h current: trades | PF | avg trade | 4h ③: trades | PF | avg trade |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2018 | −73% | 41 | 2.29 | +3% | 10 | 0.86 | −1% | │ | 17 | 5.52 | +6% | 2 | 0.00 | −4% |
| 2019 | +94% | 82 | 1.49 | +1% | 37 | 1.61 | +2% | │ | 47 | 1.83 | +2% | 21 | 2.28 | +6% |
| 2020 | +302% | 154 | 2.15 | +3% | 110 | 2.62 | +6% | │ | 87 | 2.88 | +6% | 58 | 3.61 | +13% |
| 2021 | +60% | 202 | 1.92 | +4% | 137 | 3.02 | +11% | │ | 136 | 2.01 | +5% | 85 | 3.67 | +18% |
| 2022 | −64% | 177 | 0.56 | −2% | 20 | 1.35 | +1% | │ | 85 | 1.07 | +0% | 17 | 0.74 | −1% |
| 2023 | +156% | 340 | 2.21 | +4% | 231 | 3.44 | +8% | │ | 215 | 2.17 | +4% | 146 | 2.68 | +8% |
| 2024 | +121% | 357 | 1.73 | +3% | 252 | 2.64 | +7% | │ | 242 | 2.42 | +5% | 175 | 3.14 | +14% |
| 2025 | −6% | 363 | 1.28 | +1% | 242 | 1.15 | +1% | │ | 181 | 1.58 | +2% | 121 | 2.11 | +5% |
| 2026 | −7% | 346 | 1.63 | +2% | 173 | 2.20 | +4% | │ | 228 | 1.76 | +2% | 109 | 2.82 | +7% |

## 20. The whole portfolio — one pot of money, all coins competing for N slots (2020-01-01 → today)

Everything above is per coin, as if each coin had its own all-in account. This is the real-money version: one account, each new trade gets *equity ÷ N*, a signal is skipped when all N slots are full (ties go to the higher volume spike), marked to market every bar, honest fills and fees. **Survivorship warning:** the coin list is today's list — coins that died since 2020 are not in it, which flatters every row. Coins join the moment they list. **Do not read the end values below as an expectation — section 21 repeats this on a list fixed in advance, and the numbers shrink by one to two orders of magnitude.**

| tf | rules | coins | slots N | trades taken | signals skipped (slots full) | end value (×) | CAGR | max DD | CAGR ÷ DD | avg % invested | worst year |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2h | current | all 32 | 3 | 1005 | 934 | 84.1× | +92% | −82% | 1.12 | 37% | 2022 −65% |
| 2h | current | all 32 | 5 | 1355 | 584 | 57.6× | +81% | −71% | 1.15 | 30% | 2022 −48% |
| 2h | current | all 32 | 10 | 1754 | 185 | 21.1× | +56% | −47% | 1.21 | 20% | 2022 −28% |
| 2h | current | your 14 | 5 | 822 | 72 | 22.5× | +58% | −71% | 0.81 | 19% | 2022 −56% |
| 2h | ② BTC>100d + k=4 | all 32 | 3 | 496 | 720 | 1065.7× | +178% | −62% | 2.87 | 33% | 2025 −34% |
| 2h | ② BTC>100d + k=4 | all 32 | 5 | 720 | 496 | 489.6× | +148% | −50% | 2.96 | 29% | 2025 −28% |
| 2h | ② BTC>100d + k=4 | all 32 | 10 | 1032 | 184 | 98.0× | +96% | −31% | 3.05 | 22% | 2025 −8% |
| 2h | ② BTC>100d + k=4 | your 14 | 5 | 484 | 71 | 150.8× | +109% | −39% | 2.82 | 20% | 2025 −16% |
| 2h | ②c BTC>100d + scale 3R | all 32 | 3 | 684 | 667 | 83.6× | +92% | −49% | 1.85 | 26% | 2025 −17% |
| 2h | ②c BTC>100d + scale 3R | all 32 | 5 | 937 | 414 | 49.4× | +77% | −33% | 2.35 | 22% | 2025 −6% |
| 2h | ②c BTC>100d + scale 3R | all 32 | 10 | 1215 | 136 | 17.7× | +52% | −22% | 2.42 | 15% | 2022 +2% |
| 2h | ②c BTC>100d + scale 3R | your 14 | 5 | 565 | 51 | 23.9× | +59% | −29% | 2.07 | 13% | 2022 +2% |
| 2h | ③ | all 32 | 3 | 485 | 680 | 1231.8× | +184% | −63% | 2.95 | 33% | 2025 −34% |
| 2h | ③ | all 32 | 5 | 705 | 460 | 484.4× | +148% | −49% | 3.00 | 28% | 2025 −27% |
| 2h | ③ | all 32 | 10 | 1000 | 165 | 89.1× | +93% | −32% | 2.94 | 21% | 2025 −8% |
| 2h | ③ | your 14 | 5 | 472 | 61 | 130.1× | +104% | −39% | 2.70 | 20% | 2025 −16% |
| 4h | current | all 32 | 3 | 685 | 489 | 209.4× | +119% | −70% | 1.71 | 31% | 2022 −17% |
| 4h | current | all 32 | 5 | 896 | 278 | 55.6× | +80% | −57% | 1.40 | 25% | 2022 −1% |
| 4h | current | all 32 | 10 | 1096 | 78 | 24.1× | +60% | −35% | 1.70 | 16% | 2022 +1% |
| 4h | current | your 14 | 5 | 515 | 29 | 20.4× | +56% | −58% | 0.96 | 14% | 2021 −33% |
| 4h | ② BTC>100d + k=4 | all 32 | 3 | 284 | 450 | 136.9× | +106% | −59% | 1.81 | 37% | 2024 −35% |
| 4h | ② BTC>100d + k=4 | all 32 | 5 | 416 | 318 | 116.2× | +101% | −48% | 2.10 | 33% | 2022 −5% |
| 4h | ② BTC>100d + k=4 | all 32 | 10 | 601 | 133 | 68.9× | +86% | −41% | 2.11 | 25% | 2022 −2% |
| 4h | ② BTC>100d + k=4 | your 14 | 5 | 283 | 58 | 156.3× | +110% | −44% | 2.52 | 23% | 2022 −6% |
| 4h | ②c BTC>100d + scale 3R | all 32 | 3 | 496 | 391 | 126.0× | +103% | −51% | 2.01 | 23% | 2022 −3% |
| 4h | ②c BTC>100d + scale 3R | all 32 | 5 | 666 | 221 | 28.5× | +64% | −42% | 1.52 | 19% | 2022 −4% |
| 4h | ②c BTC>100d + scale 3R | all 32 | 10 | 820 | 67 | 13.2× | +46% | −23% | 1.97 | 12% | 2022 +2% |
| 4h | ②c BTC>100d + scale 3R | your 14 | 5 | 385 | 26 | 11.1× | +42% | −44% | 0.96 | 11% | 2021 −33% |
| 4h | ③ | all 32 | 3 | 279 | 432 | 270.5× | +128% | −53% | 2.40 | 37% | 2024 −21% |
| 4h | ③ | all 32 | 5 | 407 | 304 | 112.8× | +100% | −48% | 2.10 | 33% | 2022 −5% |
| 4h | ③ | all 32 | 10 | 588 | 123 | 69.7× | +87% | −40% | 2.16 | 25% | 2022 −2% |
| 4h | ③ | your 14 | 5 | 276 | 54 | 156.7× | +110% | −44% | 2.53 | 22% | 2022 −6% |
| — | **BTC buy & hold** | BTC | — | — | — | 11.4× | +43% | −77% | 0.56 | 100% | 2022 −64% |

**Portfolio, year by year (all 32 coins, N = 5)**

| year | BTC buy & hold | 2h current | 2h ② BTC>100d + k=4 | 2h ②c BTC>100d + scale 3R | 2h ③ | 4h current | 4h ② BTC>100d + k=4 | 4h ②c BTC>100d + scale 3R | 4h ③ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2020 | +302% | +136% | +172% | +98% | +159% | +125% | +121% | +83% | +139% |
| 2021 | +60% | +223% | +600% | +200% | +630% | +210% | +433% | +120% | +466% |
| 2022 | −64% | −48% | +3% | −1% | +3% | −1% | −5% | −4% | −5% |
| 2023 | +156% | +344% | +538% | +250% | +583% | +237% | +326% | +204% | +241% |
| 2024 | +121% | +105% | +205% | +90% | +196% | +44% | −5% | +23% | +4% |
| 2025 | −6% | +18% | −28% | −6% | −27% | +33% | +40% | +30% | +41% |
| 2026 | −7% | +35% | +76% | +35% | +66% | +25% | +83% | +52% | +77% |

## 21. Survivorship check — the big names of 2021, including the ones that died (50 coins)

Every test above uses coins that are famous **today** — which means they survived and mostly pumped. That flatters any long-only system. This list is roughly the Binance top ~50 by market cap during 2021, written down without looking at what happened next: it includes **LUNA** (−100% in May 2022, held to the collapse), **FTT** (FTX, Nov 2022), coins that were renamed and delisted (MATIC→POL, FTM→S, EOS→A, closed at their last price) and a long tail of 2021 names that faded for years (ALGO, EOS, ZIL, IOTA, NEO, DASH, ONE, SUSHI, 1INCH, YFI, AXS, SAND, MANA…). **Cycle B on this list is a genuine out-of-sample test:** the list was fixed before 2023 and none of the rules were tuned on it.


## 21a. Rules on the 2021 list


**2h**

| variant | trades | WR | PF | PF w/o top 2% | coins PF>1 w/o top 3 | median net | median maxDD | coins better | A | B | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| current | 4623 | 36% | 1.33 | 0.87 | 13/50 | +10% | −70% | — | 0.90 | 0.73 | — |
| ① BTC above its 100-day MA | 3104 | 37% | 1.52 | 0.98 | 14/50 | +24% | −61% | 32/50 | 1.19 | 0.82 | ✅ |
| ② = ① + ATR trail k=4 exit | 2813 | 36% | 1.90 | 1.24 | 18/50 | +186% | −65% | 37/50 | 1.60 | 1.03 | ✅ |
| ②c = ① + scale ½ at 3R (lower-drawdown option) | 3104 | 37% | 1.46 | 1.06 | 17/50 | +37% | −56% | 31/50 | 1.28 | 0.91 | ✅ |
| ③ = ② + skip coins listed < 90 days | 2722 | 36% | 1.86 | 1.24 | 18/50 | +130% | −61% | 36/50 | 1.62 | 1.03 | ✅ |

**4h**

| variant | trades | WR | PF | PF w/o top 2% | coins PF>1 w/o top 3 | median net | median maxDD | coins better | A | B | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| current | 2665 | 40% | 1.68 | 1.05 | 16/50 | +76% | −58% | — | 1.11 | 0.91 | — |
| ① BTC above its 100-day MA | 1865 | 42% | 1.98 | 1.23 | 16/50 | +76% | −50% | 31/50 | 1.36 | 1.11 | ✅ |
| ② = ① + ATR trail k=4 exit | 1550 | 41% | 2.66 | 1.74 | 21/50 | +259% | −57% | 35/50 | 2.16 | 1.47 | ✅ |
| ②c = ① + scale ½ at 3R (lower-drawdown option) | 1865 | 42% | 1.83 | 1.31 | 19/50 | +66% | −47% | 28/50 | 1.45 | 1.16 | ✅ |
| ③ = ② + skip coins listed < 90 days | 1513 | 42% | 2.73 | 1.81 | 23/50 | +237% | −56% | 38/50 | 2.29 | 1.47 | ✅ |

**21b. Whole portfolio on the 2021 list** (same engine as section 20)

| tf | rules | period | slots N | trades taken | skipped | end value (×) | CAGR | max DD | CAGR ÷ DD | avg % invested | worst year | BTC B&H same period |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2h | current | 2020→ | 5 | 2007 | 2155 | 7.1× | +33% | −85% | 0.39 | 43% | 2022 −53% | 11.4× · CAGR +43% · DD −77% |
| 2h | current | 2020→ | 10 | 3041 | 1121 | 6.9× | +33% | −75% | 0.44 | 33% | 2022 −46% | 11.4× · CAGR +43% · DD −77% |
| 2h | current | 2023→ (out of sample) | 5 | 1076 | 1166 | 1.4× | +9% | −62% | 0.14 | 40% | 2024 −16% | 4.9× · CAGR +52% · DD −54% |
| 2h | current | 2023→ (out of sample) | 10 | 1604 | 638 | 1.3× | +7% | −59% | 0.12 | 30% | 2025 −12% | 4.9× · CAGR +52% · DD −54% |
| 2h | ② BTC>100d + k=4 | 2020→ | 5 | 1020 | 1593 | 19.5× | +55% | −65% | 0.84 | 35% | 2025 −46% | 11.4× · CAGR +43% · DD −77% |
| 2h | ② BTC>100d + k=4 | 2020→ | 10 | 1613 | 1000 | 51.3× | +78% | −45% | 1.74 | 29% | 2025 −25% | 11.4× · CAGR +43% · DD −77% |
| 2h | ② BTC>100d + k=4 | 2023→ (out of sample) | 5 | 606 | 931 | 0.9× | −2% | −65% | -0.03 | 34% | 2025 −46% | 4.9× · CAGR +52% · DD −54% |
| 2h | ② BTC>100d + k=4 | 2023→ (out of sample) | 10 | 954 | 583 | 1.4× | +10% | −45% | 0.21 | 28% | 2025 −25% | 4.9× · CAGR +52% · DD −54% |
| 2h | ②c BTC>100d + scale 3R | 2020→ | 5 | 1354 | 1527 | 13.0× | +46% | −59% | 0.78 | 29% | 2025 −36% | 11.4× · CAGR +43% · DD −77% |
| 2h | ②c BTC>100d + scale 3R | 2020→ | 10 | 2071 | 810 | 10.5× | +41% | −51% | 0.81 | 23% | 2025 −14% | 11.4× · CAGR +43% · DD −77% |
| 2h | ②c BTC>100d + scale 3R | 2023→ (out of sample) | 5 | 772 | 888 | 0.9× | −2% | −59% | -0.04 | 28% | 2025 −36% | 4.9× · CAGR +52% · DD −54% |
| 2h | ②c BTC>100d + scale 3R | 2023→ (out of sample) | 10 | 1164 | 496 | 1.1× | +2% | −50% | 0.05 | 22% | 2025 −14% | 4.9× · CAGR +52% · DD −54% |
| 2h | ③ | 2020→ | 5 | 1006 | 1548 | 16.5× | +51% | −65% | 0.78 | 35% | 2025 −46% | 11.4× · CAGR +43% · DD −77% |
| 2h | ③ | 2020→ | 10 | 1591 | 963 | 42.9× | +74% | −45% | 1.64 | 29% | 2025 −25% | 11.4× · CAGR +43% · DD −77% |
| 2h | ③ | 2023→ (out of sample) | 5 | 606 | 931 | 0.9× | −2% | −65% | -0.03 | 34% | 2025 −46% | 4.9× · CAGR +52% · DD −54% |
| 2h | ③ | 2023→ (out of sample) | 10 | 954 | 583 | 1.4× | +10% | −45% | 0.21 | 28% | 2025 −25% | 4.9× · CAGR +52% · DD −54% |
| 4h | current | 2020→ | 5 | 1364 | 1054 | 99.1× | +96% | −62% | 1.56 | 37% | 2022 −38% | 11.4× · CAGR +43% · DD −77% |
| 4h | current | 2020→ | 10 | 1945 | 473 | 48.2× | +77% | −39% | 1.97 | 27% | 2022 −19% | 11.4× · CAGR +43% · DD −77% |
| 4h | current | 2023→ (out of sample) | 5 | 733 | 581 | 3.0× | +34% | −44% | 0.77 | 34% | 2026 +7% | 4.9× · CAGR +52% · DD −54% |
| 4h | current | 2023→ (out of sample) | 10 | 1027 | 287 | 2.8× | +31% | −32% | 0.96 | 25% | 2026 +7% | 4.9× · CAGR +52% · DD −54% |
| 4h | ② BTC>100d + k=4 | 2020→ | 5 | 498 | 950 | 283.6× | +129% | −44% | 2.90 | 39% | 2022 −19% | 11.4× · CAGR +43% · DD −77% |
| 4h | ② BTC>100d + k=4 | 2020→ | 10 | 842 | 606 | 128.2× | +104% | −41% | 2.53 | 33% | 2022 −6% | 11.4× · CAGR +43% · DD −77% |
| 4h | ② BTC>100d + k=4 | 2023→ (out of sample) | 5 | 312 | 529 | 2.3× | +25% | −44% | 0.56 | 38% | 2024 −3% | 4.9× · CAGR +52% · DD −54% |
| 4h | ② BTC>100d + k=4 | 2023→ (out of sample) | 10 | 514 | 327 | 2.6× | +29% | −41% | 0.69 | 32% | 2025 −6% | 4.9× · CAGR +52% · DD −54% |
| 4h | ②c BTC>100d + scale 3R | 2020→ | 5 | 939 | 811 | 88.4× | +93% | −36% | 2.60 | 26% | 2022 −7% | 11.4× · CAGR +43% · DD −77% |
| 4h | ②c BTC>100d + scale 3R | 2020→ | 10 | 1377 | 373 | 36.6× | +70% | −31% | 2.23 | 20% | 2022 −1% | 11.4× · CAGR +43% · DD −77% |
| 4h | ②c BTC>100d + scale 3R | 2023→ (out of sample) | 5 | 531 | 458 | 2.9× | +32% | −36% | 0.89 | 25% | 2025 +12% | 4.9× · CAGR +52% · DD −54% |
| 4h | ②c BTC>100d + scale 3R | 2023→ (out of sample) | 10 | 754 | 235 | 2.7× | +30% | −31% | 0.96 | 18% | 2025 +7% | 4.9× · CAGR +52% · DD −54% |
| 4h | ③ | 2020→ | 5 | 497 | 929 | 231.7× | +123% | −44% | 2.75 | 39% | 2022 −19% | 11.4× · CAGR +43% · DD −77% |
| 4h | ③ | 2020→ | 10 | 830 | 596 | 117.1× | +101% | −41% | 2.46 | 33% | 2022 −6% | 11.4× · CAGR +43% · DD −77% |
| 4h | ③ | 2023→ (out of sample) | 5 | 312 | 529 | 2.3× | +25% | −44% | 0.56 | 38% | 2024 −3% | 4.9× · CAGR +52% · DD −54% |
| 4h | ③ | 2023→ (out of sample) | 10 | 514 | 327 | 2.6× | +29% | −41% | 0.69 | 32% | 2025 −6% | 4.9× · CAGR +52% · DD −54% |

## 22. Portfolio cost stress (all 32 coins, N = 5, 2020→)

| tf | rules | costs | end value (×) | CAGR | max DD |
| --- | --- | --- | --- | --- | --- |
| 2h | current | 0.1% fee + 0.05% slip | 57.6× | +81% | −71% |
| 2h | current | 0.1% fee + 0.2% slip | 25.0× | +60% | −74% |
| 2h | current | 0.2% fee + 0.5% slip | 2.7× | +16% | −81% |
| 2h | ③ | 0.1% fee + 0.05% slip | 484.4× | +148% | −49% |
| 2h | ③ | 0.1% fee + 0.2% slip | 329.8× | +134% | −51% |
| 2h | ③ | 0.2% fee + 0.5% slip | 90.3× | +94% | −61% |
| 4h | current | 0.1% fee + 0.05% slip | 55.6× | +80% | −57% |
| 4h | current | 0.1% fee + 0.2% slip | 32.5× | +67% | −60% |
| 4h | current | 0.2% fee + 0.5% slip | 8.4× | +37% | −66% |
| 4h | ③ | 0.1% fee + 0.05% slip | 112.8× | +100% | −48% |
| 4h | ③ | 0.1% fee + 0.2% slip | 86.3× | +92% | −49% |
| 4h | ③ | 0.2% fee + 0.5% slip | 46.1× | +76% | −53% |

## 23. Your coins — current rules vs "BTC above its 100-day MA + sell ½ at +3R", 1h / 2h / 4h, full history vs last 4,500 bars

Honest fills (next open ± 0.05%), 0.1%/side fees — so every number is a little below what the app's Compare tab shows, which fills at the signal close. ✓ = the Compare tab's test (net > 0, beats B&H, PF ≥ 1.3, WR ≥ 30%, DD ≤ 60%, trades ≥ 12 on 1h / 20 above, stable ≥ 70%). 4,500 bars = 188 days on 1h, 375 days on 2h, 750 days on 4h. The BTC gate is computed on full history, so a 4,500-bar window never loses its start to a warm-up.


**1h**

| coin | window | rules | trades | net | vs B&H | PF | max DD | WR | in mkt | stable | yrs | ✓ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SOL | full | current | 144 | −12% | −97% | 1.12 | −66% | 35% | 15% | 67% | 6.2 |  |
| SOL | full | new | 93 | +102% | −94% | 1.40 | −61% | 38% | 10% | 87% | 6.2 |  |
| FET | full | current | 156 | −94% | −90% | 0.74 | −97% | 25% | 11% | 33% | 7.6 |  |
| FET | full | new | 109 | −90% | −82% | 0.69 | −94% | 25% | 7% | 0% | 7.6 |  |
| XLM | full | current | 173 | +235% | +453% | 1.60 | −74% | 29% | 12% | 73% | 8.4 |  |
| XLM | full | new | 106 | +170% | +347% | 1.63 | −45% | 30% | 7% | 87% | 8.4 | ✓ |
| HBAR | full | current | 131 | −55% | −77% | 1.15 | −88% | 26% | 11% | 40% | 7.0 |  |
| HBAR | full | new | 95 | +34% | −32% | 1.32 | −72% | 32% | 8% | 53% | 7.0 |  |
| PEPE | full | current | 77 | +1041% | +248% | 2.43 | −48% | 35% | 16% | 100% | 3.4 | ✓ |
| PEPE | full | new | 58 | +307% | +24% | 1.99 | −49% | 31% | 11% | 73% | 3.4 | ✓ |
| AERO | full | current | 10 | +17% | −38% | 1.90 | −20% | 50% | 24% | 100% | 0.2 |  |
| AERO | full | new | 7 | +33% | −30% | 3.42 | −19% | 71% | 19% | 100% | 0.2 |  |
| INJ | full | current | 139 | −67% | −97% | 0.94 | −93% | 33% | 15% | 67% | 6.0 |  |
| INJ | full | new | 80 | +103% | −80% | 1.43 | −70% | 43% | 9% | 87% | 6.0 |  |
| STRK | full | current | 33 | +95% | +6960% | 1.90 | −38% | 39% | 8% | 87% | 2.7 | ✓ |
| STRK | full | new | 23 | +30% | +4617% | 1.54 | −30% | 39% | 5% | 60% | 2.7 |  |
| ARB | full | current | 73 | −5% | +544% | 1.10 | −68% | 30% | 12% | 20% | 3.6 |  |
| ARB | full | new | 51 | +78% | +1103% | 1.58 | −52% | 37% | 9% | 60% | 3.6 |  |
| SUI | full | current | 77 | −45% | −33% | 0.87 | −55% | 29% | 12% | 60% | 3.5 |  |
| SUI | full | new | 53 | −34% | −20% | 0.87 | −43% | 28% | 8% | 53% | 3.5 |  |
| ZEC | full | current | 144 | +43% | −93% | 1.35 | −73% | 42% | 12% | 13% | 7.6 |  |
| ZEC | full | new | 92 | +34% | −94% | 1.26 | −51% | 42% | 8% | 47% | 7.6 |  |
| RENDER | full | current | 95 | −50% | +45% | 0.92 | −82% | 31% | 12% | 47% | 4.9 |  |
| RENDER | full | new | 50 | +14% | +233% | 1.21 | −50% | 38% | 6% | 53% | 4.9 |  |
| RAY | full | current | 120 | −94% | −78% | 0.55 | −97% | 26% | 12% | 0% | 5.2 |  |
| RAY | full | new | 77 | −72% | −2% | 0.77 | −87% | 27% | 7% | 7% | 5.2 |  |
| CFX | full | current | 107 | +154% | +5366% | 1.85 | −69% | 27% | 10% | 60% | 5.5 |  |
| CFX | full | new | 64 | +194% | +6231% | 1.87 | −70% | 28% | 6% | 53% | 5.5 |  |
| STX | full | current | 161 | −91% | −95% | 0.79 | −97% | 29% | 12% | 33% | 7.0 |  |
| STX | full | new | 102 | −61% | −77% | 0.92 | −90% | 31% | 7% | 27% | 7.0 |  |
| SOL | 4500 | current | 14 | +15% | −4% | 1.85 | −13% | 36% | 20% | 53% | 0.5 |  |
| SOL | 4500 | new | 9 | −13% | −27% | 0.38 | −19% | 22% | 9% | 13% | 0.5 |  |
| FET | 4500 | current | 14 | −1% | +14% | 1.03 | −20% | 36% | 18% | 40% | 0.5 |  |
| FET | 4500 | new | 11 | +6% | +22% | 1.44 | −20% | 45% | 15% | 40% | 0.5 |  |
| XLM | 4500 | current | 14 | +8% | +8% | 1.39 | −34% | 14% | 12% | 67% | 0.5 |  |
| XLM | 4500 | new | 10 | −6% | −6% | 0.93 | −30% | 10% | 7% | 33% | 0.5 |  |
| HBAR | 4500 | current | 8 | +10% | +25% | 1.58 | −15% | 38% | 9% | 53% | 0.5 |  |
| HBAR | 4500 | new | 8 | +3% | +18% | 1.23 | −17% | 38% | 8% | 53% | 0.5 |  |
| PEPE | 4500 | current | 12 | +12% | −2% | 1.53 | −22% | 25% | 12% | 53% | 0.5 |  |
| PEPE | 4500 | new | 9 | +9% | −4% | 1.45 | −18% | 33% | 7% | 53% | 0.5 |  |
| AERO | 4500 | current | 10 | +17% | −38% | 1.90 | −20% | 50% | 24% | 100% | 0.2 |  |
| AERO | 4500 | new | 7 | +33% | −30% | 3.42 | −19% | 71% | 19% | 100% | 0.2 |  |
| INJ | 4500 | current | 11 | −9% | −61% | 0.90 | −32% | 36% | 12% | 53% | 0.5 |  |
| INJ | 4500 | new | 6 | +5% | −55% | 1.41 | −19% | 67% | 7% | 67% | 0.5 |  |
| STRK | 4500 | current | 8 | +82% | +38% | 3.36 | −34% | 63% | 11% | 60% | 0.5 |  |
| STRK | 4500 | new | 8 | +56% | +19% | 2.65 | −30% | 63% | 11% | 60% | 0.5 |  |
| ARB | 4500 | current | 6 | +109% | +51% | 8.40 | −23% | 67% | 12% | 67% | 0.5 |  |
| ARB | 4500 | new | 6 | +95% | +41% | 7.59 | −18% | 67% | 12% | 67% | 0.5 |  |
| SUI | 4500 | current | 12 | −16% | −18% | 0.58 | −34% | 17% | 13% | 20% | 0.5 |  |
| SUI | 4500 | new | 9 | −9% | −12% | 0.75 | −28% | 22% | 11% | 27% | 0.5 |  |
| ZEC | 4500 | current | 15 | +104% | −40% | 3.01 | −28% | 53% | 18% | 93% | 0.5 |  |
| ZEC | 4500 | new | 12 | +49% | −57% | 2.17 | −28% | 50% | 14% | 80% | 0.5 |  |
| RENDER | 4500 | current | 8 | +6% | +8% | 1.46 | −17% | 50% | 13% | 100% | 0.5 |  |
| RENDER | 4500 | new | 6 | −11% | −10% | 0.28 | −17% | 33% | 6% | 7% | 0.5 |  |
| RAY | 4500 | current | 15 | +23% | −56% | 1.71 | −28% | 33% | 16% | 67% | 0.5 |  |
| RAY | 4500 | new | 13 | −11% | −68% | 0.86 | −33% | 23% | 10% | 27% | 0.5 |  |
| CFX | 4500 | current | 13 | −18% | −1% | 0.50 | −33% | 23% | 15% | 7% | 0.5 |  |
| CFX | 4500 | new | 7 | +16% | +41% | 2.99 | −12% | 43% | 12% | 67% | 0.5 |  |
| STX | 4500 | current | 7 | +28% | −11% | 2.68 | −17% | 43% | 8% | 47% | 0.5 |  |
| STX | 4500 | new | 6 | +42% | −1% | 4.07 | −12% | 50% | 8% | 47% | 0.5 |  |

**2h**

| coin | window | rules | trades | net | vs B&H | PF | max DD | WR | in mkt | stable | yrs | ✓ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SOL | full | current | 90 | +132% | −92% | 1.48 | −45% | 43% | 12% | 87% | 6.2 |  |
| SOL | full | new | 62 | +333% | −86% | 2.12 | −32% | 48% | 9% | 93% | 6.2 |  |
| FET | full | current | 91 | +1031% | +1342% | 2.15 | −76% | 44% | 11% | 93% | 7.6 |  |
| FET | full | new | 61 | +242% | +336% | 1.85 | −57% | 49% | 7% | 87% | 7.6 | ✓ |
| XLM | full | current | 115 | +448% | +605% | 2.01 | −67% | 33% | 10% | 60% | 8.4 |  |
| XLM | full | new | 73 | +208% | +296% | 1.86 | −52% | 32% | 7% | 67% | 8.4 |  |
| HBAR | full | current | 89 | +325% | +88% | 1.86 | −76% | 39% | 11% | 53% | 7.0 |  |
| HBAR | full | new | 69 | +605% | +213% | 2.16 | −62% | 43% | 9% | 73% | 7.0 |  |
| PEPE | full | current | 51 | +248% | +26% | 1.98 | −53% | 39% | 12% | 67% | 3.4 |  |
| PEPE | full | new | 37 | +227% | +19% | 2.18 | −42% | 38% | 9% | 53% | 3.4 |  |
| AERO | full | current | 6 | +14% | −38% | 2.48 | −15% | 50% | 18% | 60% | 0.2 |  |
| AERO | full | new | 5 | +18% | −35% | 4.11 | −15% | 60% | 15% | 80% | 0.2 |  |
| INJ | full | current | 90 | −65% | −97% | 0.89 | −94% | 33% | 11% | 53% | 6.0 |  |
| INJ | full | new | 63 | +39% | −87% | 1.33 | −79% | 37% | 8% | 67% | 6.0 |  |
| STRK | full | current | 21 | +126% | +7442% | 2.69 | −40% | 43% | 5% | 53% | 2.6 |  |
| STRK | full | new | 16 | +97% | +6483% | 2.74 | −35% | 44% | 4% | 60% | 2.6 |  |
| ARB | full | current | 38 | +83% | +1165% | 1.82 | −46% | 47% | 8% | 47% | 3.5 |  |
| ARB | full | new | 32 | +124% | +1446% | 2.17 | −41% | 50% | 7% | 67% | 3.5 |  |
| SUI | full | current | 48 | +53% | +84% | 1.50 | −31% | 44% | 10% | 87% | 3.4 | ✓ |
| SUI | full | new | 31 | +90% | +128% | 2.10 | −25% | 48% | 6% | 100% | 3.4 | ✓ |
| ZEC | full | current | 98 | −4% | −95% | 1.27 | −80% | 36% | 9% | 13% | 7.6 |  |
| ZEC | full | new | 61 | +39% | −92% | 1.36 | −65% | 34% | 6% | 40% | 7.6 |  |
| RENDER | full | current | 45 | +44% | +209% | 1.44 | −44% | 36% | 7% | 67% | 4.9 |  |
| RENDER | full | new | 25 | +38% | +194% | 1.60 | −29% | 40% | 4% | 73% | 4.9 | ✓ |
| RAY | full | current | 77 | −53% | +85% | 0.95 | −86% | 30% | 10% | 27% | 5.2 |  |
| RAY | full | new | 56 | +70% | +563% | 1.44 | −63% | 30% | 8% | 60% | 5.2 |  |
| CFX | full | current | 78 | +228% | +7726% | 2.13 | −67% | 32% | 10% | 87% | 5.5 |  |
| CFX | full | new | 44 | +887% | +23442% | 3.10 | −52% | 43% | 6% | 93% | 5.5 | ✓ |
| STX | full | current | 110 | +25% | −21% | 1.25 | −85% | 37% | 12% | 67% | 7.0 |  |
| STX | full | new | 69 | +270% | +134% | 1.73 | −53% | 39% | 7% | 93% | 7.0 | ✓ |
| SOL | 4500 | current | 12 | +6% | +96% | 1.40 | −20% | 25% | 10% | 27% | 1.0 |  |
| SOL | 4500 | new | 7 | +13% | +109% | 2.63 | −7% | 43% | 7% | 27% | 1.0 |  |
| FET | 4500 | current | 14 | +74% | +142% | 3.27 | −26% | 57% | 11% | 87% | 1.0 |  |
| FET | 4500 | new | 8 | +34% | +87% | 4.28 | −16% | 63% | 7% | 60% | 1.0 |  |
| XLM | 4500 | current | 12 | +44% | +160% | 2.74 | −28% | 42% | 11% | 93% | 1.0 |  |
| XLM | 4500 | new | 7 | +28% | +131% | 2.76 | −15% | 29% | 6% | 67% | 1.0 |  |
| HBAR | 4500 | current | 13 | −5% | +101% | 0.86 | −29% | 38% | 11% | 20% | 1.0 |  |
| HBAR | 4500 | new | 9 | +12% | +137% | 2.08 | −16% | 44% | 7% | 33% | 1.0 |  |
| PEPE | 4500 | current | 11 | +27% | +103% | 1.77 | −36% | 36% | 8% | 60% | 1.0 |  |
| PEPE | 4500 | new | 5 | +24% | +99% | 2.31 | −17% | 40% | 3% | 27% | 1.0 |  |
| AERO | 4500 | current | 6 | +14% | −38% | 2.48 | −15% | 50% | 18% | 60% | 0.2 |  |
| AERO | 4500 | new | 5 | +18% | −35% | 4.11 | −15% | 60% | 15% | 80% | 0.2 |  |
| INJ | 4500 | current | 15 | −18% | −13% | 0.73 | −29% | 40% | 10% | 27% | 1.0 |  |
| INJ | 4500 | new | 9 | +16% | +22% | 1.95 | −15% | 56% | 7% | 73% | 1.0 |  |
| STRK | 4500 | current | 8 | +219% | +601% | 15.81 | −31% | 75% | 7% | 33% | 1.0 |  |
| STRK | 4500 | new | 4 | +145% | +438% | ∞ | −14% | 100% | 4% | 27% | 1.0 |  |
| ARB | 4500 | current | 7 | +157% | +343% | 10.46 | −18% | 71% | 8% | 67% | 1.0 |  |
| ARB | 4500 | new | 5 | +135% | +306% | 31.34 | −14% | 80% | 7% | 67% | 1.0 |  |
| SUI | 4500 | current | 13 | −3% | +148% | 1.01 | −28% | 46% | 8% | 27% | 1.0 |  |
| SUI | 4500 | new | 5 | +20% | +205% | 2.54 | −13% | 60% | 4% | 67% | 1.0 |  |
| ZEC | 4500 | current | 19 | +57% | −66% | 1.96 | −38% | 47% | 16% | 73% | 1.0 |  |
| ZEC | 4500 | new | 7 | +115% | −53% | 7.73 | −17% | 57% | 9% | 67% | 1.0 |  |
| RENDER | 4500 | current | 10 | +56% | +106% | 3.50 | −26% | 30% | 10% | 67% | 1.0 |  |
| RENDER | 4500 | new | 4 | −7% | +23% | 0.15 | −14% | 25% | 3% | 7% | 1.0 |  |
| RAY | 4500 | current | 15 | +9% | +4% | 1.35 | −37% | 33% | 11% | 20% | 1.0 |  |
| RAY | 4500 | new | 9 | +23% | +16% | 1.87 | −23% | 33% | 7% | 27% | 1.0 |  |
| CFX | 4500 | current | 15 | −40% | +26% | 0.32 | −50% | 20% | 8% | 0% | 1.0 |  |
| CFX | 4500 | new | 5 | +22% | +158% | 3.93 | −13% | 40% | 4% | 27% | 1.0 |  |
| STX | 4500 | current | 16 | +27% | +68% | 1.75 | −35% | 25% | 12% | 53% | 1.0 |  |
| STX | 4500 | new | 6 | +21% | +61% | 1.96 | −20% | 33% | 6% | 27% | 1.0 |  |

**4h**

| coin | window | rules | trades | net | vs B&H | PF | max DD | WR | in mkt | stable | yrs | ✓ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SOL | full | current | 58 | +178% | −93% | 1.89 | −37% | 48% | 10% | 87% | 6.1 |  |
| SOL | full | new | 47 | +337% | −89% | 2.66 | −28% | 51% | 8% | 100% | 6.1 |  |
| FET | full | current | 55 | +209% | +228% | 1.78 | −71% | 42% | 8% | 53% | 7.6 |  |
| FET | full | new | 38 | +6% | +13% | 1.27 | −57% | 39% | 5% | 53% | 7.6 |  |
| XLM | full | current | 63 | +2024% | +2303% | 4.46 | −53% | 41% | 7% | 80% | 8.3 | ✓ |
| XLM | full | new | 44 | +713% | +819% | 3.66 | −44% | 43% | 5% | 73% | 8.3 | ✓ |
| HBAR | full | current | 46 | +719% | +180% | 3.02 | −60% | 39% | 7% | 87% | 7.0 |  |
| HBAR | full | new | 35 | +588% | +136% | 3.23 | −55% | 46% | 6% | 73% | 7.0 | ✓ |
| PEPE | full | current | 35 | +192% | −14% | 2.04 | −58% | 37% | 11% | 100% | 3.4 |  |
| PEPE | full | new | 26 | +222% | −5% | 2.34 | −54% | 38% | 9% | 100% | 3.4 |  |
| AERO | full | current | 4 | +40% | −27% | ∞ | −12% | 100% | 20% | 100% | 0.2 |  |
| AERO | full | new | 4 | +40% | −27% | ∞ | −12% | 100% | 20% | 100% | 0.2 |  |
| INJ | full | current | 59 | −64% | −94% | 0.78 | −75% | 32% | 9% | 53% | 5.9 |  |
| INJ | full | new | 44 | −54% | −92% | 0.77 | −70% | 30% | 7% | 53% | 5.9 |  |
| STRK | full | current | 14 | +64% | +6053% | 2.52 | −32% | 43% | 4% | 13% | 2.6 |  |
| STRK | full | new | 11 | +88% | +6954% | 4.04 | −24% | 45% | 4% | 27% | 2.6 |  |
| ARB | full | current | 30 | +231% | +2798% | 2.68 | −38% | 53% | 8% | 27% | 3.5 |  |
| ARB | full | new | 25 | +155% | +2129% | 2.51 | −34% | 48% | 7% | 60% | 3.5 |  |
| SUI | full | current | 32 | −7% | −2% | 1.02 | −42% | 44% | 8% | 53% | 3.4 |  |
| SUI | full | new | 24 | +11% | +17% | 1.29 | −41% | 46% | 6% | 73% | 3.4 |  |
| ZEC | full | current | 65 | +92% | −89% | 1.55 | −73% | 40% | 8% | 7% | 7.5 |  |
| ZEC | full | new | 45 | +73% | −90% | 1.58 | −76% | 38% | 6% | 7% | 7.5 |  |
| RENDER | full | current | 27 | +94% | +543% | 1.94 | −42% | 41% | 6% | 80% | 4.8 | ✓ |
| RENDER | full | new | 18 | +34% | +345% | 1.69 | −36% | 39% | 4% | 67% | 4.8 |  |
| RAY | full | current | 39 | −42% | +285% | 0.92 | −70% | 36% | 6% | 27% | 5.1 |  |
| RAY | full | new | 32 | +10% | +627% | 1.29 | −61% | 38% | 5% | 53% | 5.1 |  |
| CFX | full | current | 37 | +47% | +2330% | 1.95 | −73% | 38% | 5% | 67% | 5.5 |  |
| CFX | full | new | 27 | +108% | +3353% | 2.12 | −61% | 44% | 4% | 73% | 5.5 |  |
| STX | full | current | 72 | +4% | −52% | 1.26 | −73% | 42% | 9% | 47% | 6.9 |  |
| STX | full | new | 52 | +77% | −18% | 1.52 | −66% | 42% | 6% | 67% | 6.9 |  |
| SOL | 4500 | current | 16 | +90% | +221% | 5.64 | −20% | 63% | 10% | 87% | 2.0 |  |
| SOL | 4500 | new | 13 | +97% | +233% | 7.18 | −14% | 69% | 9% | 87% | 2.0 |  |
| FET | 4500 | current | 13 | +79% | +1130% | 3.26 | −22% | 38% | 8% | 100% | 2.0 |  |
| FET | 4500 | new | 8 | −0% | +586% | 1.03 | −20% | 38% | 4% | 13% | 2.0 |  |
| XLM | 4500 | current | 15 | +757% | +357% | 11.89 | −32% | 40% | 9% | 87% | 2.0 |  |
| XLM | 4500 | new | 12 | +409% | +172% | 12.67 | −25% | 50% | 9% | 87% | 2.0 |  |
| HBAR | 4500 | current | 13 | +238% | +106% | 6.41 | −42% | 38% | 7% | 13% | 2.0 |  |
| HBAR | 4500 | new | 10 | +184% | +74% | 7.27 | −27% | 50% | 6% | 27% | 2.0 |  |
| PEPE | 4500 | current | 16 | +155% | +427% | 3.02 | −37% | 50% | 9% | 93% | 2.0 |  |
| PEPE | 4500 | new | 10 | +178% | +475% | 4.62 | −30% | 60% | 6% | 93% | 2.0 |  |
| AERO | 4500 | current | 4 | +40% | −27% | ∞ | −12% | 100% | 20% | 100% | 0.2 |  |
| AERO | 4500 | new | 4 | +40% | −27% | ∞ | −12% | 100% | 20% | 100% | 0.2 |  |
| INJ | 4500 | current | 18 | −55% | +9% | 0.11 | −60% | 17% | 7% | 0% | 2.0 |  |
| INJ | 4500 | new | 15 | −51% | +17% | 0.03 | −57% | 13% | 5% | 0% | 2.0 |  |
| STRK | 4500 | current | 12 | +77% | +1132% | 3.02 | −31% | 50% | 5% | 27% | 2.0 |  |
| STRK | 4500 | new | 9 | +103% | +1312% | 5.69 | −19% | 56% | 4% | 33% | 2.0 |  |
| ARB | 4500 | current | 16 | +316% | +1074% | 5.28 | −28% | 69% | 8% | 67% | 2.0 |  |
| ARB | 4500 | new | 12 | +242% | +866% | 6.21 | −25% | 67% | 6% | 80% | 2.0 |  |
| SUI | 4500 | current | 17 | +38% | +148% | 2.14 | −23% | 53% | 8% | 60% | 2.0 |  |
| SUI | 4500 | new | 14 | +66% | +197% | 3.45 | −18% | 64% | 7% | 100% | 2.0 |  |
| ZEC | 4500 | current | 25 | +182% | −91% | 2.56 | −40% | 44% | 12% | 80% | 2.0 |  |
| ZEC | 4500 | new | 14 | +167% | −92% | 3.42 | −46% | 50% | 8% | 80% | 2.0 |  |
| RENDER | 4500 | current | 6 | +44% | +287% | 4.37 | −14% | 67% | 3% | 93% | 2.0 |  |
| RENDER | 4500 | new | 2 | −6% | +153% | 0.39 | −10% | 50% | 1% | 47% | 2.0 |  |
| RAY | 4500 | current | 11 | −8% | +71% | 0.98 | −38% | 27% | 5% | 13% | 2.0 |  |
| RAY | 4500 | new | 9 | −8% | +72% | 0.99 | −38% | 22% | 4% | 13% | 2.0 |  |
| CFX | 4500 | current | 13 | −5% | +162% | 0.98 | −46% | 38% | 5% | 60% | 2.0 |  |
| CFX | 4500 | new | 9 | +29% | +254% | 2.66 | −30% | 56% | 4% | 60% | 2.0 |  |
| STX | 4500 | current | 22 | −42% | +200% | 0.61 | −57% | 32% | 9% | 7% | 2.0 |  |
| STX | 4500 | new | 18 | −51% | +154% | 0.43 | −63% | 22% | 7% | 7% | 2.0 |  |

**Summary — medians across the coins, pooled PF**

| tf | window | rules | coins | trades | pooled PF | PF w/o top 2% | median net | median vs B&H | median max DD | median WR | coins net > 0 | coins ✓ | coins where new beats current |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1h | full | current | 15 | 1640 | 1.14 | 0.72 | −12% | −38% | −73% | 30% | 6/15 | 2/15 | — |
| 1h | full | new | 15 | 1060 | 1.25 | 0.91 | +34% | −20% | −52% | 32% | 11/15 | 2/15 | 11/15 |
| 1h | 4500 | current | 15 | 167 | 1.85 | 1.45 | +12% | −2% | −23% | 36% | 11/15 | 0/15 | — |
| 1h | 4500 | new | 15 | 127 | 1.75 | 1.42 | +6% | −6% | −19% | 43% | 10/15 | 0/15 | 6/15 |
| 2h | full | current | 15 | 1047 | 1.57 | 1.04 | +83% | +85% | −67% | 39% | 12/15 | 1/15 | — |
| 2h | full | new | 15 | 704 | 1.89 | 1.48 | +124% | +194% | −52% | 43% | 15/15 | 5/15 | 10/15 |
| 2h | 4500 | current | 15 | 186 | 2.02 | 1.45 | +27% | +101% | −29% | 40% | 11/15 | 0/15 | — |
| 2h | 4500 | new | 15 | 95 | 3.68 | 2.88 | +22% | +99% | −15% | 44% | 14/15 | 0/15 | 8/15 |
| 4h | full | current | 15 | 636 | 1.85 | 1.22 | +92% | +180% | −58% | 41% | 12/15 | 2/15 | — |
| 4h | full | new | 15 | 472 | 1.92 | 1.45 | +77% | +17% | −54% | 43% | 14/15 | 2/15 | 8/15 |
| 4h | 4500 | current | 15 | 217 | 2.89 | 1.93 | +77% | +200% | −32% | 44% | 11/15 | 0/15 | — |
| 4h | 4500 | new | 15 | 159 | 2.99 | 2.28 | +66% | +172% | −25% | 50% | 10/15 | 0/15 | 7/15 |

## 24. Your coins — the 149-bar MA condition ON vs OFF, for both the current rules and the new option (1h / 2h / 4h)

"new" = BTC above its 100-day MA + sell ½ at +3R. "no MA" sets `lbMaBars = 0`, which is how the app switches the condition off; nothing else changes. Honest fills as in section 23.

| tf | window | rules | trades | pooled PF | PF w/o top 2% | median net | median vs B&H | median max DD | median WR | coins net > 0 | coins ✓ | coins better than current + 149 MA |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1h | full | current + 149 MA | 1640 | 1.14 | 0.72 | −12% | −38% | −73% | 30% | 6/15 | 2/15 | — |
| 1h | full | current, no MA | 1676 | 1.13 | 0.71 | −21% | −43% | −72% | 30% | 6/15 | 2/15 | 7/15 |
| 1h | full | new + 149 MA | 1060 | 1.25 | 0.91 | +34% | −20% | −52% | 32% | 11/15 | 2/15 | 11/15 |
| 1h | full | new, no MA | 1078 | 1.25 | 0.91 | +34% | −22% | −52% | 32% | 11/15 | 2/15 | 12/15 |
| 1h | 4500 | current + 149 MA | 167 | 1.85 | 1.45 | +12% | −2% | −23% | 36% | 11/15 | 0/15 | — |
| 1h | 4500 | current, no MA | 172 | 1.90 | 1.50 | +15% | −5% | −23% | 40% | 12/15 | 0/15 | 3/15 |
| 1h | 4500 | new + 149 MA | 127 | 1.75 | 1.42 | +6% | −6% | −19% | 43% | 10/15 | 0/15 | 6/15 |
| 1h | 4500 | new, no MA | 129 | 1.86 | 1.53 | +9% | −6% | −19% | 43% | 11/15 | 0/15 | 6/15 |
| 2h | full | current + 149 MA | 1047 | 1.57 | 1.04 | +83% | +85% | −67% | 39% | 12/15 | 1/15 | — |
| 2h | full | current, no MA | 1193 | 1.46 | 0.96 | +39% | +71% | −70% | 37% | 10/15 | 1/15 | 3/15 |
| 2h | full | new + 149 MA | 704 | 1.89 | 1.48 | +124% | +194% | −52% | 43% | 15/15 | 5/15 | 10/15 |
| 2h | full | new, no MA | 765 | 1.87 | 1.47 | +188% | +260% | −48% | 42% | 15/15 | 6/15 | 12/15 |
| 2h | 4500 | current + 149 MA | 186 | 2.02 | 1.45 | +27% | +101% | −29% | 40% | 11/15 | 0/15 | — |
| 2h | 4500 | current, no MA | 221 | 1.81 | 1.33 | +20% | +95% | −31% | 38% | 11/15 | 0/15 | 6/15 |
| 2h | 4500 | new + 149 MA | 95 | 3.68 | 2.88 | +22% | +99% | −15% | 44% | 14/15 | 0/15 | 8/15 |
| 2h | 4500 | new, no MA | 104 | 3.35 | 2.67 | +23% | +88% | −15% | 44% | 15/15 | 0/15 | 9/15 |
| 4h | full | current + 149 MA | 636 | 1.85 | 1.22 | +92% | +180% | −58% | 41% | 12/15 | 2/15 | — |
| 4h | full | current, no MA | 818 | 1.69 | 1.12 | +106% | +81% | −60% | 39% | 11/15 | 3/15 | 6/15 |
| 4h | full | new + 149 MA | 472 | 1.92 | 1.45 | +77% | +17% | −54% | 43% | 14/15 | 2/15 | 8/15 |
| 4h | full | new, no MA | 546 | 2.04 | 1.54 | +152% | +181% | −52% | 46% | 14/15 | 4/15 | 9/15 |
| 4h | 4500 | current + 149 MA | 217 | 2.89 | 1.93 | +77% | +200% | −32% | 44% | 11/15 | 0/15 | — |
| 4h | 4500 | current, no MA | 294 | 2.48 | 1.59 | +105% | +218% | −42% | 42% | 10/15 | 1/15 | 9/15 |
| 4h | 4500 | new + 149 MA | 159 | 2.99 | 2.28 | +66% | +172% | −25% | 50% | 10/15 | 0/15 | 7/15 |
| 4h | 4500 | new, no MA | 193 | 3.11 | 2.34 | +63% | +251% | −31% | 50% | 12/15 | 0/15 | 8/15 |

**1h, full history — net · PF · max DD (trades)**

| coin | current + 149 MA | current, no MA | new + 149 MA | new, no MA |
| --- | --- | --- | --- | --- |
| SOL | −12% · 1.12 · −66% (144) | −21% · 1.10 · −66% (149) | +102% · 1.40 · −61% (93) | +83% · 1.35 · −61% (97) |
| FET | −94% · 0.74 · −97% (156) | −93% · 0.76 · −98% (162) | −90% · 0.69 · −94% (109) | −88% · 0.72 · −94% (113) |
| XLM | +235% · 1.60 · −74% (173) | +251% · 1.61 · −74% (175) | +170% · 1.63 · −45% (106) ✓ | +170% · 1.63 · −45% (106) ✓ |
| HBAR | −55% · 1.15 · −88% (131) | −55% · 1.15 · −88% (132) | +34% · 1.32 · −72% (95) | +34% · 1.32 · −72% (95) |
| PEPE | +1041% · 2.43 · −48% (77) ✓ | +910% · 2.33 · −52% (80) ✓ | +307% · 1.99 · −49% (58) ✓ | +307% · 1.99 · −49% (58) ✓ |
| AERO | +17% · 1.90 · −20% (10) | +17% · 1.90 · −20% (10) | +33% · 3.42 · −19% (7) | +33% · 3.42 · −19% (7) |
| INJ | −67% · 0.94 · −93% (139) | −67% · 0.94 · −93% (141) | +103% · 1.43 · −70% (80) | +99% · 1.42 · −70% (82) |
| STRK | +95% · 1.90 · −38% (33) ✓ | +73% · 1.74 · −41% (34) ✓ | +30% · 1.54 · −30% (23) | +16% · 1.37 · −38% (24) |
| ARB | −5% · 1.10 · −68% (73) | −3% · 1.11 · −68% (73) | +78% · 1.58 · −52% (51) | +82% · 1.60 · −52% (51) |
| SUI | −45% · 0.87 · −55% (77) | −52% · 0.82 · −57% (81) | −34% · 0.87 · −43% (53) | −34% · 0.87 · −43% (53) |
| ZEC | +43% · 1.35 · −73% (144) | +72% · 1.38 · −63% (149) | +34% · 1.26 · −51% (92) | +62% · 1.32 · −44% (95) |
| RENDER | −50% · 0.92 · −82% (95) | −53% · 0.90 · −82% (96) | +14% · 1.21 · −50% (50) | +14% · 1.21 · −50% (50) |
| RAY | −94% · 0.55 · −97% (120) | −93% · 0.56 · −97% (123) | −72% · 0.77 · −87% (77) | −70% · 0.79 · −87% (79) |
| CFX | +154% · 1.85 · −69% (107) | +130% · 1.82 · −72% (109) | +194% · 1.87 · −70% (64) | +177% · 1.83 · −72% (65) |
| STX | −91% · 0.79 · −97% (161) | −91% · 0.80 · −97% (162) | −61% · 0.92 · −90% (102) | −60% · 0.93 · −90% (103) |

**1h, last 4,500 bars — net · PF · max DD (trades)**

| coin | current + 149 MA | current, no MA | new + 149 MA | new, no MA |
| --- | --- | --- | --- | --- |
| SOL | +15% · 1.85 · −13% (14) | +15% · 1.85 · −13% (14) | −13% · 0.38 · −19% (9) | −13% · 0.38 · −19% (9) |
| FET | −1% · 1.03 · −20% (14) | +32% · 2.50 · −20% (15) | +6% · 1.44 · −20% (11) | +37% · 3.03 · −20% (12) |
| XLM | +8% · 1.39 · −34% (14) | +5% · 1.30 · −36% (15) | −6% · 0.93 · −30% (10) | −6% · 0.93 · −30% (10) |
| HBAR | +10% · 1.58 · −15% (8) | +10% · 1.58 · −15% (8) | +3% · 1.23 · −17% (8) | +3% · 1.23 · −17% (8) |
| PEPE | +12% · 1.53 · −22% (12) | +12% · 1.53 · −22% (12) | +9% · 1.45 · −18% (9) | +9% · 1.45 · −18% (9) |
| AERO | +17% · 1.90 · −20% (10) | +17% · 1.90 · −20% (10) | +33% · 3.42 · −19% (7) | +33% · 3.42 · −19% (7) |
| INJ | −9% · 0.90 · −32% (11) | −9% · 0.90 · −32% (11) | +5% · 1.41 · −19% (6) | +5% · 1.41 · −19% (6) |
| STRK | +82% · 3.36 · −34% (8) | +62% · 2.61 · −41% (9) | +56% · 2.65 · −30% (8) | +39% · 2.06 · −38% (9) |
| ARB | +109% · 8.40 · −23% (6) | +109% · 8.40 · −23% (6) | +95% · 7.59 · −18% (6) | +95% · 7.59 · −18% (6) |
| SUI | −16% · 0.58 · −34% (12) | −20% · 0.51 · −37% (13) | −9% · 0.75 · −28% (9) | −9% · 0.75 · −28% (9) |
| ZEC | +104% · 3.01 · −28% (15) | +105% · 3.04 · −24% (16) | +49% · 2.17 · −28% (12) | +55% · 2.42 · −24% (12) |
| RENDER | +6% · 1.46 · −17% (8) | +6% · 1.46 · −17% (8) | −11% · 0.28 · −17% (6) | −11% · 0.28 · −17% (6) |
| RAY | +23% · 1.71 · −28% (15) | +43% · 2.51 · −26% (15) | −11% · 0.86 · −33% (13) | +4% · 1.21 · −26% (13) |
| CFX | −18% · 0.50 · −33% (13) | −18% · 0.50 · −33% (13) | +16% · 2.99 · −12% (7) | +16% · 2.99 · −12% (7) |
| STX | +28% · 2.68 · −17% (7) | +28% · 2.68 · −17% (7) | +42% · 4.07 · −12% (6) | +42% · 4.07 · −12% (6) |

**2h, full history — net · PF · max DD (trades)**

| coin | current + 149 MA | current, no MA | new + 149 MA | new, no MA |
| --- | --- | --- | --- | --- |
| SOL | +132% · 1.48 · −45% (90) | +93% · 1.38 · −48% (99) | +333% · 2.12 · −32% (62) | +359% · 2.12 · −32% (65) |
| FET | +1031% · 2.15 · −76% (91) | +608% · 1.86 · −78% (106) | +242% · 1.85 · −57% (61) ✓ | +188% · 1.67 · −59% (70) ✓ |
| XLM | +448% · 2.01 · −67% (115) | +640% · 2.06 · −70% (129) | +208% · 1.86 · −52% (73) | +233% · 1.87 · −53% (79) |
| HBAR | +325% · 1.86 · −76% (89) | +293% · 1.79 · −79% (95) | +605% · 2.16 · −62% (69) | +678% · 2.18 · −64% (72) |
| PEPE | +248% · 1.98 · −53% (51) | +294% · 1.95 · −56% (57) | +227% · 2.18 · −42% (37) | +333% · 2.31 · −46% (39) |
| AERO | +14% · 2.48 · −15% (6) | +5% · 1.38 · −15% (8) | +18% · 4.11 · −15% (5) | +15% · 2.63 · −15% (6) |
| INJ | −65% · 0.89 · −94% (90) | −70% · 0.88 · −95% (103) | +39% · 1.33 · −79% (63) | +42% · 1.32 · −80% (70) |
| STRK | +126% · 2.69 · −40% (21) | +23% · 1.43 · −54% (30) | +97% · 2.74 · −35% (16) | +43% · 1.72 · −44% (20) |
| ARB | +83% · 1.82 · −46% (38) | +192% · 2.14 · −44% (49) | +124% · 2.17 · −41% (32) | +259% · 2.65 · −37% (38) ✓ |
| SUI | +53% · 1.50 · −31% (48) ✓ | +39% · 1.38 · −36% (54) ✓ | +90% · 2.10 · −25% (31) ✓ | +98% · 2.16 · −25% (33) ✓ |
| ZEC | −4% · 1.27 · −80% (98) | −10% · 1.23 · −81% (110) | +39% · 1.36 · −65% (61) | +76% · 1.47 · −61% (64) |
| RENDER | +44% · 1.44 · −44% (45) | −8% · 1.16 · −65% (58) | +38% · 1.60 · −29% (25) ✓ | +55% · 1.68 · −27% (30) ✓ |
| RAY | −53% · 0.95 · −86% (77) | −67% · 0.86 · −90% (83) | +70% · 1.44 · −63% (56) | +56% · 1.40 · −67% (58) |
| CFX | +228% · 2.13 · −67% (78) | +199% · 2.01 · −70% (86) | +887% · 3.10 · −52% (44) ✓ | +917% · 2.89 · −48% (48) ✓ |
| STX | +25% · 1.25 · −85% (110) | −42% · 1.10 · −92% (126) | +270% · 1.73 · −53% (69) ✓ | +223% · 1.64 · −57% (73) ✓ |

**2h, last 4,500 bars — net · PF · max DD (trades)**

| coin | current + 149 MA | current, no MA | new + 149 MA | new, no MA |
| --- | --- | --- | --- | --- |
| SOL | +6% · 1.40 · −20% (12) | +6% · 1.40 · −20% (12) | +13% · 2.63 · −7% (7) | +13% · 2.63 · −7% (7) |
| FET | +74% · 3.27 · −26% (14) | +45% · 2.03 · −28% (18) | +34% · 4.28 · −16% (8) | +28% · 2.91 · −17% (9) |
| XLM | +44% · 2.74 · −28% (12) | +45% · 2.38 · −31% (15) | +28% · 2.76 · −15% (7) | +22% · 2.19 · −15% (8) |
| HBAR | −5% · 0.86 · −29% (13) | −5% · 0.86 · −29% (13) | +12% · 2.08 · −16% (9) | +12% · 2.08 · −16% (9) |
| PEPE | +27% · 1.77 · −36% (11) | +28% · 1.73 · −35% (14) | +24% · 2.31 · −17% (5) | +23% · 2.10 · −17% (6) |
| AERO | +14% · 2.48 · −15% (6) | +5% · 1.38 · −15% (8) | +18% · 4.11 · −15% (5) | +15% · 2.63 · −15% (6) |
| INJ | −18% · 0.73 · −29% (15) | −8% · 0.98 · −31% (17) | +16% · 1.95 · −15% (9) | +30% · 2.30 · −15% (10) |
| STRK | +219% · 15.81 · −31% (8) | +132% · 3.85 · −34% (12) | +145% · ∞ · −14% (4) | +111% · 7.59 · −23% (5) |
| ARB | +157% · 10.46 · −18% (7) | +199% · 8.66 · −19% (10) | +135% · 31.34 · −14% (5) | +177% · 24.27 · −11% (6) |
| SUI | −3% · 1.01 · −28% (13) | −15% · 0.75 · −28% (17) | +20% · 2.54 · −13% (5) | +20% · 2.54 · −13% (5) |
| ZEC | +57% · 1.96 · −38% (19) | +55% · 1.87 · −38% (21) | +115% · 7.73 · −17% (7) | +115% · 7.73 · −17% (7) |
| RENDER | +56% · 3.50 · −26% (10) | +62% · 3.29 · −22% (12) | −7% · 0.15 · −14% (4) | +2% · 1.35 · −14% (5) |
| RAY | +9% · 1.35 · −37% (15) | +8% · 1.29 · −39% (17) | +23% · 1.87 · −23% (9) | +26% · 1.93 · −23% (10) |
| CFX | −40% · 0.32 · −50% (15) | −35% · 0.45 · −48% (17) | +22% · 3.93 · −13% (5) | +22% · 3.93 · −13% (5) |
| STX | +27% · 1.75 · −35% (16) | +20% · 1.64 · −35% (18) | +21% · 1.96 · −20% (6) | +24% · 2.05 · −20% (6) |

**4h, full history — net · PF · max DD (trades)**

| coin | current + 149 MA | current, no MA | new + 149 MA | new, no MA |
| --- | --- | --- | --- | --- |
| SOL | +178% · 1.89 · −37% (58) | +188% · 1.79 · −37% (68) | +337% · 2.66 · −28% (47) | +336% · 2.58 · −28% (50) |
| FET | +209% · 1.78 · −71% (55) | +246% · 1.74 · −77% (67) | +6% · 1.27 · −57% (38) | +74% · 1.61 · −56% (43) |
| XLM | +2024% · 4.46 · −53% (63) ✓ | +1962% · 3.45 · −64% (84) | +713% · 3.66 · −44% (44) ✓ | +936% · 3.56 · −43% (51) ✓ |
| HBAR | +719% · 3.02 · −60% (46) | +716% · 2.85 · −60% (56) ✓ | +588% · 3.23 · −55% (35) ✓ | +490% · 2.79 · −62% (42) |
| PEPE | +192% · 2.04 · −58% (35) | +372% · 2.32 · −52% (43) ✓ | +222% · 2.34 · −54% (26) | +261% · 2.32 · −52% (30) ✓ |
| AERO | +40% · ∞ · −12% (4) | +35% · 8.80 · −12% (5) | +40% · ∞ · −12% (4) | +40% · ∞ · −12% (4) |
| INJ | −64% · 0.78 · −75% (59) | −78% · 0.73 · −86% (75) | −54% · 0.77 · −70% (44) | −49% · 0.85 · −66% (50) |
| STRK | +64% · 2.52 · −32% (14) | +79% · 2.15 · −41% (21) | +88% · 4.04 · −24% (11) | +152% · 4.34 · −25% (15) |
| ARB | +231% · 2.68 · −38% (30) | +229% · 2.44 · −37% (37) | +155% · 2.51 · −34% (25) | +196% · 2.57 · −41% (30) |
| SUI | −7% · 1.02 · −42% (32) | −30% · 0.87 · −44% (44) | +11% · 1.29 · −41% (24) | +6% · 1.21 · −41% (28) |
| ZEC | +92% · 1.55 · −73% (65) | +37% · 1.34 · −82% (84) | +73% · 1.58 · −76% (45) | +39% · 1.41 · −78% (53) |
| RENDER | +94% · 1.94 · −42% (27) ✓ | +203% · 2.22 · −49% (38) ✓ | +34% · 1.69 · −36% (18) | +108% · 2.34 · −36% (22) ✓ |
| RAY | −42% · 0.92 · −70% (39) | −61% · 0.85 · −87% (48) | +10% · 1.29 · −61% (32) | +32% · 1.41 · −66% (37) |
| CFX | +47% · 1.95 · −73% (37) | +106% · 1.91 · −78% (55) | +108% · 2.12 · −61% (27) | +506% · 2.87 · −61% (32) |
| STX | +4% · 1.26 · −73% (72) | −44% · 1.09 · −87% (93) | +77% · 1.52 · −66% (52) | +173% · 1.72 · −58% (59) ✓ |

**4h, last 4,500 bars — net · PF · max DD (trades)**

| coin | current + 149 MA | current, no MA | new + 149 MA | new, no MA |
| --- | --- | --- | --- | --- |
| SOL | +90% · 5.64 · −20% (16) | +92% · 4.55 · −21% (22) ✓ | +97% · 7.18 · −14% (13) | +96% · 6.82 · −14% (16) |
| FET | +79% · 3.26 · −22% (13) | +138% · 3.47 · −27% (19) | −0% · 1.03 · −20% (8) | +41% · 3.94 · −20% (11) |
| XLM | +757% · 11.89 · −32% (15) | +642% · 7.34 · −38% (22) | +409% · 12.67 · −25% (12) | +413% · 8.66 · −31% (15) |
| HBAR | +238% · 6.41 · −42% (13) | +232% · 5.42 · −46% (18) | +184% · 7.27 · −27% (10) | +164% · 5.55 · −32% (13) |
| PEPE | +155% · 3.02 · −37% (16) | +194% · 2.78 · −47% (23) | +178% · 4.62 · −30% (10) | +191% · 4.00 · −32% (13) |
| AERO | +40% · ∞ · −12% (4) | +35% · 8.80 · −12% (5) | +40% · ∞ · −12% (4) | +40% · ∞ · −12% (4) |
| INJ | −55% · 0.11 · −60% (18) | −54% · 0.37 · −67% (25) | −51% · 0.03 · −57% (15) | −44% · 0.40 · −60% (18) |
| STRK | +77% · 3.02 · −31% (12) | +105% · 2.77 · −41% (16) | +103% · 5.69 · −19% (9) | +189% · 8.75 · −19% (10) |
| ARB | +316% · 5.28 · −28% (16) | +327% · 4.48 · −35% (20) | +242% · 6.21 · −25% (12) | +310% · 6.48 · −25% (14) |
| SUI | +38% · 2.14 · −23% (17) | −14% · 0.94 · −44% (27) | +66% · 3.45 · −18% (14) | +63% · 2.90 · −21% (17) |
| ZEC | +182% · 2.56 · −40% (25) | +239% · 2.97 · −42% (27) | +167% · 3.42 · −46% (14) | +152% · 3.10 · −47% (16) |
| RENDER | +44% · 4.37 · −14% (6) | +148% · 5.30 · −20% (11) | −6% · 0.39 · −10% (2) | +44% · 4.71 · −17% (5) |
| RAY | −8% · 0.98 · −38% (11) | −49% · 0.49 · −65% (17) | −8% · 0.99 · −38% (9) | −21% · 0.78 · −47% (12) |
| CFX | −5% · 0.98 · −46% (13) | −12% · 0.84 · −50% (16) | +29% · 2.66 · −30% (9) | +23% · 2.14 · −33% (10) |
| STX | −42% · 0.61 · −57% (22) | −30% · 0.79 · −58% (26) | −51% · 0.43 · −63% (18) | −29% · 0.71 · −58% (19) |

**Walk-forward on these coins — PF w/o top 2% in cycle A (2020–22) / cycle B (2023→)**

| tf | current + 149 MA | current, no MA | new + 149 MA | new, no MA |
| --- | --- | --- | --- | --- |
| 1h | 0.41 / 0.96 | 0.41 / 0.96 | 0.76 / 1.02 | 0.77 / 1.02 |
| 2h | 0.58 / 1.38 | 0.49 / 1.32 | 1.07 / 1.72 | 1.05 / 1.68 |
| 4h | 0.57 / 1.57 | 0.43 / 1.59 | 0.67 / 1.75 | 0.77 / 1.95 |

**24b. Same four combinations on the broader lists (32 coins of section 1, and the 2021 list of section 21) — 2h and 4h, full history**

| list | tf | rules | trades | PF | PF w/o top 2% | coins PF>1 w/o top 3 | median net | median max DD | A | B |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 32 coins | 2h | current + 149 MA | 2072 | 1.65 | 1.09 | 8/32 | +53% | −46% | 0.96 | 1.09 |
| 32 coins | 2h | current, no MA | 2362 | 1.56 | 1.04 | 11/32 | +58% | −54% | 0.84 | 1.10 |
| 32 coins | 2h | new + 149 MA | 1414 | 1.87 | 1.42 | 13/32 | +70% | −42% | 1.52 | 1.39 |
| 32 coins | 2h | new, no MA | 1547 | 1.87 | 1.43 | 14/32 | +88% | −44% | 1.47 | 1.43 |
| 32 coins | 4h | current + 149 MA | 1246 | 2.01 | 1.31 | 11/32 | +47% | −42% | 1.10 | 1.24 |
| 32 coins | 4h | current, no MA | 1611 | 1.84 | 1.20 | 14/32 | +67% | −49% | 0.95 | 1.27 |
| 32 coins | 4h | new + 149 MA | 921 | 2.09 | 1.54 | 11/32 | +40% | −41% | 1.37 | 1.50 |
| 32 coins | 4h | new, no MA | 1067 | 2.18 | 1.62 | 13/32 | +86% | −41% | 1.37 | 1.67 |
| 2021 list (50) | 2h | current + 149 MA | 4623 | 1.33 | 0.87 | 13/50 | +10% | −70% | 0.90 | 0.73 |
| 2021 list (50) | 2h | current, no MA | 5195 | 1.28 | 0.83 | 14/50 | +5% | −73% | 0.83 | 0.78 |
| 2021 list (50) | 2h | new + 149 MA | 3104 | 1.46 | 1.06 | 17/50 | +37% | −56% | 1.28 | 0.91 |
| 2021 list (50) | 2h | new, no MA | 3346 | 1.44 | 1.04 | 17/50 | +35% | −56% | 1.23 | 0.94 |
| 2021 list (50) | 4h | current + 149 MA | 2665 | 1.68 | 1.05 | 16/50 | +76% | −58% | 1.11 | 0.91 |
| 2021 list (50) | 4h | current, no MA | 3376 | 1.56 | 0.97 | 16/50 | +41% | −63% | 0.97 | 0.96 |
| 2021 list (50) | 4h | new + 149 MA | 1865 | 1.83 | 1.31 | 19/50 | +66% | −47% | 1.45 | 1.16 |
| 2021 list (50) | 4h | new, no MA | 2158 | 1.84 | 1.31 | 19/50 | +99% | −49% | 1.39 | 1.31 |

---

# 25. Final decision — what the BTC filter leaves behind, and which rule set to ship

## 25a. The trades "BTC above its 100-day MA" skips (current rules, honest fills, all 32 coins)

Every trade the current rules take while BTC is BELOW its 100-day MA — exactly the set the filter removes.

| tf | trades kept | kept PF | kept avg | │ | trades skipped | skipped WR | skipped PF | skipped avg | skipped PF w/o top 2% | share of all profit from skipped | skipped in cycle A: PF | skipped in cycle B: PF |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2h | 1385 | 1.99 | +3% | │ | 687 | 35% | 0.99 | −0% | 0.64 | 21% | 0.67 | 1.13 |
| 4h | 907 | 2.31 | +5% | │ | 339 | 39% | 1.21 | +1% | 0.87 | 16% | 1.09 | 1.20 |

**Biggest 2h winners the filter would have skipped — and whether a rescue rule catches them**

| coin | signal date | trade | BTC vs its 100d MA | coin up ≥ 50% in 30d? | coin > own 200d MA & beating BTC? |
| --- | --- | --- | --- | --- | --- |
| FET | 2023-01-02 | +168% | −8% | yes | yes |
| ZEC | 2025-09-29 | +132% | −1% | yes | yes |
| DOGE | 2022-10-25 | +104% | −4% | no | no |
| RENDER | 2025-12-27 | +72% | −14% | no | no |
| FET | 2025-04-17 | +46% | −7% | no | no |
| LINK | 2020-03-31 | +35% | −21% | no | no |
| SOL | 2026-08-18 | +35% | −3% | no | no |
| XLM | 2018-07-13 | +33% | −18% | no | no |
| TAO | 2025-04-17 | +32% | −7% | no | no |
| CFX | 2021-08-05 | +32% | −1% | no | no |
| BTC | 2023-01-08 | +31% | −5% | no | no |
| NEAR | 2021-12-22 | +31% | −10% | no | yes |

**Biggest 4h winners the filter would have skipped — and whether a rescue rule catches them**

| coin | signal date | trade | BTC vs its 100d MA | coin up ≥ 50% in 30d? | coin > own 200d MA & beating BTC? |
| --- | --- | --- | --- | --- | --- |
| DOGE | 2022-10-26 | +99% | −3% | no | no |
| HBAR | 2023-01-08 | +60% | −5% | no | no |
| OP | 2022-07-27 | +59% | −18% | yes | no |
| ZEC | 2026-08-17 | +57% | −5% | no | no |
| WLD | 2025-09-08 | +46% | −1% | no | yes |
| FET | 2025-04-17 | +44% | −7% | no | no |
| FET | 2023-01-10 | +36% | −3% | yes | yes |
| RENDER | 2026-01-03 | +33% | −10% | no | no |
| WIF | 2024-07-15 | +33% | −2% | no | no |
| XLM | 2018-07-13 | +31% | −18% | no | no |
| CFX | 2021-08-05 | +29% | −2% | no | no |
| OP | 2022-10-23 | +28% | −7% | no | no |

## 25b. Every candidate on every test

Score = PF without the top 2% of trades (does it make money without its jackpots). **Worst-case** = the lowest of the four robustness scores (32 coins cycle A, 32 coins cycle B, your 15 coins full history, and the 2021 list in 2023→ — the only test where neither the coins nor the rules could have been chosen with hindsight). The rule set to ship is the one with the best worst-case, not the best single number.


**2h**

| rules | trades (32) | 32: PF w/o top | 32: A | 32: B | yours 15: PF w/o top | yours 15: median net | yours 15: median DD | 2021 list 2023→: PF w/o top | **worst-case** | portfolio 2021 list 2023→ (N=10) | portfolio 32 coins 2020→ (N=10) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A. current (149 MA, 1-day-low trail) | 2072 | 1.09 | 0.96 | 1.09 | 1.04 | +83% | −67% | 0.73 | **0.73** | 1.3× · DD −59% | 21.1× · DD −47% |
| B. current + sell ½ at 3R | 2072 | 1.17 | 1.04 | 1.17 | 1.14 | +88% | −59% | 0.80 | **0.80** | 1.0× · DD −57% | 13.1× · DD −41% |
| C. BTC>100d + sell ½ at 3R | 1414 | 1.42 | 1.52 | 1.39 | 1.48 | +124% | −52% | 0.91 | **0.91** | 1.1× · DD −50% | 17.7× · DD −22% |
| D. C without the 149 MA | 1547 | 1.43 | 1.47 | 1.43 | 1.47 | +188% | −48% | 0.94 | **0.94** | 0.9× · DD −51% | 18.2× · DD −21% |
| E. (BTC>100d OR coin +50% in 30d) + ½ at 3R | 1441 | 1.38 | 1.41 | 1.35 | 1.43 | +124% | −52% | 0.92 | **0.92** | 1.3× · DD −50% | 17.8× · DD −22% |
| F. (BTC>100d OR coin strong vs BTC) + ½ at 3R | 1482 | 1.38 | 1.38 | 1.36 | 1.40 | +124% | −52% | 0.94 | **0.94** | 1.4× · DD −50% | 17.9× · DD −22% |
| G. (BTC>50d OR coin +50% in 30d) + ½ at 3R | 1545 | 1.40 | 1.45 | 1.37 | 1.48 | +172% | −46% | 0.96 | **0.96** | 1.7× · DD −42% | 22.0× · DD −22% |
| H. BTC>100d + ATR trail k=4 | 1273 | 1.58 | 1.85 | 1.47 | 1.60 | +374% | −52% | 1.03 | **1.03** | 1.4× · DD −45% | 98.0× · DD −31% |
| I. (BTC>100d OR coin +50% in 30d) + ATR trail k=4 | 1298 | 1.54 | 1.76 | 1.45 | 1.57 | +340% | −54% | 1.04 | **1.04** | 1.6× · DD −45% | 108.6× · DD −31% |
| J. BTC>100d + ½ at 3R, rest on ATR trail k=4 | 1273 | 1.62 | 1.81 | 1.55 | 1.65 | +316% | −49% | 1.09 | **1.09** | 1.2× · DD −40% | 43.4× · DD −30% |
| K. H without the 149 MA | 1401 | 1.53 | 1.87 | 1.47 | 1.53 | +405% | −56% | 1.05 | **1.05** | 1.1× · DD −47% | 98.8× · DD −37% |
| L. J without the 149 MA | 1401 | 1.57 | 1.81 | 1.53 | 1.58 | +241% | −56% | 1.11 | **1.11** | 1.0× · DD −45% | 40.7× · DD −37% |

**4h**

| rules | trades (32) | 32: PF w/o top | 32: A | 32: B | yours 15: PF w/o top | yours 15: median net | yours 15: median DD | 2021 list 2023→: PF w/o top | **worst-case** | portfolio 2021 list 2023→ (N=10) | portfolio 32 coins 2020→ (N=10) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A. current (149 MA, 1-day-low trail) | 1246 | 1.31 | 1.10 | 1.24 | 1.22 | +92% | −58% | 0.91 | **0.91** | 2.8× · DD −32% | 24.1× · DD −35% |
| B. current + sell ½ at 3R | 1246 | 1.34 | 1.08 | 1.28 | 1.28 | +65% | −56% | 0.96 | **0.96** | 2.3× · DD −30% | 14.1× · DD −33% |
| C. BTC>100d + sell ½ at 3R | 921 | 1.54 | 1.37 | 1.50 | 1.45 | +77% | −54% | 1.16 | **1.16** | 2.7× · DD −31% | 13.2× · DD −23% |
| D. C without the 149 MA | 1067 | 1.62 | 1.37 | 1.67 | 1.54 | +152% | −52% | 1.31 | **1.31** | 2.4× · DD −34% | 16.9× · DD −22% |
| E. (BTC>100d OR coin +50% in 30d) + ½ at 3R | 942 | 1.52 | 1.31 | 1.48 | 1.40 | +78% | −54% | 1.18 | **1.18** | 3.1× · DD −31% | 14.2× · DD −23% |
| F. (BTC>100d OR coin strong vs BTC) + ½ at 3R | 965 | 1.50 | 1.29 | 1.46 | 1.40 | +68% | −54% | 1.16 | **1.16** | 3.1× · DD −29% | 13.6× · DD −25% |
| G. (BTC>50d OR coin +50% in 30d) + ½ at 3R | 1030 | 1.51 | 1.30 | 1.43 | 1.50 | +171% | −43% | 1.13 | **1.13** | 3.0× · DD −28% | 16.5× · DD −25% |
| H. BTC>100d + ATR trail k=4 | 764 | 1.83 | 2.43 | 1.57 | 1.77 | +162% | −62% | 1.47 | **1.47** | 2.6× · DD −41% | 68.9× · DD −41% |
| I. (BTC>100d OR coin +50% in 30d) + ATR trail k=4 | 783 | 1.76 | 2.26 | 1.52 | 1.75 | +162% | −62% | 1.49 | **1.49** | 2.8× · DD −41% | 71.5× · DD −41% |
| J. BTC>100d + ½ at 3R, rest on ATR trail k=4 | 764 | 1.82 | 2.19 | 1.63 | 1.78 | +151% | −61% | 1.49 | **1.49** | 1.9× · DD −37% | 30.0× · DD −33% |
| K. H without the 149 MA | 878 | 1.85 | 2.10 | 1.84 | 1.80 | +168% | −60% | 1.68 | **1.68** | 1.7× · DD −47% | 70.6× · DD −41% |
| L. J without the 149 MA | 878 | 1.84 | 1.96 | 1.84 | 1.78 | +174% | −55% | 1.64 | **1.64** | 1.5× · DD −44% | 31.6× · DD −37% |

BTC buy & hold for reference: 2023→ 4.9× · CAGR +52% · DD −54% · 2020→ 11.4× · CAGR +43% · DD −77%.
