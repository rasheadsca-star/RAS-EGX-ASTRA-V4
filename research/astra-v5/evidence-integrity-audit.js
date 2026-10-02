'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const LEDGER_PATH = path.join(ROOT, 'data', 'prospective-evidence.json');
const TRAINING_PATH = path.join(ROOT, 'data', 'training-records.json');

function dateOnly(value) {
  const m = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function audit({ ledger = readJson(LEDGER_PATH), training = readJson(TRAINING_PATH) } = {}) {
  const errors = [];
  const warnings = [];
  const cohortIds = new Set();
  const recordIds = new Set();
  let candidateCount = 0;
  let resolvedCount = 0;

  if (ledger?.safety?.prospectiveOnly !== true) errors.push('LEDGER_NOT_PROSPECTIVE_ONLY');
  if (ledger?.safety?.executionAllowed !== false) errors.push('LEDGER_EXECUTION_PERMISSION_BREACH');
  if (ledger?.safety?.writesToProductionData !== false) errors.push('LEDGER_PRODUCTION_WRITE_BREACH');
  if (training?.prospectiveOnly !== true) errors.push('TRAINING_NOT_PROSPECTIVE_ONLY');

  for (const cohort of ledger.cohorts || []) {
    const decisionDate = dateOnly(cohort.decisionSessionDate);
    const targetDate = dateOnly(cohort.targetSessionDate);
    if (!cohort.cohortId) errors.push('COHORT_ID_MISSING');
    else if (cohortIds.has(cohort.cohortId)) errors.push(`DUPLICATE_COHORT_ID:${cohort.cohortId}`);
    else cohortIds.add(cohort.cohortId);

    if (!decisionDate) errors.push(`COHORT_DECISION_DATE_INVALID:${cohort.cohortId || 'UNKNOWN'}`);
    if (targetDate && decisionDate && targetDate < decisionDate) {
      errors.push(`TARGET_PRECEDES_DECISION:${cohort.cohortId}`);
    }
    if (cohort.observationPolicy?.prospectiveOnly !== true) {
      errors.push(`COHORT_POLICY_NOT_PROSPECTIVE:${cohort.cohortId}`);
    }
    if (cohort.observationPolicy?.executionAllowed !== false) {
      errors.push(`COHORT_EXECUTION_PERMISSION_BREACH:${cohort.cohortId}`);
    }

    const tickers = new Set();
    for (const candidate of cohort.candidates || []) {
      candidateCount += 1;
      const ticker = String(candidate.ticker || '');
      if (!ticker) errors.push(`CANDIDATE_TICKER_MISSING:${cohort.cohortId}`);
      else if (tickers.has(ticker)) errors.push(`DUPLICATE_CANDIDATE:${cohort.cohortId}:${ticker}`);
      else tickers.add(ticker);

      if (candidate.prospectiveOnly !== true) errors.push(`CANDIDATE_NOT_PROSPECTIVE:${cohort.cohortId}:${ticker}`);
      if (candidate.executionAllowed !== false) errors.push(`CANDIDATE_EXECUTION_PERMISSION_BREACH:${cohort.cohortId}:${ticker}`);

      const outcome = candidate.outcome || {};
      if (typeof outcome.targetBeforeStop === 'boolean') {
        resolvedCount += 1;
        const entryDate = dateOnly(outcome.entrySession);
        const exitDate = dateOnly(outcome.exitSession);
        if (entryDate && targetDate && entryDate < targetDate) {
          errors.push(`ENTRY_BEFORE_TARGET_SESSION:${cohort.cohortId}:${ticker}`);
        }
        if (exitDate && entryDate && exitDate < entryDate) {
          errors.push(`EXIT_BEFORE_ENTRY:${cohort.cohortId}:${ticker}`);
        }
        if (!outcome.resolvedAt) warnings.push(`RESOLVED_TIMESTAMP_MISSING:${cohort.cohortId}:${ticker}`);
      }
    }
  }

  for (const record of training.records || []) {
    if (!record.recordId) errors.push('TRAINING_RECORD_ID_MISSING');
    else if (recordIds.has(record.recordId)) errors.push(`DUPLICATE_TRAINING_RECORD:${record.recordId}`);
    else recordIds.add(record.recordId);

    if (record.prospectiveOnly !== true) errors.push(`TRAINING_ROW_NOT_PROSPECTIVE:${record.recordId}`);
    if (typeof record.targetBeforeStop !== 'boolean') errors.push(`TRAINING_LABEL_INVALID:${record.recordId}`);

    const sessionDate = dateOnly(record.sessionDate);
    const targetDate = dateOnly(record.targetSessionDate);
    const entryDate = dateOnly(record.entrySession);
    const exitDate = dateOnly(record.exitSession);
    if (targetDate && sessionDate && targetDate < sessionDate) errors.push(`TRAINING_TARGET_PRECEDES_DECISION:${record.recordId}`);
    if (entryDate && targetDate && entryDate < targetDate) errors.push(`TRAINING_ENTRY_BEFORE_TARGET:${record.recordId}`);
    if (exitDate && entryDate && exitDate < entryDate) errors.push(`TRAINING_EXIT_BEFORE_ENTRY:${record.recordId}`);
  }

  if ((training.records || []).length !== resolvedCount) {
    errors.push(`TRAINING_RESOLVED_COUNT_MISMATCH:${(training.records || []).length}:${resolvedCount}`);
  }

  return {
    schemaVersion: 'astra-v5-evidence-integrity-audit/v1',
    passed: errors.length === 0,
    auditedAt: new Date().toISOString(),
    counts: {
      cohorts: cohortIds.size,
      candidates: candidateCount,
      resolvedCandidates: resolvedCount,
      trainingRecords: (training.records || []).length
    },
    errors,
    warnings,
    safety: {
      retrospectiveRowsAccepted: false,
      executionAllowed: false,
      productionWritesAllowed: false
    }
  };
}

if (require.main === module) {
  try {
    const result = audit();
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (!result.passed) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(JSON.stringify({
      schemaVersion: 'astra-v5-evidence-integrity-audit/v1',
      passed: false,
      error: error?.message || 'EVIDENCE_AUDIT_FAILED'
    }, null, 2) + '\n');
    process.exitCode = 1;
  }
}

module.exports = { audit };
