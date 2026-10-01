'use strict';

const assert = require('assert');
const {
  REGISTRY,
  evaluateDataQuality,
  buildDecisionSnapshot
} = require('../engine/ucp');
const {
  loadRc2ShadowScan
} = require('../engine/ucp/rc2-shadow-adapter');
const {
  loadUpstreamQuality
} = require('../engine/ucp/upstream-quality');
const {
  runUcpShadowPipeline
} = require('../engine/ucp/shadow-pipeline');

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    }
  };
}

function qualityPayload() {
  return {
    ok: true,
    realFetch: true,
    generatedAt: '2026-10-01T18:57:00.626Z',
    sourceName: 'mubasher_symbol_pages_precise_enriched',
    sourceUrl: '244 symbols + analysis tools enrichment',
    marketRows: 199,
    inputRows: 212,
    sourceSessionVerifiedRows: 202,
    sourceSessionEvidenceCoveragePct: 95.28,
    coveragePct: 93.87,
    executionGrade: true,
    expectedSession: '2026-10-01',
    currentSessionRows: 199,
    rejectedCurrentSessionRows: 13,
    droppedCurrentSessionRows: 0
  };
}

function rc2Payload(overrides = {}) {
  return {
    ok: true,
    engine: 'TFE_V20_FUSION_RC2',
    schemaVersion: '20.tfe.2',
    sourceCommit: 'rc2-frozen-test-commit',
    generatedAt: '2026-10-01T19:00:00.000Z',
    mode: 'RESEARCH_ONLY',
    permissions: {
      researchOnly: true,
      executionAllowed: false,
      productionAllocation: false,
      automaticOrders: false,
      automaticChampionPromotion: false
    },
    universe: {
      mode: 'CURRENT_VERIFIED_MARKET',
      sessionDate: '2026-10-01',
      currentVerifiedCandidates: 199,
      alphaDataBranch: 'main',
      overlayBranch: 'develop/v20-integrated-decision-platform'
    },
    summary: {
      scanned: 199,
      technicalEligibleTotal: 4,
      publicationEligibleTotal: 3,
      withheldForPriceReconciliation: 1,
      returned: 1
    },
    recommendations: [
      {
        ticker: 'COPR',
        publicationState: 'RESEARCH_CANDIDATE',
        publicationEligible: true,
        technicalEligible: true,
        scores: {
          research: 84,
          fusionRank: 86,
          liquidity: 70,
          supportResistance: 68
        },
        tradePlan: {
          entry: 0.50,
          stop: 0.47,
          target1: 0.524,
          target2: 0.55,
          structuralNetRR: 1.5
        },
        reasonCodes: []
      }
    ],
    ...overrides
  };
}

async function main() {
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

  const quality = await loadUpstreamQuality({
    fetchImpl: async () => jsonResponse(qualityPayload())
  });

  assert.strictEqual(quality.available, true);
  assert.strictEqual(quality.acceptedRows, 199);
  assert.strictEqual(quality.coveragePct, 93.87);
  assert.strictEqual(quality.verifiedCoveragePct, 95.28);

  const rc2 = await loadRc2ShadowScan({
    fetchImpl: async () => jsonResponse(rc2Payload())
  });

  assert.strictEqual(rc2.available, true);
  assert.strictEqual(rc2.status, 'SHADOW_READY');
  assert.strictEqual(rc2.engineId, 'TFE_V20_FUSION_RC2');
  assert.strictEqual(rc2.permissions.executionAllowed, false);
  assert.strictEqual(rc2.candidates.length, 1);
  assert.strictEqual(rc2.candidates[0].ticker, 'COPR');
  assert.strictEqual(rc2.candidates[0].fusionRankScore, 86);

  const unsafeRc2 = await loadRc2ShadowScan({
    fetchImpl: async () => jsonResponse(
      rc2Payload({
        permissions: {
          researchOnly: false,
          executionAllowed: true,
          productionAllocation: true,
          automaticOrders: true,
          automaticChampionPromotion: true
        }
      })
    )
  });

  assert.strictEqual(unsafeRc2.available, false);
  assert.strictEqual(
    unsafeRc2.error,
    'RC2_PERMISSION_CONTRACT_VIOLATION'
  );

  const fetchImpl = async (url) => {
    if (String(url).includes('fetch-status.json')) {
      return jsonResponse(qualityPayload());
    }

    if (String(url).includes('route=scan')) {
      return jsonResponse(rc2Payload());
    }

    return jsonResponse({}, 404);
  };

  const shadow = await runUcpShadowPipeline({
    generatedAt: '2026-10-01T21:59:00.000Z',
    rc2Options: { fetchImpl },
    qualityOptions: { fetchImpl }
  });

  assert.strictEqual(shadow.success, true);
  assert.strictEqual(shadow.status, 'SHADOW_READY');
  assert.strictEqual(shadow.executionAllowed, false);
  assert.strictEqual(shadow.recommendationMutationAllowed, false);
  assert.strictEqual(shadow.snapshot.dataGate.pass, true);
  assert.strictEqual(shadow.snapshot.alpha.status, 'SHADOW_READY');
  assert.deepStrictEqual(shadow.snapshot.decision.finalRecommendations, []);
  assert.deepStrictEqual(shadow.snapshot.decision.watchlist, ['COPR']);
  assert.ok(
    shadow.snapshot.decision.blockers.includes('FORWARD_VALIDATION_REQUIRED')
  );
  assert.ok(
    shadow.snapshot.decision.blockers.includes('V17_UCP_ADAPTER_NOT_WIRED')
  );
  assert.ok(
    shadow.snapshot.decision.blockers.includes(
      'V2_4_MORNING_CONFIRMATION_NOT_WIRED'
    )
  );

  console.log('Rasheed EGX UCP validation passed');
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
