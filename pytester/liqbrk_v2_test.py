"""
liqbrk_v2_test.py — drop into SmartMoneyBOS/pytester/

Runs baseline liqbrk against the v2 refinement on FULL history using this repo's
own data.load() (so ZECUSDT 15m, 258k bars, is reachable).

    cd pytester
    python liqbrk_v2_test.py                      # ZEC 15m, the benchmark pair
    python liqbrk_v2_test.py ZECUSDT 15m
    python liqbrk_v2_test.py SOLUSDT 1h

Does NOT touch strategies.py / detector.js, so `python verify.py` still passes.

v2 = baseline + three changes:
  lbBrkExt   1.0   close must clear the 2-day high by >=1.0 x ATR
  lbStop     4.0   (was 3.0)
  lbBtcVeto -0.10  skip if BTC 30-day momentum < -10% at the signal bar
Concurrency cap is a book-level rule and is not modelled here (single symbol).
"""
from __future__ import annotations
import sys, warnings
warnings.filterwarnings("ignore")
import numpy as np, pandas as pd
import data as repo_data

FEE = 0.001                                    # 0.1% per side, as the app models it
BASE = dict(lbBreak=2.0, lbTrend=5.0, lbExit=1.0, lbRelVol=1.3, lbStop=3.0,
            lbMaBars=149, lbBrkExt=0.0, lbBtcVeto=None)
V2 = {**BASE, 'lbStop': 4.0, 'lbBrkExt': 1.0, 'lbBtcVeto': -0.10}


def get(symbol, tf):
    df = repo_data.load(symbol, tf, bars=0, refresh=True)
    t = pd.to_numeric(df['time'])
    unit = 'ms' if t.iloc[-1] > 1e11 else 's'
    d = df.copy(); d['dt'] = pd.to_datetime(t, unit=unit, utc=True)
    return (d[['dt','open','high','low','close','volume']]
            .astype({c: float for c in ['open','high','low','close','volume']})
            .drop_duplicates('dt').sort_values('dt').set_index('dt'))


def _atr(h, l, c, n=14):
    pc = np.roll(c, 1); pc[0] = c[0]
    tr = np.maximum(h - l, np.maximum(np.abs(h - pc), np.abs(l - pc)))
    return pd.Series(tr).rolling(n).mean().values


def _sma(x, n):
    return pd.Series(x).rolling(max(2, int(n))).mean().values


def backtest(df, p, btc_mom=None):
    o, h, l, c = df.open.values, df.high.values, df.low.values, df.close.values
    v = df.volume.values; n = len(df)
    dt = max(60, int((df.index[1] - df.index[0]).total_seconds()))
    bpd = 86400 / dt
    S = lambda d: max(2, int(round(d * bpd)))
    brkN, trdN, exN, volN = S(p['lbBreak']), S(p['lbTrend']), S(p['lbExit']), S(1.0)
    maB = int(p['lbMaBars'] or 0)
    a = _atr(h, l, c); tMA = _sma(c, trdN)
    bMA = _sma(c, maB) if maB >= 2 else np.full(n, -np.inf)
    vA = _sma(v, volN)
    pH = pd.Series(h).rolling(brkN).max().shift(1).values
    pL = pd.Series(l).rolling(exN).min().shift(1).values
    mom = (btc_mom.reindex(df.index, method='ffill').values
           if (p.get('lbBtcVeto') is not None and btc_mom is not None) else None)
    warm = max(brkN, trdN, volN, maB, 14) + 2
    out, pos = [], None
    for i in range(warm, n):
        if pos is None:
            if not (np.isfinite(pH[i]) and np.isfinite(a[i]) and np.isfinite(vA[i])): continue
            if not (c[i] > pH[i] and c[i] > tMA[i] and c[i] > bMA[i]
                    and v[i] >= p['lbRelVol'] * vA[i]): continue
            if p['lbBrkExt'] > 0 and (c[i] - pH[i]) / a[i] < p['lbBrkExt']: continue
            if mom is not None and (not np.isfinite(mom[i]) or mom[i] < p['lbBtcVeto']): continue
            if i + 1 >= n: break
            e = o[i + 1]; st = e - p['lbStop'] * a[i]
            if st <= 0 or (e - st) / e < 0.001: continue
            pos = dict(ie=i + 1, e=e, st=st)
        else:
            if l[i] <= pos['st']: px = pos['st']
            elif np.isfinite(pL[i]) and c[i] < pL[i]: px = c[i]
            else: continue
            net = (px * (1 - FEE)) / (pos['e'] * (1 + FEE)) - 1
            risk = (pos['e'] - pos['st']) / pos['e']
            out.append(dict(t_exit=df.index[i], net=net, R=net / risk,
                            hours=(df.index[i] - df.index[pos['ie']]).total_seconds() / 3600))
            pos = None
    return pd.DataFrame(out)


def report(name, tr, risk=0.01):
    if tr is None or len(tr) < 5:
        print(f"  {name:34s} n={0 if tr is None else len(tr)} — too few"); return
    t = tr.sort_values('t_exit')
    eq = (1 + risk * t.R.clip(-1.2, 60)).cumprod(); eq.index = pd.DatetimeIndex(t.t_exit.values)
    w = t.net > 0; gl = abs(t.loc[~w, 'net'].sum())
    q = eq.resample('QE').last().ffill().pct_change().dropna()
    yr = t.assign(y=pd.DatetimeIndex(t.t_exit).year).groupby('y').R.mean()
    print(f"  {name:34s} n={len(t):4d} WR={w.mean():5.1%} PF={(t.loc[w,'net'].sum()/gl if gl>0 else 9.99):5.2f} "
          f"expR={t.R.mean():+.3f} ret={eq.iloc[-1]-1:+8.1%} DD={(eq/eq.cummax()-1).min():6.1%} "
          f"loseQ={int((q<0).sum())}/{len(q)} posY={int((yr>0).sum())}/{len(yr)} hold={t.hours.mean():.0f}h")
    return yr


def main(sym='ZECUSDT', tf='15m'):
    print(f"loading {sym} {tf} (full history; first run fetches + caches) ...")
    df = get(sym, tf)
    print(f"  {len(df):,} bars  {df.index.min().date()} -> {df.index.max().date()}")
    btc_mom = None
    try:
        b = get('BTCUSDT', '1h')                      # 1h is plenty for a 30-day regime
        btc_mom = b.close.pct_change(30 * 24)
        print(f"  BTC regime from 1h: {b.index.min().date()} -> {b.index.max().date()}")
    except Exception as e:
        print(f"  !! BTC regime unavailable ({e}); veto will be skipped")

    print(f"\n{sym} {tf}, 0.1%/side, 1% risk/trade")
    y0 = report("baseline liqbrk", backtest(df, BASE))
    report("+ brk_ext >= 1.0 ATR", backtest(df, {**BASE, 'lbBrkExt': 1.0}))
    report("+ brk_ext + stop 4 ATR", backtest(df, {**BASE, 'lbBrkExt': 1.0, 'lbStop': 4.0}))
    y2 = report("v2 (+ BTC mom30 >= -10%)", backtest(df, V2, btc_mom))

    if y0 is not None and y2 is not None:
        print("\n  mean R by year")
        allx = sorted(set(y0.index) | set(y2.index))
        print("    " + "year  ".rjust(10) + "".join(f"{y:>9}" for y in allx))
        print("    " + "base  ".rjust(10) + "".join(f"{y0.get(y, float('nan')):>+9.3f}" for y in allx))
        print("    " + "v2    ".rjust(10) + "".join(f"{y2.get(y, float('nan')):>+9.3f}" for y in allx))
    print("\nNOTE: the book-level 'max 5 concurrent positions' rule is not modelled here "
          "(single symbol). On the 10-symbol 1h study it cut max drawdown from -52% to -40%.")


if __name__ == '__main__':
    a = sys.argv[1:]
    main(a[0].upper() if a else 'ZECUSDT', a[1].lower() if len(a) > 1 else '15m')
