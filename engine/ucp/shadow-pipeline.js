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

  const blockers = ['FORWARD_VALIDATION_REQUIRED'];
  if (!dataGate.pass) blockers.push('DATA_QUALITY_GATE_FAILED');
  if (!rc2.available) blockers.push('RC2_SHADOW_UNAVAILABLE');
  if (!v17.available) blockers.push('V17_GOVERNANCE_UNAVAILABLE');
  if (v17.available && !v17.policySafe) blockers.push('V17_POLICY_CONTRACT_FAILED');
  if (v17.available && !v17.sessionAligned) blockers.push('V17_SESSION_ALIGNMENT_REQUIRED');
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
        'RC2 is consumed read-only as a frozen after-close Alpha candidate list.',
        'V17 governance is fail-closed and requires exact session alignment.',
        'V2.4 morning confirmation never re-ranks the frozen RC2 list.',
        'Missing or delayed 10:20-10:45 Cairo evidence becomes WAITING_DATA, never an inferred rejection.',
        'Daily OHLC is never substituted for first-20-30-minute morning evidence.',
        'Execution remains disabled pending prospective forward validation and explicit Champion promotion.'
      ]
    }
  });

  return Object.freeze({
    success: true,
    status: dataGate.pass && rc2.available && v17.available ? 'SHADOW_READY' : 'SHADOW_DEGRADED',
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
        evidenceReason: morningEvidence.reason || null
      })
    })
  });
}

module.exports = { runUcpShadowPipeline, morningStatus };
