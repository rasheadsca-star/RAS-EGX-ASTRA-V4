'use strict';

const { evaluateDataQuality } = require('./data-quality-gate');
const { buildDecisionSnapshot } = require('./decision-snapshot');
const { loadRc2ShadowScan } = require('./rc2-shadow-adapter');
const { loadUpstreamQuality } = require('./upstream-quality');

async function runUcpShadowPipeline({
  rc2Options = {},
  qualityOptions = {},
  generatedAt = new Date().toISOString()
} = {}) {
  const [quality, rc2] = await Promise.all([
    loadUpstreamQuality(qualityOptions),
    loadRc2ShadowScan(rc2Options)
  ]);

  const dataGate = evaluateDataQuality({
    expectedUniverseSize: quality.expectedUniverseSize,
    acceptedRows: quality.acceptedRows,
    verifiedRows: quality.verifiedRows,
    coveragePct: quality.coveragePct,
    verifiedCoveragePct: quality.verifiedCoveragePct,
    sourceReady: quality.sourceReady,
    currentSessionReady: quality.currentSessionReady,
    executionGrade: quality.executionGrade,
    criticalErrors: quality.criticalErrors || []
  });

  const blockers = ['FORWARD_VALIDATION_REQUIRED'];

  if (!dataGate.pass) blockers.push('DATA_QUALITY_GATE_FAILED');
  if (!rc2.available) blockers.push('RC2_SHADOW_UNAVAILABLE');

  blockers.push('V17_UCP_ADAPTER_NOT_WIRED');
  blockers.push('V2_4_MORNING_CONFIRMATION_NOT_WIRED');

  const sessionDate =
    quality.expectedSession ||
    rc2.sessionDate ||
    null;

  const watchlist = (rc2.candidates || [])
    .map((item) => item.ticker)
    .filter(Boolean);

  const snapshot = buildDecisionSnapshot({
    generatedAt,
    sessionDate,
    dataGate,
    alpha: {
      engineId: rc2.engineId,
      status: rc2.status,
      candidates: rc2.candidates || []
    },
    governance: {
      status: 'REGISTERED_NOT_WIRED',
      approvedSymbols: [],
      rejectedSymbols: []
    },
    morningConfirmation: {
      status: 'REGISTERED_NOT_WIRED',
      confirmedSymbols: [],
      waitingSymbols: watchlist
    },
    decision: {
      status: 'RESEARCH_ONLY',
      finalRecommendations: [],
      watchlist,
      blockers
    },
    provenance: {
      sourceCommit: rc2.sourceCommit || null,
      sourceSession: sessionDate,
      notes: [
        'RC2 is consumed read-only as a shadow Alpha candidate.',
        'RC2 output cannot mutate native ASTRA recommendations.',
        'Execution remains disabled until V17, V2.4 and forward-validation gates are satisfied.'
      ]
    }
  });

  return Object.freeze({
    success: true,
    status:
      dataGate.pass && rc2.available
        ? 'SHADOW_READY'
        : 'SHADOW_DEGRADED',
    executionAllowed: false,
    recommendationMutationAllowed: false,
    snapshot,
    diagnostics: Object.freeze({
      upstreamQuality: quality,
      rc2: Object.freeze({
        available: rc2.available,
        status: rc2.status,
        engineId: rc2.engineId,
        mode: rc2.mode || null,
        schemaVersion: rc2.schemaVersion || null,
        sourceCommit: rc2.sourceCommit || null,
        sessionDate: rc2.sessionDate || null,
        summary: rc2.summary || null,
        error: rc2.error || null
      })
    })
  });
}

module.exports = {
  runUcpShadowPipeline
};
