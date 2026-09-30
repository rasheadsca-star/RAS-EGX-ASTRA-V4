// ASTRA V4 EGX Live Provider
// Free public-market-data fallback using Yahoo Finance chart data.
// Yahoo's EGX feed is delayed; upstream availability is always explicit.

const WATCHLIST = ['COMI', 'SWDY', 'FWRY', 'TMGH', 'HRHO'];
const YAHOO_SYMBOLS = Object.fromEntries(
  WATCHLIST.map((symbol) => [symbol, symbol + '.CA'])
);
const REQUEST_TIMEOUT_MS = 8000;

function emptyQuote(symbol) {
  return {
    symbol,
    price: 0,
    change: 0,
    changePercent: 0,
    previousClose: 0,
    volume: 0,
    high: 0,
    low: 0,
    timestamp: new Date().toISOString(),
    source: 'YAHOO_FINANCE_DELAYED',
    delayed: true
  };
}

async function fetchYahooQuote(symbol) {
  const yahooSymbol = YAHOO_SYMBOLS[symbol] || symbol + '.CA';
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' +
    encodeURIComponent(yahooSymbol) +
    '?range=1d&interval=1m&includePrePost=false';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'ASTRA-V4/1.0' },
      signal: controller.signal
    });

    if (!response.ok) return emptyQuote(symbol);

    const payload = await response.json();
    const result = payload?.chart?.result?.[0];
    const meta = result?.meta || {};
    const timestamps = result?.timestamp || [];
    const quote = result?.indicators?.quote?.[0] || {};
    const closes = quote.close || [];
    const highs = quote.high || [];
    const lows = quote.low || [];
    const volumes = quote.volume || [];

    let lastIndex = -1;
    for (let i = closes.length - 1; i >= 0; i -= 1) {
      if (Number.isFinite(Number(closes[i]))) {
        lastIndex = i;
        break;
      }
    }

    if (lastIndex < 0) return emptyQuote(symbol);

    const price = Number(closes[lastIndex]);
    const previousClose = Number(
      meta.previousClose ?? meta.chartPreviousClose ?? 0
    );
    const change = previousClose > 0 ? price - previousClose : 0;
    const changePercent = previousClose > 0
      ? (change / previousClose) * 100
      : 0;

    return {
      symbol,
      price,
      change,
      changePercent,
      previousClose,
      volume: Number(volumes[lastIndex] || 0),
      high: Number(highs[lastIndex] || price),
      low: Number(lows[lastIndex] || price),
      timestamp: timestamps[lastIndex]
        ? new Date(Number(timestamps[lastIndex]) * 1000).toISOString()
        : new Date().toISOString(),
      source: 'YAHOO_FINANCE_DELAYED',
      delayed: true
    };
  } catch (_) {
    return emptyQuote(symbol);
  } finally {
    clearTimeout(timeout);
  }
}

const egxLiveProvider = {
  name: 'YAHOO_FINANCE_DELAYED',

  async fetchQuotes() {
    const quotes = await Promise.all(WATCHLIST.map(fetchYahooQuote));
    return quotes.filter((quote) => quote.price > 0);
  },

  async getQuotes() {
    return this.fetchQuotes();
  }
};

module.exports = { egxLiveProvider };
