const fallbackSnapshot = [
  {
    symbol: 'EGX_SAMPLE',
    signal: 'WATCH',
    entry: null,
    target1: null,
    target2: null,
    stopLoss: null,
    confidence: 0
  }
];

export function getRecommendations(snapshot = fallbackSnapshot) {
  return snapshot.map(stock => ({
    symbol: stock.symbol,
    signal: stock.signal || 'WATCH',
    entry: stock.entry ?? null,
    target1: stock.target1 ?? null,
    target2: stock.target2 ?? null,
    stopLoss: stock.stopLoss ?? null,
    confidence: stock.confidence ?? 0
  }));
}

export default async function handler(req, res) {
  const recommendations = getRecommendations();

  res.status(200).json({
    success: true,
    updatedAt: new Date().toISOString(),
    count: recommendations.length,
    recommendations
  });
}
