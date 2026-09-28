// ASTRA V4 Recommendation Runtime

function generateRecommendation(analysis) {
  const ranked = (analysis?.results || []).map((item) => {
    const score = item.technicalScore || 0;

    const signal = score >= 75 ? 'BUY' : score >= 55 ? 'WATCH' : 'NO_SIGNAL';

    return {
      symbol: item.symbol,
      signal,
      confidence: score,
      entry: null,
      target1: null,
      target2: null,
      stopLoss: null
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    recommendations: ranked
  };
}

module.exports = { generateRecommendation };
