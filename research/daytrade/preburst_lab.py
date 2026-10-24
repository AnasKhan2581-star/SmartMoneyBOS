"""PRE-burst signals on mid/small caps: can a setup that forms BEFORE the big candle be traded for 14-18h?

Companion to daytrade_lab.py, which bought AFTER the burst candle and lost in all 108 settings. Same hourly
data (research/cache/<COIN>_1h.json, 2023-01-01 ->, delisted coins included).
    python research/daytrade/preburst_lab.py > research/daytrade/RESULTS_preburst_2026-10.md

Mid/small caps = coins averaging $1M-$50M a day over the prior 7 days (market cap isn't in the data; volume is
the tradeable proxy, and it excludes the BTC/ETH/SOL tier). Everything at the CLOSE of hour t, entry at the OPEN of
hour t+1. Spot only, long only. Fee 0.1% + slippage 0.2% per side.
"""
from __future__ import annotations

import itertools
import json
import os
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
CACHE = HERE.parent / "cache"
T0, SPLIT = 1672531200, 1735689600          # 2023-01-01, 2025-01-01 UTC
FEE, SLIP = 0.001, 0.002
MAXN = 24
rng = np.random.default_rng(5)

coins = [c.strip() for c in open(os.environ.get("DT_UNIVERSE", HERE / "universe.txt")) if c.strip()]
raw = {}
for c in coins:
    f = CACHE / f"{c}_1h.json"
    if f.exists():
        a = np.array(json.load(open(f)), dtype=np.float64)
        a = a[a[:, 0] >= T0]
        if len(a) > 400:
            raw[c] = a
coins = sorted(raw)
NT = (max(int(a[-1, 0]) for a in raw.values()) - T0) // 3600 + 1
NC = len(coins)
TIMES = T0 + 3600 * np.arange(NT)
Op, Hi, Lo, Cl, DV = (np.full((NT, NC), np.nan, dtype=np.float64) for _ in range(5))
for j, c in enumerate(coins):
    a = raw[c]; k = ((a[:, 0] - T0) // 3600).astype(int)
    Op[k, j], Hi[k, j], Lo[k, j], Cl[k, j], DV[k, j] = a[:, 1], a[:, 2], a[:, 3], a[:, 4], a[:, 5] * a[:, 4]
del raw
P = lambda x: pd.DataFrame(x)
prior = lambda x, n, f: getattr(P(x).shift(1).rolling(n, min_periods=int(n * .8)), f)().values   # excludes hour t

# ------------------------------------------------------------------ features (all known at the close of hour t)
dv7 = prior(DV, 168, "mean") * 24                      # $/day, prior week
MIDSMALL = (dv7 >= 1e6) & (dv7 <= 50e6) & np.isfinite(Op)
NEXT_OK = np.vstack([np.isfinite(Op[1:]), np.zeros((1, NC), bool)])
vol24avg = prior(DV, 24, "mean")
vol48avg = prior(DV, 48, "mean")
vol30d = prior(DV, 720, "mean")
hi48, lo48, hi72 = prior(Hi, 48, "max"), prior(Lo, 48, "min"), prior(Hi, 72, "max")
rng48 = (hi48 - lo48) / Cl
rng48_norm = rng48 / P(rng48).rolling(720, min_periods=400).mean().values      # <1 = tighter than its usual
ret1 = np.full_like(Cl, np.nan); ret1[1:] = Cl[1:] / Cl[:-1] - 1
ret12 = np.full_like(Cl, np.nan); ret12[12:] = Cl[12:] / Cl[:-12] - 1
ret24 = np.full_like(Cl, np.nan); ret24[24:] = Cl[24:] / Cl[:-24] - 1
v24 = P(DV).rolling(24, min_periods=20).sum().values
v24_prev7d = prior(DV, 168, "mean") * 24
low12 = P(Lo).rolling(12, min_periods=10).min().values
low12_prev = P(Lo).shift(12).rolling(12, min_periods=10).min().values
v6 = P(DV).rolling(6, min_periods=5).mean().values
quiet48 = (vol48avg < vol30d * 0.8)
jB = coins.index("BTC")
btc12 = ret12[:, jB][:, None]
btc_ma50 = P(Cl[:, jB]).rolling(1200, min_periods=1000).mean().values[:, 0]
BTC_UP = (Cl[:, jB] > btc_ma50)[:, None]

with np.errstate(invalid="ignore", divide="ignore"):
    SIGNALS = {
        "1. squeeze breakout (tight 48h range, breaks 48h high, moderate volume, no big candle yet)":
            ((rng48_norm < 0.6) & (Cl > hi48) & (DV / vol24avg >= 1.5) & (ret1 < 0.03), DV / vol24avg),
        "2. quiet accumulation (24h volume ≥ 2× its weekly normal, price flat −2…+3%)":
            ((v24 / v24_prev7d >= 2) & (ret24 > -0.02) & (ret24 < 0.03), v24 / v24_prev7d),
        "3. strong while BTC is weak (BTC −1.5% over 12h, coin up and within 2% of its 48h high)":
            ((btc12 <= -0.015) & (ret12 >= 0) & (Cl >= hi48 * 0.98), ret12 - btc12),
        "4. higher lows, then breaks the 72h high (hour gain < 3%)":
            ((low12 > low12_prev) & (Cl > hi72) & (ret1 < 0.03), Cl / hi72),
        "5. volume wakes after a quiet 2 days, breaking the 72h high":
            (quiet48 & (v6 >= 2 * vol48avg) & (Cl > hi72), v6 / vol48avg),
    }


def paths(t, j):
    idx = t[:, None] + 1 + np.arange(MAXN)[None, :]
    return Op[t + 1, j], Hi[idx, j[:, None]], Lo[idx, j[:, None]], Cl[idx, j[:, None]]


def events(mask, strength, gate=False):
    m = mask & MIDSMALL & NEXT_OK
    if gate:
        m &= BTC_UP
    m[:800] = False; m[-MAXN - 2:] = False
    t, j = np.nonzero(m)
    return t, j, np.nan_to_num(strength[t, j], nan=0.0)


def twin(t):                                       # a random mid/small coin tradeable in the same hour
    jr = np.empty(len(t), int)
    for a, tt in enumerate(t):
        cand = np.flatnonzero(MIDSMALL[tt] & NEXT_OK[tt])
        jr[a] = rng.choice(cand)
    return jr


def outcomes(eo, H, L, C, T, S, N):
    e = eo * (1 + SLIP); tp, sl = e * (1 + T), e * (1 - S)
    h, l, c = H[:, :N], L[:, :N], C[:, :N]
    hs, ht = l <= sl[:, None], h >= tp[:, None]
    fs = np.where(hs.any(1), hs.argmax(1), N); ft = np.where(ht.any(1), ht.argmax(1), N)
    ok = np.isfinite(c); last = np.where(ok.any(1), N - 1 - np.argmax(ok[:, ::-1], 1), 0)
    tpx = c[np.arange(len(e)), last]
    stop_first = fs <= ft                         # same candle -> the stop (conservative)
    px = np.where((fs < N) & stop_first, sl, np.where(ft < N, tp, tpx))
    hrs = np.where((fs < N) & stop_first, fs + 1, np.where(ft < N, ft + 1, last + 1))
    return px * (1 - SLIP) * (1 - FEE) / (e * (1 + FEE)) - 1, hrs


def book(t, j, s, ret, hrs, lo, hi, k=3):
    sel = (TIMES[t] >= lo) & (TIMES[t] < hi)
    o = np.lexsort((-s[sel], t[sel]))
    tt, jj, rr, hh = t[sel][o], j[sel][o], ret[sel][o], hrs[sel][o]
    eq, opn, curve, taken = 1.0, [], [1.0], []
    for a in range(len(tt)):
        now = tt[a] + 1
        keep = []
        for x in opn:
            if x[0] <= now:
                eq += x[2] * x[3]; curve.append(eq)
            else:
                keep.append(x)
        opn = keep
        if len(opn) >= k or any(x[1] == jj[a] for x in opn):
            continue
        opn.append((now + hh[a], jj[a], eq / k, rr[a])); taken.append(a)
    for x in sorted(opn):
        eq += x[2] * x[3]; curve.append(eq)
    v = np.array(curve)
    rr = rr[taken] if taken else np.array([])
    w, l_ = rr[rr > 0].sum(), -rr[rr <= 0].sum()
    return dict(eq=eq, dd=(v / np.maximum.accumulate(v) - 1).min(), n=len(rr),
                wr=(rr > 0).mean() if len(rr) else np.nan, avg=rr.mean() if len(rr) else np.nan,
                pf=w / l_ if l_ > 0 else np.inf)


say = lambda s="": print(s, flush=True)
row = lambda c: "| " + " | ".join(str(x) for x in c) + " |"
head = lambda c: row(c) + "\n" + row(["---"] * len(c))
pct = lambda x: "—" if not np.isfinite(x) else f"{x * 100:+.1f}%"
pp = lambda x: "—" if not np.isfinite(x) else f"{x * 100:.0f}%"
END = TIMES[-1] + 1

say("# Pre-burst signals on mid/small caps, held 14–18 hours — hourly backtest (Oct 2026)\n")
say(f"{NC} Binance USDT coins (delisted included), hourly, {np.datetime64(T0, 's')} → {np.datetime64(int(TIMES[-1]), 's')}. "
    f"Only coins trading **$1M–$50M a day** (mid/small caps) can be picked; on a typical recent hour that is "
    f"{int(np.median(MIDSMALL[-720:].sum(1)))} coins. Signals at the close of an hour, entry at the next open, spot long only, "
    f"0.1% fee + 0.2% slippage per side. Settings chosen on 2023–24, judged on 2025–26 (unseen). Same-candle target+stop "
    f"counts as the stop.\n")

# ------------------------------------------------------------------ 1. do the setups shift the odds toward a burst UP?
say("## 1. Does the setup come before bursts UP — more than a random mid/small coin at the same hour?\n")
say("Before costs, from the entry open. **+10% first** = the price reached +10% within 16 hours before it ever fell 10%; "
    "**−10% first** the reverse. A pre-burst signal worth trading must raise the first and not the second.\n")
say(head(["setup", "signals", "per day", "avg after 16h", "random coin, avg after 16h", "+10% first (16h)", "−10% first (16h)",
          "random: +10% first", "random: −10% first"]))
EV = {}


def first_hit(H, L, eo, up=0.10, dn=0.10, N=16):
    hu = H[:, :N] >= (eo * (1 + up))[:, None]; hd = L[:, :N] <= (eo * (1 - dn))[:, None]
    fu = np.where(hu.any(1), hu.argmax(1), N); fd = np.where(hd.any(1), hd.argmax(1), N)
    return np.mean((fu < N) & (fu < fd)), np.mean((fd < N) & (fd <= fu))


for name, (mask, strength) in SIGNALS.items():
    t, j, s = events(mask, strength)
    jr = twin(t)
    eo, H, L, C = paths(t, j); eor, Hr, Lr, Cr = paths(t, jr)
    EV[name] = (t, j, s, jr, (eo, H, L, C), (eor, Hr, Lr, Cr))
    a16 = np.nanmean(C[:, 15] / eo - 1); r16 = np.nanmean(Cr[:, 15] / eor - 1)
    up, dn = first_hit(H, L, eo); upr, dnr = first_hit(Hr, Lr, eor)
    say(row([name, f"{len(t):,}", f"{len(t) / (NT / 24):.1f}", pct(a16), pct(r16), pp(up), pp(dn), pp(upr), pp(dnr)]))

# ------------------------------------------------------------------ 2. trading it: 14-18h holds, walk-forward
GRID = list(itertools.product([0.08, 0.15, 0.25, 9.0], [0.04, 0.06, 0.10], [14, 16, 18]))   # 9.0 = no target
say("\n## 2. Trading each setup: 3 positions at a time, a third each, held up to 14–18h\n")
say(f"{len(GRID)} exit settings per setup (target +8/+15/+25%/none × stop −4/−6/−10% × time exit 14/16/18h), with and "
    "without a BTC-uptrend gate (BTC above its 50-day MA). The setting is picked on 2023–24 by return ÷ drawdown; the "
    "2025–26 column is what it then did on data it never saw. **Random** = the same setting on a random mid/small coin "
    "at the same hours.\n")
say(head(["setup", "BTC gate", "settings profitable 2023–24", "settings profitable 2025–26", "picked setting",
          "2023–24 end value", "**2025–26 end value**", "2025–26 trades / win rate / avg", "2025–26 max DD", "2025–26 random coin"]))
summary = []
for name, (mask, strength) in SIGNALS.items():
    for gate in (False, True):
        t, j, s = events(mask, strength, gate)
        if len(t) < 50:
            continue
        jr = twin(t)
        eo, H, L, C = paths(t, j); eor, Hr, Lr, Cr = paths(t, jr)
        res = []
        for T, S, N in GRID:
            r, h = outcomes(eo, H, L, C, T, S, N)
            rr_, hr_ = outcomes(eor, Hr, Lr, Cr, T, S, N)
            res.append(dict(T=T, S=S, N=N, ins=book(t, j, s, r, h, T0, SPLIT), oos=book(t, j, s, r, h, SPLIT, END),
                            rnd=book(t, jr, s, rr_, hr_, SPLIT, END)))
        b = max(res, key=lambda x: (x["ins"]["eq"] - 1) / max(0.05, -x["ins"]["dd"]))
        summary.append((name, gate, b))
        o = b["oos"]
        say(row([name.split(" (")[0], "on" if gate else "off", f"{sum(x['ins']['eq'] > 1 for x in res)}/{len(res)}",
                 f"{sum(x['oos']['eq'] > 1 for x in res)}/{len(res)}",
                 f"{'no target' if b['T'] > 1 else f'+{b[chr(84)] * 100:.0f}%'} / −{b['S'] * 100:.0f}% / {b['N']}h",
                 f"{b['ins']['eq']:.2f}×", f"**{o['eq']:.2f}×**", f"{o['n']} / {pp(o['wr'])} / {pct(o['avg'])}", pct(o["dd"]),
                 f"{b['rnd']['eq']:.2f}×"]))

say("\n## 3. Verdict\n")
wins = [(n, g, b) for n, g, b in summary if b["oos"]["eq"] > 1 and b["oos"]["eq"] > b["rnd"]["eq"] and b["ins"]["eq"] > 1]
if wins:
    say("Setups whose picked setting made money in 2023–24 AND on the unseen 2025–26 AND beat the random coin there:\n")
    for n, g, b in wins:
        say(f"- {n} (BTC gate {'on' if g else 'off'}): 2023–24 {b['ins']['eq']:.2f}×, 2025–26 {b['oos']['eq']:.2f}× vs random {b['rnd']['eq']:.2f}×")
else:
    say("**No setup passed**: none made money in 2023–24 *and* on the unseen 2025–26 *and* beat a random coin there.")
