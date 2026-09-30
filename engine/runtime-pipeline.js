// ASTRA V4 Runtime Pipeline
// Live EGX data with validated historical fallback -> normalized snapshot -> analyzer -> recommendations.

const { getMarketSnapshot } = require('../data-engine/egx-adapter');
const { egxLiveProvider } = require('../data-engine/providers/egx-live-provider');
const { analyze } = require('./analysis-engine/runtime-analyzer');
const { generateRecommendation } = require('./recommendation-engine/runtime-recommender');
const { loadLegacyHistory } = require('../data-engine/history/legacy-history-provider');

function normalizeLiveQuote(quote = {}) {
  const price = Number(quote.price || 0);
  const previousClose = Number(quote.previousClose || 0);
  const explicitChangePercent = Number(quote.changePercent);
  const changePercent = Number.isFinite(explicitChangePercent)
    ? explicitChangePercent
    : previousClose > 0
      ? ((price - previousClose) / previousClose) * 100
      : 0;

  return {
    symbol: quote.symbol,
    price,
    changePercent,
    volume: Number(quote.volume || 0),
    high: Number(quote.high || 0),
    low: Number(quote.low || 0),
    source: quote.source || 'LIVE'
  };
}

function getLatestHistory(history = []) {
  const valid = history
    .filter((row) => row && Number(row.close) > 0)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  if (!valid.length) return null;

  const latest = valid[valid.length - 1];
  const previous = valid[valid.length - 2] || latest;
  const previousClose = Number(previous.close || 0);
  const close = Number(latest.close || 0);

  return {
    symbol: latest.ticker || null,
    price: close,
    changePercent: previousClose > 0
      ? ((close - previousClose) / previousClose) * 100
      : 0,
    volume: Number(latest.volume || 0),
    high: Number(latest.high || close),
    low: Number(latest.low || close),
    source: latest.primarySource || 'LEGACY_HISTORY'
  };
}

function buildNormalizedSymbols(liveQuotes, histories) {
  const bySymbol = new Map();

  for (const quote of liveQuotes || []) {
    if (quote?.symbol) {
      bySymbol.set(quote.symbol, normalizeLiveQuote(quote));
    }
  }

  for (const [symbol, history] of Object.entries(histories || {})) {
    if (!bySymbol.has(symbol)) {
      const latest = getLatestHistory(history);
      if (latest) {
        latest.symbol = symbol;
        bySymbol.set(symbol, latest);
      }
    }
  }

  return Array.from(bySymbol.values());
}

async function loadLiveSnapshot() {
  try {
    return await getMarketSnapshot(egxLiveProvider);
  } catch (error) {
    return {
      status: 'ERROR',
      source: 'YAHOO_FINANCE_DELAYED',
      quotes: [],
      timestamp: new Date().toISOString(),
      error: error?.message || 'Live provider failed'
    };
  }
}

async function buildRuntimeRecommendations(snapshot = {}) {
  const liveSnapshot = snapshot?.liveSnapshot || snapshot;
  const liveQuotes = Array.isArray(liveSnapshot?.quotes)
    ? liveSnapshot.quotes.filter((quote) => Number(quote?.price) > 0)
    : [];

  const histories = snapshot?.histories || await loadLegacyHistory();
  const normalizedSymbols = buildNormalizedSymbols(liveQuotes, histories);

  if (!normalizedSymbols.length) {
    return {
      generatedAt: new Date().toISOString(),
      recommendations: [],
      status: 'NO_DATA',
      mode: 'NO_DATA',
      dataSource: 'NONE'
    };
  }

  const analysis = analyze({
    symbols: normalizedSymbols,
    histories
  });

  const recommendations = generateRecommendation(analysis);
  const historyAvailable = Object.values(histories).some(
    (rows) => Array.isArray(rows) && rows.length > 0
  );

  const hasLive = liveQuotes.length > 0;

  return {
    status: 'READY',
    generatedAt: new Date().toISOString(),
    mode: hasLive && historyAvailable
      ? 'MIXED_MODE'
      : hasLive
        ? 'LIVE_MODE'
        : 'HISTORY_MODE',
    dataSource: hasLive
      ? historyAvailable ? 'LIVE_PLUS_HISTORY' : 'LIVE'
      : 'HISTORICAL',
    symbolsAnalyzed: normalizedSymbols.length,
    liveQuoteCount: liveQuotes.length,
    historyCount: Object.values(histories).filter((rows) => Array.isArray(rows) && rows.length > 0).length,
    historySymbols: Object.entries(histories).filter(([, rows]) => Array.isArray(rows) && rows.length > 0).map(([symbol]) => symbol),
    liveSource: liveSnapshot?.source || 'NONE',
    ...recommendations
  };
}

async function runRuntimePipeline() {
  const liveSnapshot = await loadLiveSnapshot();
  const histories = await loadLegacyHistory();

  return buildRuntimeRecommendations({
    liveSnapshot,
    histories
  });
}

module.exports = {
  buildRuntimeRecommendations,
  runRuntimePipeline,
  buildNormalizedSymbols,
  getLatestHistory
};
