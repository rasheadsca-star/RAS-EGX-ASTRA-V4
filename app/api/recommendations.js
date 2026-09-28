export function getRecommendations(snapshot = []) {
  return snapshot.map(stock => ({
    symbol: stock.symbol,
    signal: stock.signal || 'WATCH',
    entry: stock.entry || null,
    target1: stock.target1 || null,
    target2: stock.target2 || null,
    stopLoss: stock.stopLoss || null,
    confidence: stock.confidence || 0
  }));
}
