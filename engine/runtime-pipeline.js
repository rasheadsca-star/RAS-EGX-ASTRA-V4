// ASTRA V4 Runtime Pipeline
// Connects EGX data + historical engine -> analyzer -> recommendation engine.

const { analyze } = require('./analysis-engine/runtime-analyzer');
const { generateRecommendation } = require('./recommendation-engine/runtime-recommender');
const { loadLegacyHistory } = require('../data-engine/history/legacy-history-provider');

async function loadSnapshot() {
  try {
    const provider = await import('../data-engine/providers/egx-data-provider.js');
    const provided = await provider.getEGXSnapshot();

    if (provided) return provided;
  } catch (e) {}

  try {
    const source = require('../data/egx-snapshot.json');
    return source || { quotes: [] };
  } catch (e) {
    return { quotes: [] };
  }
}

function normalizeSymbols(quotes = []) {
  return quotes.map((quote) => ({
    symbol: quote.symbol,
    price: quote.price,
    changePercent: quote.change,
    volume: quote.volume
  }));
}

async async function buildRuntimeRecommendations(snapshot) {
  const quotes = snapshot?.quotes || [];

  const histories = await loadLegacyHistory();

  if (!quotes.length && !Object.keys(histories).length) {
    return {
      generatedAt: new Date().toISOString(),
      recommendations: [],
      status: 'WAITING_FOR_MARKET_DATA',
      mode: 'WAITING_FOR_DATA'
    };
  }

  const analysis = analyze({
    symbols: normalizeSymbols(quotes),
    histories
  });

  return {
    status: 'READY',
    generatedAt: new Date().toISOString(),
    mode: quotes.length ? 'MIXED_MODE' : 'HISTORY_MODE',
    ...generateRecommendation(analysis)
  };
}

async function runRuntimePipeline() {
  const snapshot = await loadSnapshot();
  return buildRuntimeRecommendations(snapshot);
}

module.exports = {
  buildRuntimeRecommendations,
  runRuntimePipeline
};
const { loadLegacyHistory } = require('../data-engine/history/legacy-history-provider');
