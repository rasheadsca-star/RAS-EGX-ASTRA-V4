const assert = require('assert');

const baseUrl = process.env.ASTRA_PROD_URL || 'https://ras-egx-astra-v4.vercel.app';
const expectedCommit = process.env.GITHUB_SHA;

async function main() {
  assert(expectedCommit, 'GITHUB_SHA is required');

  const url = baseUrl.replace(/\/$/, '') +
    '/api/recommendations?ci=' +
    encodeURIComponent(expectedCommit);

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

  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error('Production API did not return JSON: ' + text.slice(0, 1000));
  }

  assert.strictEqual(data.success, true, JSON.stringify(data));
  assert.strictEqual(data.market, 'EGX', JSON.stringify(data));
  assert(
    data.status === 'LIVE_READY' || data.status === 'HISTORICAL_READY',
    JSON.stringify(data)
  );
  assert(Array.isArray(data.recommendations), JSON.stringify(data));
  assert(Number(data.count) > 0, JSON.stringify(data));

  const deploymentCommit = data.deploymentCommit;
  assert(deploymentCommit, 'Production did not expose VERCEL_GIT_COMMIT_SHA');
  assert.strictEqual(
    deploymentCommit,
    expectedCommit,
    JSON.stringify({ expectedCommit, deploymentCommit })
  );

  console.log(JSON.stringify({
    productionUrl: baseUrl,
    status: data.status,
    mode: data.mode,
    dataSource: data.dataSource,
    count: data.count,
    symbolsAnalyzed: data.symbolsAnalyzed,
    deploymentCommit
  }, null, 2));
}

main().catch((error) => {
  console.error('ASTRA production contract validation failed');
  console.error(error?.stack || error);
  process.exit(1);
});
