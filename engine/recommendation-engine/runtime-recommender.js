// ASTRA V4 Recommendation Runtime
// Converts analyzer output into a stable recommendation contract.

const { generateSignal } = require('./signal-generator');
const { calculateTrade } = require('./trade-calculator-runtime');

function classifySignal(analysis = {}) {
  const score = Number(analysis.technicalScore || 0);
  const riskLevel = analysis.riskLevel || 'UNKNOWN';

  if (score >= 75 && riskLevel !== 'HIGH') return 'BUY';
  if (score < 45) return 'SELL';
  return 'HOLD';
}

function generateRecommendation(analysis) {
  const ranked = (analysis?.results || [])
    .map((item) => {
      const technicalScore = Number(item.technicalScore || 0);
      const riskLevel = item.riskLevel || 'MEDIUM';
      const provisionalSignal = classifySignal(item);
      const direction = provisionalSignal === 'SELL' ? 'SELL' : 'BUY';

      const tradePlan = calculateTrade({
        price: Number(item.price || 0),
        confidence: technicalScore,
        direction
      });

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
        execution
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
          averageVolume20: item.averageVolume20
        },
        dataFreshness: item.dataFreshness,
        priceMatched: item.priceMatched,
        morningGate: item.morningGate,
        morningEvidence: item.morningEvidence,
        sessionPhase: item.sessionPhase,
        execution
      };
    })
    .sort((a, b) => b.confidence - a.confidence);

  return {
    generatedAt: new Date().toISOString(),
    recommendations: ranked
  };
}

module.exports = { generateRecommendation, classifySignal };
