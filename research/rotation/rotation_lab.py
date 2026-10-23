"""Can we see Binance's next top gainers coming? A signal study + a top-3 rotation backtest.

Data: daily klines for every Binance USDT spot pair, INCLUDING delisted ones (status BREAK), so dead
coins are in the sample and a held coin that vanishes is closed at its last price — no survivorship.
    python research/fetch_klines.py 1d --file research/rotation/universe.txt
    python research/rotation/rotation_lab.py > research/rotation/RESULTS_rotation_2026-10.md

No look-ahead: every signal uses data up to the CLOSE of day t; trades happen at the OPEN of day t+1.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "cache"
START = "2019-01-01"
FEE = 0.001                       # per side
rng = np.random.default_rng(7)


# ---------------------------------------------------------------- data
def load_panel():
    coins = [c.strip() for c in open(Path(__file__).with_name("universe.txt")) if c.strip()]
    O, H, L, C, V = {}, {}, {}, {}, {}
    for coin in coins:
        f = CACHE / f"{coin}_1d.json"
        if not f.exists():
            continue
        rows = json.load(open(f))
        if len(rows) < 40:
            continue
        a = np.array(rows, dtype=float)
        idx = pd.to_datetime(a[:, 0], unit="s")
        O[coin], H[coin], L[coin], C[coin] = (pd.Series(a[:, k], idx) for k in (1, 2, 3, 4))
        V[coin] = pd.Series(a[:, 5] * a[:, 4], idx)          # ≈ USDT volume
    df = lambda d: pd.DataFrame(d).sort_index()
    return df(O), df(H), df(L), df(C), df(V)


O, H, L, C, DV = load_panel()
# A 1-day "bar" of a coin with almost no trading is noise; also keep only dates from START.
dates = C.index[C.index >= START]

# ---------------------------------------------------------------- features (as of day-t close)
ret1 = C / C.shift(1) - 1
ret7 = C / C.shift(7) - 1
ret30 = C / C.shift(30) - 1
dv_med20 = DV.shift(1).rolling(20, min_periods=15).median()
vsurge = DV / dv_med20                                        # today's $ volume vs its normal
vtrend = DV.rolling(7, min_periods=5).mean() / DV.shift(7).rolling(30, min_periods=20).mean()
hi30 = H.shift(1).rolling(30, min_periods=20).max()
brk30 = C / hi30                                              # >1 = closed above the 30-day high
rng20 = (H.rolling(20, min_periods=15).max() - L.rolling(20, min_periods=15).min()) / C
squeeze = -rng20.rolling(180, min_periods=60).rank(pct=True)  # tighter than usual = higher
btc30 = ret30["BTC"]
rs30 = ret30.sub(btc30, axis=0)
age = C.notna().cumsum()
liquid = dv_med20 >= 1e6                                      # ≥ $1M/day median: tradeable at all
eligible = liquid & (age >= 30) & C.notna()
# stealth accumulation: volume building while price has NOT moved yet
stealth = vtrend.where(ret7.abs() < 0.10)
# volume-confirmed move: a surge on an up day
vconf = vsurge.where(ret1 > 0)

FEATURES = {
    "volume spike today (vs 20-day normal)": vsurge,
    "volume spike on an UP day": vconf,
    "volume building 7d vs 30d (any price)": vtrend,
    "volume building while price flat (stealth)": stealth,
    "yesterday's % gain (chase the gainers)": ret1,
    "yesterday's % LOSS (buy the losers)": -ret1,
    "7-day momentum": ret7,
    "30-day momentum": ret30,
    "close vs 30-day high (breakout)": brk30,
    "volatility squeeze (tightest range)": squeeze,
}   # "30-day strength vs BTC" ranks identically to 30-day momentum (BTC's return is the same for every coin on a day)

# forward returns, open(t+1) -> open(t+1+h); a coin that disappears is closed at its last close
def fwd(h):
    nxt_open = O.shift(-1)
    out_open = O.shift(-1 - h)
    last = C.ffill()
    exit_px = out_open.fillna(last.shift(-h))                 # vanished within the hold -> last close
    return exit_px / nxt_open - 1

F1, F3, F7 = fwd(1), fwd(3), fwd(7)


def say(s=""):
    print(s)


def row(cells):
    return "| " + " | ".join(str(c) for c in cells) + " |"


def head(cols):
    return row(cols) + "\n" + row(["---"] * len(cols))


pct = lambda x: "—" if not np.isfinite(x) else f"{x * 100:+.1f}%"
pp = lambda x: "—" if not np.isfinite(x) else f"{x * 100:.1f}%"

PERIODS = [("2019–20", "2019-01-01", "2020-12-31"), ("2021", "2021-01-01", "2021-12-31"),
           ("2022", "2022-01-01", "2022-12-31"), ("2023–24", "2023-01-01", "2024-12-31"),
           ("2025–26", "2025-01-01", "2026-12-31")]

say("# Rotation research — can Binance's next top gainers be seen coming? (Oct 2026)\n")
n_coins = C.shape[1]
n_dead = sum(1 for c in C.columns if C[c].last_valid_index() < C.index[-1] - pd.Timedelta(days=7))
say(f"Universe: **{n_coins} Binance USDT spot coins, {n_dead} of them delisted** (kept on purpose — a strategy that "
    f"only ever sees survivors looks better than it is). Stablecoins, leveraged tokens and wrapped copies excluded. "
    f"Daily candles {dates[0].date()} → {dates[-1].date()}. A coin is tradeable on a day if its median daily volume over "
    f"the prior 20 days is ≥ $1M and it has ≥ 30 days of history (on a typical recent day: "
    f"{int(eligible.loc[dates[-30:]].sum(axis=1).median())} coins). Signals use data to the close of day t; trades fill at "
    f"the open of day t+1. Fees 0.1% per side plus slippage as stated.\n")

# ---------------------------------------------------------------- 1. which signals come before big days?
say("## 1. Which signals actually come before a coin's big up-days?\n")
say("For every day, all tradeable coins are ranked by the signal at the close. **Top-10 hit rate** = how many of the next "
    "day's 10 biggest gainers were already in the signal's top 10 the evening before (random picking: the 'random' row). "
    "**Top-10 next day / next 7 days** = the average return of the signal's top 10 picks, MINUS the average tradeable coin, "
    "before costs. A real edge is positive in EVERY period column, not just on average.\n")
say(head(["signal", "top-10 hit rate (next day's top-10 gainers)", "top-10 next day vs avg coin", "top-10 next 7 days vs avg coin"]
         + [f"7d excess {p[0]}" for p in PERIODS]))


def study(score):
    hits, ex1, ex7 = [], [], []
    per = {p[0]: [] for p in PERIODS}
    for d in dates[:-8]:
        el = eligible.loc[d]
        s = score.loc[d][el].dropna()
        f1 = F1.loc[d][el].dropna()
        f7 = F7.loc[d][el].dropna()
        common = s.index.intersection(f1.index)
        if len(common) < 30:
            continue
        top = s.loc[common].nlargest(10).index
        winners = f1.loc[common].nlargest(10).index
        hits.append(len(top.intersection(winners)))
        ex1.append(f1.loc[top].mean() - f1.loc[common].mean())
        c7 = s.index.intersection(f7.index)
        if len(c7) >= 30:
            t7 = s.loc[c7].nlargest(10).index
            e = f7.loc[t7].mean() - f7.loc[c7].mean()
            ex7.append(e)
            for name, a, b in PERIODS:
                if a <= str(d.date()) <= b:
                    per[name].append(e)
    return np.mean(hits), np.mean(ex1), np.mean(ex7), [np.mean(per[p[0]]) if per[p[0]] else np.nan for p in PERIODS]


random_score = pd.DataFrame(rng.random(C.shape), index=C.index, columns=C.columns)
for name, sc in list(FEATURES.items()) + [("random (baseline)", random_score)]:
    h, e1, e7, per = study(sc)
    say(row([name, f"{h:.2f} of 10", pct(e1), pct(e7)] + [pct(x) for x in per]))
sys.stdout.flush()

# ---------------------------------------------------------------- 2. the rotation itself
say("\n## 2. The rotation: hold the top 3 picks, a third of the money each\n")
say("Every H days, at the open, sell what is no longer in the top 3 and buy the new top 3 (equal thirds). Costs are paid "
    "only on what actually changes hands. **Random** = the same rotation picking 3 tradeable coins at random "
    "(median of 60 runs) — the bar any signal must clear. The **BTC gate** variant holds cash whenever BTC closed below its "
    "50-day MA the evening before.\n")

btc_gate = (C["BTC"] > C["BTC"].rolling(50).mean())
# numpy views over the backtest dates — the rotation runs ~150 times, pandas row access is too slow
D = len(dates) - 1
cols = list(C.columns)
EL = eligible.loc[dates].values
F1a = F1.loc[dates].values
ONa = O.shift(-1).loc[dates].notna().values
GATE = btc_gate.reindex(dates).fillna(False).values


def rotate(score, H=1, k=3, slip=0.002, gate=False, randomize=False):
    """Daily equity of a top-k rotation. Each holding's value drifts with its own price between
    rebalances; costs = (fee + slippage) × the value that actually changes hands."""
    Sa = None if randomize else score.loc[dates].values
    val = np.zeros(len(cols)); cash = 1.0
    eq = np.empty(D)
    for i in range(D):
        if i % H == 0:
            tot = cash + val.sum()
            ok = EL[i] & ONa[i]
            if gate and not GATE[i]:
                tgt = np.array([], int)
            elif randomize:
                cand = np.flatnonzero(ok)
                tgt = rng.choice(cand, k, replace=False) if len(cand) >= k else np.array([], int)
            else:
                sc = np.where(ok, Sa[i], np.nan)
                good = np.flatnonzero(np.isfinite(sc))
                tgt = good[np.argsort(-sc[good])[:k]] if len(good) >= k else np.array([], int)
            new = np.zeros(len(cols))
            if len(tgt):
                new[tgt] = tot / k
            turnover = np.abs(new - val).sum()
            tot -= turnover * (FEE + slip)
            new *= tot / max(1e-12, new.sum()) if len(tgt) else 0
            val = new; cash = tot - val.sum()
        r = np.nan_to_num(F1a[i], nan=0.0)
        val = val * (1 + r)
        eq[i] = cash + val.sum()
    return pd.Series(eq, index=dates[:-1])


def summarize(eq):
    yrs = (eq.index[-1] - eq.index[0]).days / 365.25
    dd = (eq / eq.cummax() - 1).min()
    by = eq.groupby(eq.index.year).last() / eq.groupby(eq.index.year).first() - 1
    return eq.iloc[-1], eq.iloc[-1] ** (1 / yrs) - 1, dd, by


BTC_eq = (O["BTC"].shift(-1) / O["BTC"].shift(-1).loc[dates[0]]).loc[dates[:-1]]
ew = F1.where(eligible).loc[dates[:-1]].mean(axis=1).fillna(0)
EW_eq = (1 + ew - 0.0).cumprod()                   # equal-weight every tradeable coin, rebalanced daily, no costs
rows = [("BTC buy & hold", BTC_eq), ("every tradeable coin, equal weight (no costs)", EW_eq)]

for H in (1, 7):
    rand_runs = [rotate(None, H=H, randomize=True) for _ in range(60)]
    finals = np.array([r.iloc[-1] for r in rand_runs])
    rows.append((f"random 3 coins, rebalance every {H}d (median of 60)", rand_runs[int(np.argsort(finals)[len(finals) // 2])]))
    for name in ["volume spike on an UP day", "volume building while price flat (stealth)",
                 "yesterday's % gain (chase the gainers)", "7-day momentum", "30-day momentum",
                 "close vs 30-day high (breakout)"]:
        rows.append((f"{name}, every {H}d", rotate(FEATURES[name], H=H)))
    rows.append((f"7-day momentum, every {H}d, BTC gate", rotate(FEATURES["7-day momentum"], H=H, gate=True)))
    rows.append((f"30-day momentum, every {H}d, BTC gate", rotate(FEATURES["30-day momentum"], H=H, gate=True)))

years = sorted(set(dates.year))
say(head(["strategy", "end value", "CAGR", "max DD"] + [str(y) for y in years]))
for name, eq in rows:
    end, cagr, dd, by = summarize(eq)
    say(row([name, f"{end:,.2f}×", pct(cagr), pct(dd)] + [pct(by.get(y, np.nan)) for y in years]))

# ---------------------------------------------------------------- 3. what the biggest runners looked like BEFORE
say("\n## 3. What did the biggest daily runners look like the evening BEFORE they ran?\n")
say("Every coin-day with a next-day gain of ≥ +30% (tradeable coins only), compared with all other coin-days. If a pattern "
    "came before big moves, it would show up here as a large gap between the two columns.\n")
big = (F1 >= 0.30) & eligible
norm = (F1 < 0.30) & eligible
say(head(["evening-before reading", "before a ≥+30% day (median)", "all other days (median)", "share of ≥+30% days where it was in the coin's top 10%"]))
for name, sc in [("volume vs 20-day normal", vsurge), ("7d/30d volume trend", vtrend), ("yesterday's return", ret1),
                 ("7-day return", ret7), ("30-day return", ret30), ("close vs 30-day high", brk30)]:
    sub = sc.loc[dates]
    b = sub[big.loc[dates]].stack().median()
    n_ = sub[norm.loc[dates]].stack().median()
    q90 = sub.where(eligible.loc[dates]).quantile(0.9, axis=1)
    top = sub.ge(q90, axis=0) & big.loc[dates]
    share = top.values.sum() / max(1, big.loc[dates].values.sum())
    say(row([name, f"{b:.3f}", f"{n_:.3f}", pp(share)]))
nb = int(big.loc[dates].values.sum()); nall = int(eligible.loc[dates].values.sum())
say(f"\n{nb:,} coin-days of ≥ +30% out of {nall:,} tradeable coin-days ({nb / nall * 100:.2f}%).")

# ---------------------------------------------------------------- 3b. same readings before big DOWN days
say("\n**The same readings before big DOWN days** — if they are just as high before crashes, they predict a big move, "
    "not its direction.\n")
crash = (F1 <= -0.20) & eligible
say(head(["evening-before reading", "before a ≥+30% day", "before a ≤−20% day", "all other days"]))
for name, sc in [("volume vs 20-day normal", vsurge), ("7d/30d volume trend", vtrend), ("7-day return", ret7), ("30-day return", ret30)]:
    sub = sc.loc[dates]
    say(row([name, f"{sub[big.loc[dates]].stack().median():.3f}", f"{sub[crash.loc[dates]].stack().median():.3f}",
             f"{sub[norm.loc[dates]].stack().median():.3f}"]))
say("\n**Odds of a ≥+30% day vs a ≤−20% day tomorrow, by tonight's volume reading**\n")
say(head(["tonight's volume vs 20-day normal", "coin-days", "P(next day ≥ +30%)", "P(next day ≤ −20%)", "avg next day"]))
vs = vsurge.loc[dates].where(eligible.loc[dates]); f1d = F1.loc[dates]
for lo, hi in [(0, 1), (1, 2), (2, 4), (4, 8), (8, np.inf)]:
    m = (vs >= lo) & (vs < hi)
    n = int(m.values.sum())
    if not n:
        continue
    say(row([f"{lo}× – {hi}×" if np.isfinite(hi) else f"{lo}×+", f"{n:,}", pp(((f1d >= 0.30) & m).values.sum() / n),
             pp(((f1d <= -0.20) & m).values.sum() / n), pct(np.nanmean(f1d.values[m.values]))]))

# ---------------------------------------------------------------- 4. give the idea every fair chance
say("\n## 4. Giving the rotation every fair chance\n")
say("Section 2 used small coins, 3 picks and 0.2% slippage. Here: only big liquid coins (≥ $20M/day), more picks, "
    "slower rebalancing, 0.1% slippage, with and without the BTC gate. If none of these beat holding BTC or the random "
    "baseline, the idea has no edge on this data — not just bad settings.\n")
eligible_big = (dv_med20 >= 20e6) & (age >= 30) & C.notna()
EL_small = EL
EL = eligible_big.loc[dates].values
say(head(["rotation (coins ≥ $20M/day)", "end value", "CAGR", "max DD"] + [str(y) for y in years]))
for k in (3, 10):
    for H in (7, 30):
        runs = [rotate(None, H=H, k=k, slip=0.001, randomize=True) for _ in range(30)]
        fin = np.array([r.iloc[-1] for r in runs])
        for nm, eq in [(f"random {k}, every {H}d (median of 30)", runs[int(np.argsort(fin)[len(fin) // 2])]),
                       (f"30-day momentum top {k}, every {H}d", rotate(ret30, H=H, k=k, slip=0.001)),
                       (f"30-day momentum top {k}, every {H}d, BTC gate", rotate(ret30, H=H, k=k, slip=0.001, gate=True)),
                       (f"volume building (stealth) top {k}, every {H}d, BTC gate", rotate(stealth, H=H, k=k, slip=0.001, gate=True))]:
            end, cagr, dd, by = summarize(eq)
            say(row([nm, f"{end:,.2f}×", pct(cagr), pct(dd)] + [pct(by.get(y, np.nan)) for y in years]))
EL = EL_small
end, cagr, dd, by = summarize(BTC_eq)
say(row(["BTC buy & hold", f"{end:,.2f}×", pct(cagr), pct(dd)] + [pct(by.get(y, np.nan)) for y in years]))
