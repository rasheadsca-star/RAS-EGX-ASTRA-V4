// ASTRA V4 Runtime Pipeline
// Connects market snapshot -> analyzer -> recommendation engine.

const { analyze } = require('./analysis-engine/runtime-analyzer');
const { generateRecommendation } = require('./recommendation-engine/runtime-recommender');

function buildRuntimeRecommendations(snapshot) {
  const quotes = snapshot?.quotes || [];

  if (!quotes.length) {
    return {
      generatedAt: new Date().toISOString(),
      recommendations: [],
      status: 'WAITING_FOR_MARKET_DATA'
    };
  }

  const analysis = analyze({
    symbols: quotes.map((quote) => ({
      symbol: quote.symbol,
      price: quote.price,
      changePercent: quote.change,
      volume: quote.volume
    }))
  });

  return {
    status: 'READY',
    ...generateRecommendation(analysis)
  };
}

module.exports = { buildRuntimeRecommendations };
