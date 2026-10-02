'use strict';

const assert = require('assert');

const {
  DEFAULT_POLICY,
  modelReadiness,
  breakEvenProbabilityPct,
  expectedValuePct,
  uncertaintyScore,
  evaluateInstitutionalDecision,
  evaluateInstitutionalBoard
} = require('./institutional-decision-engine');

const {
  trainProspectiveModel
} = require('./prospective-calibration');

function baseRow(overrides = {}) {
  return {
    ticker: 'TEST',
    source: 'RR68_CHALLENGER',
    technicalScore: 78,
    researchScore: 80,
    liquidityScore: 90,
    supportResistanceScore: 75,
    dataQualityScore: 92,
    structuralNetRR: 1.5,
    riskSafetyScore: 88,
    crossSectionalScore: 82,
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
    estimatedSlippagePct: 0.1,
    morningStatus: 'CONFIRMED',
    ...overrides
  };
}

function calibratedModel(overrides = {}) {
  return {
    schemaVersion: 'astra-v5-prospective-model/v1',
    modelVersion: 'synthetic-calibrated-test',
    status: 'CALIBRATED',
    prospectiveOnly: true,
    features: ['researchScore'],
    trainingSample: {
      prospectiveOnly: true,
      resolvedTrades: 120,
      forwardSessions: 80,
      observedCalendarDays: 150,
      positiveOutcomes: 60,
      negativeOutcomes: 60
    },
    intercept: 0,
    coefficients: { researchScore: 2 },
    normalization: {
      researchScore: { mean: 50, std: 10 }
    },
    calibration: {
      method: 'ISOTONIC_PAV',
      points: [
        { x: 0, y: 0 },
        { x: 0.5, y: 0.5 },
        { x: 1, y: 1 }
      ]
    },
    validationMetrics: {
      brierScore: 0.12,
      baseRateBrierScore: 0.25,
      brierSkillScore: 0.52,
      ece: 0.05
    },
    ...overrides
  };
}

function isoDay(index) {
  const d = new Date('2026-01-01T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + index);
  return d.toISOString();
}

function main() {
  const row = baseRow();

  const breakEven = breakEvenProbabilityPct(row);
  assert(Number.isFinite(breakEven));
  assert(breakEven > 25 && breakEven < 45);

  const ev = expectedValuePct(row, 70);
  assert(Number.isFinite(ev));
  assert(ev > 0);

  const bootstrap = {
    status: 'NOT_CALIBRATED',
    prospectiveOnly: true,
    trainingSample: {
      prospectiveOnly: true,
      resolvedTrades: 0,
      forwardSessions: 0,
      observedCalendarDays: 0,
      positiveOutcomes: 0,
      negativeOutcomes: 0
    },
    validationMetrics: {}
  };

  const notReady = evaluateInstitutionalDecision({
    row,
    marketRegime: { score: 8, riskMultiplier: 0.35 },
    model: bootstrap,
    forwardSummary: { criticalBreaches: 0 }
  });
  assert.strictEqual(notReady.status, 'NO_TRADE_UNCALIBRATED');
  assert.strictEqual(notReady.probabilityTarget1Pct, null);
  assert.strictEqual(notReady.expectedValuePct, null);
  assert.strictEqual(notReady.executionAllowed, false);
  assert.strictEqual(notReady.usedForCurrentAppSelection, false);

  const model = calibratedModel();
  assert.strictEqual(modelReadiness(model, { criticalBreaches: 0 }).ready, true);

  const candidate = evaluateInstitutionalDecision({
    row,
    marketRegime: { score: 8, riskMultiplier: 0.35 },
    model,
    forwardSummary: { criticalBreaches: 0 }
  });
  assert.strictEqual(candidate.status, 'RESEARCH_CANDIDATE');
  assert.strictEqual(candidate.researchCandidate, true);
  assert(candidate.probabilityTarget1Pct > candidate.breakEvenProbabilityPct);
  assert(candidate.expectedValuePct > DEFAULT_POLICY.minExpectedValuePct);
  assert(candidate.uncertainty.score <= DEFAULT_POLICY.maxUncertaintyScore);
  assert.strictEqual(candidate.executionAllowed, false);
  assert.strictEqual(candidate.usedForCurrentAppSelection, false);

  const badQuality = evaluateInstitutionalDecision({
    row: baseRow({ dataQualityScore: 30 }),
    marketRegime: {},
    model,
    forwardSummary: { criticalBreaches: 0 }
  });
  assert.strictEqual(badQuality.status, 'NO_TRADE_DATA_QUALITY');

  const morningRejected = evaluateInstitutionalDecision({
    row: baseRow({ morningStatus: 'REJECTED' }),
    marketRegime: {},
    model,
    forwardSummary: { criticalBreaches: 0 }
  });
  assert.strictEqual(morningRejected.status, 'NO_TRADE_MORNING_REJECTED');

  const uncertainModel = calibratedModel({
    coefficients: { researchScore: 0 },
    validationMetrics: {
      brierScore: 0.2,
      baseRateBrierScore: 0.25,
      brierSkillScore: 0.2,
      ece: 0.09
    }
  });
  const uncertain = evaluateInstitutionalDecision({
    row: baseRow({ researchScore: 150 }),
    marketRegime: {},
    model: uncertainModel,
    forwardSummary: { criticalBreaches: 0 }
  });
  assert.strictEqual(uncertain.status, 'NO_TRADE_UNCERTAINTY');

  const breached = modelReadiness(model, { criticalBreaches: 1 });
  assert.strictEqual(breached.ready, false);
  assert(breached.blockers.includes('CRITICAL_GOVERNANCE_BREACH_PRESENT'));

  const board = evaluateInstitutionalBoard({
    rows: [row, baseRow({ ticker: 'LOWQ', dataQualityScore: 20 })],
    marketRegime: { score: 8, riskMultiplier: 0.35 },
    model,
    forwardSummary: { criticalBreaches: 0 }
  });
  assert.strictEqual(board.executionAllowed, false);
  assert.strictEqual(board.usedForCurrentAppSelection, false);
  assert.strictEqual(board.decisions.length, 2);

  const retrospectiveOnly = Array.from({ length: 150 }, (_, i) => ({
    capturedAt: isoDay(i),
    sessionDate: isoDay(i).slice(0, 10),
    prospectiveOnly: false,
    source: 'BACKTEST',
    outcome: i % 2 ? 'TARGET1' : 'STOP',
    features: { researchScore: i % 2 ? 80 : 20 }
  }));
  const rejectedBacktest = trainProspectiveModel({
    records: retrospectiveOnly,
    featureNames: ['researchScore'],
    modelVersion: 'retrospective-must-not-calibrate'
  });
  assert.strictEqual(rejectedBacktest.status, 'NOT_CALIBRATED');
  assert.strictEqual(rejectedBacktest.trainingSample.resolvedTrades, 0);

  const prospective = Array.from({ length: 120 }, (_, i) => {
    const y = i % 2;
    return {
      capturedAt: isoDay(i),
      sessionDate: isoDay(i).slice(0, 10),
      prospectiveOnly: true,
      source: 'FORWARD_PROSPECTIVE',
      outcome: y ? 'TARGET1' : 'STOP',
      features: { researchScore: y ? 82 : 18 }
    };
  });

  const trained = trainProspectiveModel({
    records: prospective,
    featureNames: ['researchScore'],
    modelVersion: 'synthetic-forward-validation'
  });
  assert.strictEqual(trained.status, 'CALIBRATED');
  assert.strictEqual(trained.trainingSample.resolvedTrades, 120);
  assert(trained.trainingSample.forwardSessions >= DEFAULT_POLICY.minForwardSessions);
  assert(trained.trainingSample.observedCalendarDays >= DEFAULT_POLICY.minObservedCalendarDays);
  assert(trained.validationMetrics.ece <= DEFAULT_POLICY.maxValidationEce);
  assert(trained.validationMetrics.brierSkillScore >= DEFAULT_POLICY.minBrierSkillScore);
  assert.strictEqual(trained.executionAllowed, false);
  assert.strictEqual(trained.usedForCurrentAppSelection, false);

  const uncertainty = uncertaintyScore({
    probability: 0.8,
    features: { researchScore: 80 },
    model,
    policy: DEFAULT_POLICY
  });
  assert(Number.isFinite(uncertainty.score));

  console.log('ASTRA V5 institutional research validation passed');
}

main();
