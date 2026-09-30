// ASTRA V4 Recommendation Runtime
// Converts analyzer output into a stable recommendation contract.

const { generateSignal } = require('./signal-generator');
const { calculateTrade } = require('./trade-calculator-runtime');

function generateRecommendation(analysis) {
  const ranked = (analysis?.results || [])
    .map((item) => {
      const technicalScore = Number(item.technicalScore || 0);
      const riskLevel = item.riskLevel || 'MEDIUM';

      const tradePlan = calculateTrade({
        price: Number(item.price || 0),
        confidence: technicalScore
      });

      const signal = generateSignal({
        symbol: item.symbol,
        analysis: item,
        risk: { level: riskLevel },
        trade: tradePlan
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
        }
      };
    })
    .sort((a, b) => b.confidence - a.confidence);

  return {
    generatedAt: new Date().toISOString(),
    recommendations: ranked
  };
}

module.exports = { generateRecommendation };
