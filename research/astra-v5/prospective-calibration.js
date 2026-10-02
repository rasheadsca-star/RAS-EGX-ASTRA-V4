'use strict';

/**
 * ASTRA V5 prospective-only calibration lab.
 *
 * No retrospective rows are accepted as proof of calibration readiness.
 * Chronology is preserved: train -> calibrate -> untouched validation.
 */

const {
  DEFAULT_POLICY,
  FEATURE_NAMES,
  finite
} = require('./institutional-decision-engine');

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function sigmoid(x) {
  if (x >= 0) {
    const z = Math.exp(-x);
    return 1 / (1 + z);
  }
  const z = Math.exp(x);
  return z / (1 + z);
}

function labelFromOutcome(record = {}) {
  if (typeof record.targetBeforeStop === 'boolean') return record.targetBeforeStop ? 1 : 0;
  const outcome = String(record.outcome || '').toUpperCase();
  if (outcome === 'TARGET1' || outcome === 'TARGET2' || outcome === 'TARGET3') return 1;
  if (outcome === 'STOP') return 0;
  return null;
}

function isProspective(record = {}) {
  return record.prospectiveOnly === true ||
    String(record.source || '').toUpperCase().includes('PROSPECTIVE') ||
    String(record.source || '').toUpperCase().includes('FORWARD');
}

function normalizeRecord(record = {}, featureNames = FEATURE_NAMES) {
  const y = labelFromOutcome(record);
  const features = record.features || {};
  if (y === null || !isProspective(record)) return null;

  return {
    capturedAt: record.capturedAt || record.resolvedAt || record.sessionDate || null,
    sessionDate: record.sessionDate || null,
    y,
    features: Object.fromEntries(featureNames.map(name => [name, finite(features[name])]))
  };
}

function sortChronologically(records = []) {
  return [...records].sort((a, b) =>
    String(a.capturedAt || a.sessionDate || '').localeCompare(String(b.capturedAt || b.sessionDate || ''))
  );
}

function splitChronological(records = []) {
  const n = records.length;
  const trainEnd = Math.max(1, Math.floor(n * 0.60));
  const calibrationEnd = Math.max(trainEnd + 1, Math.floor(n * 0.80));
  return {
    train: records.slice(0, trainEnd),
    calibration: records.slice(trainEnd, calibrationEnd),
    validation: records.slice(calibrationEnd)
  };
}

function fitNormalization(records = [], featureNames = FEATURE_NAMES) {
  const normalization = {};
  for (const name of featureNames) {
    const values = records.map(row => finite(row.features[name])).filter(v => v !== null);
    const mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    const variance = values.length
      ? values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length
      : 0;
    const std = Math.sqrt(variance) || 1;
    normalization[name] = { mean, std };
  }
  return normalization;
}

function vectorize(record, normalization, featureNames = FEATURE_NAMES) {
  return featureNames.map(name => {
    const value = finite(record.features[name]);
    const mean = finite(normalization[name]?.mean) ?? 0;
    const std = finite(normalization[name]?.std) || 1;
    return value === null ? 0 : (value - mean) / std;
  });
}

function trainLogistic(records = [], normalization = {}, featureNames = FEATURE_NAMES, options = {}) {
  const learningRate = finite(options.learningRate) ?? 0.03;
  const l2 = finite(options.l2) ?? 0.01;
  const iterations = Math.max(200, Number(options.iterations || 1800));

  let intercept = 0;
  const weights = Array(featureNames.length).fill(0);

  for (let iter = 0; iter < iterations; iter += 1) {
    let gradIntercept = 0;
    const grad = Array(weights.length).fill(0);

    for (const row of records) {
      const x = vectorize(row, normalization, featureNames);
      const score = intercept + x.reduce((sum, value, i) => sum + value * weights[i], 0);
      const p = sigmoid(score);
      const error = p - row.y;
      gradIntercept += error;
      for (let i = 0; i < weights.length; i += 1) grad[i] += error * x[i];
    }

    const n = Math.max(1, records.length);
    intercept -= learningRate * gradIntercept / n;
    for (let i = 0; i < weights.length; i += 1) {
      weights[i] -= learningRate * (grad[i] / n + l2 * weights[i]);
    }
  }

  return {
    intercept,
    coefficients: Object.fromEntries(featureNames.map((name, i) => [name, weights[i]]))
  };
}

function predictRaw(model = {}, record = {}) {
  let score = finite(model.intercept);
  if (score === null) return null;

  for (const name of model.features || FEATURE_NAMES) {
    const coefficient = finite(model.coefficients?.[name]);
    const mean = finite(model.normalization?.[name]?.mean);
    const std = finite(model.normalization?.[name]?.std);
    const value = finite(record.features?.[name]);
    if (coefficient === null || mean === null || !(std > 0)) return null;
    const z = value === null ? 0 : (value - mean) / std;
    score += coefficient * z;
  }

  return sigmoid(score);
}

function fitIsotonic(samples = []) {
  const ordered = samples
    .map(item => ({ x: finite(item.p), y: finite(item.y), weight: 1 }))
    .filter(item => item.x !== null && item.y !== null)
    .sort((a, b) => a.x - b.x);

  if (!ordered.length) return [];

  const blocks = [];
  for (const item of ordered) {
    blocks.push({
      minX: item.x,
      maxX: item.x,
      sumY: item.y,
      weight: item.weight
    });

    while (blocks.length >= 2) {
      const b = blocks[blocks.length - 1];
      const a = blocks[blocks.length - 2];
      const meanA = a.sumY / a.weight;
      const meanB = b.sumY / b.weight;
      if (meanA <= meanB) break;

      blocks.splice(blocks.length - 2, 2, {
        minX: a.minX,
        maxX: b.maxX,
        sumY: a.sumY + b.sumY,
        weight: a.weight + b.weight
      });
    }
  }

  const points = [];
  for (const block of blocks) {
    const y = block.sumY / block.weight;
    points.push({ x: block.minX, y });
    if (block.maxX !== block.minX) points.push({ x: block.maxX, y });
  }

  return points
    .sort((a, b) => a.x - b.x)
    .map(point => ({
      x: Number(clamp(point.x).toFixed(6)),
      y: Number(clamp(point.y).toFixed(6))
    }));
}

function applyIsotonic(p, points = []) {
  if (!points.length) return clamp(p);
  const ordered = [...points].sort((a, b) => a.x - b.x);
  if (p <= ordered[0].x) return clamp(ordered[0].y);

  for (let i = 1; i < ordered.length; i += 1) {
    if (p <= ordered[i].x) {
      const left = ordered[i - 1];
      const right = ordered[i];
      if (right.x === left.x) return clamp(right.y);
      const t = (p - left.x) / (right.x - left.x);
      return clamp(left.y + t * (right.y - left.y));
    }
  }

  return clamp(ordered.at(-1).y);
}

function brierScore(samples = []) {
  if (!samples.length) return null;
  return samples.reduce((sum, item) => sum + (item.p - item.y) ** 2, 0) / samples.length;
}

function expectedCalibrationError(samples = [], bins = 10) {
  if (!samples.length) return null;
  let ece = 0;

  for (let b = 0; b < bins; b += 1) {
    const low = b / bins;
    const high = (b + 1) / bins;
    const bucket = samples.filter(item =>
      b === bins - 1 ? item.p >= low && item.p <= high : item.p >= low && item.p < high
    );
    if (!bucket.length) continue;
    const avgP = bucket.reduce((s, item) => s + item.p, 0) / bucket.length;
    const avgY = bucket.reduce((s, item) => s + item.y, 0) / bucket.length;
    ece += bucket.length / samples.length * Math.abs(avgP - avgY);
  }

  return ece;
}

function classificationCounts(records = []) {
  const positiveOutcomes = records.filter(row => row.y === 1).length;
  const negativeOutcomes = records.filter(row => row.y === 0).length;
  return { positiveOutcomes, negativeOutcomes };
}

function uniqueSessions(records = []) {
  return new Set(records.map(row => row.sessionDate).filter(Boolean)).size;
}

function observedCalendarDays(records = []) {
  const dates = records
    .map(row => row.capturedAt || row.sessionDate)
    .filter(Boolean)
    .map(value => new Date(value))
    .filter(date => !Number.isNaN(date.getTime()))
    .sort((a, b) => a - b);

  if (!dates.length) return 0;
  return Math.floor((dates.at(-1) - dates[0]) / 86400000) + 1;
}

function trainProspectiveModel({
  records = [],
  featureNames = FEATURE_NAMES,
  policy = DEFAULT_POLICY,
  modelVersion = 'astra-v5-prospective-model'
} = {}) {
  const prospective = sortChronologically(
    records.map(record => normalizeRecord(record, featureNames)).filter(Boolean)
  );
  const counts = classificationCounts(prospective);
  const sessions = uniqueSessions(prospective);
  const days = observedCalendarDays(prospective);

  const insufficient =
    prospective.length < policy.minResolvedTrades ||
    counts.positiveOutcomes < policy.minPositiveOutcomes ||
    counts.negativeOutcomes < policy.minNegativeOutcomes ||
    sessions < policy.minForwardSessions ||
    days < policy.minObservedCalendarDays;

  if (insufficient) {
    return {
      schemaVersion: 'astra-v5-prospective-model/v1',
      modelVersion,
      status: 'NOT_CALIBRATED',
      prospectiveOnly: true,
      target: 'TARGET1_BEFORE_STOP_WITHIN_MAX_HOLD',
      features: [...featureNames],
      trainingSample: {
        prospectiveOnly: true,
        resolvedTrades: prospective.length,
        forwardSessions: sessions,
        observedCalendarDays: days,
        ...counts
      },
      intercept: null,
      coefficients: {},
      normalization: {},
      calibration: { method: 'ISOTONIC_PAV', points: [] },
      validationMetrics: {
        brierScore: null,
        baseRateBrierScore: null,
        brierSkillScore: null,
        ece: null
      },
      executionAllowed: false,
      usedForCurrentAppSelection: false
    };
  }

  const split = splitChronological(prospective);
  const normalization = fitNormalization(split.train, featureNames);
  const logistic = trainLogistic(split.train, normalization, featureNames);
  const baseModel = {
    features: [...featureNames],
    normalization,
    intercept: logistic.intercept,
    coefficients: logistic.coefficients
  };

  const calibrationSamples = split.calibration
    .map(row => ({ p: predictRaw(baseModel, row), y: row.y }))
    .filter(item => item.p !== null);
  const points = fitIsotonic(calibrationSamples);

  const validationSamples = split.validation
    .map(row => {
      const raw = predictRaw(baseModel, row);
      return raw === null ? null : { p: applyIsotonic(raw, points), y: row.y };
    })
    .filter(Boolean);

  const brier = brierScore(validationSamples);
  const baseRate = split.train.reduce((sum, row) => sum + row.y, 0) / Math.max(1, split.train.length);
  const baseSamples = split.validation.map(row => ({ p: baseRate, y: row.y }));
  const baseBrier = brierScore(baseSamples);
  const brierSkill = brier !== null && baseBrier > 0 ? 1 - brier / baseBrier : null;
  const ece = expectedCalibrationError(validationSamples);

  const metrics = {
    brierScore: brier === null ? null : Number(brier.toFixed(6)),
    baseRateBrierScore: baseBrier === null ? null : Number(baseBrier.toFixed(6)),
    brierSkillScore: brierSkill === null ? null : Number(brierSkill.toFixed(6)),
    ece: ece === null ? null : Number(ece.toFixed(6)),
    validationSize: validationSamples.length
  };

  const passesMetrics =
    validationSamples.length >= Math.max(18, Math.floor(policy.minResolvedTrades * 0.15)) &&
    metrics.ece !== null &&
    metrics.ece <= policy.maxValidationEce &&
    metrics.brierSkillScore !== null &&
    metrics.brierSkillScore >= policy.minBrierSkillScore;

  return {
    schemaVersion: 'astra-v5-prospective-model/v1',
    modelVersion,
    status: passesMetrics ? 'CALIBRATED' : 'VALIDATION_FAILED',
    prospectiveOnly: true,
    target: 'TARGET1_BEFORE_STOP_WITHIN_MAX_HOLD',
    features: [...featureNames],
    trainingSample: {
      prospectiveOnly: true,
      resolvedTrades: prospective.length,
      forwardSessions: sessions,
      observedCalendarDays: days,
      ...counts,
      trainRows: split.train.length,
      calibrationRows: split.calibration.length,
      validationRows: split.validation.length
    },
    intercept: Number(logistic.intercept.toFixed(10)),
    coefficients: Object.fromEntries(
      Object.entries(logistic.coefficients).map(([k, v]) => [k, Number(v.toFixed(10))])
    ),
    normalization,
    calibration: {
      method: 'ISOTONIC_PAV',
      fittedOnChronologicalHoldout: true,
      points
    },
    validationMetrics: metrics,
    executionAllowed: false,
    usedForCurrentAppSelection: false,
    automaticPromotionAllowed: false
  };
}

module.exports = {
  labelFromOutcome,
  normalizeRecord,
  splitChronological,
  fitNormalization,
  trainLogistic,
  fitIsotonic,
  applyIsotonic,
  brierScore,
  expectedCalibrationError,
  trainProspectiveModel
};
