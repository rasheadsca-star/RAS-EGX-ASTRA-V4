const { runRuntimePipeline } = require('../../engine/runtime-pipeline.js');

async function handler(req, res) {
  const now = new Date().toISOString();

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');

  try {
    const pipeline = await runRuntimePipeline();
    const liveReady = Number(pipeline.liveQuoteCount || 0) > 0;
    const historyReady = Number(pipeline.historyCount || 0) > 0;

    const engineStatus =
      pipeline.status === 'NO_DATA'
        ? 'NO_DATA'
        : liveReady
          ? 'LIVE_READY'
          : historyReady
            ? 'HISTORICAL_READY'
            : 'NO_DATA';

    return res.status(200).json({
      success: true,
      market: 'EGX',
      dataEngine: engineStatus,
      engineStatus,
      pipeline: pipeline.status || 'UNKNOWN',
      liveFeed: liveReady ? 'CONNECTED' : 'WAITING_FOR_SOURCE',
      historicalData: historyReady ? 'CONNECTED' : 'EMPTY',
      historicalSymbols: pipeline.historySymbols || [],
      source: pipeline.liveSource || 'NONE',
      snapshot: engineStatus,
      quoteCount: Number(pipeline.liveQuoteCount || 0),
      historyCount: Number(pipeline.historyCount || 0),
      symbolsAnalyzed: Number(pipeline.symbolsAnalyzed || 0),
      morningConfirmedCount: Number(pipeline.morningConfirmedCount || 0),
      executionReadyCount: Number(pipeline.executionReadyCount || 0),
      checkedAt: now,
      snapshotTime: pipeline.generatedAt,
      deploymentCommit: process.env.VERCEL_GIT_COMMIT_SHA || null,
      recommendationsReady:
        Array.isArray(pipeline.recommendations) &&
        pipeline.recommendations.length > 0,
      message:
        engineStatus === 'LIVE_READY'
          ? 'ASTRA received market quotes and validated historical context.'
          : engineStatus === 'HISTORICAL_READY'
            ? 'ASTRA is running from validated historical market data; paper execution remains blocked until fresh price and morning evidence are confirmed.'
            : 'ASTRA has no usable market data.'
    });
  } catch (error) {
    return res.status(200).json({
      success: false,
      market: 'EGX',
      dataEngine: 'ERROR',
      engineStatus: 'ERROR',
      pipeline: 'ERROR',
      liveFeed: 'UNKNOWN',
      historicalData: 'UNKNOWN',
      quoteCount: 0,
      historyCount: 0,
      checkedAt: now,
      deploymentCommit: process.env.VERCEL_GIT_COMMIT_SHA || null,
      recommendationsReady: false,
      message: 'ASTRA health check failed safely.',
      error: error?.message || 'Unknown runtime error'
    });
  }
}

module.exports = handler;
