# Day-trading volume bursts across Binance — hourly backtest (Oct 2026)

**557 Binance USDT coins** that traded ≥ $1M/day at some point since 2023 (delisted ones included), hourly candles 2023-01-01 → 2026-10-24T08:00:00 UTC. A coin can only be traded in an hour when its average $ volume over the prior 7 days is ≥ $1M/day. Costs per side: 0.1% fee + slippage (0.2% unless stated). See the docstring of `daytrade_lab.py` for the exact rules.

## 1. How often does the scanner fire?

| signal: hour volume ≥ … × 24h avg, hour gain ≥ … | signals 2023-24 | signals 2025-26 | per day |
| --- | --- | --- | --- |
| 3× and +2% | 31,435 | 27,129 | 42.1 |
| 3× and +4% | 14,012 | 12,254 | 18.9 |
| 5× and +2% | 14,375 | 12,223 | 19.1 |
| 5× and +4% | 8,468 | 7,353 | 11.4 |

## 2. All 108 settings — how many make money?

Each setting = one signal threshold × one take-profit × one stop × one time limit. Portfolio result of the 3-slot book.

|  | 2023-24 (choose here) | 2025-26 (unseen) |
| --- | --- | --- |
| settings that made money | 0/108 | 0/108 |
| settings beating the same exits on a random coin | 0/108 | 0/108 |
| median end value | 0.00× | 0.00× |

## 3. Walk-forward: the best 2023-24 setting, judged on 2025-26

Chosen by return ÷ drawdown on 2023-24 only: **volume ≥ 3× and hour gain ≥ +2%, take profit +10%, stop −8%, time limit 24h.**

|  | trades | win rate | avg trade | PF | end value | CAGR | max DD |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2023-24 (in sample, signal) | 3365 | 38% | -1.1% | 0.72 | 0.00× | -99.9% | -100.0% |
| 2023-24 random coin, same exits | 2335 | 45% | -0.3% | 0.87 | 0.07× | -74.2% | -96.0% |
| **2025-26 (unseen), signal** | 3253 | 38% | -1.0% | 0.73 | 0.00× | -99.9% | -100.0% |
| 2025-26 random coin, same exits | 2167 | 39% | -0.8% | 0.68 | 0.00× | -97.0% | -99.8% |

## 4. Top 10 settings on 2023-24 — and what each did next

| signal | TP | SL | max hold | 2023-24 end value | 2023-24 max DD | 2025-26 end value | 2025-26 max DD | 2025-26 random coin |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 3× / +2% | +10% | −8% | 24h | 0.00× | -100.0% | 0.00× | -100.0% | 0.00× |
| 5× / +2% | +10% | −8% | 24h | 0.00× | -100.0% | 0.00× | -100.0% | 0.00× |
| 3× / +2% | +5% | −8% | 24h | 0.00× | -100.0% | 0.00× | -100.0% | 0.00× |
| 5× / +2% | +5% | −8% | 24h | 0.00× | -100.0% | 0.00× | -100.0% | 0.00× |
| 3× / +2% | +20% | −8% | 24h | 0.00× | -100.0% | 0.00× | -100.0% | 0.00× |
| 5× / +4% | +10% | −8% | 24h | 0.00× | -100.0% | 0.00× | -100.0% | 0.00× |
| 3× / +4% | +10% | −8% | 24h | 0.00× | -100.0% | 0.00× | -100.0% | 0.01× |
| 5× / +2% | +20% | −8% | 24h | 0.00× | -100.0% | 0.00× | -100.0% | 0.00× |
| 3× / +2% | +20% | −5% | 24h | 0.00× | -100.0% | 0.00× | -100.0% | 0.00× |
| 5× / +4% | +5% | −8% | 24h | 0.00× | -100.0% | 0.00× | -100.0% | 0.00× |

## 5. The chosen setting at different trading costs (2023 → now)

| slippage per side (+0.1% fee) | trades | win rate | avg trade | end value | CAGR | max DD |
| --- | --- | --- | --- | --- | --- | --- |
| 0.0% | 6578 | 41% | -0.6% | 0.00× | -98.4% | -100.0% |
| 0.1% | 6633 | 39% | -0.8% | 0.00× | -99.6% | -100.0% |
| 0.2% | 6617 | 38% | -1.0% | 0.00× | -99.9% | -100.0% |
| 0.5% | 6723 | 35% | -1.7% | 0.00× | -100.0% | -100.0% |

## 6. What a burst does next, on average (all signals at the loosest threshold, before costs)

| hours after entry | avg return from entry | share still above entry | avg best price reached | avg worst price reached |
| --- | --- | --- | --- | --- |
| 1 | -0.2% | 42% | +2.7% | -2.2% |
| 2 | -0.2% | 42% | +3.5% | -2.8% |
| 4 | -0.2% | 43% | +4.4% | -3.5% |
| 8 | -0.3% | 42% | +5.7% | -4.5% |
| 12 | -0.3% | 42% | +6.6% | -5.1% |
| 24 | -0.5% | 40% | +8.8% | -6.5% |

## 7. Is the conservative fill rule what sinks it? And do big coins behave better?

**Optimistic bound:** if one candle touches both the target and the stop, count it as the TARGET instead, and charge no slippage at all (fee only). If the scanner still loses under these flattering assumptions, the result does not depend on how fills were modelled.

| signal | TP / SL / max hold | trades taken | win rate | avg trade | end value 2023 → now |
| --- | --- | --- | --- | --- | --- |
| 3× / +2% | +5% / −3% / 4h | 26588 | 40% | -0.1% | 0.00× |
| 3× / +2% | +10% / −8% / 24h | 6578 | 41% | -0.5% | 0.00× |
| 3× / +2% | +20% / −5% / 24h | 7325 | 29% | -0.6% | 0.00× |
| 3× / +4% | +5% / −3% / 4h | 19003 | 40% | -0.0% | 0.01× |
| 3× / +4% | +10% / −8% / 24h | 7339 | 40% | -0.6% | 0.00× |
| 3× / +4% | +20% / −5% / 24h | 8148 | 25% | -0.8% | 0.00× |
| 5× / +2% | +5% / −3% / 4h | 18158 | 40% | -0.1% | 0.00× |
| 5× / +2% | +10% / −8% / 24h | 6329 | 40% | -0.7% | 0.00× |
| 5× / +2% | +20% / −5% / 24h | 6844 | 28% | -0.8% | 0.00× |
| 5× / +4% | +5% / −3% / 4h | 13045 | 41% | -0.0% | 0.22× |
| 5× / +4% | +10% / −8% / 24h | 6520 | 39% | -0.9% | 0.00× |
| 5× / +4% | +20% / −5% / 24h | 7038 | 24% | -0.9% | 0.00× |

Under the optimistic rules **0 of 108** settings end above 1.0×.

**Big coins only** — the same scan restricted to coins averaging ≥ $50M a day over the prior week (the BTC/ETH/SOL tier, where a volume burst is less likely to be one wallet pumping a thin book). Realistic fills again.

|  | 2023-24 | 2025-26 (unseen) |
| --- | --- | --- |
| settings that made money (of 108) | 3 | 1 |
| best 2023-24 setting (5× / +4%, +20% / −8% / 12h): end value | 1.09× (DD -54.0%) | 0.59× (DD -43.5%) |
| …its trades / win rate / avg trade | 517 / 44% / +0.2% | 238 / 39% / -0.6% |
