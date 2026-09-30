// ASTRA V4 Signal Generator
// Converts explainable analysis + risk + trade plan into a stable recommendation contract.

function generateSignal({ symbol, analysis = {}, risk = {}, trade = {} }) {
  const score = Number(analysis.technicalScore ?? 0);
  const riskLevel = risk.level || analysis.riskLevel || 'UNKNOWN';
  const validTrade = trade?.status === 'READY' && Number(trade?.entry) > 0;

  let signal = 'HOLD';

  if (!validTrade || riskLevel === 'UNKNOWN') {
    signal = 'HOLD';
  } else if (score >= 75 && riskLevel !== 'HIGH') {
    signal = 'BUY';
  } else if (score < 45) {
    signal = 'SELL';
  }

  return {
    symbol,
    signal,
    entry: trade?.entry ?? null,
    target1: trade?.target1 ?? null,
    target2: trade?.target2 ?? null,
    stopLoss: trade?.stopLoss ?? null,
    confidence: Math.round(score),
    riskLevel,
    generatedAt: new Date().toISOString()
  };
}

module.exports = { generateSignal };
