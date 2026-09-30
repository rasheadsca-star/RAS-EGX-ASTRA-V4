const { runRuntimePipeline } = require('../../engine/runtime-pipeline.js');

function mapRecommendation(stock) {
  return {
    symbol: stock.symbol,
    signal: stock.signal || 'WATCH',
    entryOpportunity: stock.entryOpportunity === true,
    entry: stock.entry ?? null,
    target1: stock.target1 ?? null,
    target2: stock.target2 ?? null,
    target3: stock.target3 ?? null,
    stopLoss: stock.stopLoss ?? null,
    riskPerShare: stock.riskPerShare ?? null,
    riskPercent: stock.riskPercent ?? null,
    riskReward1: stock.riskReward1 ?? null,
    riskReward2: stock.riskReward2 ?? null,
    riskReward3: stock.riskReward3 ?? null,
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
  };
}

function mapWatch(stock) {
  return {
    symbol: stock.symbol,
    signal: 'WATCH',
    confidence: stock.confidence ?? 0,
    riskLevel: stock.riskLevel || 'UNKNOWN',
    reason: stock.executionBlockers?.includes('ENTRY_SCORE_BELOW_THRESHOLD')
      ? 'ENTRY_CRITERIA_NOT_MET'
      : 'TRADE_PLAN_NOT_READY',
    analysis: stock.analysis || null,
    dataFreshness: stock.dataFreshness || null
  };
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
        recommendations: [],
        watchlist: []
      });
    }

    const recommendations = (pipeline.recommendations || []).map(mapRecommendation);
    const watchlist = (pipeline.watchlist || []).map(mapWatch);

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
      watchlistCount: watchlist.length,
      symbolsAnalyzed: pipeline.symbolsAnalyzed || 0,
      morningConfirmedCount: pipeline.morningConfirmedCount || 0,
      executionReadyCount: pipeline.executionReadyCount || 0,
      recommendations,
      watchlist
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
      watchlist: [],
      error: error?.message || 'Unknown runtime error'
    });
  }
}

module.exports = handler;
