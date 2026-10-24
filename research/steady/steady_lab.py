"""Which simple spot strategies give steady, smaller-but-reliable results? (daily, 2017-08 -> now)

Uses the daily cache from research/fetch_klines.py (BTC, ETH, BNB ... _1d.json).
    python research/steady/steady_lab.py > research/steady/RESULTS_steady_2026-10.md

All signals use the daily CLOSE of day t and trade at the OPEN of day t+1. Fees 0.1% + slippage 0.05% per side.
"Cash" earns 0% unless a row says otherwise (USDT in Binance Simple Earn has paid roughly 3-10%/yr; 4% is used
as a stated ASSUMPTION, not measured here).
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

CACHE = Path(__file__).resolve().parents[1] / "cache"
COST = 0.0015


def load(coin):
    a = np.array(json.load(open(CACHE / f"{coin}_1d.json")), float)
    idx = pd.to_datetime(a[:, 0], unit="s")
    return pd.DataFrame({"o": a[:, 1], "c": a[:, 4]}, index=idx)


BTC, ETH = load("BTC"), load("ETH")
df = pd.DataFrame({"bo": BTC.o, "bc": BTC.c, "eo": ETH.o, "ec": ETH.c}).dropna()
df = df[df.index >= "2017-09-01"]
# daily open-to-open returns: a position decided at day t's close earns open(t+1) -> open(t+2)
rb = (df.bo.shift(-2) / df.bo.shift(-1) - 1).fillna(0)
re = (df.eo.shift(-2) / df.eo.shift(-1) - 1).fillna(0)


def run(w_btc, w_eth=None, cash_yield=0.0):
    """w_* = target weights decided at each close (Series in [0,1]); costs on weight changes."""
    w_eth = w_eth if w_eth is not None else pd.Series(0.0, index=df.index)
    wb, we = w_btc.fillna(0), w_eth.fillna(0)
    wc = 1 - wb - we
    turn = (wb.diff().abs() + we.diff().abs()).fillna(wb.iloc[0] + we.iloc[0])
    r = wb * rb + we * re + wc * cash_yield / 365 - turn * COST
    return (1 + r).cumprod()


def drift_rebalance(target=0.5, band=0.10, cash_yield=0.0):
    """Hold `target` in BTC, rest in cash; rebalance only when the BTC share drifts beyond ±band."""
    eq, wb, out = 1.0, target, []
    for i in range(len(df)):
        eq_b, eq_c = eq * wb * (1 + rb.iloc[i]), eq * (1 - wb) * (1 + cash_yield / 365)
        eq = eq_b + eq_c
        wb = eq_b / eq
        if abs(wb - target) > band:
            eq *= 1 - abs(wb - target) * COST
            wb = target
        out.append(eq)
    return pd.Series(out, index=df.index)


ma = lambda s, n: s.rolling(n).mean()
mom = lambda s, n: s / s.shift(n) - 1
hold = pd.Series(1.0, index=df.index)
STRATS = {
    "BTC buy & hold": run(hold),
    "BTC only while above its 200-day MA, else cash": run((df.bc > ma(df.bc, 200)).astype(float)),
    "BTC only while above its 100-day MA, else cash": run((df.bc > ma(df.bc, 100)).astype(float)),
    "BTC only while above its 50-day MA, else cash": run((df.bc > ma(df.bc, 50)).astype(float)),
    "…200-day MA version, cash earning 4%/yr (assumption)": run((df.bc > ma(df.bc, 200)).astype(float), cash_yield=0.04),
    "50% BTC / 50% cash, rebalanced at ±10% drift": drift_rebalance(0.5, 0.10),
    "…same, cash earning 4%/yr (assumption)": drift_rebalance(0.5, 0.10, 0.04),
    "50% BTC always + 50% BTC only above its 200-day MA": run(0.5 + 0.5 * (df.bc > ma(df.bc, 200)).astype(float)),
    "dual momentum: BTC or ETH, whichever is up more over 90 days, cash if neither is up": (lambda:
        run(((mom(df.bc, 90) >= mom(df.ec, 90)) & (mom(df.bc, 90) > 0)).astype(float),
            ((mom(df.ec, 90) > mom(df.bc, 90)) & (mom(df.ec, 90) > 0)).astype(float)))(),
    "weekly DCA into BTC (same money spread over time) — reference": None,
}
# DCA: put an equal slice in every Monday from start; report value / money in
mondays = df.index[df.index.day_of_week == 0]
units, paid, dca = 0.0, 0.0, []
for d in df.index:
    if d in mondays:
        units += 1 / df.bo.loc[d] * (1 - COST); paid += 1
    dca.append(units * df.bc.loc[d] / max(paid, 1e-9))
STRATS["weekly DCA into BTC (same money spread over time) — reference"] = pd.Series(dca, index=df.index)


def say(s=""):
    print(s)


row = lambda c: "| " + " | ".join(str(x) for x in c) + " |"
head = lambda c: row(c) + "\n" + row(["---"] * len(c))
pct = lambda x: f"{x * 100:+.0f}%"

say("# Steady strategies — what actually gives smaller but reliable results? (spot, daily, Oct 2026)\n")
say(f"Daily Binance spot candles {df.index[0].date()} → {df.index[-1].date()} (two full bear markets: 2018 and 2022). "
    "Signals at the close, trades at the next open, 0.15% cost per trade side. Cash earns 0% unless stated.\n")
years = sorted(set(df.index.year))
say(head(["strategy", "end value", "CAGR", "max DD", "months up", "worst 12 months", "losing years"] + [str(y) for y in years]))
for name, eq in STRATS.items():
    eq = eq.dropna()
    yrs = (eq.index[-1] - eq.index[0]).days / 365.25
    dd = (eq / eq.cummax() - 1).min()
    m = eq.resample("ME").last().pct_change().dropna()
    roll12 = (eq / eq.shift(365) - 1).min()
    by = eq.groupby(eq.index.year).last() / eq.groupby(eq.index.year).first() - 1
    say(row([name, f"{eq.iloc[-1]:,.1f}×", pct(eq.iloc[-1] ** (1 / yrs) - 1), pct(dd), f"{(m > 0).mean() * 100:.0f}%",
             pct(roll12), f"{(by < 0).sum()}/{len(by)}"] + [pct(by.get(y, np.nan)) for y in years]))
