const { runRuntimePipeline } = require('../../engine/runtime-pipeline.js');

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');

  const checkedAt = new Date().toISOString();

  try {
    const pipeline = await runRuntimePipeline();
    const liveReady = Number(pipeline.liveQuoteCount || 0) > 0;
    const historyReady = Number(pipeline.historyCount || 0) > 0;

    return res.status(200).json({
      success: true,
      system: 'ASTRA_V4',
      checkedAt,
      dataEngine: liveReady || historyReady ? 'READY' : 'NO_DATA',
      liveFeed: liveReady ? 'CONNECTED' : 'WAITING_FOR_SOURCE',
      historicalData: historyReady ? 'CONNECTED' : 'EMPTY',
      pipeline: pipeline.status || 'UNKNOWN',
      mode: pipeline.mode || 'NO_DATA',
      recommendations: pipeline.recommendations?.length || 0,
      healthy: pipeline.status !== 'NO_DATA'
    });
  } catch (error) {
    return res.status(200).json({
      success: false,
      system: 'ASTRA_V4',
      checkedAt,
      healthy: false,
      error: error?.message || 'Unknown runtime error'
    });
  }
}

module.exports = handler;
