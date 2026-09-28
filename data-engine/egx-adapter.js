// ASTRA V4 EGX Data Adapter
// Provider abstraction layer for live EGX market snapshots.

function normalizeQuote(quote = {}) {
  return {
    symbol: quote.symbol || null,
    price: Number(quote.price || 0),
    change: Number(quote.change || 0),
    volume: Number(quote.volume || 0),
    high: Number(quote.high || 0),
    low: Number(quote.low || 0),
    timestamp: quote.timestamp || new Date().toISOString()
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
    status: 'CONNECTED',
    source: provider.name || 'EGX_PROVIDER',
    quotes: quotes.map(normalizeQuote),
    timestamp: new Date().toISOString()
  };
}

module.exports = { normalizeQuote, getMarketSnapshot };
