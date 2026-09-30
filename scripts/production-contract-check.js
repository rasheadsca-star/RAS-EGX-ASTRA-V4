const assert = require('assert');

const baseUrl = process.env.ASTRA_PROD_URL || 'https://ras-egx-astra-v4.vercel.app';
const expectedCommit = process.env.GITHUB_SHA;

async function getJson(path) {
  const url = baseUrl.replace(/\/$/, '') + path;
  const response = await fetch(url, {
    headers: {
      'Cache-Control': 'no-cache',
      'User-Agent': 'ASTRA-Production-Contract-Check/1.0'
    }
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error('Production API HTTP ' + response.status + ': ' + text.slice(0, 1000));
  }

  try {
    return JSON.parse(text);
  } catch (_) {
    throw new Error('Production API did not return JSON: ' + text.slice(0, 1000));
  }
}

async function main() {
  assert(expectedCommit, 'GITHUB_SHA is required');

  const recommendations = await getJson(
    '/api/recommendations?ci=' + encodeURIComponent(expectedCommit)
  );
  const health = await getJson('/api/data-health?ci=' + encodeURIComponent(expectedCommit));
  const system = await getJson('/api/system-health?ci=' + encodeURIComponent(expectedCommit));

  assert.strictEqual(recommendations.success, true, JSON.stringify(recommendations));
  assert.strictEqual(recommendations.market, 'EGX', JSON.stringify(recommendations));
  assert(
    recommendations.status === 'LIVE_READY' ||
    recommendations.status === 'HISTORICAL_READY',
    JSON.stringify(recommendations)
  );
  assert(Array.isArray(recommendations.recommendations), JSON.stringify(recommendations));
  assert(Number(recommendations.count) > 0, JSON.stringify(recommendations));

  const deploymentCommit = recommendations.deploymentCommit;
  assert(deploymentCommit, 'Production did not expose VERCEL_GIT_COMMIT_SHA');
  assert.strictEqual(
    deploymentCommit,
    expectedCommit,
    JSON.stringify({ expectedCommit, deploymentCommit })
  );

  assert.strictEqual(health.market, 'EGX', JSON.stringify(health));
  assert(
    health.engineStatus === 'LIVE_READY' ||
    health.engineStatus === 'HISTORICAL_READY',
    JSON.stringify(health)
  );
  assert(health.recommendationsReady === true, JSON.stringify(health));

  assert.strictEqual(system.system, 'ASTRA_V4', JSON.stringify(system));
  assert.strictEqual(system.healthy, true, JSON.stringify(system));

  const executionReadyCount = Number(recommendations.executionReadyCount || 0);
  const morningConfirmedCount = Number(recommendations.morningConfirmedCount || 0);

  assert(
    executionReadyCount <= morningConfirmedCount,
    JSON.stringify({ executionReadyCount, morningConfirmedCount })
  );

  if (recommendations.status === 'HISTORICAL_READY') {
    assert.strictEqual(executionReadyCount, 0, JSON.stringify(recommendations));
    assert(
      recommendations.recommendations.every((item) => item.executionReady === false),
      JSON.stringify(recommendations)
    );
  }

  for (const item of recommendations.recommendations) {
    if (item.executionReady === true) {
      assert.strictEqual(item.morningGate?.confirmed, true, JSON.stringify(item));
      assert.strictEqual(item.priceMatched, true, JSON.stringify(item));
      assert.strictEqual(item.dataFreshness?.status, 'FRESH', JSON.stringify(item));
      assert.strictEqual(item.executionMode, 'PAPER_ONLY', JSON.stringify(item));
    }
  }

  console.log(JSON.stringify({
    productionUrl: baseUrl,
    status: recommendations.status,
    mode: recommendations.mode,
    dataSource: recommendations.dataSource,
    count: recommendations.count,
    symbolsAnalyzed: recommendations.symbolsAnalyzed,
    morningConfirmedCount,
    executionReadyCount,
    deploymentCommit,
    health: {
      liveFeed: health.liveFeed,
      historicalData: health.historicalData,
      quoteCount: health.quoteCount,
      historyCount: health.historyCount
    },
    system: {
      healthy: system.healthy,
      dataEngine: system.dataEngine,
      recommendations: system.recommendations
    }
  }, null, 2));
}

main().catch((error) => {
  console.error('ASTRA production contract validation failed');
  console.error(error?.stack || error);
  process.exit(1);
});
