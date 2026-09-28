// ASTRA V4 Runtime Trade Calculator
// Generates entry, targets, stop loss and risk reward data.

function calculateTrade({ price, confidence = 0 }) {
  if (!price || price <= 0) {
    return {
      status: 'INVALID',
      reason: 'Invalid price input'
    };
  }

  const riskPercent = confidence >= 80 ? 0.03 : confidence >= 60 ? 0.02 : 0.01;

  const entry = Number(price.toFixed(2));
  const stopLoss = Number((price * (1 - riskPercent)).toFixed(2));
  const target1 = Number((price * (1 + riskPercent * 2)).toFixed(2));
  const target2 = Number((price * (1 + riskPercent * 4)).toFixed(2));

  return {
    status: 'READY',
    entry,
    target1,
    target2,
    stopLoss,
    riskReward: Number(((target1 - entry) / (entry - stopLoss)).toFixed(2))
  };
}

module.exports = { calculateTrade };
