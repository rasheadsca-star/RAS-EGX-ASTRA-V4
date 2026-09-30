// ASTRA V4 Runtime Trade Calculator
// Produces direction-aware entry, targets, stop loss and risk/reward data.

function calculateTrade({ price, confidence = 0, direction = 'BUY' }) {
  const numericPrice = Number(price);

  if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
    return {
      status: 'INVALID',
      reason: 'Invalid price input'
    };
  }

  const riskPercent = confidence >= 80 ? 0.03 : confidence >= 60 ? 0.02 : 0.01;
  const entry = Number(numericPrice.toFixed(2));

  if (direction === 'SELL') {
    const stopLoss = Number((entry * (1 + riskPercent)).toFixed(2));
    const target1 = Number((entry * (1 - riskPercent * 2)).toFixed(2));
    const target2 = Number((entry * (1 - riskPercent * 4)).toFixed(2));
    const risk = stopLoss - entry;

    return {
      status: 'READY',
      direction: 'SELL',
      entry,
      target1,
      target2,
      stopLoss,
      riskReward: risk > 0
        ? Number(((entry - target1) / risk).toFixed(2))
        : null
    };
  }

  const stopLoss = Number((entry * (1 - riskPercent)).toFixed(2));
  const target1 = Number((entry * (1 + riskPercent * 2)).toFixed(2));
  const target2 = Number((entry * (1 + riskPercent * 4)).toFixed(2));
  const risk = entry - stopLoss;

  return {
    status: 'READY',
    direction: 'BUY',
    entry,
    target1,
    target2,
    stopLoss,
    riskReward: risk > 0
      ? Number(((target1 - entry) / risk).toFixed(2))
      : null
  };
}

module.exports = { calculateTrade };
