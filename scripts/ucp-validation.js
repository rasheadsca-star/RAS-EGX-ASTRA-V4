'use strict';

const assert = require('assert');
const {
  REGISTRY,
  evaluateDataQuality,
  buildDecisionSnapshot
} = require('../engine/ucp');

function main() {
  const oct1Gate = evaluateDataQuality({
    expectedUniverseSize: 212,
    acceptedRows: 199,
    verifiedRows: 202,
    sourceReady: true,
    currentSessionReady: true,
    executionGrade: true,
    criticalErrors: [],
    quarantinedSymbols: ['MISSING_A', 'MISSING_B']
  });

  assert.strictEqual(oct1Gate.pass, true);
  assert.strictEqual(oct1Gate.metrics.coveragePct, 93.87);
  assert.strictEqual(oct1Gate.metrics.verifiedCoveragePct, 95.28);
  assert.strictEqual(oct1Gate.metrics.acceptedRows, 199);
  assert.ok(!oct1Gate.blockers.includes('COVERAGE_BELOW_POLICY'));

  const weakCoverageGate = evaluateDataQuality({
    expectedUniverseSize: 212,
    acceptedRows: 180,
    verifiedRows: 180,
    sourceReady: true,
    currentSessionReady: true,
    executionGrade: true,
    criticalErrors: []
  });

  assert.strictEqual(weakCoverageGate.pass, false);
  assert.ok(weakCoverageGate.blockers.includes('COVERAGE_BELOW_POLICY'));
  assert.ok(weakCoverageGate.blockers.includes('VERIFIED_COVERAGE_BELOW_POLICY'));

  const criticalErrorGate = evaluateDataQuality({
    expectedUniverseSize: 212,
    acceptedRows: 205,
    verifiedRows: 205,
    sourceReady: true,
    currentSessionReady: true,
    executionGrade: true,
    criticalErrors: ['SESSION_DATE_CORRUPT']
  });

  assert.strictEqual(criticalErrorGate.pass, false);
  assert.ok(
    criticalErrorGate.blockers.includes('CRITICAL_DATA_ERRORS_PRESENT')
  );

  const snapshot = buildDecisionSnapshot({
    generatedAt: '2026-10-01T21:52:21.000Z',
    sessionDate: '2026-10-01',
    dataGate: oct1Gate,
    alpha: {
      status: 'SHADOW_READY',
      candidates: [{ symbol: 'TEST', score: 88 }]
    },
    governance: {
      status: 'READY',
      approvedSymbols: ['TEST']
    },
    morningConfirmation: {
      status: 'WAITING_NEXT_SESSION',
      waitingSymbols: ['TEST']
    },
    decision: {
      status: 'RESEARCH_ONLY',
      finalRecommendations: [],
      watchlist: ['TEST'],
      blockers: ['FORWARD_VALIDATION_REQUIRED']
    },
    provenance: {
      sourceSession: '2026-10-01',
      notes: ['UCP bootstrap validation']
    }
  });

  assert.strictEqual(snapshot.pipeline.name, 'Rasheed EGX Unified Champion Pipeline');
  assert.strictEqual(snapshot.mode, 'SHADOW_PRODUCTION');
  assert.strictEqual(snapshot.executionAllowed, false);
  assert.strictEqual(
    snapshot.engines.alphaChampionCandidate.id,
    'TFE_V20_FUSION_RC2'
  );
  assert.strictEqual(REGISTRY.championCandidate.executionAllowed, false);
  assert.strictEqual(snapshot.decisionHash.length, 64);
  assert.strictEqual(Object.isFrozen(snapshot), true);
  assert.strictEqual(Object.isFrozen(snapshot.dataGate), true);

  console.log('Rasheed EGX UCP validation passed');
}

main();
