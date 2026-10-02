'use strict';

const fs = require('fs');
const path = require('path');

const { runRuntimePipeline } = require('../../engine/runtime-pipeline');
const { runUcpShadowPipeline } = require('../../engine/ucp/shadow-pipeline');
const { buildUnifiedOpportunityBoard } = require('../../engine/ucp/unified-opportunity');
const {
  evaluateInstitutionalBoard,
  DEFAULT_POLICY
} = require('./institutional-decision-engine');

const MODEL_PATH = path.join(__dirname, 'model.json');
const FORWARD_LEDGER_PATH = path.join(process.cwd(), 'data', 'ucp', 'forward-ledger.json');

function readJson(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_error) {
    return fallback;
  }
}

async function runV5Shadow() {
  const [runtime, ucp] = await Promise.all([
    runRuntimePipeline(),
    runUcpShadowPipeline()
  ]);

  const board = buildUnifiedOpportunityBoard({ runtime, ucp });
  const model = readJson(MODEL_PATH, {
    status: 'MODEL_UNAVAILABLE',
    trainingSample: {},
    validationMetrics: {}
  });
  const forwardLedger = readJson(FORWARD_LEDGER_PATH, { summary: {} });

  const v5 = evaluateInstitutionalBoard({
    rows: board.rows || [],
    marketRegime: board.marketRegime || {},
    model,
    forwardSummary: forwardLedger.summary || {},
    policy: DEFAULT_POLICY
  });

  const researchCandidates = v5.decisions.filter(item => item.researchCandidate === true);

  return Object.freeze({
    schemaVersion: 'astra-v5-shadow-run/v1',
    generatedAt: new Date().toISOString(),
    source: {
      marketSessionDate: board.sessionDate || runtime.marketSessionDate || null,
      snapshotMode: runtime.snapshotMode || null,
      sourceSessionDataHash: runtime.sourceSessionDataHash || null,
      ucpStatus: ucp.status || null,
      rowCount: (board.rows || []).length
    },
    isolation: {
      branchOnly: true,
      productionApiChanged: false,
      productionUiChanged: false,
      productionSelectionChanged: false,
      writesToProductionData: false,
      deploymentRequired: false
    },
    safety: {
      researchOnly: true,
      executionAllowed: false,
      usedForCurrentAppSelection: false,
      automaticPromotionAllowed: false
    },
    policy: DEFAULT_POLICY,
    model: {
      modelVersion: model.modelVersion || null,
      status: model.status || 'UNKNOWN',
      readiness: v5.modelReadiness
    },
    summary: {
      evaluatedRows: v5.decisions.length,
      researchCandidateCount: researchCandidates.length,
      noTradeCount: v5.decisions.length - researchCandidates.length,
      statusCounts: v5.statusCounts
    },
    researchCandidates,
    decisions: v5.decisions
  });
}

if (require.main === module) {
  runV5Shadow()
    .then(result => {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    })
    .catch(error => {
      process.stderr.write(JSON.stringify({
        schemaVersion: 'astra-v5-shadow-run/v1',
        researchOnly: true,
        executionAllowed: false,
        error: error?.message || 'ASTRA_V5_SHADOW_RUN_FAILED'
      }, null, 2) + '\n');
      process.exitCode = 1;
    });
}

module.exports = {
  runV5Shadow
};
