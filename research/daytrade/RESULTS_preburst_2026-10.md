# Pre-burst signals on mid/small caps, held 14–18 hours — hourly backtest (Oct 2026)

557 Binance USDT coins (delisted included), hourly, 2023-01-01T00:00:00 → 2026-10-24T08:00:00. Only coins trading **$1M–$50M a day** (mid/small caps) can be picked; on a typical recent hour that is 197 coins. Signals at the close of an hour, entry at the next open, spot long only, 0.1% fee + 0.2% slippage per side. Settings chosen on 2023–24, judged on 2025–26 (unseen). Same-candle target+stop counts as the stop.

## 1. Does the setup come before bursts UP — more than a random mid/small coin at the same hour?

Before costs, from the entry open. **+10% first** = the price reached +10% within 16 hours before it ever fell 10%; **−10% first** the reverse. A pre-burst signal worth trading must raise the first and not the second.

| setup | signals | per day | avg after 16h | random coin, avg after 16h | +10% first (16h) | −10% first (16h) | random: +10% first | random: −10% first |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1. squeeze breakout (tight 48h range, breaks 48h high, moderate volume, no big candle yet) | 29,460 | 21.2 | -0.0% | +0.0% | 6% | 2% | 6% | 3% |
| 2. quiet accumulation (24h volume ≥ 2× its weekly normal, price flat −2…+3%) | 110,630 | 79.5 | +0.0% | +0.0% | 9% | 4% | 7% | 4% |
| 3. strong while BTC is weak (BTC −1.5% over 12h, coin up and within 2% of its 48h high) | 24,696 | 17.7 | -0.2% | +0.1% | 11% | 8% | 7% | 5% |
| 4. higher lows, then breaks the 72h high (hour gain < 3%) | 96,958 | 69.6 | +0.1% | +0.1% | 8% | 4% | 7% | 3% |
| 5. volume wakes after a quiet 2 days, breaking the 72h high | 19,550 | 14.0 | -0.3% | +0.1% | 13% | 7% | 6% | 3% |

## 2. Trading each setup: 3 positions at a time, a third each, held up to 14–18h

36 exit settings per setup (target +8/+15/+25%/none × stop −4/−6/−10% × time exit 14/16/18h), with and without a BTC-uptrend gate (BTC above its 50-day MA). The setting is picked on 2023–24 by return ÷ drawdown; the 2025–26 column is what it then did on data it never saw. **Random** = the same setting on a random mid/small coin at the same hours.

| setup | BTC gate | settings profitable 2023–24 | settings profitable 2025–26 | picked setting | 2023–24 end value | **2025–26 end value** | 2025–26 trades / win rate / avg | 2025–26 max DD | 2025–26 random coin |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1. squeeze breakout | off | 0/36 | 0/36 | +8% / −10% / 16h | 0.01× | **0.00×** | 1992 / 36% / -0.8% | -99.7% | 0.00× |
| 1. squeeze breakout | on | 0/36 | 0/36 | +8% / −10% / 16h | 0.06× | **0.04×** | 1107 / 36% / -0.8% | -96.4% | 0.05× |
| 2. quiet accumulation | off | 0/36 | 0/36 | +8% / −10% / 16h | 0.00× | **0.00×** | 3165 / 42% / -0.5% | -99.8% | 0.00× |
| 2. quiet accumulation | on | 0/36 | 0/36 | no target / −10% / 18h | 0.02× | **0.02×** | 1398 / 37% / -0.8% | -98.7% | 0.02× |
| 3. strong while BTC is weak | off | 0/36 | 0/36 | +25% / −6% / 18h | 0.00× | **0.01×** | 1112 / 27% / -1.3% | -99.5% | 0.08× |
| 3. strong while BTC is weak | on | 0/36 | 0/36 | +25% / −10% / 16h | 0.05× | **0.18×** | 334 / 32% / -1.4% | -83.8% | 0.50× |
| 4. higher lows, then breaks the 72h high | off | 0/36 | 0/36 | +8% / −10% / 16h | 0.00× | **0.00×** | 2677 / 40% / -0.6% | -99.8% | 0.00× |
| 4. higher lows, then breaks the 72h high | on | 0/36 | 0/36 | +8% / −10% / 16h | 0.04× | **0.05×** | 1514 / 42% / -0.5% | -95.1% | 0.05× |
| 5. volume wakes after a quiet 2 days, breaking the 72h high | off | 0/36 | 0/36 | +8% / −10% / 16h | 0.00× | **0.00×** | 2357 / 39% / -1.2% | -100.0% | 0.01× |
| 5. volume wakes after a quiet 2 days, breaking the 72h high | on | 0/36 | 0/36 | +8% / −10% / 16h | 0.00× | **0.02×** | 1262 / 41% / -0.9% | -98.6% | 0.07× |

## 3. Verdict

**No setup passed**: none made money in 2023–24 *and* on the unseen 2025–26 *and* beat a random coin there.
