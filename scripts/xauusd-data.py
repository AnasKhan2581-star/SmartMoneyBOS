#!/usr/bin/env python3
"""Spot gold (XAUUSD) daily candles for the webapp: data/xauusd_1d.csv.

Binance has no spot gold (only the PAXG/XAUT tokens, from 2020/2026), so the chart's XAUUSD comes from
Dukascopy's public historical datafeed (Swiss bank; BID prices; from 2 January 2003). Its files are LZMA-compressed
binary candles that a browser page cannot read (no CORS), so this runs in a GitHub Action and the page reads
the CSV from this same site.

Where each day comes from (the feed is slow from GitHub's runners, ~10 s a file, so as few files as possible):
  finished years   one file of Dukascopy's own daily candles per year (UTC days: Feb 2024 checked against UTC
                   days built from its hourly candles, identical to the cent)
  this year        one file of hourly candles per finished month
  this month       one file of minute candles per day (the month's hour file isn't published until it ends; a
                   day's minute file appears after the day ends, so the file reaches yesterday and the page adds
                   today from a live price)
Days are UTC days. Gold trades from Sunday evening to Friday evening; a Sunday candle (the evening session) is
folded into Monday and a stray Saturday into Friday, so a week has five candles. Candles with no volume (the
market closed) are skipped.

Usage: python3 scripts/xauusd-data.py [--full] [--out data/xauusd_1d.csv]
  default: re-read this month and the last, re-fetch any year or month that is missing, and merge.
  --full:  rebuild everything from 2003.
A period that can't be fetched is reported (a GitHub warning) and left for the next run; the file never shrinks.
Standard library only.
"""
import csv, datetime as dt, lzma, os, struct, sys, time, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor

BASE = 'https://datafeed.dukascopy.com/datafeed/XAUUSD'
SCALE = 1000.0                     # XAUUSD is stored ×1000 (3 decimals); sanity-checked before writing
FIRST_YEAR = 2003                  # Dukascopy's XAUUSD history starts on 2 January 2003
OUT = sys.argv[sys.argv.index('--out') + 1] if '--out' in sys.argv else 'data/xauusd_1d.csv'
UTC = dt.timezone.utc
FAILED = []

def get(url):
    """the file's bytes; None when Dukascopy has no such file (404) or it could not be fetched (recorded)."""
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 SmartMoneyBOS gold updater'})
            with urllib.request.urlopen(req, timeout=45) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            err = f'HTTP {e.code}'
        except Exception as e:                                 # timeouts, resets
            err = str(e)
        time.sleep(2 + 3 * attempt)
    FAILED.append(f'{url} ({err})')
    return None

def candles(blob, t0):
    """Dukascopy .bi5 candle file -> [(utc seconds, open, high, low, close, volume)]. Records are 24 bytes,
    big-endian: seconds from the file's start, OPEN, CLOSE, LOW, HIGH (int, ×1000), volume (float)."""
    if not blob:
        return []
    raw = lzma.decompress(blob, format=lzma.FORMAT_ALONE)
    out = []
    for off in range(0, len(raw) - 23, 24):
        t, o, c, lo, hi, v = struct.unpack('>5if', raw[off:off + 24])
        if v > 0 and o > 0:
            out.append((t0 + t, o / SCALE, hi / SCALE, lo / SCALE, c / SCALE, v))
    return out

def ts(y, m=1, d=1):
    return int(dt.datetime(y, m, d, tzinfo=UTC).timestamp())

def year_candles(y):
    return candles(get(f'{BASE}/{y}/BID_candles_day_1.bi5'), ts(y))

def month_candles(y, m):
    """hour candles of a finished month; for this month (no hour file yet) the day-by-day minute files."""
    blob = get(f'{BASE}/{y}/{m - 1:02d}/BID_candles_hour_1.bi5')
    if blob:
        return candles(blob, ts(y, m))
    today, days, d = dt.datetime.now(UTC).date(), [], dt.date(y, m, 1)
    if (today.year - y) * 12 + today.month - m > 1:          # an old month with no hour file has no data
        return []
    while d.month == m and d <= today:
        days.append(d); d += dt.timedelta(days=1)
    day_min = lambda d: candles(get(f'{BASE}/{y}/{m - 1:02d}/{d.day:02d}/BID_candles_min_1.bi5'), ts(d.year, d.month, d.day))
    with ThreadPoolExecutor(max_workers=4) as pool:          # up to 31 files at month end; ~5-90 s each from a runner
        return [c for cs in pool.map(day_min, days) for c in cs]

def to_days(rows):
    """UTC days from candles of any size; Sunday's evening session joins Monday, a stray Saturday joins Friday."""
    days = {}
    for t, o, h, l, c, v in sorted(rows):
        day = dt.datetime.fromtimestamp(t, UTC).date()
        if day.weekday() == 6:
            day += dt.timedelta(days=1)
        elif day.weekday() == 5:
            day -= dt.timedelta(days=1)
        if day not in days:
            days[day] = [o, h, l, c]
        else:
            x = days[day]; x[1] = max(x[1], h); x[2] = min(x[2], l); x[3] = c
    return days

def main():
    full = '--full' in sys.argv or not os.path.exists(OUT)
    rows = {}
    if not full:
        with open(OUT) as f:
            for r in csv.DictReader(f):
                rows[dt.date.fromisoformat(r['date'])] = [float(r['open']), float(r['high']), float(r['low']), float(r['close'])]
    now = dt.datetime.now(UTC).date()
    have_y = {}
    for d in rows:
        have_y[d.year] = have_y.get(d.year, 0) + 1
    # what to fetch: finished years by their day file, this year's finished months by hour file, this month by minutes
    years = [y for y in range(FIRST_YEAR, now.year) if full or have_y.get(y, 0) < (150 if y == FIRST_YEAR else 240)]
    months = [(now.year, m) for m in range(1, now.month + 1)
              if full or m >= now.month - 1 or not any(d.year == now.year and d.month == m for d in rows)]
    if now.month == 1 and not full:                           # in January, last December is still "the last month"
        months.insert(0, (now.year - 1, 12))
    jobs = [('y', y, 0) for y in years] + [('m', y, m) for y, m in months]
    t0, got = time.time(), 0
    with ThreadPoolExecutor(max_workers=4) as pool:
        for (kind, y, m), cs in zip(jobs, pool.map(lambda j: year_candles(j[1]) if j[0] == 'y' else month_candles(j[1], j[2]), jobs)):
            for day, v in to_days(cs).items():
                rows[day] = v; got += 1
            print(f'  {y}{"" if kind == "y" else f"-{m:02d}"}: {len(cs)} candles ({time.time() - t0:.0f}s)', flush=True)
    if not rows:
        sys.exit('no data at all — nothing written')
    days = sorted(rows)
    # sanity: a gold price is between $200 and $20,000, and a candle's high/low contain its open/close
    bad = [d for d in days if not (200 < rows[d][3] < 20000) or rows[d][1] < max(rows[d][0], rows[d][3]) - 1e-9
           or rows[d][2] > min(rows[d][0], rows[d][3]) + 1e-9]
    if bad:
        sys.exit(f'refusing to write: {len(bad)} impossible candles, first {bad[0]} {rows[bad[0]]}')
    os.makedirs(os.path.dirname(OUT) or '.', exist_ok=True)
    tmp = OUT + '.tmp'
    with open(tmp, 'w', newline='') as f:
        w = csv.writer(f, lineterminator='\n')            # plain LF lines (csv's default is CRLF)
        w.writerow(['date', 'open', 'high', 'low', 'close'])
        for d in days:
            w.writerow([d.isoformat()] + [f'{x:.3f}'.rstrip('0').rstrip('.') for x in rows[d]])
    os.replace(tmp, OUT)
    print(f'{OUT}: {len(days)} days, {days[0]} -> {days[-1]} ({got} fetched from {len(jobs)} files in {time.time() - t0:.0f}s)')
    print('weekdays:', {n: sum(1 for d in days if d.weekday() == i) for i, n in enumerate('Mon Tue Wed Thu Fri Sat Sun'.split())})
    jumps = [(days[i], rows[days[i]][3] / rows[days[i - 1]][3] - 1) for i in range(1, len(days))
             if abs(rows[days[i]][3] / rows[days[i - 1]][3] - 1) > 0.08]
    if jumps:
        print(f'{len(jumps)} day-over-day moves beyond 8% (check they are real):', ', '.join(f'{d} {j:+.1%}' for d, j in jumps[:20]))
    for f in FAILED:                                           # left for the next run, which re-fetches what's missing
        print(f'::warning::could not fetch {f}')

if __name__ == '__main__':
    main()
