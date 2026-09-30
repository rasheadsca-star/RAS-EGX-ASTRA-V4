// ASTRA V4 Recommendation Runtime
// Entry-only recommendation engine.
// Bearish/weak setups remain in the watchlist and are never emitted as SELL entries.

const { generateSignal } = require('./signal-generator');
const { calculateTrade } = require('./trade-calculator-runtime');

const ENTRY_SCORE_MINIMUM = 75;

function qualifiesForEntry(analysis = {}) {
  const score = Number(analysis.technicalScore || 0);

  return (
    score >= ENTRY_SCORE_MINIMUM &&
    analysis.riskLevel !== 'HIGH' &&
    Number(analysis.momentum || 0) >= 60 &&
    Number(analysis.trend || 0) >= 60 &&
    Number(analysis.liquidity || 0) >= 50 &&
    Number(analysis.volatility || 0) >= 45
  );
}

function classifySignal(analysis = {}) {
  return qualifiesForEntry(analysis) ? 'BUY' : 'WATCH';
}

function buildItem(item) {
  const technicalScore = Number(item.technicalScore || 0);
  const riskLevel = item.riskLevel || 'MEDIUM';
  const entryOpportunity = qualifiesForEntry(item);

  const tradePlan = entryOpportunity
    ? calculateTrade({
        price: Number(item.price || 0),
        confidence: technicalScore,
        direction: 'BUY',
        atr14: Number(item.atr14 || 0),
        recentLow20: Number(item.recentLow20 || 0)
      })
    : {
        status: 'NOT_ELIGIBLE',
        reason: 'Entry criteria not met'
      };

  const execution = {
    dataFresh: item.dataFreshness?.status === 'FRESH',
    priceMatched: item.priceMatched === true,
    morningGateConfirmed: item.morningGate?.confirmed === true,
    liveData: item.dataFreshness?.status === 'FRESH'
  };

  const signal = generateSignal({
    symbol: item.symbol,
    analysis: item,
    risk: { level: riskLevel },
    trade: tradePlan,
    execution,
    entryOpportunity: entryOpportunity && tradePlan.status === 'READY'
  });

  return {
    ...signal,
    analysis: {
      technicalScore,
      momentum: item.momentum,
      trend: item.trend,
      liquidity: item.liquidity,
      volatility: item.volatility,
      volatilityPct: item.volatilityPct,
      fiveDayChangePct: item.fiveDayChangePct,
      twentyDayChangePct: item.twentyDayChangePct,
      historySessions: item.historySessions,
      latestVolume: item.latestVolume,
      averageVolume20: item.averageVolume20,
      atr14: item.atr14,
      recentLow20: item.recentLow20,
      recentHigh20: item.recentHigh20
    },
    dataFreshness: item.dataFreshness,
    priceMatched: item.priceMatched,
    morningGate: item.morningGate,
    morningEvidence: item.morningEvidence,
    sessionPhase: item.sessionPhase,
    execution
  };
}

function generateRecommendation(analysis) {
  const evaluated = (analysis?.results || [])
    .map(buildItem)
    .sort((a, b) => b.confidence - a.confidence);

  const recommendations = evaluated.filter(
    (item) => item.signal === 'BUY' && item.entryOpportunity === true
  );

  const watchlist = evaluated.filter(
    (item) => item.signal !== 'BUY'
  );

  return {
    generatedAt: new Date().toISOString(),
    recommendations,
    watchlist
  };
}

module.exports = {
  ENTRY_SCORE_MINIMUM,
  qualifiesForEntry,
  generateRecommendation,
  classifySignal
};
