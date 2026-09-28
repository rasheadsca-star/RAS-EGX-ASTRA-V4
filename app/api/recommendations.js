const { runRuntimePipeline } = require('../../engine/runtime-pipeline.js');

function getRecommendations(snapshot = []) {
  return snapshot.map(stock => ({
    symbol: stock.symbol,
    signal: stock.signal || 'WATCH',
    entry: stock.entry ?? null,
    target1: stock.target1 ?? null,
    target2: stock.target2 ?? null,
    stopLoss: stock.stopLoss ?? null,
    confidence: stock.confidence ?? 0,
    riskLevel: stock.riskLevel || 'UNKNOWN'
  }));
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');

  try {
    const pipeline = await runRuntimePipeline();

    if (!pipeline || pipeline.status !== 'READY') {
      return res.status(200).json({
        success: true,
        market: 'EGX',
        status: pipeline?.status || 'NO_LIVE_SNAPSHOT',
        updatedAt: new Date().toISOString(),
        count: 0,
        recommendations: []
      });
    }

    const recommendations = getRecommendations(pipeline.recommendations || []);

    return res.status(200).json({
      success: true,
      market: 'EGX',
      status: 'LIVE',
      updatedAt: pipeline.generatedAt,
      count: recommendations.length,
      recommendations
    });
  } catch (error) {
    return res.status(200).json({
      success: false,
      market: 'EGX',
      status: 'PIPELINE_ERROR',
      updatedAt: new Date().toISOString(),
      count: 0,
      recommendations: [],
      error: error?.message || 'Unknown runtime error'
    });
  }
}
