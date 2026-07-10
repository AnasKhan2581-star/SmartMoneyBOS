# ScreenerPro (SmartMoneyBOS)

Long-only daily **crypto investment advisor webapp**. Fully static — no build step, no deps.

## Files
- `index.html` — UI: two tabs (Chart / **Compare** — all strategies × the 7-coin universe), strategy dropdown, Advisor panel, equity backtest, mobile-responsive (media query at END of `<style>` so it wins the cascade). Fetches Binance spot klines client-side (`api.binance.com`, fallback `data-api.binance.vision`).
- Universe: **BTC ZEC SOL XRP XMR SUI LINK** only (XMR delisted Feb 2024, historical). Any Binance pair still works via free-text search.
- Lookbacks are **day-denominated** and scaled to bars per TF in `runQuant` (stop mults × √(bars/day), floor 0.8) — that's what makes strategies consistent across 4h/1d/1w. Don't add bar-count params.
- `detector.js` — the engine (`window.SMC` / Node module). Quant strategies live in `runQuant`; legacy SMC structure code (pivots/FVG/liquidity/walkStructure) remains for chart context and hidden params.
- `ALGORITHM.md` — **single source of truth** for strategy rules, tuned defaults, and benchmark results (including rejected ideas — read before re-testing anything).

## Strategies (dropdown → `strategy` param)
- `composite` (default) — vol-targeted trend ensemble; tuned July 2026: `persist:3`, `compExit:0`, `chandMult:2.5`, `volTarget:0.3`. Validated on 8 coins net of 0.1%/side fees; 6/8 pass (CAGR≥15%, dd≤60%, WR≥30%).
- `tsmom`, `meanrev`, `donch` — pure CTA trend / mean reversion / turtle breakout.
- Hidden legacy params: `fvg`, `scalp`, `momo`, `regime` (SMC playbook — benched weaker, kept for experiments).

## Conventions
- Run locally: `python -m http.server 8910` (or preview config `bos-backtester` in `.claude/launch.json`).
- Benchmarks: Node scripts that `require('./detector.js')`, fetch Binance daily klines, compute all-in equity with 0.1%/side fees, marked-to-market daily drawdown. Always compare vs buy & hold and report WR/DD/CAGR per symbol.
- The user judges strategies by: win rate ≥30%, drawdown, consistency across ≥5 symbols. Don't overfit weak assets (XRP/LINK fail deliberately).
- Equity panel is exposure-based (`Invest %` of equity per hold, 100% = all-in), NOT risk-per-trade sizing.
- If a rule changes, change `ALGORITHM.md` first.
