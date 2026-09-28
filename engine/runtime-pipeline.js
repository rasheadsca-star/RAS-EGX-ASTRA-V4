// ASTRA V4 Runtime Pipeline
// Connects EGX data provider -> analyzer -> recommendation engine.

const { analyze } = require('./analysis-engine/runtime-analyzer');
const { generateRecommendation } = require('./recommendation-engine/runtime-recommender');

async function loadSnapshot(){
  try {
    const provider = await import('../data-engine/providers/egx-data-provider.js');
    const provided = await provider.getEGXSnapshot();

    if (provided) return provided;
  } catch(e) {
    // fallback to local snapshot
  }

  try {
    const source = require('../data/egx-snapshot.json');
    return source || { quotes: [] };
  } catch(e){
    return { quotes: [] };
  }
}

function buildRuntimeRecommendations(snapshot) {
  const quotes = snapshot?.quotes || [];

  if (!quotes.length) {
    return {
      generatedAt: new Date().toISOString(),
      recommendations: [],
      status: 'WAITING_FOR_MARKET_DATA',
      mode: snapshot?.mode || 'WAITING_FOR_DATA'
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
    generatedAt: new Date().toISOString(),
    ...generateRecommendation(analysis)
  };
}

async function runRuntimePipeline(){
  const snapshot = await loadSnapshot();
  return buildRuntimeRecommendations(snapshot);
}

module.exports = { buildRuntimeRecommendations, runRuntimePipeline };
