const assert = require('assert');
const { buildRuntimeRecommendations } = require('../engine/runtime-pipeline');
const { analyze } = require('../engine/analysis-engine/runtime-analyzer');
const { generateSignal } = require('../engine/recommendation-engine/signal-generator');

function makeHistory({ symbol, start = 100, drift = 0.4, volume = 1000000 }) {
  return Array.from({ length: 25 }, (_, index) => {
    const close = start + index * drift;
    const day = String(index + 1).padStart(2, '0');

    return {
      ticker: symbol,
      date: '2026-08-' + day,
      open: close - 0.5,
      high: close + 1,
      low: close - 1,
      close,
      volume: volume + index * 10000
    };
  });
}

async function main() {
  const histories = {
    COMI: makeHistory({ symbol: 'COMI', start: 100, drift: 1.2 }),
    SWDY: makeHistory({ symbol: 'SWDY', start: 80, drift: 0.1 })
  };

  const historicalResult = await buildRuntimeRecommendations({
    liveSnapshot: { quotes: [], source: 'TEST' },
    histories
  });

  assert.strictEqual(historicalResult.status, 'READY');
  assert.strictEqual(historicalResult.mode, 'HISTORY_MODE');
  assert.strictEqual(historicalResult.dataSource, 'HISTORICAL');
  assert.strictEqual(historicalResult.recommendations.length, 2);

  for (const item of historicalResult.recommendations) {
    assert.ok(['BUY', 'HOLD', 'SELL'].includes(item.signal));
    assert.ok(Number.isFinite(item.confidence));
    assert.ok(item.riskLevel);
    assert.ok(item.entry > 0);
    assert.ok(item.target1 > item.entry);
    assert.ok(item.stopLoss < item.entry);
    assert.ok(item.analysis.historySessions >= 25);
  }

  const analysis = analyze({
    symbols: [{ symbol: 'COMI', price: 128, changePercent: 1.5, volume: 1200000 }],
    histories
  });

  assert.strictEqual(analysis.results.length, 1);
  assert.ok(analysis.results[0].historySessions >= 25);
  assert.ok(Number.isFinite(analysis.results[0].technicalScore));

  const noData = await buildRuntimeRecommendations({
    liveSnapshot: { quotes: [] },
    histories: {}
  });

  assert.strictEqual(noData.status, 'NO_DATA');
  assert.strictEqual(noData.recommendations.length, 0);

  const signal = generateSignal({
    symbol: 'TEST',
    analysis: { technicalScore: 82, riskLevel: 'LOW' },
    risk: { level: 'LOW' },
    trade: {
      status: 'READY',
      entry: 100,
      target1: 106,
      target2: 112,
      stopLoss: 97
    }
  });

  assert.strictEqual(signal.signal, 'BUY');
  assert.strictEqual(signal.symbol, 'TEST');
  assert.strictEqual(signal.entry, 100);

  console.log('ASTRA runtime validation passed');
  console.log(JSON.stringify({
    historicalMode: {
      status: historicalResult.status,
      count: historicalResult.recommendations.length,
      symbols: historicalResult.recommendations.map((item) => item.symbol)
    },
    noDataMode: noData.status,
    signalContract: signal
  }, null, 2));
}

main().catch((error) => {
  console.error('ASTRA runtime validation failed');
  console.error(error);
  process.exit(1);
});
