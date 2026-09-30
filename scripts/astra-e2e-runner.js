const fs = require('fs');
const path = require('path');

const { buildRuntimeRecommendations } = require('../engine/runtime-pipeline');

const fixturePath = path.join(__dirname, '..', 'tests', 'fixtures', 'market-snapshot.fixture.json');
const outputPath = path.join(__dirname, '..', 'artifacts', 'astra-result.json');
const fixture = require(fixturePath);

function buildHistory(symbol, start, drift) {
  return Array.from({ length: 25 }, (_, index) => {
    const close = start + index * drift;
    return {
      ticker: symbol,
      date: '2026-08-' + String(index + 1).padStart(2, '0'),
      open: close - 0.5,
      high: close + 1,
      low: close - 1,
      close,
      volume: 1000000 + index * 10000
    };
  });
}

async function main() {
  const profiles = {
    COMI: [100, 1.2],
    SWDY: [80, 0.4],
    FWRY: [60, 0.2],
    TMGH: [50, -0.1],
    HRHO: [40, -0.4]
  };

  const histories = Object.fromEntries(
    Object.entries(profiles).map(([symbol, [start, drift]]) => [
      symbol,
      buildHistory(symbol, start, drift)
    ])
  );

  const result = await buildRuntimeRecommendations({
    liveSnapshot: { quotes: [], source: 'E2E_FIXTURE' },
    histories
  });

  if (result.status !== 'READY' || result.recommendations.length !== 5) {
    throw new Error('ASTRA E2E failed to produce five historical recommendations');
  }

  const invalid = result.recommendations.find((item) => {
    const baseInvalid =
      !fixture.symbols.includes(item.symbol) ||
      !['BUY', 'HOLD', 'SELL'].includes(item.signal) ||
      !Number.isFinite(item.confidence) ||
      !item.riskLevel ||
      !(item.entry > 0);

    if (baseInvalid) return true;

    if (item.signal === 'SELL') {
      return !(item.target1 < item.entry && item.target2 < item.entry && item.stopLoss > item.entry);
    }

    return !(item.target1 > item.entry && item.stopLoss < item.entry);
  });

  if (invalid) {
    throw new Error('ASTRA E2E produced an invalid recommendation contract');
  }

  const report = {
    generatedAt: new Date().toISOString(),
    source: 'ASTRA-RUNTIME-ENGINE',
    market: fixture.market,
    mode: result.mode,
    summary: {
      totalSignals: result.recommendations.length,
      buySignals: result.recommendations.filter((r) => r.signal === 'BUY').length,
      holdSignals: result.recommendations.filter((r) => r.signal === 'HOLD').length,
      sellSignals: result.recommendations.filter((r) => r.signal === 'SELL').length
    },
    recommendations: result.recommendations
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));

  console.log('ASTRA E2E REPORT');
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error('ASTRA E2E FAILED');
  console.error(error);
  process.exit(1);
});
