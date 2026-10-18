"""
session_bt.py — drop-in for SmartMoneyBOS/pytester.

Intraday session backtest (15m/30m/1h) for 3 SMC-style strategies + a random
control, using this repo's existing `data.load()` (so it fetches/caches any
Binance pair, INJUSDT and ARBUSDT included).

    cd pytester
    python session_bt.py                      # default 5 symbols
    python session_bt.py INJUSDT ARBUSDT      # or pick your own

Reads nothing else from the repo. Prints the same tables the cloud run produced.
"""
from __future__ import annotations
import sys, warnings
warnings.filterwarnings("ignore")
import numpy as np, pandas as pd

import data as repo_data          # this repo's Binance loader + parquet cache

# ---- costs: Binance USDT-M futures ----------------------------------------
COSTS = {"gross": (0.0, 0.0), "maker": (0.0002, 0.0001), "taker": (0.0004, 0.0002)}
ASIA, US, FLAT_H = (0, 7), (13, 21), 23          # UTC; IST = +5:30

SYMS_DEFAULT = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "INJUSDT", "ARBUSDT"]
TFS = ["15m", "30m", "1h"]


# ---------------------------------------------------------------- data adapt
def get(symbol: str, tf: str, bars: int = 0) -> pd.DataFrame:
    """repo loader -> UTC-indexed OHLCV frame."""
    df = repo_data.load(symbol, tf, bars=bars, refresh=True)
    if df is None or len(df) == 0:
        return None
    d = df.copy()
    t = pd.to_numeric(d["time"])
    unit = "ms" if t.iloc[-1] > 1e11 else "s"        # tolerate either
    d["dt"] = pd.to_datetime(t, unit=unit, utc=True)
    d = (d[["dt", "open", "high", "low", "close", "volume"]]
         .astype({c: float for c in ["open", "high", "low", "close", "volume"]})
         .drop_duplicates("dt").sort_values("dt").set_index("dt"))
    return d


def atr(df, n=14):
    h, l, c = df.high.values, df.low.values, df.close.values
    pc = np.roll(c, 1); pc[0] = c[0]
    tr = np.maximum(h - l, np.maximum(np.abs(h - pc), np.abs(l - pc)))
    return pd.Series(tr, index=df.index).rolling(n).mean().shift(1).values   # shift = no look-ahead


def daily_context(df):
    d = df.copy(); d["date"] = d.index.date; d["hour"] = d.index.hour
    day = d.groupby("date").agg(d_high=("high", "max"), d_low=("low", "min"),
                                d_close=("close", "last"))
    day["pdh"] = day.d_high.shift(1); day["pdl"] = day.d_low.shift(1)
    pc = day.d_close.shift(1)
    tr = pd.concat([day.d_high - day.d_low, (day.d_high - pc).abs(),
                    (day.d_low - pc).abs()], axis=1).max(axis=1)
    day["atr_d"] = tr.rolling(14).mean().shift(1)
    day["trend"] = np.sign(day.d_close - day.d_close.rolling(50).mean()).shift(1)
    asia = d[(d.hour >= ASIA[0]) & (d.hour < ASIA[1])]
    day = day.join(asia.groupby("date").agg(a_high=("high", "max"), a_low=("low", "min")))
    ratio = (day.a_high - day.a_low) / day.atr_d
    day["compress"] = ratio / ratio.rolling(20).median()
    return day


def _dl(date): return pd.Timestamp(date, tz="UTC") + pd.Timedelta(hours=FLAT_H)


# ---------------------------------------------------------------- simulation
def simulate(sigs, df, fee, slip):
    if not sigs: return pd.DataFrame()
    idx = df.index; H, L, C = df.high.values, df.low.values, df.close.values
    out = []
    for s in sigs:
        p0 = idx.searchsorted(s["t_entry"])
        if p0 >= len(idx): continue
        pe = min(idx.searchsorted(s["t_deadline"]), len(idx) - 1)
        if pe < p0: continue
        side, ent, stop, tgt = s["side"], s["entry"], s["stop"], s["target"]
        px = tm = why = None
        for p in range(p0, pe + 1):
            if side == 1:
                if L[p] <= stop: px, tm, why = stop, idx[p], "stop"; break
                if H[p] >= tgt:  px, tm, why = tgt, idx[p], "target"; break
            else:
                if H[p] >= stop: px, tm, why = stop, idx[p], "stop"; break
                if L[p] <= tgt:  px, tm, why = tgt, idx[p], "target"; break
        if px is None: px, tm, why = C[pe], idx[pe], "time"
        gross = side * (px - ent) / ent
        risk = abs(ent - stop) / ent
        out.append(dict(t_entry=s["t_entry"], side=side, entry=ent, exit=px,
                        t_exit=tm, reason=why, risk_pct=risk,
                        R=(gross - 2 * (fee + slip)) / risk if risk > 0 else np.nan))
    return pd.DataFrame(out)


# ---------------------------------------------------------------- strategies
def s1_tare(df, day, a, k_stop=2.5, rr=3.0, buf=0.05):
    """Trend-Aligned Range Expansion: Asia-range break in the US session,
    only in the direction of the daily 50-MA trend."""
    d = df.copy(); d["date"] = d.index.date; d["hour"] = d.index.hour
    sig = []
    for date, g in d[(d.hour >= US[0]) & (d.hour < US[1])].groupby("date"):
        if date not in day.index: continue
        r = day.loc[date]
        if not (np.isfinite(r.a_high) and np.isfinite(r.atr_d) and r.atr_d > 0): continue
        t = r.trend
        if not np.isfinite(t) or t == 0: continue
        g = g.sort_index(); pos = df.index.searchsorted(g.index)
        cl, op, ts = g.close.values, g.open.values, g.index
        for i in range(len(g)):
            av = a[pos[i]]
            if not np.isfinite(av) or av <= 0: continue
            if cl[i] > r.a_high + buf * r.atr_d: side = 1
            elif cl[i] < r.a_low - buf * r.atr_d: side = -1
            else: continue
            if side != t or i + 1 >= len(g): break
            e = op[i + 1]; risk = k_stop * av
            if risk / e < 0.0015: break
            sig.append(dict(t_entry=ts[i + 1], side=side, entry=e,
                            stop=e - side * risk, target=e + side * rr * risk,
                            t_deadline=_dl(date)))
            break
    return sig


def s2_cf(df, day, a, k_min=2.5, rr=3.0, max_compress=1.0, reclaim=8):
    """Compression Fade: counter-trend sweep of a tight Asia range, entry on reclaim."""
    d = df.copy(); d["date"] = d.index.date; d["hour"] = d.index.hour
    sig = []
    for date, g in d[(d.hour >= US[0]) & (d.hour < US[1])].groupby("date"):
        if date not in day.index: continue
        r = day.loc[date]
        if not (np.isfinite(r.a_high) and np.isfinite(r.atr_d) and r.atr_d > 0): continue
        if not (np.isfinite(r.compress) and r.compress <= max_compress): continue
        t = r.trend
        if not np.isfinite(t) or t == 0: continue
        g = g.sort_index(); pos = df.index.searchsorted(g.index)
        hi, lo, cl, op, ts = g.high.values, g.low.values, g.close.values, g.open.values, g.index
        swept = None
        for i in range(len(g)):
            if swept is None:
                if hi[i] > r.a_high: swept = ("up", hi[i], i)
                elif lo[i] < r.a_low: swept = ("down", lo[i], i)
                continue
            dsw, ext, i0 = swept
            ext = max(ext, hi[i]) if dsw == "up" else min(ext, lo[i])
            swept = (dsw, ext, i0)
            if i - i0 > reclaim: break
            if dsw == "up" and cl[i] < r.a_high: side = -1
            elif dsw == "down" and cl[i] > r.a_low: side = 1
            else: continue
            if side != -t or i + 1 >= len(g): break
            av = a[pos[i]]
            if not np.isfinite(av) or av <= 0: break
            e = op[i + 1]
            risk = max(abs(e - ext) + 0.10 * av, k_min * av)      # ATR floor vs fees
            if not (0.0015 <= risk / e <= 0.06): break
            sig.append(dict(t_entry=ts[i + 1], side=side, entry=e,
                            stop=e - side * risk, target=e + side * rr * risk,
                            t_deadline=_dl(date)))
            break
    return sig


def s3_lsd(df, day, a, rr=3.0, disp_mult=0.8, retrace=0.4, wait=12,
           k_min=3.0, sweep_win=6):
    """Liquidity Sweep + Displacement: sweep PDH/PDL, displacement candle closes
    back through it, enter on the retrace into that candle."""
    d = df.copy(); d["date"] = d.index.date; d["hour"] = d.index.hour
    H, L, C = df.high.values, df.low.values, df.close.values
    sig = []
    for date, g in d[(d.hour >= US[0]) & (d.hour < US[1])].groupby("date"):
        if date not in day.index: continue
        r = day.loc[date]
        if not (np.isfinite(r.pdh) and np.isfinite(r.pdl)): continue
        t = r.trend
        if not np.isfinite(t) or t == 0: continue
        g = g.sort_index(); pos = df.index.searchsorted(g.index)
        swept = None; done = False
        for i in range(len(g)):
            if done: break
            p = pos[i]; av = a[p]
            if not np.isfinite(av) or av <= 0: continue
            if swept is None:
                if H[p] > r.pdh: swept = ("up", H[p], i)
                elif L[p] < r.pdl: swept = ("down", L[p], i)
                continue
            dsw, ext, i0 = swept
            ext = max(ext, H[p]) if dsw == "up" else min(ext, L[p])
            swept = (dsw, ext, i0)
            if i - i0 > sweep_win: break
            lvl = r.pdh if dsw == "up" else r.pdl
            if not ((C[p] < lvl) if dsw == "up" else (C[p] > lvl)): continue
            if (H[p] - L[p]) < disp_mult * av: continue
            side = -1 if dsw == "up" else 1
            if side != t: break
            e = (H[p] - retrace * (H[p] - L[p])) if side == -1 else (L[p] + retrace * (H[p] - L[p]))
            fill = None
            for q in range(p + 1, min(p + 1 + wait, len(df))):
                if df.index[q] > _dl(date): break
                if (side == -1 and H[q] >= e) or (side == 1 and L[q] <= e): fill = q; break
            if fill is None: break
            risk = max(abs(e - ext) + 0.10 * av, k_min * av)
            if not (0.0015 <= risk / e <= 0.06): break
            sig.append(dict(t_entry=df.index[fill], side=side, entry=e,
                            stop=e - side * risk, target=e + side * rr * risk,
                            t_deadline=_dl(date)))
            done = True
    return sig


def s0_random(df, day, a, k_stop=2.5, rr=3.0, seed=7):
    """Control. At zero cost this MUST return ~0.00R or the engine is biased."""
    rng = np.random.default_rng(seed)
    d = df.copy(); d["date"] = d.index.date; d["hour"] = d.index.hour
    sig = []
    for date, g in d[(d.hour >= US[0]) & (d.hour < US[1])].groupby("date"):
        g = g.sort_index()
        if len(g) < 3: continue
        pos = df.index.searchsorted(g.index)
        i = int(rng.integers(0, len(g) - 1)); av = a[pos[i]]
        if not np.isfinite(av) or av <= 0: continue
        side = 1 if rng.random() < 0.5 else -1
        e = g.open.values[i + 1]; risk = k_stop * av
        if risk / e < 0.0015: continue
        sig.append(dict(t_entry=g.index[i + 1], side=side, entry=e,
                        stop=e - side * risk, target=e + side * rr * risk,
                        t_deadline=_dl(date)))
    return sig


STRATS = {"S1_TARE": s1_tare, "S2_CF": s2_cf, "S3_LSD": s3_lsd, "S0_RANDOM": s0_random}


# ---------------------------------------------------------------- reporting
def stats(tr, risk=0.01):
    t = tr.dropna(subset=["R"]).sort_values("t_exit")
    if len(t) < 10: return None
    eq = (1 + risk * t.R.clip(-1.5, 20)).cumprod()
    eq.index = pd.DatetimeIndex(t.t_exit.values)
    days = max((t.t_exit.max() - t.t_exit.min()).days, 1)
    m = eq.resample("ME").last().ffill().pct_change().dropna()
    w = t.R > 0; gl = abs(t.loc[~w, "R"].sum())
    yr = t.assign(y=pd.DatetimeIndex(t.t_exit).year).groupby("y").R.mean()
    return dict(n=len(t), win=w.mean(), exp=t.R.mean(),
                pf=(t.loc[w, "R"].sum() / gl) if gl > 0 else np.inf,
                risk_pct=t.risk_pct.median(),
                cagr=eq.iloc[-1] ** (365.25 / days) - 1,
                maxdd=(eq / eq.cummax() - 1).min(),
                sharpe=(m.mean() / m.std() * np.sqrt(12)) if len(m) > 2 and m.std() > 0 else np.nan,
                pos_yrs=f"{int((yr > 0).sum())}/{len(yr)}")


def main(symbols):
    rows = []
    for sym in symbols:
        for tf in TFS:
            try:
                df = get(sym, tf)
            except Exception as e:
                print(f"  !! {sym} {tf}: {e}"); continue
            if df is None or len(df) < 1500:
                print(f"  -- {sym} {tf}: only {0 if df is None else len(df)} bars, skipped"); continue
            day = daily_context(df); a = atr(df, 14)
            print(f"  {sym} {tf}: {len(df)} bars  {df.index.min().date()} -> {df.index.max().date()}")
            for name, fn in STRATS.items():
                sig = fn(df, day, a)
                if len(sig) < 15: continue
                r = {}
                for ck, (fee, slip) in COSTS.items():
                    s = stats(simulate(sig, df, fee, slip))
                    if s: r[ck] = s
                if "taker" not in r: continue
                rows.append(dict(sym=sym, tf=tf, strat=name, n=r["taker"]["n"],
                                 win=r["taker"]["win"], gross=r["gross"]["exp"],
                                 maker=r["maker"]["exp"], taker=r["taker"]["exp"],
                                 pf=r["taker"]["pf"], risk_pct=r["taker"]["risk_pct"],
                                 cagr=r["taker"]["cagr"], maxdd=r["taker"]["maxdd"],
                                 sharpe=r["taker"]["sharpe"], pos_yrs=r["taker"]["pos_yrs"]))
    R = pd.DataFrame(rows)
    if R.empty:
        print("no results"); return R

    rnd = R[R.strat == "S0_RANDOM"].set_index(["sym", "tf"])
    R["excess"] = R.apply(lambda x: x.taker - rnd.loc[(x.sym, x.tf), "taker"]
                          if (x.sym, x.tf) in rnd.index else np.nan, axis=1)

    print("\n" + "=" * 96)
    print("ENGINE CHECK — random control at ZERO cost must be ~0.000R")
    print("=" * 96)
    print(R[R.strat == "S0_RANDOM"][["sym", "tf", "n", "gross", "taker"]].round(4).to_string(index=False))

    print("\n" + "=" * 96); print("PER SYMBOL / TIMEFRAME — expectancy in R"); print("=" * 96)
    print(R[R.strat != "S0_RANDOM"][
        ["sym", "tf", "strat", "n", "win", "gross", "maker", "taker", "excess",
         "pf", "sharpe", "maxdd", "pos_yrs"]].round(4).to_string(index=False))

    print("\n" + "=" * 96); print("STRATEGY x TIMEFRAME — mean NET (taker) expectancy"); print("=" * 96)
    print(R[R.strat != "S0_RANDOM"].pivot_table(index="strat", columns="tf",
          values="taker", aggfunc="mean").round(4).to_string())

    print("\n" + "=" * 96); print("CONSISTENCY — cells net-positive AND beating random"); print("=" * 96)
    g = R[R.strat != "S0_RANDOM"].copy()
    g["PASS"] = (g.taker > 0) & (g.excess > 0)
    print(g.groupby("strat").agg(cells=("PASS", "size"), passed=("PASS", "sum"),
                                 rate=("PASS", "mean"),
                                 mean_gross=("gross", "mean"),
                                 mean_taker=("taker", "mean")).round(3).to_string())

    print("\n" + "=" * 96); print("BREAKEVEN round-trip cost (bp).  futures taker=12bp, maker=6bp, spot=26bp")
    print("=" * 96)
    g["be_bp"] = g.gross * g.risk_pct * 1e4
    print(g.pivot_table(index="strat", columns="tf", values="be_bp", aggfunc="mean").round(1).to_string())

    R.to_csv("session_bt_results.csv", index=False)
    print("\nsaved -> session_bt_results.csv")
    return R


if __name__ == "__main__":
    syms = [s.upper() for s in sys.argv[1:]] or SYMS_DEFAULT
    print(f"symbols: {syms}\ntimeframes: {TFS}\n(first run fetches + caches; later runs are fast)\n")
    main(syms)
