"""Day-trading the volume bursts: scan every coin every hour, take the top 3 bursts, exit fast.

    python research/fetch_klines.py 1h --since 2023-01-01 --file research/daytrade/universe.txt
    python research/daytrade/daytrade_lab.py > research/daytrade/RESULTS_daytrade_2026-10.md

Signal at the CLOSE of hour t:  volume of hour t >= RV x its average over the prior 24 hours,
                                hour-t return >= R1, close in the top 30% of the hour's range,
                                coin liquid (avg $ volume over the prior 7 days >= $1M/day).
Entry: OPEN of hour t+1 + slippage.  Exit, whichever comes first:
    take profit at +T%, stop at -S%, or the close of hour t+N (time stop).
    If one candle touches both the target and the stop, it counts as the STOP (conservative).
Book: at most 3 trades open, each gets 1/3 of equity; competing signals in the same hour go to the
strongest volume burst; one position per coin.
Walk-forward: the setting is chosen on 2023-24 only, then judged on 2025-26 which it never saw.
Baseline: the same trades on a RANDOM liquid coin at the same hour — tells the signal from the exits.
"""
from __future__ import annotations

import itertools
import json
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
CACHE = HERE.parent / "cache"
T0 = 1672531200                  # 2023-01-01 UTC
SPLIT = 1735689600               # 2025-01-01 UTC
FEE = 0.001
rng = np.random.default_rng(11)

# ------------------------------------------------------------------ data on one hourly grid
import os
coins = [c.strip() for c in open(os.environ.get("DT_UNIVERSE", HERE / "universe.txt")) if c.strip()]
raw = {}
for c in coins:
    f = CACHE / f"{c}_1h.json"
    if f.exists():
        a = np.array(json.load(open(f)), dtype=np.float64)
        a = a[a[:, 0] >= T0]
        if len(a) > 200:
            raw[c] = a
coins = sorted(raw)
tmax = max(int(a[-1, 0]) for a in raw.values())
NT = (tmax - T0) // 3600 + 1
NC = len(coins)
TIMES = T0 + 3600 * np.arange(NT)
Op, Hi, Lo, Cl, DV = (np.full((NT, NC), np.nan, dtype=np.float32) for _ in range(5))
for j, c in enumerate(coins):
    a = raw[c]
    k = ((a[:, 0] - T0) // 3600).astype(int)
    Op[k, j], Hi[k, j], Lo[k, j], Cl[k, j] = a[:, 1], a[:, 2], a[:, 3], a[:, 4]
    DV[k, j] = a[:, 5] * a[:, 4]
del raw


def roll_mean(x, n):                        # trailing mean of the previous n rows (excludes the current row)
    z = np.where(np.isfinite(x), x, 0.0).astype(np.float64)
    m = np.isfinite(x).astype(np.float64)
    cs, cm = np.cumsum(z, 0), np.cumsum(m, 0)
    s = np.full_like(cs, np.nan)
    s[n:] = (cs[n - 1:-1] - np.vstack([np.zeros((1, x.shape[1])), cs[:-n - 1]]))
    k = np.full_like(cm, np.nan)
    k[n:] = (cm[n - 1:-1] - np.vstack([np.zeros((1, x.shape[1])), cm[:-n - 1]]))
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(k >= n * 0.8, s / k, np.nan)


dv24 = roll_mean(DV, 24)                     # avg hourly $ volume, prior 24h
dv168 = roll_mean(DV, 168)                   # avg hourly $ volume, prior 7 days
RV = DV / dv24
R1 = np.full_like(Cl, np.nan); R1[1:] = Cl[1:] / Cl[:-1] - 1
with np.errstate(invalid="ignore", divide="ignore"):
    POS = (Cl - Lo) / (Hi - Lo)              # where the close sits in the hour's range
LIQ = dv168 * 24 >= 1e6
LIQ &= np.isfinite(Op).astype(bool)
NEXT_OK = np.vstack([np.isfinite(Op[1:]), np.zeros((1, NC), bool)])   # there IS a next hour to enter on

# ------------------------------------------------------------------ forward paths for every candidate event
MAXN = 24


def events(rv_min, r1_min):
    with np.errstate(invalid="ignore"):
        m = (RV >= rv_min) & (R1 >= r1_min) & (POS >= 0.7) & LIQ & NEXT_OK
    m[:25] = False
    m[-MAXN - 2:] = False
    t, j = np.nonzero(m)
    return t, j, RV[t, j]


def paths(t, j):
    """highs/lows/closes of hours t+1 .. t+MAXN for each event (NaN past a delisting)."""
    idx = t[:, None] + 1 + np.arange(MAXN)[None, :]
    return Op[t + 1, j], Hi[idx, j[:, None]], Lo[idx, j[:, None]], Cl[idx, j[:, None]]


def outcomes(entry_open, H, L, Cc, T, S, N, slip):
    """Per-event net return and holding hours for one exit setting."""
    e = entry_open * (1 + slip)
    tp, sl = e * (1 + T), e * (1 - S)
    h, l, cc = H[:, :N], L[:, :N], Cc[:, :N]
    hit_sl = l <= sl[:, None]
    hit_tp = h >= tp[:, None]
    first_sl = np.where(hit_sl.any(1), hit_sl.argmax(1), N)
    first_tp = np.where(hit_tp.any(1), hit_tp.argmax(1), N)
    valid = np.isfinite(cc)
    last_ok = np.where(valid.any(1), N - 1 - np.argmax(valid[:, ::-1], 1), 0)
    time_px = cc[np.arange(len(e)), last_ok]
    stop_first = first_sl <= first_tp                 # same candle -> the stop (conservative)
    px = np.where((first_sl < N) & stop_first, sl,
         np.where(first_tp < N, tp, time_px))
    hours = np.where((first_sl < N) & stop_first, first_sl + 1,
            np.where(first_tp < N, first_tp + 1, last_ok + 1))
    exit_px = px * (1 - slip)
    ret = exit_px * (1 - FEE) / (e * (1 + FEE)) - 1
    return ret, hours


def book(t, j, strength, ret, hours, k=3, lo=None, hi=None):
    """3-slot book. Returns equity at each trade exit, the trades taken, and their returns."""
    sel = np.ones(len(t), bool)
    if lo is not None:
        sel &= TIMES[t] >= lo
    if hi is not None:
        sel &= TIMES[t] < hi
    order = np.lexsort((-strength[sel], t[sel]))
    tt, jj, rr, hh = t[sel][order], j[sel][order], ret[sel][order], hours[sel][order]
    equity, open_ = 1.0, []                            # open_: (exit_t, coin, alloc, ret)
    curve, taken = [(0, 1.0)], []
    for a in range(len(tt)):
        now = tt[a] + 1                                # entry hour
        still = []
        for x in open_:
            if x[0] <= now:
                equity += x[2] * x[3]
                curve.append((x[0], equity))
            else:
                still.append(x)
        open_ = still
        if len(open_) >= k or any(x[1] == jj[a] for x in open_):
            continue
        alloc = equity / k
        open_.append((now + hh[a], jj[a], alloc, rr[a]))
        taken.append(a)
    for x in sorted(open_):
        equity += x[2] * x[3]
        curve.append((x[0], equity))
    return equity, np.array(curve), rr[taken] if taken else np.array([])


def stats(t, j, strength, ret, hours, lo, hi):
    eq, curve, rr = book(t, j, strength, ret, hours, lo=lo, hi=hi)
    v = curve[:, 1]
    dd = (v / np.maximum.accumulate(v) - 1).min() if len(v) else 0
    yrs = ((hi or TIMES[-1]) - (lo or T0)) / 31557600
    wins, losses = rr[rr > 0].sum(), -rr[rr <= 0].sum()
    return dict(eq=eq, cagr=eq ** (1 / yrs) - 1 if eq > 0 else -1, dd=dd, n=len(rr),
                wr=(rr > 0).mean() if len(rr) else np.nan, avg=rr.mean() if len(rr) else np.nan,
                pf=wins / losses if losses > 0 else np.inf)


def say(s=""):
    print(s, flush=True)


row = lambda cells: "| " + " | ".join(str(x) for x in cells) + " |"
head = lambda cols: row(cols) + "\n" + row(["---"] * len(cols))
pct = lambda x: "—" if not np.isfinite(x) else f"{x * 100:+.1f}%"
pp = lambda x: "—" if not np.isfinite(x) else f"{x * 100:.0f}%"

say("# Day-trading volume bursts across Binance — hourly backtest (Oct 2026)\n")
say(f"**{NC} Binance USDT coins** that traded ≥ $1M/day at some point since 2023 (delisted ones included), hourly candles "
    f"2023-01-01 → {np.datetime64(int(TIMES[-1]), 's')} UTC. A coin can only be traded in an hour when its average $ volume over "
    f"the prior 7 days is ≥ $1M/day. Costs per side: 0.1% fee + slippage (0.2% unless stated). See the docstring of "
    f"`daytrade_lab.py` for the exact rules.\n")

# ------------------------------------------------------------------ grid on 2023-24, judged on 2025-26
GRID_SIG = [(3, 0.02), (3, 0.04), (5, 0.02), (5, 0.04)]
GRID_EXIT = list(itertools.product([0.05, 0.10, 0.20], [0.03, 0.05, 0.08], [4, 12, 24]))
results = []
cache_ev = {}
for rv_min, r1_min in GRID_SIG:
    t, j, s = events(rv_min, r1_min)
    eo, H, L, Cc = paths(t, j)
    # random-coin twin of every event: same hour, a random coin that was tradeable then
    jr = np.empty_like(j)
    for a, tt in enumerate(t):
        cand = np.flatnonzero(LIQ[tt] & NEXT_OK[tt])
        jr[a] = rng.choice(cand) if len(cand) else j[a]
    eor, Hr, Lr, Cr = paths(t, jr)
    cache_ev[(rv_min, r1_min)] = (t, j, s, eo, H, L, Cc, jr, eor, Hr, Lr, Cr)
    for T, S, N in GRID_EXIT:
        ret, hrs = outcomes(eo, H, L, Cc, T, S, N, 0.002)
        ins = stats(t, j, s, ret, hrs, T0, SPLIT)
        oos = stats(t, j, s, ret, hrs, SPLIT, None)
        retr, hrsr = outcomes(eor, Hr, Lr, Cr, T, S, N, 0.002)
        rin = stats(t, jr, s, retr, hrsr, T0, SPLIT)
        rout = stats(t, jr, s, retr, hrsr, SPLIT, None)
        results.append(dict(rv=rv_min, r1=r1_min, T=T, S=S, N=N, ins=ins, oos=oos, rin=rin, rout=rout))

say("## 1. How often does the scanner fire?\n")
say(head(["signal: hour volume ≥ … × 24h avg, hour gain ≥ …", "signals 2023-24", "signals 2025-26", "per day"]))
for (rv_min, r1_min), v in cache_ev.items():
    t = v[0]
    a, b = (TIMES[t] < SPLIT).sum(), (TIMES[t] >= SPLIT).sum()
    say(row([f"{rv_min}× and +{r1_min * 100:.0f}%", f"{a:,}", f"{b:,}", f"{len(t) / (NT / 24):.1f}"]))

say("\n## 2. All 108 settings — how many make money?\n")
say("Each setting = one signal threshold × one take-profit × one stop × one time limit. Portfolio result of the 3-slot book.\n")
ins_pos = sum(r["ins"]["eq"] > 1 for r in results); oos_pos = sum(r["oos"]["eq"] > 1 for r in results)
beat_rand = sum(r["oos"]["eq"] > r["rout"]["eq"] for r in results)
say(head(["", "2023-24 (choose here)", "2025-26 (unseen)"]))
say(row(["settings that made money", f"{ins_pos}/108", f"{oos_pos}/108"]))
say(row(["settings beating the same exits on a random coin", f"{sum(r['ins']['eq'] > r['rin']['eq'] for r in results)}/108", f"{beat_rand}/108"]))
say(row(["median end value", f"{np.median([r['ins']['eq'] for r in results]):.2f}×", f"{np.median([r['oos']['eq'] for r in results]):.2f}×"]))

best = max(results, key=lambda r: r["ins"]["cagr"] / max(0.05, -r["ins"]["dd"]))
say("\n## 3. Walk-forward: the best 2023-24 setting, judged on 2025-26\n")
say(f"Chosen by return ÷ drawdown on 2023-24 only: **volume ≥ {best['rv']}× and hour gain ≥ +{best['r1'] * 100:.0f}%, "
    f"take profit +{best['T'] * 100:.0f}%, stop −{best['S'] * 100:.0f}%, time limit {best['N']}h.**\n")
say(head(["", "trades", "win rate", "avg trade", "PF", "end value", "CAGR", "max DD"]))
for nm, key in [("2023-24 (in sample, signal)", "ins"), ("2023-24 random coin, same exits", "rin"),
                ("**2025-26 (unseen), signal**", "oos"), ("2025-26 random coin, same exits", "rout")]:
    x = best[key]
    say(row([nm, x["n"], pp(x["wr"]), pct(x["avg"]), f"{x['pf']:.2f}", f"{x['eq']:.2f}×", pct(x["cagr"]), pct(x["dd"])]))

say("\n## 4. Top 10 settings on 2023-24 — and what each did next\n")
say(head(["signal", "TP", "SL", "max hold", "2023-24 end value", "2023-24 max DD", "2025-26 end value", "2025-26 max DD", "2025-26 random coin"]))
for r in sorted(results, key=lambda r: -r["ins"]["cagr"] / max(0.05, -r["ins"]["dd"]))[:10]:
    say(row([f"{r['rv']}× / +{r['r1'] * 100:.0f}%", f"+{r['T'] * 100:.0f}%", f"−{r['S'] * 100:.0f}%", f"{r['N']}h",
             f"{r['ins']['eq']:.2f}×", pct(r["ins"]["dd"]), f"{r['oos']['eq']:.2f}×", pct(r["oos"]["dd"]), f"{r['rout']['eq']:.2f}×"]))

# ------------------------------------------------------------------ costs
say("\n## 5. The chosen setting at different trading costs (2023 → now)\n")
v = cache_ev[(best["rv"], best["r1"])]
t, j, s, eo, H, L, Cc = v[:7]
say(head(["slippage per side (+0.1% fee)", "trades", "win rate", "avg trade", "end value", "CAGR", "max DD"]))
for slip in (0.0, 0.001, 0.002, 0.005):
    ret, hrs = outcomes(eo, H, L, Cc, best["T"], best["S"], best["N"], slip)
    x = stats(t, j, s, ret, hrs, T0, None)
    say(row([f"{slip * 100:.1f}%", x["n"], pp(x["wr"]), pct(x["avg"]), f"{x['eq']:.2f}×", pct(x["cagr"]), pct(x["dd"])]))

# ------------------------------------------------------------------ what happens after a burst, on average
say("\n## 6. What a burst does next, on average (all signals at the loosest threshold, before costs)\n")
t, j, s, eo, H, L, Cc = cache_ev[(3, 0.02)][:7]
say(head(["hours after entry", "avg return from entry", "share still above entry", "avg best price reached", "avg worst price reached"]))
for n in (1, 2, 4, 8, 12, 24):
    r = Cc[:, n - 1] / eo - 1
    best_ = np.nanmax(H[:, :n], 1) / eo - 1
    worst_ = np.nanmin(L[:, :n], 1) / eo - 1
    say(row([n, pct(np.nanmean(r)), pp(np.nanmean(r > 0)), pct(np.nanmean(best_)), pct(np.nanmean(worst_))]))

# ------------------------------------------------------------------ 7. robustness: optimistic fills, big coins only
say("\n## 7. Is the conservative fill rule what sinks it? And do big coins behave better?\n")
say("**Optimistic bound:** if one candle touches both the target and the stop, count it as the TARGET instead, and charge "
    "no slippage at all (fee only). If the scanner still loses under these flattering assumptions, the result does not "
    "depend on how fills were modelled.\n")


def outcomes_opt(entry_open, H, L, Cc, T, S, N):
    e = entry_open
    tp, sl = e * (1 + T), e * (1 - S)
    h, l, cc = H[:, :N], L[:, :N], Cc[:, :N]
    hs, ht = l <= sl[:, None], h >= tp[:, None]
    fs = np.where(hs.any(1), hs.argmax(1), N); ft = np.where(ht.any(1), ht.argmax(1), N)
    valid = np.isfinite(cc); last_ok = np.where(valid.any(1), N - 1 - np.argmax(valid[:, ::-1], 1), 0)
    tpx = cc[np.arange(len(e)), last_ok]
    tp_first = ft <= fs
    px = np.where((ft < N) & tp_first, tp, np.where(fs < N, sl, tpx))
    hrs = np.where((ft < N) & tp_first, ft + 1, np.where(fs < N, fs + 1, last_ok + 1))
    return px * (1 - FEE) / (e * (1 + FEE)) - 1, hrs


say(head(["signal", "TP / SL / max hold", "trades taken", "win rate", "avg trade", "end value 2023 → now"]))
opt_pos = 0
for (rv_min, r1_min), v in cache_ev.items():
    t, j, s, eo, H, L, Cc = v[:7]
    for T, S, N in GRID_EXIT:
        ret, hrs = outcomes_opt(eo, H, L, Cc, T, S, N)
        x = stats(t, j, s, ret, hrs, T0, None)
        opt_pos += x["eq"] > 1
        if (T, S, N) in [(0.10, 0.08, 24), (0.20, 0.05, 24), (0.05, 0.03, 4)]:
            say(row([f"{rv_min}× / +{r1_min * 100:.0f}%", f"+{T * 100:.0f}% / −{S * 100:.0f}% / {N}h", x["n"], pp(x["wr"]), pct(x["avg"]), f"{x['eq']:.2f}×"]))
say(f"\nUnder the optimistic rules **{opt_pos} of 108** settings end above 1.0×.\n")

say("**Big coins only** — the same scan restricted to coins averaging ≥ $50M a day over the prior week "
    "(the BTC/ETH/SOL tier, where a volume burst is less likely to be one wallet pumping a thin book). Realistic fills again.\n")
LIQ_ALL = LIQ.copy()
LIQ &= dv168 * 24 >= 50e6
big_res = []
for rv_min, r1_min in GRID_SIG:
    t, j, s = events(rv_min, r1_min)
    eo, H, L, Cc = paths(t, j)
    for T, S, N in GRID_EXIT:
        ret, hrs = outcomes(eo, H, L, Cc, T, S, N, 0.001)
        big_res.append(dict(rv=rv_min, r1=r1_min, T=T, S=S, N=N, ins=stats(t, j, s, ret, hrs, T0, SPLIT),
                            oos=stats(t, j, s, ret, hrs, SPLIT, None)))
LIQ = LIQ_ALL
bb = max(big_res, key=lambda r: r["ins"]["cagr"] / max(0.05, -r["ins"]["dd"]))
say(head(["", "2023-24", "2025-26 (unseen)"]))
say(row(["settings that made money (of 108)", sum(r["ins"]["eq"] > 1 for r in big_res), sum(r["oos"]["eq"] > 1 for r in big_res)]))
say(row([f"best 2023-24 setting ({bb['rv']}× / +{bb['r1'] * 100:.0f}%, +{bb['T'] * 100:.0f}% / −{bb['S'] * 100:.0f}% / {bb['N']}h): end value",
         f"{bb['ins']['eq']:.2f}× (DD {pct(bb['ins']['dd'])})", f"{bb['oos']['eq']:.2f}× (DD {pct(bb['oos']['dd'])})"]))
say(row(["…its trades / win rate / avg trade", f"{bb['ins']['n']} / {pp(bb['ins']['wr'])} / {pct(bb['ins']['avg'])}",
         f"{bb['oos']['n']} / {pp(bb['oos']['wr'])} / {pct(bb['oos']['avg'])}"]))
