"""Download full Binance spot kline history into research/cache/<SYM>_<TF>.json.

Pages FORWARD from the listing date, 1000 bars per request, and drops the still-forming bar
(closeTime in the future) so every stored bar is final. Re-running only fetches the new tail.
Uses data-api.binance.vision (Binance's public market-data mirror), then api.binance.com.

    python research/fetch_klines.py 2h SOL FET XLM ...
"""
import json, os, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

HOSTS = ["https://data-api.binance.vision", "https://api.binance.com"]
CACHE = os.path.join(os.path.dirname(__file__), "cache")
os.makedirs(CACHE, exist_ok=True)
# tickers Binance renamed: the old symbol's history is stitched in front of the new one
RENAMED = {"RENDER": "RNDR"}


def get(path):
    err = None
    for attempt in range(5):
        for h in HOSTS:
            try:
                with urllib.request.urlopen(h + path, timeout=30) as r:
                    return json.loads(r.read())
            except Exception as e:                       # noqa: BLE001
                err = e
        time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"{path}: {err}")


def fetch_all(sym, tf, start=0):
    rows, now = [], int(time.time() * 1000)
    while True:
        k = get(f"/api/v3/klines?symbol={sym}&interval={tf}&limit=1000&startTime={start}")
        if not k:
            break
        rows += k
        start = k[-1][0] + 1
        if len(k) < 1000:
            break
    return [[r[0] // 1000, float(r[1]), float(r[2]), float(r[3]), float(r[4]), float(r[5])]
            for r in rows if r[6] <= now]                # closed bars only


def load(coin, tf):
    path = os.path.join(CACHE, f"{coin}_{tf}.json")
    old = json.load(open(path)) if os.path.exists(path) else []
    start = (old[-1][0] + 1) * 1000 if old else 0
    new = fetch_all(coin + "USDT", tf, start)
    if not old and coin in RENAMED:                      # prepend the pre-rename history
        pre = fetch_all(RENAMED[coin] + "USDT", tf, 0)
        first = new[0][0] if new else 10**12
        new = [r for r in pre if r[0] < first] + new
    rows = old + new
    json.dump(rows, open(path, "w"), separators=(",", ":"))
    return coin, len(rows)


if __name__ == "__main__":
    tf, coins = sys.argv[1], sys.argv[2:]
    with ThreadPoolExecutor(6) as ex:
        for coin, n in ex.map(lambda c: load(c, tf), coins):
            print(f"{coin:7} {n:6} bars", flush=True)
