# ScreenerPro — crypto investment advisor & backtester

Long-only daily investing tool on Binance spot data. Four systematic strategies with full-history
backtests, an Advisor panel reading the live market context, and TradingView-style trade visuals.
Fully static (`index.html` + `detector.js`) — no build step.

## Strategies
| Strategy | Idea |
|---|---|
| **Composite** (default) | Vol-targeted trend ensemble: 3 signals (200d MA, 90d momentum, 55d channel), 3-day persistence, chandelier trailing stop, volatility-sized positions |
| **Trend Follow** | CTA momentum: long above 200d MA with positive 90d return, else cash |
| **Dip Buyer** | Mean reversion: buy −2.5σ panics inside an uptrend, sell the bounce |
| **Turtle** | Channel breakout: buy 55d highs, exit below 20d lows |

Composite validation (all-in, 0.1% fees/side, full history): ~20–33% CAGR with ~30–40% max
drawdowns on 6 of 8 majors (buy & hold drawdowns: 80–96%). Details + rejected ideas: [ALGORITHM.md](ALGORITHM.md).

## Run locally
```powershell
python -m http.server 8910
# open http://localhost:8910
```
Pick a strategy and symbol (top-20 dropdown or type any Binance pair, Enter to run).
Chart: drag axes to scale, double-click to reset, Log/Lin toggle. Liq = Coinglass-style
estimated liquidation heat (context, or "Trade on it" as an entry gate).

Data source: `api.binance.com`, falling back to `data-api.binance.vision`. Not financial advice.
