const { getMarketSnapshot } = require('../../data-engine/egx-adapter.js');
const { egxLiveProvider } = require('../../data-engine/providers/egx-live-provider.js');
const { runRuntimePipeline } = require('../../engine/runtime-pipeline.js');

const { loadLegacyHistory } = require('../../data-engine/history/legacy-history-provider.js');

async function handler(req, res) {
  const now = new Date().toISOString();

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');

  try {

    const snapshot = await getMarketSnapshot(egxLiveProvider);

    const pipeline = await runRuntimePipeline();

    const histories = await loadLegacyHistory();

    const hasRealQuotes =
      snapshot.quotes.some((q) => q.price > 0);

    const historySymbols =
      Object.keys(histories).filter(
        (symbol) => histories[symbol]?.length > 0
      );

    const hasHistoricalData =
      historySymbols.length > 0;


    let engineStatus = 'WAITING';


    if (hasRealQuotes) {
      engineStatus = 'LIVE';
    } 
    else if (hasHistoricalData) {
      engineStatus = 'HISTORY_READY';
    }


    return res.status(200).json({

      success: true,

      market: 'EGX',

      dataEngine: 'READY',

      engineStatus,

      pipeline: pipeline.status || 'UNKNOWN',

      liveFeed:
        hasRealQuotes
          ? 'CONNECTED'
          : 'WAITING_FOR_SOURCE',


      historicalData:
        hasHistoricalData
          ? 'CONNECTED'
          : 'EMPTY',


      historicalSymbols:
        historySymbols,


      source: snapshot.source,

      snapshot:
        hasRealQuotes
          ? 'READY'
          : hasHistoricalData
            ? 'HISTORY_READY'
            : 'WAITING',


      quoteCount:
        snapshot.quotes.length,


      historyCount:
        historySymbols.length,


      checkedAt: now,

      snapshotTime: snapshot.timestamp,


      recommendationsReady:
        Array.isArray(pipeline.recommendations)
        &&
        pipeline.recommendations.length > 0,


      message:
        hasRealQuotes
          ? 'ASTRA received verified market quotes.'
          :
        hasHistoricalData
          ? 'ASTRA running with validated historical market data.'
          :
          'ASTRA waiting for market data source.'

    });


  } catch (error) {

    return res.status(200).json({

      success: false,

      market: 'EGX',

      dataEngine: 'ERROR',

      pipeline: 'ERROR',

      liveFeed: 'UNKNOWN',

      historicalData: 'UNKNOWN',

      quoteCount: 0,

      historyCount: 0,

      checkedAt: now,

      recommendationsReady: false,

      message:
        'ASTRA health check failed safely.',

      error:
        error?.message || 'Unknown runtime error'

    });

  }
}


module.exports = handler;
