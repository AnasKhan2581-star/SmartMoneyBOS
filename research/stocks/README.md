# Four strategies for your US and Indian stock lists (Nov 2026)

Backtest only: the app, `detector.js` and the signal bot don't use any of it.

**Verdict: Leaders, a monthly rotation into the strongest stocks, is the one worth running.** In India it beat
holding the whole list on growth and on worst fall. In the US it made a little less than holding the list, for a
smaller fall. Daily charts suit the other three strategies best (weekly for Breakout and Pullback in India), and
hourly charts add nothing.

**Every return here is too high.** Both lists were picked today, so they hold only companies that did well. Compare
the rows with each other and with "holding the list", not with what a real account would have made. The US list's
Shariah compliance is not verified.

## The strategies

Each one is **context**, read once a day, plus a **trigger** read on the chart and counted in its candles.

| | Context | Buy | Sell |
|---|---|---|---|
| **Leaders** | the index over its 200-day average | at each month's end, the top fifth of the list by 12-month return (skipping the latest month), each over its own 200-day average | when it drops out of the top 30%; everything when the index is under its 200-day at a month's end |
| **Trend** | index up, stock in the top half by 6-month return | the 50-candle average over the 200, and the close over the 200 | the 50 under the 200, or 25% under the entry |
| **Breakout** | index up, stock over its 200-day, top half by 6-month return | the first close over the 50-candle high, on 1.5× the usual volume | a close under the 50-candle low, or 3 × ATR under the entry |
| **Pullback** | index up, stock over its 200-day | the 2-candle RSI under 10 | the first close over the 5-candle average, after 10 candles, or 5 × ATR under the entry |

## Results

US: 50 stocks, 2000 → Nov 2026, costs 0.05% a side. India: the 97 HalalVest stocks, 2010 → Nov 2026, costs 0.2% a
side. A book of 10 equal slots, a signal at a candle's close filled at the next open.

| Strategy | US: best chart | US: growth a year / worst fall | India: best chart | India: growth a year / worst fall |
|---|---|---|---|---|
| **Leaders** | monthly | +16.4% / −33% | monthly | +31.8% / −27% |
| **Trend** | daily | +15.2% / −51% | daily | +28.8% / −34% |
| **Breakout** | daily | +13.5% / −26% | weekly | +18.7% / −35% |
| **Pullback** | daily | +8.5% / −18% | weekly | +7.1% / −19% |
| Holding the whole list | | +17.7% / −45% | | +24.7% / −39% |
| …only while the index is up | | +11.0% / −23% | | +20.9% / −33% |

- **US dips bounce.** The Pullback trigger beats buying on random days by +0.26% a trade (6.8 standard errors), both
  in the years its rules were chosen on and after them. The Breakout trigger beats them by nothing.
- **Indian stocks trend.** Trend beats random days by +27% a trade and Breakout by +5.9%. Dip-buying earns +0.29% a
  trade, too little after 0.4% round-trip costs.
- **Context matters most where the trigger is weak.** Without it Indian dip-buying loses (−0.10% a trade, worst fall
  −78%). The market test cuts Leaders' worst fall from −53% to −33% in the US.
- **Hourly charts add nothing** (Yahoo's hourly data starts in December 2023). No hourly trigger beat random days by
  enough to matter, and hourly dip-buying lost money after costs in both markets.
- **US Trend fell −51% after the 2000 bubble.** Started on the first day of 2000, it holds that winter's strongest
  stocks and gives their gains back before it sells.

The full report, with every sub-period, the hourly / daily / weekly tables, the context tables and how the rules were
chosen: [RESULTS_stocks_2026-11.md](RESULTS_stocks_2026-11.md). Every comparison in it is checked against the run
before it is printed.

## Run it

```
python3 -I research/stocks/build_universe.py <the HalalVest page's index.html>   # the two lists -> universe.json
NODE_USE_ENV_PROXY=1 node research/stocks/fetch.js       # Yahoo prices -> research/cache/stocks/raw (git-ignored)
node research/stocks/stock_lab.js design                 # US 2000-2013: the rule variants the rules were chosen from
node research/stocks/stock_lab.js design-cost            # the dip rule again, at India's costs
node research/stocks/stock_lab.js run                    # everything else (about 30 s)
node research/stocks/stock_report.js > research/stocks/RESULTS_stocks_2026-11.md
```

`fetch.js` needs `query1.finance.yahoo.com` and `query2.finance.yahoo.com` on the network allowlist.
