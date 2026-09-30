const { runRuntimePipeline } = require('../../engine/runtime-pipeline.js');

function getRecommendations(snapshot = []) {
  return snapshot.map((stock) => ({
    symbol: stock.symbol,
    signal: stock.signal || 'HOLD',
    entry: stock.entry ?? null,
    target1: stock.target1 ?? null,
    target2: stock.target2 ?? null,
    stopLoss: stock.stopLoss ?? null,
    confidence: stock.confidence ?? 0,
    riskLevel: stock.riskLevel || 'UNKNOWN',
    executionReady: stock.executionReady === true,
    executionMode: stock.executionMode || 'PAPER_ONLY',
    executionBlockers: stock.executionBlockers || [],
    dataFreshness: stock.dataFreshness || null,
    priceMatched: stock.priceMatched === true,
    morningGate: stock.morningGate || null,
    morningEvidence: stock.morningEvidence || null,
    sessionPhase: stock.sessionPhase || null,
    analysis: stock.analysis || null
  }));
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');

  try {
    const pipeline = await runRuntimePipeline();

    if (!pipeline || pipeline.status === 'NO_DATA') {
      return res.status(200).json({
        success: true,
        market: 'EGX',
        status: 'NO_DATA',
        mode: 'NO_DATA',
        dataSource: 'NONE',
        deploymentCommit: process.env.VERCEL_GIT_COMMIT_SHA || null,
        updatedAt: new Date().toISOString(),
        count: 0,
        recommendations: []
      });
    }

    const recommendations = getRecommendations(
      pipeline.recommendations || []
    );

    const status = pipeline.liveQuoteCount > 0
      ? 'LIVE_READY'
      : 'HISTORICAL_READY';

    return res.status(200).json({
      success: true,
      market: 'EGX',
      status,
      mode: pipeline.mode,
      dataSource: pipeline.dataSource,
      deploymentCommit: process.env.VERCEL_GIT_COMMIT_SHA || null,
      updatedAt: pipeline.generatedAt,
      count: recommendations.length,
      symbolsAnalyzed: pipeline.symbolsAnalyzed || 0,
      morningConfirmedCount: pipeline.morningConfirmedCount || 0,
      executionReadyCount: pipeline.executionReadyCount || 0,
      recommendations
    });
  } catch (error) {
    return res.status(200).json({
      success: false,
      market: 'EGX',
      status: 'ERROR',
      deploymentCommit: process.env.VERCEL_GIT_COMMIT_SHA || null,
      updatedAt: new Date().toISOString(),
      count: 0,
      recommendations: [],
      error: error?.message || 'Unknown runtime error'
    });
  }
}

module.exports = handler;
