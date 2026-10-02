'use strict';

const assert = require('assert');
const { runV5Shadow } = require('./shadow-runner');

async function main() {
  const result = await runV5Shadow();

  assert.strictEqual(result.safety.researchOnly, true);
  assert.strictEqual(result.safety.executionAllowed, false);
  assert.strictEqual(result.safety.usedForCurrentAppSelection, false);
  assert.strictEqual(result.isolation.productionApiChanged, false);
  assert.strictEqual(result.isolation.productionUiChanged, false);
  assert.strictEqual(result.isolation.productionSelectionChanged, false);
  assert.strictEqual(result.isolation.writesToProductionData, false);

  assert(result.source.rowCount > 0, 'Expected current ASTRA/UCP opportunity rows');
  assert.strictEqual(result.model.status, 'NOT_CALIBRATED');
  assert.strictEqual(result.model.readiness.ready, false);
  assert.strictEqual(result.summary.researchCandidateCount, 0);
  assert.strictEqual(result.summary.noTradeCount, result.summary.evaluatedRows);

  for (const decision of result.decisions) {
    assert.strictEqual(decision.status, 'NO_TRADE_UNCALIBRATED');
    assert.strictEqual(decision.probabilityTarget1Pct, null);
    assert.strictEqual(decision.expectedValuePct, null);
    assert.strictEqual(decision.researchCandidate, false);
    assert.strictEqual(decision.executionAllowed, false);
    assert.strictEqual(decision.usedForCurrentAppSelection, false);
  }

  console.log(JSON.stringify({
    validation: 'ASTRA_V5_SHADOW_CURRENT_DATA_PASS',
    marketSessionDate: result.source.marketSessionDate,
    snapshotMode: result.source.snapshotMode,
    ucpStatus: result.source.ucpStatus,
    evaluatedRows: result.summary.evaluatedRows,
    researchCandidateCount: result.summary.researchCandidateCount,
    modelStatus: result.model.status,
    executionAllowed: result.safety.executionAllowed
  }));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
