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
