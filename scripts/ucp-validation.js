'use strict';

const assert = require('assert');
const {
  REGISTRY,
  evaluateDataQuality,
  buildDecisionSnapshot
} = require('../engine/ucp');
const { loadRc2ShadowScan } = require('../engine/ucp/rc2-shadow-adapter');
const { loadUpstreamQuality } = require('../engine/ucp/upstream-quality');
const { runUcpShadowPipeline } = require('../engine/ucp/shadow-pipeline');
const { evaluateV17Governance } = require('../engine/ucp/v17-governance-adapter');
const {
  nextEgxTradingSession,
  prepareCandidates,
  evaluateCandidate,
  evaluateMorningBatch
} = require('../engine/ucp/v24-morning-confirmation');
const {
  legacyEvidenceFromHistory
} = require('../engine/ucp/v24-morning-evidence-adapter');

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; }
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
    recommendations: [{
      ticker: 'COPR',
      publicationState: 'RESEARCH_CANDIDATE',
      publicationEligible: true,
      technicalEligible: true,
      scores: { research: 84, fusionRank: 86, liquidity: 70, supportResistance: 68 },
      tradePlan: { entry: 0.50, stop: 0.47, target1: 0.524, target2: 0.55, structuralNetRR: 1.5 },
      reasonCodes: []
    }],
    ...overrides
  };
}

function v17Payload(sessionDate = '2026-09-13') {
  return {
    schemaVersion: '17.0.0-rc3',
    generatedAt: '2026-09-13T22:40:05.200Z',
    status: 'READY_FOR_NEXT_SESSION_REVIEW',
    sessionDate,
    championChallenger: { promotionAllowed: false },
    readiness: { releaseStage: 'CONTROLLED_PILOT', professionalEvidenceReady: false },
    portfolioPolicy: { automaticOrders: false },
    market: { regime: 'NEUTRAL', score: 48, riskMultiplier: 0.65, maxTradeRiskPct: 0.16 }
  };
}

function consensusPayload(v17Session = '2026-09-13', aligned = false) {
  return {
    generatedAt: '2026-10-01T22:03:03.062Z',
    sessionDate: '2026-10-01',
    sourceHealth: {
      mainSession: '2026-10-01',
      v17Session,
      v17SessionAligned: aligned
    },
    policy: {
      exactSessionAlignmentRequired: true,
      failClosedOnMissingExternalData: true,
      comparisonCanGrantExecution: false
    }
  };
}

function completeMorningEvidence(overrides = {}) {
  return {
    sourceSessionDate: '2026-10-04',
    latestSourceMinute: 625,
    marketCoveragePct: 94,
    candidatePresent: true,
    volumeBaselineAvailable: true,
    openingGapPass: true,
    priceAcceptancePass: true,
    relativeVolumePass: true,
    relativeTurnoverPass: true,
    marketBreadthPass: true,
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
    expectedUniverseSize: 212, acceptedRows: 180, verifiedRows: 180,
    sourceReady: true, currentSessionReady: true, executionGrade: true, criticalErrors: []
  });
  assert.strictEqual(weakCoverageGate.pass, false);
  assert.ok(weakCoverageGate.blockers.includes('COVERAGE_BELOW_POLICY'));
  assert.ok(weakCoverageGate.blockers.includes('VERIFIED_COVERAGE_BELOW_POLICY'));

  const criticalErrorGate = evaluateDataQuality({
    expectedUniverseSize: 212, acceptedRows: 205, verifiedRows: 205,
    sourceReady: true, currentSessionReady: true, executionGrade: true,
    criticalErrors: ['SESSION_DATE_CORRUPT']
  });
  assert.strictEqual(criticalErrorGate.pass, false);
  assert.ok(criticalErrorGate.blockers.includes('CRITICAL_DATA_ERRORS_PRESENT'));

  const snapshot = buildDecisionSnapshot({
    generatedAt: '2026-10-01T21:52:21.000Z',
    sessionDate: '2026-10-01',
    dataGate: oct1Gate,
    alpha: { status: 'SHADOW_READY', candidates: [{ symbol: 'TEST', score: 88 }] },
    governance: { status: 'READY', sessionAligned: true, policySafe: true, approvedSymbols: ['TEST'] },
    morningConfirmation: {
      status: 'WAITING_NEXT_SESSION',
      preparedFromSession: '2026-10-01',
      targetSessionDate: '2026-10-04',
      waitingSymbols: ['TEST']
    },
    decision: { status: 'RESEARCH_ONLY', finalRecommendations: [], watchlist: ['TEST'], blockers: ['FORWARD_VALIDATION_REQUIRED'] },
    provenance: { sourceSession: '2026-10-01', notes: ['UCP bootstrap validation'] }
  });

  assert.strictEqual(snapshot.pipeline.name, 'Rasheed EGX Unified Champion Pipeline');
  assert.strictEqual(snapshot.mode, 'SHADOW_PRODUCTION');
  assert.strictEqual(snapshot.executionAllowed, false);
  assert.strictEqual(snapshot.engines.alphaChampionCandidate.id, 'TFE_V20_FUSION_RC2');
  assert.strictEqual(REGISTRY.championCandidate.executionAllowed, false);
  assert.strictEqual(snapshot.decisionHash.length, 64);
  assert.strictEqual(Object.isFrozen(snapshot), true);
  assert.strictEqual(Object.isFrozen(snapshot.dataGate), true);
  assert.strictEqual(snapshot.morningConfirmation.targetSessionDate, '2026-10-04');
  assert.strictEqual(snapshot.morningConfirmation.executionAllowed, false);

  const quality = await loadUpstreamQuality({ fetchImpl: async () => jsonResponse(qualityPayload()) });
  assert.strictEqual(quality.available, true);
  assert.strictEqual(quality.acceptedRows, 199);
  assert.strictEqual(quality.coveragePct, 93.87);
  assert.strictEqual(quality.verifiedCoveragePct, 95.28);

  const rc2 = await loadRc2ShadowScan({ fetchImpl: async () => jsonResponse(rc2Payload()) });
  assert.strictEqual(rc2.available, true);
  assert.strictEqual(rc2.status, 'SHADOW_READY');
  assert.strictEqual(rc2.engineId, 'TFE_V20_FUSION_RC2');
  assert.strictEqual(rc2.permissions.executionAllowed, false);
  assert.strictEqual(rc2.candidates.length, 1);
  assert.strictEqual(rc2.candidates[0].ticker, 'COPR');
  assert.strictEqual(rc2.candidates[0].fusionRankScore, 86);

  const unsafeRc2 = await loadRc2ShadowScan({
    fetchImpl: async () => jsonResponse(rc2Payload({
      permissions: {
        researchOnly: false, executionAllowed: true, productionAllocation: true,
        automaticOrders: true, automaticChampionPromotion: true
      }
    }))
  });
  assert.strictEqual(unsafeRc2.available, false);
  assert.strictEqual(unsafeRc2.error, 'RC2_PERMISSION_CONTRACT_VIOLATION');

  const sameSessionV17 = evaluateV17Governance({
    v17: v17Payload('2026-10-01'),
    consensus: consensusPayload('2026-10-01', true),
    requiredSession: '2026-10-01',
    candidates: [{ ticker: 'COPR' }]
  });
  assert.strictEqual(sameSessionV17.status, 'GOVERNANCE_READY');
  assert.strictEqual(sameSessionV17.sessionAligned, true);
  assert.strictEqual(sameSessionV17.policySafe, true);
  assert.deepStrictEqual(sameSessionV17.approvedSymbols, ['COPR']);
  assert.strictEqual(sameSessionV17.executionAllowed, false);

  const staleV17 = evaluateV17Governance({
    v17: v17Payload('2026-09-13'),
    consensus: consensusPayload('2026-09-13', false),
    requiredSession: '2026-10-01',
    candidates: [{ ticker: 'COPR' }]
  });
  assert.strictEqual(staleV17.status, 'GOVERNANCE_BLOCKED');
  assert.strictEqual(staleV17.sessionAligned, false);
  assert.deepStrictEqual(staleV17.approvedSymbols, []);
  assert.strictEqual(staleV17.rejectedSymbols[0].reason, 'V17_SESSION_MISMATCH');
  assert.ok(staleV17.blockers.includes('V17_SESSION_MISMATCH'));

  // V2.4 session calendar: Thursday -> Sunday, with holiday skip.
  assert.strictEqual(nextEgxTradingSession('2026-10-01'), '2026-10-04');
  assert.strictEqual(nextEgxTradingSession('2026-10-01', ['2026-10-04']), '2026-10-05');

  const prepared = prepareCandidates(rc2.candidates, {
    preparedFromSession: '2026-10-01',
    dataGatePass: true
  });
  assert.strictEqual(prepared.length, 1);
  assert.strictEqual(prepared[0].ticker, 'COPR');
  assert.strictEqual(prepared[0].lifecycleState, 'PREPARED');
  assert.strictEqual(prepared[0].targetSessionDate, '2026-10-04');
  assert.strictEqual(prepared[0].fusionRankScore, 86);
  assert.strictEqual(prepared[0].executionAllowed, false);

  const tooEarly = evaluateCandidate(prepared[0], completeMorningEvidence({ latestSourceMinute: 612 }), {
    now: new Date('2026-10-04T07:12:00.000Z')
  });
  assert.strictEqual(tooEarly.lifecycleState, 'WAITING_DATA');
  assert.ok(tooEarly.reasons.includes('MORNING_WINDOW_NOT_READY'));

  const missingBaseline = evaluateCandidate(prepared[0], completeMorningEvidence({ volumeBaselineAvailable: false }), {
    now: new Date('2026-10-04T07:25:00.000Z')
  });
  assert.strictEqual(missingBaseline.lifecycleState, 'WAITING_DATA');
  assert.ok(missingBaseline.reasons.includes('MORNING_VOLUME_BASELINE_MISSING'));

  const confirmed = evaluateCandidate(prepared[0], completeMorningEvidence(), {
    now: new Date('2026-10-04T07:25:00.000Z')
  });
  assert.strictEqual(confirmed.lifecycleState, 'CONFIRMED');
  assert.strictEqual(confirmed.executionAllowed, false);

  const rejected = evaluateCandidate(prepared[0], completeMorningEvidence({ priceAcceptancePass: false }), {
    now: new Date('2026-10-04T07:25:00.000Z')
  });
  assert.strictEqual(rejected.lifecycleState, 'REJECTED');
  assert.ok(rejected.reasons.includes('PRICE_ACCEPTANCE_FAILED'));

  const expired = evaluateCandidate(prepared[0], completeMorningEvidence({ volumeBaselineAvailable: false }), {
    now: new Date('2026-10-04T07:50:00.000Z')
  });
  assert.strictEqual(expired.lifecycleState, 'EXPIRED');
  assert.strictEqual(expired.terminal, true);

  const terminalRemainsTerminal = evaluateCandidate(prepared[0], completeMorningEvidence({ priceAcceptancePass: false }), {
    now: new Date('2026-10-04T07:30:00.000Z'),
    previousState: 'CONFIRMED'
  });
  assert.strictEqual(terminalRemainsTerminal.lifecycleState, 'CONFIRMED');

  const batch = evaluateMorningBatch(prepared, { COPR: completeMorningEvidence() }, {
    now: new Date('2026-10-04T07:25:00.000Z')
  });
  assert.deepStrictEqual(batch.confirmedSymbols, ['COPR']);
  assert.strictEqual(batch.stateCounts.CONFIRMED, 1);
  assert.strictEqual(batch.executionAllowed, false);

  // A legacy snapshot at 10:12 is not eligible for the 10:20-10:45 window.
  const noEligibleLegacy = legacyEvidenceFromHistory({
    updatedAt: '2026-10-04T07:12:00.000Z',
    snapshots: [{
      generatedAt: '2026-10-04T07:12:00.000Z',
      cairoTime: '2026-10-04 10:12:00',
      rows: [{ ticker: 'COPR', price: 0.50, turnover: 5000000 }]
    }]
  }, {
    targetSessionDate: '2026-10-04',
    candidates: prepared,
    expectedUniverseSize: 212
  });
  assert.strictEqual(noEligibleLegacy.available, false);
  assert.strictEqual(noEligibleLegacy.reason, 'NO_ELIGIBLE_10_20_TO_10_45_SNAPSHOT');

  // Even an eligible legacy row cannot fabricate opening/volume-baseline evidence.
  const incompleteLegacy = legacyEvidenceFromHistory({
    updatedAt: '2026-10-04T07:25:00.000Z',
    snapshots: [{
      generatedAt: '2026-10-04T07:25:00.000Z',
      cairoTime: '2026-10-04 10:25:00',
      rows: [{ ticker: 'COPR', price: 0.50, turnover: 5000000, changePct: 1.2 }]
    }]
  }, {
    targetSessionDate: '2026-10-04',
    candidates: prepared,
    expectedUniverseSize: 212
  });
  assert.strictEqual(incompleteLegacy.available, true);
  assert.strictEqual(incompleteLegacy.completeSource, false);
  assert.strictEqual(incompleteLegacy.evidenceByTicker.COPR.volumeBaselineAvailable, false);
  assert.strictEqual(incompleteLegacy.evidenceByTicker.COPR.openingGapPass, undefined);

  const fetchImpl = async (url) => {
    const value = String(url);
    if (value.includes('fetch-status.json')) return jsonResponse(qualityPayload());
    if (value.includes('route=scan')) return jsonResponse(rc2Payload());
    if (value.includes('/data/v17/current.json')) return jsonResponse(v17Payload('2026-09-13'));
    if (value.includes('v16-main-app-consensus.json')) return jsonResponse(consensusPayload('2026-09-13', false));
    return jsonResponse({}, 404);
  };

  // Oct 2 is before the Oct 4 target session: frozen candidate stays PREPARED.
  const shadow = await runUcpShadowPipeline({
    generatedAt: '2026-10-02T09:00:00.000Z',
    rc2Options: { fetchImpl },
    qualityOptions: { fetchImpl },
    v17Options: { fetchImpl },
    morningOptions: { fetchImpl }
  });

  assert.strictEqual(shadow.success, true);
  assert.strictEqual(shadow.status, 'SHADOW_READY');
  assert.strictEqual(shadow.executionAllowed, false);
  assert.strictEqual(shadow.recommendationMutationAllowed, false);
  assert.strictEqual(shadow.snapshot.dataGate.pass, true);
  assert.strictEqual(shadow.snapshot.alpha.status, 'SHADOW_READY');
  assert.strictEqual(shadow.snapshot.governance.status, 'GOVERNANCE_BLOCKED');
  assert.strictEqual(shadow.snapshot.governance.sessionAligned, false);
  assert.deepStrictEqual(shadow.snapshot.governance.approvedSymbols, []);
  assert.strictEqual(shadow.snapshot.morningConfirmation.engineId, 'V2_4_MORNING_CONFIRMATION');
  assert.strictEqual(shadow.snapshot.morningConfirmation.status, 'WAITING_NEXT_SESSION');
  assert.strictEqual(shadow.snapshot.morningConfirmation.preparedFromSession, '2026-10-01');
  assert.strictEqual(shadow.snapshot.morningConfirmation.targetSessionDate, '2026-10-04');
  assert.strictEqual(shadow.snapshot.morningConfirmation.preparedCandidates.length, 1);
  assert.strictEqual(shadow.snapshot.morningConfirmation.preparedCandidates[0].lifecycleState, 'PREPARED');
  assert.strictEqual(shadow.snapshot.morningConfirmation.executionAllowed, false);
  assert.deepStrictEqual(shadow.snapshot.decision.finalRecommendations, []);
  assert.deepStrictEqual(shadow.snapshot.decision.watchlist, ['COPR']);
  assert.ok(shadow.snapshot.decision.blockers.includes('FORWARD_VALIDATION_REQUIRED'));
  assert.ok(shadow.snapshot.decision.blockers.includes('V17_SESSION_ALIGNMENT_REQUIRED'));
  assert.ok(shadow.snapshot.decision.blockers.includes('V2_4_MORNING_CONFIRMATION_PENDING'));
  assert.ok(!shadow.snapshot.decision.blockers.includes('V2_4_MORNING_CONFIRMATION_NOT_WIRED'));
  assert.ok(!shadow.snapshot.decision.blockers.includes('V17_UCP_ADAPTER_NOT_WIRED'));
  assert.strictEqual(shadow.diagnostics.v24.targetSessionDate, '2026-10-04');
  assert.strictEqual(shadow.diagnostics.v24.status, 'WAITING_NEXT_SESSION');
  assert.strictEqual(shadow.diagnostics.v24.evidenceAvailable, false);

  console.log('Rasheed EGX UCP validation passed');
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
