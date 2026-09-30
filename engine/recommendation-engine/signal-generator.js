// ASTRA V4 Signal Generator
// Converts explainable analysis + risk + trade plan into a stable paper-trade recommendation contract.

function generateSignal({
  symbol,
  analysis = {},
  risk = {},
  trade = {},
  execution = {}
}) {
  const score = Number(analysis.technicalScore ?? 0);
  const riskLevel = risk.level || analysis.riskLevel || 'UNKNOWN';
  const validTrade = trade?.status === 'READY' && Number(trade?.entry) > 0;

  const blockers = [];

  if (!execution.liveData) blockers.push('LIVE_DATA_NOT_FRESH');
  if (!execution.dataFresh) blockers.push('STALE_OR_NONLIVE_DATA');
  if (!execution.priceMatched) blockers.push('PRICE_NOT_MATCHED');
  if (!execution.morningGateConfirmed) blockers.push('MORNING_CONFIRMATION_REQUIRED');

  const executionReady =
    validTrade &&
    riskLevel !== 'UNKNOWN' &&
    execution.liveData === true &&
    execution.dataFresh === true &&
    execution.priceMatched === true &&
    execution.morningGateConfirmed === true;

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
    executionReady,
    executionMode: 'PAPER_ONLY',
    executionBlockers: executionReady ? [] : blockers,
    generatedAt: new Date().toISOString()
  };
}

module.exports = { generateSignal };
