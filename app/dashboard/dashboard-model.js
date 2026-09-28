// ASTRA V4 Dashboard data model
// Normalizes API responses into a stable UI contract.

function normalizeRecommendation(item = {}) {
  return {
    symbol: item.symbol || item.ticker || 'N/A',
    signal: item.signal || item.action || 'WATCH',
    entry: item.entry ?? item.entryPrice ?? null,
    target1: item.target1 ?? item.target ?? null,
    target2: item.target2 ?? null,
    stopLoss: item.stopLoss ?? item.stop ?? null,
    confidence: item.confidence ?? item.score ?? 0,
    risk: item.risk ?? item.riskLevel ?? 'UNKNOWN',
    timestamp: item.timestamp ?? new Date().toISOString()
  };
}

export function buildDashboardState({ health, recommendations }) {
  return {
    health: health || {},
    opportunities: Array.isArray(recommendations)
      ? recommendations.map(normalizeRecommendation)
      : [],
    updatedAt: new Date().toISOString()
  };
}
