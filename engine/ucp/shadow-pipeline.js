'use strict';

const { evaluateDataQuality } = require('./data-quality-gate');
const { buildDecisionSnapshot } = require('./decision-snapshot');
const { loadRc2ShadowScan } = require('./rc2-shadow-adapter');
const { loadUpstreamQuality } = require('./upstream-quality');
const { loadV17Governance } = require('./v17-governance-adapter');

async function runUcpShadowPipeline({
  rc2Options = {},
  qualityOptions = {},
  v17Options = {},
  generatedAt = new Date().toISOString()
} = {}) {
  const quality = await loadUpstreamQuality(qualityOptions);

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

  const sessionDate = quality.expectedSession || null;
  const rc2 = await loadRc2ShadowScan(rc2Options);
  const rc2Candidates = rc2.candidates || [];
  const v17 = await loadV17Governance({
    ...v17Options,
    requiredSession: sessionDate,
    candidates: rc2Candidates
  });

  const blockers = ['FORWARD_VALIDATION_REQUIRED'];

  if (!dataGate.pass) blockers.push('DATA_QUALITY_GATE_FAILED');
  if (!rc2.available) blockers.push('RC2_SHADOW_UNAVAILABLE');
  if (!v17.available) blockers.push('V17_GOVERNANCE_UNAVAILABLE');
  if (v17.available && !v17.policySafe) blockers.push('V17_POLICY_CONTRACT_FAILED');
  if (v17.available && !v17.sessionAligned) blockers.push('V17_SESSION_ALIGNMENT_REQUIRED');

  blockers.push('V2_4_MORNING_CONFIRMATION_NOT_WIRED');

  const watchlist = rc2Candidates
    .map((item) => item.ticker)
    .filter(Boolean);

  const snapshot = buildDecisionSnapshot({
    generatedAt,
    sessionDate,
    dataGate,
    alpha: {
      engineId: rc2.engineId,
      status: rc2.status,
      candidates: rc2Candidates
    },
    governance: {
      engineId: v17.id,
      status: v17.status,
      requiredSession: v17.requiredSession,
      referenceSession: v17.referenceSession,
      sessionAligned: v17.sessionAligned,
      policySafe: v17.policySafe,
      executionAllowed: false,
      market: v17.market || null,
      approvedSymbols: v17.approvedSymbols || [],
      rejectedSymbols: v17.rejectedSymbols || [],
      blockers: v17.blockers || []
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
        'V17 governance is fail-closed and requires exact session alignment.',
        'Stale V17 market regime or approvals are never applied to a newer session.',
        'Execution remains disabled until V2.4 morning confirmation and forward-validation gates are satisfied.'
      ]
    }
  });

  return Object.freeze({
    success: true,
    status:
      dataGate.pass && rc2.available && v17.available
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
      }),
      v17: Object.freeze({
        available: v17.available,
        status: v17.status,
        requiredSession: v17.requiredSession || null,
        referenceSession: v17.referenceSession || null,
        sessionAligned: v17.sessionAligned === true,
        policySafe: v17.policySafe === true,
        approvedCount: v17.approvedSymbols?.length || 0,
        rejectedCount: v17.rejectedSymbols?.length || 0,
        blockers: v17.blockers || [],
        error: v17.error || null
      })
    })
  });
}

module.exports = {
  runUcpShadowPipeline
};
