// ASTRA V4 EGX Live Provider
// Production-ready provider contract.
// Replace fetch source with authenticated EGX market feed when available.

const WATCHLIST = [
  'COMI',
  'SWDY',
  'FWRY',
  'TMGH',
  'HRHO'
];

function createEmptyQuote(symbol) {
  return {
    symbol,
    price: 0,
    change: 0,
    volume: 0,
    high: 0,
    low: 0,
    timestamp: new Date().toISOString()
  };
}

const egxLiveProvider = {
  name: 'EGX_LIVE_PROVIDER',

  async fetchQuotes() {
    return WATCHLIST.map(createEmptyQuote);
  }
};

module.exports = { egxLiveProvider };
