const assert = require('assert');

const baseUrl = process.env.ASTRA_PROD_URL || 'https://ras-egx-astra-v4.vercel.app';
const expectedCommit = process.env.GITHUB_SHA;
const retryAttempts = Number(process.env.ASTRA_PROD_RETRY_ATTEMPTS || 12);
const retryDelayMs = Number(process.env.ASTRA_PROD_RETRY_DELAY_MS || 10000);
const READY_STATUSES = new Set(['LIVE_READY', 'DELAYED_READY', 'HISTORICAL_READY']);
const V24_STATUSES = new Set([
  'NO_CANDIDATES',
  'WAITING_NEXT_SESSION',
  'WAITING_DATA',
  'WATCH',
  'CONFIRMED_RESEARCH_ONLY',
  'REJECTED_PRESENT',
  'EXPIRED'
]);

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function getJson(path) {
  const url = baseUrl.replace(/\/$/, '') + path;
  const response = await fetch(url, {
    headers: { 'Cache-Control': 'no-cache', 'User-Agent': 'ASTRA-Production-Contract-Check/1.5' }
  });
  const text = await response.text();
  if (!response.ok) throw new Error('Production API HTTP ' + response.status + ': ' + text.slice(0, 1000));
  try { return JSON.parse(text); }
  catch (_) { throw new Error('Production API did not return JSON: ' + text.slice(0, 1000)); }
}

async function waitForExpectedDeployment() {
  let lastError = null;
  for (let attempt = 1; attempt <= retryAttempts; attempt += 1) {
    try {
      const recommendations = await getJson('/api/recommendations?ci=' + encodeURIComponent(expectedCommit) + '&attempt=' + attempt);
      if (recommendations?.deploymentCommit === expectedCommit) return recommendations;
      lastError = new Error('Production deployment commit mismatch: expected ' + expectedCommit + ', received ' + (recommendations?.deploymentCommit || 'missing'));
    } catch (error) { lastError = error; }
    if (attempt < retryAttempts) await sleep(retryDelayMs);
  }
  throw lastError || new Error('Production deployment did not become ready');
}

function assertNonExecutableWhenNotFresh(payload, label) {
  if (payload.status === 'DELAYED_READY' || payload.status === 'HISTORICAL_READY') {
    assert.strictEqual(Number(payload.executionReadyCount || 0), 0, label + ' must not expose execution-ready signals without fresh market data');
  }
}

function assertUcpShadowContract(ucp) {
  assert.strictEqual(ucp.success, true, JSON.stringify(ucp));
  assert(ucp.status === 'SHADOW_READY' || ucp.status === 'SHADOW_DEGRADED', JSON.stringify(ucp));
  assert.strictEqual(ucp.executionAllowed, false, JSON.stringify(ucp));
  assert.strictEqual(ucp.recommendationMutationAllowed, false, JSON.stringify(ucp));
  assert.strictEqual(ucp.snapshot?.schema, 'rasheed-egx-ucp-decision-snapshot/v1', JSON.stringify(ucp));
  assert.strictEqual(ucp.snapshot?.pipeline?.name, 'Rasheed EGX Unified Champion Pipeline', JSON.stringify(ucp));
  assert.strictEqual(ucp.snapshot?.executionAllowed, false, JSON.stringify(ucp));
  assert(Array.isArray(ucp.snapshot?.decision?.finalRecommendations), JSON.stringify(ucp));
  assert.strictEqual(ucp.snapshot.decision.finalRecommendations.length, 0, 'UCP shadow stage must not publish final recommendations');
  assert(Array.isArray(ucp.snapshot?.decision?.blockers) && ucp.snapshot.decision.blockers.includes('FORWARD_VALIDATION_REQUIRED'), JSON.stringify(ucp));

  if (ucp.status === 'SHADOW_READY') {
    assert.strictEqual(ucp.diagnostics?.rc2?.engineId, 'TFE_V20_FUSION_RC2', JSON.stringify(ucp));
    assert.strictEqual(ucp.diagnostics?.rc2?.mode, 'RESEARCH_ONLY', JSON.stringify(ucp));
  }

  const v17 = ucp.diagnostics?.v17;
  assert(v17 && typeof v17 === 'object', JSON.stringify(ucp));
  assert.strictEqual(ucp.snapshot?.governance?.executionAllowed, false, JSON.stringify(ucp));
  assert(Array.isArray(ucp.snapshot?.governance?.approvedSymbols), JSON.stringify(ucp));
  assert(Array.isArray(ucp.snapshot?.governance?.rejectedSymbols), JSON.stringify(ucp));

  if (v17.available === true) {
    assert.strictEqual(v17.policySafe, true, JSON.stringify(v17));
    if (v17.sessionAligned !== true) {
      assert.strictEqual(ucp.snapshot.governance.approvedSymbols.length, 0, JSON.stringify(ucp));
      assert(ucp.snapshot.decision.blockers.includes('V17_SESSION_ALIGNMENT_REQUIRED'), JSON.stringify(ucp));
    }
  } else {
    assert(ucp.snapshot.decision.blockers.includes('V17_GOVERNANCE_UNAVAILABLE'), JSON.stringify(ucp));
  }

  const v24 = ucp.diagnostics?.v24;
  const morning = ucp.snapshot?.morningConfirmation;
  assert(v24 && typeof v24 === 'object', JSON.stringify(ucp));
  assert(morning && typeof morning === 'object', JSON.stringify(ucp));
  assert.strictEqual(morning.engineId, 'V2_4_MORNING_CONFIRMATION', JSON.stringify(ucp));
  assert.strictEqual(morning.executionAllowed, false, JSON.stringify(ucp));
  assert(V24_STATUSES.has(morning.status), JSON.stringify(morning));
  assert.strictEqual(morning.status, v24.status, JSON.stringify({ morning, v24 }));
  assert(Array.isArray(morning.confirmedSymbols), JSON.stringify(morning));
  assert(Array.isArray(morning.waitingSymbols), JSON.stringify(morning));
  assert(Array.isArray(morning.rejectedSymbols), JSON.stringify(morning));
  assert(Array.isArray(morning.expiredSymbols), JSON.stringify(morning));
  assert(!ucp.snapshot.decision.blockers.includes('V2_4_MORNING_CONFIRMATION_NOT_WIRED'), JSON.stringify(ucp));

  if ((v24.preparedCount || 0) > 0 && morning.confirmedSymbols.length === 0) {
    assert(ucp.snapshot.decision.blockers.includes('V2_4_MORNING_CONFIRMATION_PENDING'), JSON.stringify(ucp));
  }

  if (v24.evidenceComplete !== true) {
    assert.strictEqual(morning.confirmedSymbols.length, 0, 'Incomplete morning evidence must not confirm candidates');
  }

  for (const item of morning.preparedCandidates || []) {
    assert.strictEqual(item.executionAllowed, false, JSON.stringify(item));
  }
}

async function main() {
  assert(expectedCommit, 'GITHUB_SHA is required');

  const recommendations = await waitForExpectedDeployment();
  const health = await getJson('/api/data-health?ci=' + encodeURIComponent(expectedCommit));
  const system = await getJson('/api/system-health?ci=' + encodeURIComponent(expectedCommit));
  const ucp = await getJson('/api/ucp-shadow?ci=' + encodeURIComponent(expectedCommit));

  assert.strictEqual(recommendations.success, true, JSON.stringify(recommendations));
  assert.strictEqual(recommendations.market, 'EGX', JSON.stringify(recommendations));
  assert(READY_STATUSES.has(recommendations.status), JSON.stringify(recommendations));
  assert(Array.isArray(recommendations.recommendations), JSON.stringify(recommendations));
  assert(Array.isArray(recommendations.watchlist), JSON.stringify(recommendations));
  assert(Number(recommendations.count) === recommendations.recommendations.length, JSON.stringify(recommendations));

  const deploymentCommit = recommendations.deploymentCommit;
  assert(deploymentCommit, 'Production did not expose VERCEL_GIT_COMMIT_SHA');
  assert.strictEqual(deploymentCommit, expectedCommit, JSON.stringify({ expectedCommit, deploymentCommit }));

  assert.strictEqual(health.success, true, JSON.stringify(health));
  assert.strictEqual(health.market, 'EGX', JSON.stringify(health));
  assert(READY_STATUSES.has(health.engineStatus), JSON.stringify(health));
  assert.strictEqual(system.success, true, JSON.stringify(system));
  assert.strictEqual(system.system, 'ASTRA_V4', JSON.stringify(system));
  assert.strictEqual(system.healthy, true, JSON.stringify(system));
  assert.strictEqual(ucp.deploymentCommit, expectedCommit, JSON.stringify(ucp));
  assertUcpShadowContract(ucp);

  assert(recommendations.recommendations.every((item) => item.signal === 'BUY'), JSON.stringify(recommendations));
  assert(recommendations.watchlist.every((item) => item.signal === 'WATCH'), JSON.stringify(recommendations));

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
  assertNonExecutableWhenNotFresh({ status: health.engineStatus, executionReadyCount: health.executionReadyCount }, 'Data-health API');

  if (recommendations.status === 'DELAYED_READY') {
    assert.strictEqual(health.liveFeed, 'DELAYED_CURRENT_SESSION', JSON.stringify(health));
  }

  console.log(JSON.stringify({
    productionUrl: baseUrl,
    status: recommendations.status,
    mode: recommendations.mode,
    dataSource: recommendations.dataSource,
    entryCandidates: recommendations.count,
    morningConfirmedCount: recommendations.morningConfirmedCount,
    executionReadyCount: recommendations.executionReadyCount,
    ucpStatus: ucp.status,
    ucpDataGatePass: ucp.snapshot?.dataGate?.pass,
    ucpRc2Available: ucp.diagnostics?.rc2?.available,
    ucpRc2Candidates: ucp.snapshot?.alpha?.candidates?.length || 0,
    ucpV17Available: ucp.diagnostics?.v17?.available,
    ucpV17SessionAligned: ucp.diagnostics?.v17?.sessionAligned,
    ucpV17ReferenceSession: ucp.diagnostics?.v17?.referenceSession,
    ucpV24Status: ucp.diagnostics?.v24?.status,
    ucpV24TargetSession: ucp.diagnostics?.v24?.targetSessionDate,
    ucpV24Prepared: ucp.diagnostics?.v24?.preparedCount,
    ucpV24EvidenceComplete: ucp.diagnostics?.v24?.evidenceComplete,
    deploymentCommit
  }, null, 2));
}

main().catch((error) => {
  console.error('ASTRA production entry contract validation failed');
  console.error(error?.stack || error);
  process.exit(1);
});
