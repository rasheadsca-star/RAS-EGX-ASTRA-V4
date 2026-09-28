// ASTRA V4 Recommendation Runtime

const { generateSignal } = require('./signal-generator');
const { calculateTradePlan } = require('./trade-calculator-runtime');

function generateRecommendation(analysis) {
  const ranked = (analysis?.results || []).map((item) => {
    const technicalScore = item.technicalScore || 0;
    const riskLevel = item.riskLevel || 'MEDIUM';

    const tradePlan = calculateTradePlan({
      price: item.price,
      score: technicalScore,
      riskLevel
    });

    const signal = generateSignal({
      rank: technicalScore,
      technicalScore,
      riskLevel,
      tradePlan
    });

    return {
      symbol: item.symbol,
      signal,
      confidence: technicalScore,
      riskLevel,
      ...tradePlan
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    recommendations: ranked
  };
}

module.exports = { generateRecommendation };
