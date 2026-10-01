const assert = require('assert');

const baseUrl = process.env.ASTRA_PROD_URL || 'https://ras-egx-astra-v4.vercel.app';
const expectedCommit = process.env.GITHUB_SHA;
const retryAttempts = Number(process.env.ASTRA_PROD_RETRY_ATTEMPTS || 12);
const retryDelayMs = Number(process.env.ASTRA_PROD_RETRY_DELAY_MS || 10000);
const READY_STATUSES = new Set([
  'LIVE_READY',
  'DELAYED_READY',
  'HISTORICAL_READY'
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getJson(path) {
  const url = baseUrl.replace(/\/$/, '') + path;
  const response = await fetch(url, {
    headers: {
      'Cache-Control': 'no-cache',
      'User-Agent': 'ASTRA-Production-Contract-Check/1.2'
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

async function waitForExpectedDeployment() {
  let lastError = null;

  for (let attempt = 1; attempt <= retryAttempts; attempt += 1) {
    try {
      const recommendations = await getJson(
        '/api/recommendations?ci=' + encodeURIComponent(expectedCommit) +
        '&attempt=' + attempt
      );

      if (recommendations?.deploymentCommit === expectedCommit) {
        return recommendations;
      }

      lastError = new Error(
        'Production deployment commit mismatch: expected ' +
        expectedCommit + ', received ' +
        (recommendations?.deploymentCommit || 'missing')
      );
    } catch (error) {
      lastError = error;
    }

    if (attempt < retryAttempts) {
      await sleep(retryDelayMs);
    }
  }

  throw lastError || new Error('Production deployment did not become ready');
}

function assertNonExecutableWhenNotFresh(payload, label) {
  if (payload.status === 'DELAYED_READY' || payload.status === 'HISTORICAL_READY') {
    assert.strictEqual(
      Number(payload.executionReadyCount || 0),
      0,
      label + ' must not expose execution-ready signals without fresh market data'
    );
  }
}

async function main() {
  assert(expectedCommit, 'GITHUB_SHA is required');

  const recommendations = await waitForExpectedDeployment();
  const health = await getJson('/api/data-health?ci=' + encodeURIComponent(expectedCommit));
  const system = await getJson('/api/system-health?ci=' + encodeURIComponent(expectedCommit));

  assert.strictEqual(recommendations.success, true, JSON.stringify(recommendations));
  assert.strictEqual(recommendations.market, 'EGX', JSON.stringify(recommendations));
  assert(
    READY_STATUSES.has(recommendations.status),
    JSON.stringify(recommendations)
  );
  assert(Array.isArray(recommendations.recommendations), JSON.stringify(recommendations));
  assert(Array.isArray(recommendations.watchlist), JSON.stringify(recommendations));
  assert(Number(recommendations.count) === recommendations.recommendations.length, JSON.stringify(recommendations));

  const deploymentCommit = recommendations.deploymentCommit;
  assert(deploymentCommit, 'Production did not expose VERCEL_GIT_COMMIT_SHA');
  assert.strictEqual(
    deploymentCommit,
    expectedCommit,
    JSON.stringify({ expectedCommit, deploymentCommit })
  );

  assert.strictEqual(health.success, true, JSON.stringify(health));
  assert.strictEqual(health.market, 'EGX', JSON.stringify(health));
  assert(
    READY_STATUSES.has(health.engineStatus),
    JSON.stringify(health)
  );
  assert.strictEqual(system.success, true, JSON.stringify(system));
  assert.strictEqual(system.system, 'ASTRA_V4', JSON.stringify(system));
  assert.strictEqual(system.healthy, true, JSON.stringify(system));

  assert(
    recommendations.recommendations.every((item) => item.signal === 'BUY'),
    JSON.stringify(recommendations)
  );

  assert(
    recommendations.watchlist.every((item) => item.signal === 'WATCH'),
    JSON.stringify(recommendations)
  );

  for (const item of recommendations.recommendations) {
    assert.strictEqual(item.entryOpportunity, true, JSON.stringify(item));
    assert(item.stopLoss < item.entry, JSON.stringify(item));
    assert(item.entry < item.target1, JSON.stringify(item));
    assert(item.target1 < item.target2, JSON.stringify(item));
    assert(item.target2 < item.target3, JSON.stringify(item));

    if (item.executionReady === true) {
      assert.strictEqual(recommendations.status, 'LIVE_READY', JSON.stringify(item));
      assert.strictEqual(item.morningGate?.confirmed, true, JSON.stringify(item));
      assert.strictEqual(item.priceMatched, true, JSON.stringify(item));
      assert.strictEqual(item.dataFreshness?.status, 'FRESH', JSON.stringify(item));
      assert.strictEqual(item.executionMode, 'PAPER_ONLY', JSON.stringify(item));
    }
  }

  assertNonExecutableWhenNotFresh(recommendations, 'Recommendations API');
  assertNonExecutableWhenNotFresh({
    status: health.engineStatus,
    executionReadyCount: health.executionReadyCount
  }, 'Data-health API');

  if (recommendations.status === 'DELAYED_READY') {
    assert.strictEqual(
      health.liveFeed,
      'DELAYED_CURRENT_SESSION',
      JSON.stringify(health)
    );
  }

  console.log(JSON.stringify({
    productionUrl: baseUrl,
    status: recommendations.status,
    mode: recommendations.mode,
    dataSource: recommendations.dataSource,
    entryCandidates: recommendations.count,
    watchlist: recommendations.watchlistCount,
    morningConfirmedCount: recommendations.morningConfirmedCount,
    executionReadyCount: recommendations.executionReadyCount,
    deploymentCommit
  }, null, 2));
}

main().catch((error) => {
  console.error('ASTRA production entry contract validation failed');
  console.error(error?.stack || error);
  process.exit(1);
});
