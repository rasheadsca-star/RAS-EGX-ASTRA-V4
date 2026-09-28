// ASTRA V4 Signal Generator
// Final bridge between analysis, risk and trade calculation

function generateSignal({ symbol, analysis, risk, trade }) {
  const score = analysis?.technicalScore ?? 0;
  const riskLevel = risk?.level ?? 'UNKNOWN';

  let signal = 'NO_SIGNAL';

  if (score >= 80 && riskLevel !== 'HIGH') {
    signal = 'BUY';
  } else if (score >= 60) {
    signal = 'WATCH';
  }

  return {
    symbol,
    signal,
    entry: trade?.entry ?? null,
    target1: trade?.target1 ?? null,
    target2: trade?.target2 ?? null,
    stopLoss: trade?.stopLoss ?? null,
    confidence: score,
    riskLevel,
    generatedAt: new Date().toISOString()
  };
}

module.exports = { generateSignal };
