'use strict';

const assert = require('assert');

const {
  POLICY,
  tradePlan,
  eligibleObservationRows,
  captureCohort,
  enrichMorning,
  historyRows,
  simulatedFill,
  resolveOutcome,
  trainingRecords,
  summarize,
  finalize
} = require('./evidence-factory');

function board(status = 'PREPARED') {
  return {
    success: true,
    executionAllowed: false,
    sessionDate: '2026-10-01',
    generatedAt: '2026-10-01T15:00:00.000Z',
    deploymentCommit: 'test-production',
    marketRegime: { regime: 'RISK_OFF', score: 8, riskMultiplier: 0.35 },
    rows: [{
      ticker: 'TEST',
      source: 'RR68_CHALLENGER',
      selectedByUcp: true,
      nearMiss: false,
      unifiedRank: 1,
      unifiedScore: 82,
      crossSectionalRank: 2,
      crossSectionalScore: 88,
      scoreCoveragePct: 100,
      technicalScore: 78,
      researchScore: 80,
      liquidityScore: 90,
      supportResistanceScore: 75,
      dataQualityScore: 92,
      structuralNetRR: 1.5,
      riskSafetyScore: 88,
      crossSectional: {
        technicalPercentile: 85,
        researchPercentile: 90,
        liquidityPercentile: 88,
        supportResistancePercentile: 80,
        structuralRrPercentile: 78,
        riskSafetyPercentile: 86
      },
      entryLow: 99,
      entryHigh: 100,
      stopLoss: 95,
      target1: 112,
      target2: 118,
      roundTripCostPct: 0.6,
      riskLevel: 'LOW',
      sector: 'TEST_SECTOR',
      sectorSource: 'TEST_FIXTURE',
      morningStatus: status,
      reasonCodes: []
    }]
  };
}

function ucp() {
  return {
    success: true,
    executionAllowed: false,
    recommendationMutationAllowed: false,
    status: 'SHADOW_READY',
    deploymentCommit: 'test-production',
    snapshot: {
      sessionDate: '2026-10-01',
      decisionHash: 'abc123',
      morningConfirmation: {
        targetSessionDate: '2026-10-04',
        status: 'CONFIRMED',
        source: 'TEST_MORNING_FEED',
        generatedAt: '2026-10-04T07:25:00.000Z',
        latestSourceMinute: 625,
        marketCoveragePct: 96,
        preparedCandidates: [{
          ticker: 'TEST',
          lifecycleState: 'CONFIRMED',
          currentPrice: 100.2,
          changePct: 1.1,
          turnover: 1500000,
          volumeRatio: 1.6,
          openingGapPct: 0.4
        }]
      }
    }
  };
}

function blankLedger() {
  return {
    schemaVersion: 'astra-v5-prospective-evidence/v1',
    policyVersion: POLICY.version,
    cohorts: []
  };
}

function main() {
  const plan = tradePlan(board().rows[0]);
  assert(plan);
  assert.strictEqual(plan.entryLow, 99);
  assert.strictEqual(plan.entryHigh, 100);

  const eligible = eligibleObservationRows(board());
  assert.strictEqual(eligible.length, 1);
  assert.strictEqual(eligible[0].prospectiveOnly, true);
  assert.strictEqual(eligible[0].executionAllowed, false);

  const ledger = blankLedger();
  const first = captureCohort(ledger, board(), ucp(), '2026-10-01T16:00:00.000Z');
  assert.strictEqual(first.changed, true);
  assert.strictEqual(ledger.cohorts.length, 1);
  assert.strictEqual(first.cohort.targetSessionDate, '2026-10-04');
  assert.strictEqual(first.cohort.candidateCount, 1);
  const captureHash = first.cohort.captureHash;

  const duplicate = captureCohort(ledger, board('CONFIRMED'), ucp(), '2026-10-01T16:30:00.000Z');
  assert.strictEqual(duplicate.changed, false);
  assert.strictEqual(ledger.cohorts.length, 1);
  assert.strictEqual(ledger.cohorts[0].captureHash, captureHash);

  const morning = enrichMorning(ledger, board('CONFIRMED'), ucp(), '2026-10-04T08:20:00.000Z');
  assert.strictEqual(morning.changed, true);
  assert.strictEqual(morning.updates, 1);
  assert.strictEqual(ledger.cohorts[0].candidates[0].morningEvidence.at(-1).status, 'CONFIRMED');
  assert.strictEqual(ledger.cohorts[0].candidates[0].morningEvidence.at(-1).currentPrice, 100.2);
  assert.strictEqual(ledger.cohorts[0].candidates[0].sector, 'TEST_SECTOR');
  assert.strictEqual(ledger.cohorts[0].captureHash, captureHash);

  const parsed = historyRows({
    sessions: [
      { date: '2026-10-04', open: 101, high: 102, low: 99.5, close: 100.5 },
      { date: '2026-10-05', open: 105, high: 113, low: 104, close: 112 }
    ]
  });
  assert.strictEqual(parsed.length, 2);

  const fill = simulatedFill(parsed[0], 99, 100);
  assert.strictEqual(fill, 100);

  const candidate = ledger.cohorts[0].candidates[0];
  const outcome = resolveOutcome(
    ledger.cohorts[0],
    candidate,
    parsed,
    '2026-10-05T15:00:00.000Z'
  );
  assert.strictEqual(outcome.status, 'TARGET1');
  assert.strictEqual(outcome.targetBeforeStop, true);
  assert.strictEqual(outcome.entered, true);
  assert(outcome.netReturnPct > 0);
  assert.strictEqual(outcome.slippageMeasurement, 'DAILY_OHLC_SIMULATED_FILL_VS_FROZEN_ENTRY_MIDPOINT_PROXY');
  assert(Number.isFinite(outcome.entrySlippageProxyPct));
  candidate.outcome = outcome;

  const records = trainingRecords(ledger);
  assert.strictEqual(records.length, 1);
  assert.strictEqual(records[0].prospectiveOnly, true);
  assert.strictEqual(records[0].targetBeforeStop, true);
  assert.strictEqual(records[0].features.researchScore, 80);
  assert.strictEqual(records[0].sector, 'TEST_SECTOR');
  assert.strictEqual(records[0].morningEvidence.currentPrice, 100.2);
  assert(Number.isFinite(records[0].slippage.realizedProxyPct));

  finalize(ledger, '2026-10-05T16:00:00.000Z');
  assert.strictEqual(ledger.summary.decisionSessions, 1);
  assert.strictEqual(ledger.summary.resolvedLabels, 1);
  assert.strictEqual(ledger.summary.positiveOutcomes, 1);
  assert.strictEqual(ledger.summary.negativeOutcomes, 0);
  assert.strictEqual(ledger.summary.sectorCoverage, 1);
  assert.strictEqual(ledger.summary.morningEvidenceCaptured, 1);
  assert.strictEqual(ledger.summary.slippageProxyObserved, 1);
  assert.strictEqual(ledger.safety.executionAllowed, false);
  assert.strictEqual(ledger.safety.usedForCurrentAppSelection, false);
  assert.strictEqual(ledger.safety.writesToProductionData, false);

  const sameBarLedger = blankLedger();
  captureCohort(sameBarLedger, board(), ucp(), '2026-10-01T16:00:00.000Z');
  const sameBarCandidate = sameBarLedger.cohorts[0].candidates[0];
  const sameBarOutcome = resolveOutcome(
    sameBarLedger.cohorts[0],
    sameBarCandidate,
    [{
      date: '2026-10-04',
      open: 100,
      high: 115,
      low: 94,
      close: 105
    }],
    '2026-10-04T15:00:00.000Z'
  );
  assert.strictEqual(sameBarOutcome.status, 'STOP');
  assert.strictEqual(sameBarOutcome.targetBeforeStop, false);
  assert.strictEqual(sameBarOutcome.sameBarAmbiguity, 'STOP_FIRST');

  const noEntryLedger = blankLedger();
  captureCohort(noEntryLedger, board(), ucp(), '2026-10-01T16:00:00.000Z');
  const noEntryCandidate = noEntryLedger.cohorts[0].candidates[0];
  const noEntryOutcome = resolveOutcome(
    noEntryLedger.cohorts[0],
    noEntryCandidate,
    [
      { date: '2026-10-04', open: 110, high: 111, low: 105, close: 108 },
      { date: '2026-10-05', open: 109, high: 110, low: 104, close: 107 },
      { date: '2026-10-06', open: 108, high: 109, low: 103, close: 106 }
    ],
    '2026-10-06T15:00:00.000Z'
  );
  assert.strictEqual(noEntryOutcome.status, 'NOT_ENTERED');
  assert.strictEqual(noEntryOutcome.targetBeforeStop, null);

  const summary = summarize(noEntryLedger);
  assert.strictEqual(summary.candidatesCaptured, 1);

  console.log('ASTRA V5 prospective evidence factory validation passed');
}

main();
