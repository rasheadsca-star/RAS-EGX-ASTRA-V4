// ASTRA V4 System Health Endpoint
// Aggregates provider, pipeline, and recommendation health.

import { runRuntimePipeline } from '../../engine/runtime-pipeline.js';
import { getMarketSnapshot } from '../../data-engine/egx-adapter.js';
import { egxLiveProvider } from '../../data-engine/providers/egx-live-provider.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');

  const checkedAt = new Date().toISOString();

  try {
    const snapshot = await getMarketSnapshot(egxLiveProvider);
    const pipeline = await runRuntimePipeline();

    const hasQuotes = snapshot.quotes.some((q) => q.price > 0);

    return res.status(200).json({
      success: true,
      system: 'ASTRA_V4',
      checkedAt,
      dataEngine: snapshot.status,
      liveFeed: hasQuotes ? 'CONNECTED' : 'WAITING_FOR_SOURCE',
      pipeline: pipeline.status || 'UNKNOWN',
      recommendations: pipeline.recommendations?.length || 0,
      healthy: true
    });
  } catch (error) {
    return res.status(200).json({
      success: false,
      system: 'ASTRA_V4',
      checkedAt,
      healthy: false,
      error: error.message
    });
  }
}
