// ASTRA V4 Analysis Runtime
// Calculates a normalized analysis result from validated market snapshots.

function analyze(snapshot) {
  const symbols = snapshot?.symbols || [];

  const results = symbols.map((item) => {
    const price = Number(item.price || 0);
    const change = Number(item.changePercent || 0);
    const volume = Number(item.volume || 0);

    const momentum = Math.max(0, Math.min(100, 50 + change * 5));
    const liquidity = Math.min(100, volume > 0 ? 80 : 30);
    const trend = price > 0 ? 60 : 0;

    const technicalScore = Math.round(
      momentum * 0.4 + liquidity * 0.3 + trend * 0.3
    );

    return {
      symbol: item.symbol,
      momentum,
      liquidity,
      trend,
      technicalScore
    };
  });

  return {
    analyzedAt: new Date().toISOString(),
    results
  };
}

module.exports = { analyze };
