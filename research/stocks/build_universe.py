#!/usr/bin/env python3
"""Builds research/stocks/universe.json: the stocks the stock study trades.

  python3 research/stocks/build_universe.py <path to HalalVest's index.html>

INDIA  every stock on the user's HalalVest page (https://github.com/AnasKhan2581-star/proscreening, 97 names). The page
       is read as text only: tickers and names from its portfolios, and its 31 March prices for 2025 and 2026, which
       fetch.js uses to check that the Yahoo symbol it downloads is the same share.
US     50 large, liquid names across eight sectors, picked by hand from companies that Shariah-screened US funds
       commonly hold (no banks, insurers, alcohol, tobacco, gambling or defence primes). NOBODY HAS VERIFIED THEIR
       COMPLIANCE HERE: screens change every quarter, so check each name on a screener before trading it.

Sectors are broad groups assigned by hand (the page's own labels are free text, 162 of them); the study uses them for
sector context.
"""
import json, re, sys, collections, pathlib

IN_SECTOR = {
 'IT': 'TCS INFY HCLTECH WIPRO TECHM PERSISTENT TATAELXSI MAPMYINDIA REDINGTON TATACOMM YASHIND',
 'Healthcare': 'SUNPHARMA DRREDDY CIPLA DIVISLAB ALKEM LAURUSLABS GRANULES SYNGENE MAXHEALTH KRSNAA METROPOLIS MEDPLUS POLYMED',
 'Consumer': 'MARICO DABUR GODREJCP EMAMILTD JYOTHYLAB ASIANPAINT SIYARAM KPRMILL',
 'Chemicals': 'AARTIIND ANURAS DEEPAKNTR NAVINFLUOR SRF VINATIORGA SHREEPUSHK PIDILITIND PIIND BAYERCROP RALLIS SUMICHEM COROMANDEL KSCL',
 'Capital goods': 'ABB SIEMENS CGPOWER CUMMINSIND THERMAX HAVELLS POLYCAB KEI APARINDS VOLTAMP TRSF HIRECT GENUSPOWER KEC TEXRAIL BEML CARBORUNIV GREAVESCOT WABAG IONEXCHANG MTARTECH APLAPOLLO ASTRAL',
 'Electronics': 'DIXON AMBER KAYNES PGEL BLUESTAR VOLTAS CYIENTDLM',
 'Auto': 'BHARATFORG MOTHERSON SONACOMS UNOMINDA MINDACORP EXIDEIND OLECTRA TIINDIA',
 'Energy & metals': 'COALINDIA SUZLON WAAREEENER PREMIERENE BORORENEW KPEL SARDAEN JAIBALAJI MAANALUM',
 'Logistics': 'CONCOR BLUEDART TCIEXP DELHIVERY',
}
# the page's own key -> the NSE code Yahoo lists it under, where they differ (first one that matches the page's prices wins)
IN_ALIAS = {'BLUESTAR': ['BLUESTARCO'], 'MAANALUM': ['MAANALU'], 'SIYARAM': ['SIYSIL'], 'TRSF': ['TARIL', 'TRIL', 'TECHNOE'], 'YASHIND': ['NETWEB'], 'HIRECT': ['HIRECT']}

US = {
 'Technology': 'AAPL MSFT NVDA AVGO AMD QCOM TXN AMAT LRCX MU ADBE CRM NOW INTU CSCO ACN',
 'Communication': 'GOOGL META',
 'Consumer discretionary': 'AMZN TSLA HD LOW NKE TJX',
 'Consumer staples': 'PG CL KMB MDLZ',
 'Healthcare': 'LLY JNJ MRK ABBV ABT TMO DHR ISRG SYK MDT',
 'Industrials': 'UNP UPS EMR ETN',
 'Energy': 'XOM CVX COP SLB',
 'Materials': 'LIN ECL APD NEM',
}

def main():
    page = pathlib.Path(sys.argv[1]).read_text(encoding='utf-8')
    items = re.findall(r"\{n:'((?:[^'\\]|\\.)*)',t:'([A-Z0-9&\-]+)',w:[\d.]+,s:'(?:[^'\\]|\\.)*'\}", page)
    names = collections.OrderedDict()
    for n, t in items: names.setdefault(t, n.replace("\\'", "'"))
    prices = json.loads(re.search(r"const PRICES = (\{.*?\});\s*\n", page, re.S).group(1))
    sec = {t: s for s, ts in IN_SECTOR.items() for t in ts.split()}
    missing = [t for t in names if t not in sec]; extra = [t for t in sec if t not in names]
    assert not missing and not extra, (missing, extra)
    india = [{'key': t, 'name': names[t], 'sector': sec[t], 'yahoo': [c + '.NS' for c in IN_ALIAS.get(t, [t])],
              'check': {y: prices[t][y] for y in ('2025', '2026') if y in prices[t]}} for t in sorted(names)]
    us = [{'key': t, 'sector': s, 'yahoo': [t]} for s, ts in US.items() for t in ts.split()]
    assert len(us) == 50 and len({x['key'] for x in us}) == 50
    out = {'_comment': 'Built by research/stocks/build_universe.py. India: the 97 stocks on the HalalVest page. US: 50 hand-picked large names; '
                       'their Shariah compliance is NOT verified here.',
           'context': {'us': {'index': '^GSPC', 'vix': '^VIX'}, 'in': {'index': '^BSESN', 'index2': '^NSEI', 'vix': '^INDIAVIX'}},
           'us': us, 'in': india}
    dst = pathlib.Path(__file__).with_name('universe.json')
    dst.write_text(json.dumps(out, indent=1, ensure_ascii=False) + '\n', encoding='utf-8')
    print(f"{dst}: {len(us)} US, {len(india)} India; sectors US {collections.Counter(x['sector'] for x in us).most_common()}; India {collections.Counter(x['sector'] for x in india).most_common()}")

if __name__ == '__main__':
    main()
