const { getMarketSnapshot } = require('../../data-engine/egx-adapter.js');
const { egxLiveProvider } = require('../../data-engine/providers/egx-live-provider.js');
const { runRuntimePipeline } = require('../../engine/runtime-pipeline.js');

async function handler(req, res) {
  const now = new Date().toISOString();

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');

  try {
    const snapshot = await getMarketSnapshot(egxLiveProvider);
    const pipeline = await runRuntimePipeline();
    const hasRealQuotes = snapshot.quotes.some((q) => q.price > 0);

    return res.status(200).json({
      success: true,
      market: 'EGX',
      dataEngine: 'READY',
      pipeline: pipeline.status || 'UNKNOWN',
      liveFeed: hasRealQuotes ? 'CONNECTED' : 'WAITING_FOR_SOURCE',
      source: snapshot.source,
      snapshot: hasRealQuotes ? 'READY' : 'WAITING',
      quoteCount: snapshot.quotes.length,
      checkedAt: now,
      snapshotTime: snapshot.timestamp,
      recommendationsReady: Array.isArray(pipeline.recommendations) && pipeline.recommendations.length > 0,
      message: hasRealQuotes
        ? 'ASTRA received verified market quotes.'
        : 'ASTRA provider connected but real EGX quotes are not available yet.'
    });
  } catch (error) {
    return res.status(200).json({
      success: false,
      market: 'EGX',
      dataEngine: 'ERROR',
      pipeline: 'ERROR',
      liveFeed: 'UNKNOWN',
      quoteCount: 0,
      checkedAt: now,
      recommendationsReady: false,
      message: 'ASTRA health check failed safely.',
      error: error?.message || 'Unknown runtime error'
    });
  }
}

module.exports = handler;
