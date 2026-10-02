'use strict';

/**
 * ASTRA V5 Institutional Decision Layer — RESEARCH SIDECAR ONLY
 *
 * This module is deliberately isolated from ASTRA V4 runtime selection and execution.
 * It consumes a unified-opportunity row, a prospective-only model and forward summary,
 * then returns a research decision with calibrated probability, expected value and
 * uncertainty only when strict readiness requirements are satisfied.
 */

const DEFAULT_POLICY = Object.freeze({
  version: 'astra-v5-institutional-policy/v1',
  minResolvedTrades: 90,
  minForwardSessions: 60,
  minObservedCalendarDays: 120,
  minPositiveOutcomes: 25,
  minNegativeOutcomes: 25,
  maxCriticalBreaches: 0,
  maxValidationEce: 0.10,
  minBrierSkillScore: 0,
  minProbabilityEdgePct: 3.0,
  minExpectedValuePct: 0.25,
  maxUncertaintyScore: 55,
  minDataQualityScore: 60,
  minLiquidityScore: 50,
  defaultRoundTripCostPct: 0.60,
  defaultSlippagePct: 0.15,
  usedForCurrentAppSelection: false,
  executionAllowed: false,
  automaticPromotionAllowed: false
});

const FEATURE_NAMES = Object.freeze([
  'technicalScore',
  'researchScore',
  'liquidityScore',
  'supportResistanceScore',
  'dataQualityScore',
  'structuralNetRR',
  'riskSafetyScore',
  'technicalPercentile',
  'researchPercentile',
  'liquidityPercentile',
  'supportResistancePercentile',
  'structuralRrPercentile',
  'riskSafetyPercentile',
  'crossSectionalScore',
  'regimeScore',
  'regimeRiskMultiplier'
]);

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp(value, min = 0, max = 100) {
  const n = finite(value);
  return n === null ? min : Math.max(min, Math.min(max, n));
}

function sigmoid(x) {
  if (x >= 0) {
    const z = Math.exp(-x);
    return 1 / (1 + z);
  }
  const z = Math.exp(x);
  return z / (1 + z);
}

function extractFeatures(row = {}, marketRegime = {}) {
  const x = row.crossSectional || {};
  return Object.freeze({
    technicalScore: finite(row.technicalScore),
    researchScore: finite(row.researchScore),
    liquidityScore: finite(row.liquidityScore),
    supportResistanceScore: finite(row.supportResistanceScore),
    dataQualityScore: finite(row.dataQualityScore),
    structuralNetRR: finite(row.structuralNetRR),
    riskSafetyScore: finite(row.riskSafetyScore),
    technicalPercentile: finite(x.technicalPercentile),
    researchPercentile: finite(x.researchPercentile),
    liquidityPercentile: finite(x.liquidityPercentile),
    supportResistancePercentile: finite(x.supportResistancePercentile),
    structuralRrPercentile: finite(x.structuralRrPercentile),
    riskSafetyPercentile: finite(x.riskSafetyPercentile),
    crossSectionalScore: finite(row.crossSectionalScore),
    regimeScore: finite(marketRegime.score),
    regimeRiskMultiplier: finite(marketRegime.riskMultiplier)
  });
}

function modelReadiness(model = {}, forwardSummary = {}, policy = DEFAULT_POLICY) {
  const sample = model.trainingSample || {};
  const metrics = model.validationMetrics || {};
  const positive = Number(sample.positiveOutcomes || 0);
  const negative = Number(sample.negativeOutcomes || 0);
  const blockers = [];

  if (model.status !== 'CALIBRATED') blockers.push('MODEL_NOT_CALIBRATED');
  if (Number(sample.resolvedTrades || 0) < policy.minResolvedTrades) blockers.push('MIN_RESOLVED_TRADES_NOT_MET');
  if (Number(sample.forwardSessions || 0) < policy.minForwardSessions) blockers.push('MIN_FORWARD_SESSIONS_NOT_MET');
  if (Number(sample.observedCalendarDays || 0) < policy.minObservedCalendarDays) blockers.push('MIN_CALENDAR_DAYS_NOT_MET');
  if (positive < policy.minPositiveOutcomes) blockers.push('MIN_POSITIVE_OUTCOMES_NOT_MET');
  if (negative < policy.minNegativeOutcomes) blockers.push('MIN_NEGATIVE_OUTCOMES_NOT_MET');
  if (Number(forwardSummary.criticalBreaches || 0) > policy.maxCriticalBreaches) blockers.push('CRITICAL_GOVERNANCE_BREACH_PRESENT');

  const ece = finite(metrics.ece);
  if (ece === null || ece > policy.maxValidationEce) blockers.push('VALIDATION_ECE_NOT_ACCEPTABLE');

  const brierSkill = finite(metrics.brierSkillScore);
  if (brierSkill === null || brierSkill < policy.minBrierSkillScore) blockers.push('BRIER_SKILL_NOT_ACCEPTABLE');

  if (model.prospectiveOnly !== true && sample.prospectiveOnly !== true) blockers.push('PROSPECTIVE_ONLY_PROOF_REQUIRED');

  return Object.freeze({
    ready: blockers.length === 0,
    blockers: Object.freeze(blockers),
    policyVersion: policy.version
  });
}

function normalizedValue(name, value, model = {}) {
  const n = finite(value);
  const mean = finite(model.normalization?.[name]?.mean);
  const std = finite(model.normalization?.[name]?.std);
  if (n === null || mean === null || !(std > 0)) return null;
  return (n - mean) / std;
}

function rawModelProbability(model = {}, features = {}) {
  if (model.status !== 'CALIBRATED') return null;
  let logit = finite(model.intercept);
  if (logit === null) return null;

  for (const name of model.features || FEATURE_NAMES) {
    const coefficient = finite(model.coefficients?.[name]);
    const z = normalizedValue(name, features[name], model);
    if (coefficient === null || z === null) return null;
    logit += coefficient * z;
  }

  return sigmoid(logit);
}

function applyIsotonicCalibration(rawProbability, calibration = {}) {
  const p = finite(rawProbability);
  if (p === null || p < 0 || p > 1) return null;
  const points = Array.isArray(calibration.points) ? calibration.points : [];
  if (!points.length) return p;

  const ordered = points
    .map(point => ({ x: finite(point.x), y: finite(point.y) }))
    .filter(point => point.x !== null && point.y !== null)
    .sort((a, b) => a.x - b.x);

  if (!ordered.length) return p;
  if (p <= ordered[0].x) return clamp(ordered[0].y, 0, 1);

  for (let i = 1; i < ordered.length; i += 1) {
    if (p <= ordered[i].x) {
      const left = ordered[i - 1];
      const right = ordered[i];
      if (right.x === left.x) return clamp(right.y, 0, 1);
      const t = (p - left.x) / (right.x - left.x);
      return clamp(left.y + t * (right.y - left.y), 0, 1);
    }
  }

  return clamp(ordered.at(-1).y, 0, 1);
}

function breakEvenProbabilityPct(row = {}, policy = DEFAULT_POLICY) {
  const entry = finite(row.entryHigh) ?? finite(row.entryLow);
  const stop = finite(row.stopLoss);
  const target = finite(row.target1);
  const costPct = finite(row.roundTripCostPct) ?? policy.defaultRoundTripCostPct;
  const slippagePct = finite(row.estimatedSlippagePct) ?? policy.defaultSlippagePct;

  if (!(entry > 0) || !(stop > 0) || !(target > entry) || !(stop < entry)) return null;

  const friction = entry * (costPct + slippagePct) / 100;
  const risk = entry - stop + friction;
  const reward = target - entry - friction;
  if (!(risk > 0) || !(reward > 0)) return null;

  return Number((risk / (risk + reward) * 100).toFixed(2));
}

function expectedValuePct(row = {}, probabilityTarget1Pct, policy = DEFAULT_POLICY) {
  const pPct = finite(probabilityTarget1Pct);
  const entry = finite(row.entryHigh) ?? finite(row.entryLow);
  const stop = finite(row.stopLoss);
  const target = finite(row.target1);
  const costPct = finite(row.roundTripCostPct) ?? policy.defaultRoundTripCostPct;
  const slippagePct = finite(row.estimatedSlippagePct) ?? policy.defaultSlippagePct;

  if (pPct === null || !(entry > 0) || !(stop > 0) || !(target > entry) || !(stop < entry)) return null;

  const p = clamp(pPct / 100, 0, 1);
  const frictionPct = costPct + slippagePct;
  const rewardPct = ((target - entry) / entry) * 100 - frictionPct;
  const lossPct = ((entry - stop) / entry) * 100 + frictionPct;

  return Number((p * rewardPct - (1 - p) * lossPct).toFixed(4));
}

function predictiveEntropyScore(probability) {
  const p = finite(probability);
  if (p === null || p <= 0 || p >= 1) return 0;
  const entropy = -(p * Math.log(p) + (1 - p) * Math.log(1 - p)) / Math.log(2);
  return Number((entropy * 100).toFixed(2));
}

function outOfDistributionScore(features = {}, model = {}) {
  const names = model.features || FEATURE_NAMES;
  const distances = [];
  let missing = 0;

  for (const name of names) {
    const z = normalizedValue(name, features[name], model);
    if (z === null) {
      missing += 1;
      continue;
    }
    distances.push(Math.max(0, Math.abs(z) - 2));
  }

  if (!names.length) return { score: 100, missingPct: 100 };
  const missingPct = missing / names.length * 100;
  const distancePenalty = distances.length
    ? distances.reduce((sum, d) => sum + Math.min(3, d), 0) / distances.length / 3 * 100
    : 100;

  return {
    score: Number(clamp(distancePenalty + missingPct * 0.5, 0, 100).toFixed(2)),
    missingPct: Number(missingPct.toFixed(2))
  };
}

function uncertaintyScore({ probability, features = {}, model = {}, policy = DEFAULT_POLICY } = {}) {
  const sample = model.trainingSample || {};
  const metrics = model.validationMetrics || {};
  const n = Math.max(1, Number(sample.resolvedTrades || 0));
  const sampleComponent = clamp(50 * Math.sqrt(policy.minResolvedTrades / n), 0, 100);
  const calibrationComponent = clamp((finite(metrics.ece) ?? 1) * 100, 0, 100);
  const ood = outOfDistributionScore(features, model);
  const entropyComponent = predictiveEntropyScore(probability);
  const missingComponent = ood.missingPct;

  const score =
    sampleComponent * 0.20 +
    calibrationComponent * 0.25 +
    ood.score * 0.30 +
    entropyComponent * 0.20 +
    missingComponent * 0.05;

  return Object.freeze({
    score: Number(clamp(score, 0, 100).toFixed(2)),
    level: score <= 35 ? 'LOW' : score <= policy.maxUncertaintyScore ? 'MEDIUM' : 'HIGH',
    components: Object.freeze({
      sample: Number(sampleComponent.toFixed(2)),
      calibration: Number(calibrationComponent.toFixed(2)),
      outOfDistribution: ood.score,
      predictiveEntropy: entropyComponent,
      missingFeatures: missingComponent
    })
  });
}

function noTrade(reason, base) {
  return Object.freeze({
    ...base,
    status: reason,
    decision: 'NO_TRADE',
    researchCandidate: false,
    usedForCurrentAppSelection: false,
    executionAllowed: false
  });
}

function evaluateInstitutionalDecision({
  row = {},
  marketRegime = {},
  model = {},
  forwardSummary = {},
  policy = DEFAULT_POLICY
} = {}) {
  const ticker = row.ticker || row.symbol || null;
  const features = extractFeatures(row, marketRegime);
  const readiness = modelReadiness(model, forwardSummary, policy);
  const breakEvenPct = breakEvenProbabilityPct(row, policy);

  const base = {
    schemaVersion: 'astra-v5-institutional-decision/v1',
    engineId: 'ASTRA_V5_INSTITUTIONAL_DECISION_LAYER',
    ticker,
    source: row.source || null,
    modelVersion: model.modelVersion || null,
    breakEvenProbabilityPct: breakEvenPct,
    probabilityTarget1Pct: null,
    probabilityEdgePct: null,
    expectedValuePct: null,
    uncertainty: null,
    features,
    readiness,
    policyVersion: policy.version,
    researchOnly: true,
    usedForCurrentAppSelection: false,
    executionAllowed: false
  };

  if (!readiness.ready) return noTrade('NO_TRADE_UNCALIBRATED', base);

  const raw = rawModelProbability(model, features);
  if (raw === null) return noTrade('NO_TRADE_MODEL_INPUT_INCOMPLETE', base);

  const calibrated = applyIsotonicCalibration(raw, model.calibration || {});
  if (calibrated === null) return noTrade('NO_TRADE_CALIBRATION_FAILURE', base);

  const probabilityTarget1Pct = Number((calibrated * 100).toFixed(2));
  const ev = expectedValuePct(row, probabilityTarget1Pct, policy);
  const uncertainty = uncertaintyScore({ probability: calibrated, features, model, policy });
  const probabilityEdgePct = breakEvenPct === null
    ? null
    : Number((probabilityTarget1Pct - breakEvenPct).toFixed(2));

  const enriched = {
    ...base,
    probabilityTarget1Pct,
    probabilityEdgePct,
    expectedValuePct: ev,
    uncertainty
  };

  if (breakEvenPct === null || ev === null) return noTrade('NO_TRADE_TRADE_PLAN_INVALID', enriched);
  if ((finite(row.dataQualityScore) ?? 0) < policy.minDataQualityScore) return noTrade('NO_TRADE_DATA_QUALITY', enriched);
  if ((finite(row.liquidityScore) ?? 0) < policy.minLiquidityScore) return noTrade('NO_TRADE_LIQUIDITY', enriched);
  if (String(row.morningStatus || '').toUpperCase().includes('REJECT')) return noTrade('NO_TRADE_MORNING_REJECTED', enriched);
  if (uncertainty.score > policy.maxUncertaintyScore) return noTrade('NO_TRADE_UNCERTAINTY', enriched);
  if (probabilityEdgePct < policy.minProbabilityEdgePct) return noTrade('NO_TRADE_EDGE_TOO_SMALL', enriched);
  if (ev < policy.minExpectedValuePct) return noTrade('NO_TRADE_EV_LOW', enriched);

  return Object.freeze({
    ...enriched,
    status: 'RESEARCH_CANDIDATE',
    decision: 'RESEARCH_CANDIDATE',
    researchCandidate: true,
    usedForCurrentAppSelection: false,
    executionAllowed: false
  });
}

function evaluateInstitutionalBoard({
  rows = [],
  marketRegime = {},
  model = {},
  forwardSummary = {},
  policy = DEFAULT_POLICY
} = {}) {
  const decisions = (rows || []).map(row => evaluateInstitutionalDecision({
    row,
    marketRegime,
    model,
    forwardSummary,
    policy
  }));

  const statusCounts = decisions.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});

  return Object.freeze({
    schemaVersion: 'astra-v5-institutional-board/v1',
    engineId: 'ASTRA_V5_INSTITUTIONAL_DECISION_LAYER',
    generatedAt: new Date().toISOString(),
    researchOnly: true,
    usedForCurrentAppSelection: false,
    executionAllowed: false,
    modelReadiness: modelReadiness(model, forwardSummary, policy),
    statusCounts: Object.freeze(statusCounts),
    decisions: Object.freeze(decisions)
  });
}

module.exports = {
  DEFAULT_POLICY,
  FEATURE_NAMES,
  finite,
  extractFeatures,
  modelReadiness,
  rawModelProbability,
  applyIsotonicCalibration,
  breakEvenProbabilityPct,
  expectedValuePct,
  uncertaintyScore,
  evaluateInstitutionalDecision,
  evaluateInstitutionalBoard
};
