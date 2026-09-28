// ASTRA V4 Recommendation Runtime

const { generateSignal } = require('./signal-generator');
const { calculateTrade } = require('./trade-calculator-runtime');

function generateRecommendation(analysis) {
  const ranked = (analysis?.results || []).map((item) => {
    const technicalScore = item.technicalScore || 0;
    const riskLevel = item.riskLevel || 'MEDIUM';

    const tradePlan = calculateTrade({
      price: item.price,
      confidence: technicalScore
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
