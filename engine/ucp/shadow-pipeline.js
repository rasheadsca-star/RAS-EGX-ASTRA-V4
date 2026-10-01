'use strict';

const { evaluateDataQuality } = require('./data-quality-gate');
const { buildDecisionSnapshot } = require('./decision-snapshot');
const { loadRc2ShadowScan } = require('./rc2-shadow-adapter');
const { loadUpstreamQuality } = require('./upstream-quality');
const { loadV17Governance } = require('./v17-governance-adapter');
const {
  cairoClock,
  prepareCandidates,
  evaluateMorningBatch
} = require('./v24-morning-confirmation');
const { loadMorningEvidence } = require('./v24-morning-evidence-adapter');
const { loadForwardLedger } = require('./forward-governance');

function morningStatus(batch, clock, targetSessionDate) {
  if (!batch.results.length) return 'NO_CANDIDATES';
  if (targetSessionDate && clock.sessionDate < targetSessionDate) return 'WAITING_NEXT_SESSION';
  if (batch.confirmedSymbols.length) return 'CONFIRMED_RESEARCH_ONLY';
  if (batch.stateCounts.REJECTED) return 'REJECTED_PRESENT';
  if (batch.stateCounts.EXPIRED && batch.stateCounts.EXPIRED === batch.results.length) return 'EXPIRED';
  if (batch.stateCounts.WATCH) return 'WATCH';
  return 'WAITING_DATA';
}

async function runUcpShadowPipeline({
  rc2Options = {},
  qualityOptions = {},
  v17Options = {},
  morningOptions = {},
  forwardOptions = {},
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
  const rc2 = await loadRc2ShadowScan({ ...rc2Options, expectedSession: sessionDate });
  const rc2Candidates = rc2.sessionAligned === true ? (rc2.candidates || []) : [];
  const v17 = await loadV17Governance({
    ...v17Options,
    requiredSession: sessionDate,
    candidates: rc2Candidates
  });
  const forward = loadForwardLedger(forwardOptions.filePath);

  const preparedCandidates = prepareCandidates(rc2Candidates, {
    preparedFromSession: sessionDate,
    dataGatePass: dataGate.pass
  });
  const targetSessionDate = preparedCandidates[0]?.targetSessionDate || null;
  const clock = cairoClock(new Date(generatedAt));

  let morningEvidence = Object.freeze({
    available: false,
    completeSource: false,
    source: 'NOT_REQUIRED_YET',
    sessionDate: targetSessionDate,
    evidenceByTicker: Object.freeze({})
  });

  if (
    preparedCandidates.length &&
    targetSessionDate &&
    clock.sessionDate === targetSessionDate &&
    clock.minuteOfDay >= 620
  ) {
    morningEvidence = await loadMorningEvidence({
      ...morningOptions,
      targetSessionDate,
      candidates: preparedCandidates,
      expectedUniverseSize: dataGate.metrics.expectedUniverseSize
    });
  }

  const morningBatch = evaluateMorningBatch(
    preparedCandidates,
    morningEvidence.evidenceByTicker || {},
    { now: new Date(generatedAt) }
  );
  const v24Status = morningStatus(morningBatch, clock, targetSessionDate);

  const blockers = [
    forward.promotion.eligible
      ? 'MANUAL_CHAMPION_REVIEW_REQUIRED'
      : 'FORWARD_VALIDATION_REQUIRED'
  ];
  if (!dataGate.pass) blockers.push('DATA_QUALITY_GATE_FAILED');
  if (!rc2.available) blockers.push('RC2_SHADOW_UNAVAILABLE');
  if (rc2.available && rc2.sessionAligned !== true) blockers.push('RC2_SESSION_ALIGNMENT_REQUIRED');
  if (!v17.available) blockers.push('V17_GOVERNANCE_UNAVAILABLE');
  if (v17.available && !v17.policySafe) blockers.push('V17_POLICY_CONTRACT_FAILED');
  if (v17.available && !v17.sessionAligned) blockers.push('V17_SESSION_ALIGNMENT_REQUIRED');
  if (v17.available && v17.sourceCurrent !== true) blockers.push('V17_SOURCE_STATUS_NOT_CURRENT');
  if (preparedCandidates.length && morningBatch.confirmedSymbols.length === 0) {
    blockers.push('V2_4_MORNING_CONFIRMATION_PENDING');
  }

  const watchlist = morningBatch.results
    .filter((item) => !['REJECTED', 'EXPIRED'].includes(item.lifecycleState))
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
      engineId: 'V2_4_MORNING_CONFIRMATION',
      status: v24Status,
      preparedFromSession: sessionDate,
      targetSessionDate,
      preparedCandidates,
      stateCounts: morningBatch.stateCounts,
      confirmedSymbols: morningBatch.confirmedSymbols,
      waitingSymbols: morningBatch.waitingSymbols,
      rejectedSymbols: morningBatch.rejectedSymbols,
      expiredSymbols: morningBatch.expiredSymbols,
      evidenceSource: morningEvidence.source || null,
      evidenceComplete: morningEvidence.completeSource === true
    },
    forwardValidation: {
      status: forward.promotion.status,
      ledgerAvailable: forward.available,
      ledgerUpdatedAt: forward.updatedAt,
      promotionEligible: forward.promotion.eligible,
      metrics: forward.summary,
      blockers: forward.promotion.blockers
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
        'RC2 is consumed read-only from an exact-session persisted research snapshot, with a live exact-session fallback only.',
        'A zero-candidate RC2 scan is a valid research outcome and never causes an invented recommendation.',
        'V17 UCP governance is fail-closed and requires an exact current-session snapshot with safe permissions.',
        'External consensus is diagnostic only and cannot make an exact-session V17 snapshot stale.',
        'V2.4 morning confirmation never re-ranks the frozen RC2 list.',
        'Missing or delayed 10:20-10:45 Cairo evidence becomes WAITING_DATA, never an inferred rejection.',
        'Full-day OHLC/volume is never substituted for a first-20-30-minute morning baseline.',
        'Champion eligibility uses only prospective UCP forward evidence collected after deployment.',
        'Automatic Champion promotion and execution remain permanently disabled by policy.'
      ]
    }
  });

  // SHADOW_READY means the shadow system itself is operational. Governance/session
  // blockers remain explicit in the DecisionSnapshot and can never grant execution.
  const shadowOperational = Boolean(
    dataGate.pass &&
    rc2.available && rc2.sessionAligned === true &&
    v17.available && v17.policySafe === true
  );

  return Object.freeze({
    success: true,
    status: shadowOperational ? 'SHADOW_READY' : 'SHADOW_DEGRADED',
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
        sourceType: rc2.sourceType || null,
        expectedSession: rc2.expectedSession || sessionDate,
        sessionDate: rc2.sessionDate || null,
        sessionAligned: rc2.sessionAligned === true,
        summary: rc2.summary || null,
        rejectionReasonCounts: rc2.rejectionReasonCounts || {},
        rejectedSample: rc2.rejectedSample || [],
        error: rc2.error || null
      }),
      v17: Object.freeze({
        available: v17.available,
        status: v17.status,
        sourceStatus: v17.sourceStatus || null,
        sourceType: v17.sourceType || null,
        sourceCurrent: v17.sourceCurrent === true,
        requiredSession: v17.requiredSession || null,
        referenceSession: v17.referenceSession || null,
        sessionAligned: v17.sessionAligned === true,
        policySafe: v17.policySafe === true,
        zeroRecommendationStateValid: v17.zeroRecommendationStateValid === true,
        approvedCount: v17.approvedSymbols?.length || 0,
        rejectedCount: v17.rejectedSymbols?.length || 0,
        blockers: v17.blockers || [],
        error: v17.error || null
      }),
      v24: Object.freeze({
        status: v24Status,
        preparedFromSession: sessionDate,
        targetSessionDate,
        clock,
        preparedCount: preparedCandidates.length,
        stateCounts: morningBatch.stateCounts,
        evidenceAvailable: morningEvidence.available === true,
        evidenceComplete: morningEvidence.completeSource === true,
        evidenceSource: morningEvidence.source || null,
        evidenceReason: morningEvidence.reason || null,
        marketCoveragePct: morningEvidence.marketCoveragePct ?? null,
        latestSourceMinute: morningEvidence.latestSourceMinute ?? null
      }),
      forward: Object.freeze({
        ledgerAvailable: forward.available,
        ledgerUpdatedAt: forward.updatedAt,
        summary: forward.summary,
        promotion: forward.promotion,
        error: forward.error || null
      })
    })
  });
}

module.exports = { runUcpShadowPipeline, morningStatus };
