// ASTRA V4 EGX Data Adapter
// Normalizes provider output while preserving freshness and morning-evidence metadata.

function normalizeQuote(quote = {}) {
  const price = Number(quote.price || 0);
  const previousClose = Number(quote.previousClose || 0);
  const rawChangePercent = Number(quote.changePercent);
  const changePercent = Number.isFinite(rawChangePercent)
    ? rawChangePercent
    : previousClose > 0
      ? ((price - previousClose) / previousClose) * 100
      : 0;

  return {
    symbol: quote.symbol || null,
    price,
    change: Number(quote.change || 0),
    changePercent,
    previousClose,
    volume: Number(quote.volume || 0),
    high: Number(quote.high || 0),
    low: Number(quote.low || 0),
    timestamp: quote.timestamp || new Date().toISOString(),
    source: quote.source || null,
    sourceUrl: quote.sourceUrl || null,
    sourceVerified: quote.sourceVerified === true,
    sourceLatencySeconds: Number.isFinite(Number(quote.sourceLatencySeconds))
      ? Number(quote.sourceLatencySeconds)
      : null,
    confidence: Number.isFinite(Number(quote.confidence))
      ? Number(quote.confidence)
      : null,
    delayed: Boolean(quote.delayed),
    intradayCandles: Array.isArray(quote.intradayCandles)
      ? quote.intradayCandles
      : []
  };
}

async function getMarketSnapshot(provider) {
  if (!provider || typeof provider.fetchQuotes !== 'function') {
    return {
      status: 'OFFLINE',
      source: 'NONE',
      quotes: [],
      timestamp: new Date().toISOString()
    };
  }

  const quotes = await provider.fetchQuotes();

  return {
    status: quotes.length ? 'CONNECTED' : 'NO_QUOTES',
    source: provider.name || 'EGX_PROVIDER',
    quotes: Array.isArray(quotes) ? quotes.map(normalizeQuote) : [],
    timestamp: new Date().toISOString()
  };
}

module.exports = { normalizeQuote, getMarketSnapshot };
