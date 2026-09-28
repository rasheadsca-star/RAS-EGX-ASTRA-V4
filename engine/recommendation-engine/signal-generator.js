// ASTRA V4 Signal Generator

function generateSignal(stock) {
  const rank = stock.rank || 0;

  if (rank >= 80) return 'STRONG';
  if (rank >= 60) return 'WATCH';
  return 'NO_SIGNAL';
}

module.exports = { generateSignal };
