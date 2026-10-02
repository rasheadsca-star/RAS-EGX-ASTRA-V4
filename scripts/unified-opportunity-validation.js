'use strict';

const assert = require('assert');
const {
  structuralRrScore,
  stopRiskPct,
  combinedRiskSafety,
  weightedScore,
  buildUnifiedOpportunityBoard
} = require('../engine/ucp/unified-opportunity');

assert.strictEqual(structuralRrScore(0.68), 40);
assert.strictEqual(structuralRrScore(0.70), 42);

const rrRow = {
  entryLow: 57.52,
  entryHigh: 59.0013,
  stopLoss: 54.7913,
  structuralNetRR: 0.685
};
assert(stopRiskPct(rrRow) > 7 && stopRiskPct(rrRow) < 8);
assert(combinedRiskSafety(rrRow, { riskLevel: 'HIGH' }) < combinedRiskSafety(rrRow, { riskLevel: 'LOW' }));

const full = weightedScore({
  technical: 75.3,
  research: 73.5,
  liquidity: 98,
  supportResistance: 69.9,
  structuralRR: structuralRrScore(0.685),
  riskSafety: combinedRiskSafety(rrRow, { riskLevel: 'HIGH' }),
  dataQuality: 78
});
assert.strictEqual(full.coveragePct, 100);
assert(full.score > 0 && full.score < 100);

const runtime = {
  recommendations: [{
    symbol: 'AAA',
    confidence: 88,
    riskLevel: 'LOW',
    entry: 10,
    stopLoss: 9.5,
    target1: 11,
    analysis: { technicalScore: 88, liquidity: 75 }
  }, {
    symbol: 'BINV',
    confidence: 75,
    riskLevel: 'HIGH',
    entry: 59,
    stopLoss: 54.8,
    target1: 62.48,
    analysis: { technicalScore: 75, liquidity: 80 }
  }],
  watchlist: [],
  rejected: []
};

const ucp = {
  snapshot: {
    sessionDate: '2026-10-01',
    alpha: {
      challengers: [{
        id: 'TFE_V20_FUSION_RC2_RR68_CHALLENGER',
        candidates: [{ ticker: 'BINV' }]
      }]
    },
    morningConfirmation: {
      status: 'WAITING_NEXT_SESSION',
      preparedCandidates: [{
        ticker: 'BINV',
        lifecycleState: 'PREPARED'
      }]
    }
  },
  diagnostics: {
    rc2: {
      marketScoreboard: [{
        ticker: 'AAA',
        coreScore: 65,
        researchScore: 64,
        liquidityScore: 90,
        srScore: 70,
        dataQualityScore: 78,
        structuralNetRR: 1.1,
        entryLow: 9.8,
        entryHigh: 10,
        stopLoss: 9.5,
        target1: 11,
        eligible: false,
        publicationEligible: false,
        nearMiss: false,
        reasonCodes: ['CORE_SCORE_LOW','RESEARCH_SCORE_LOW']
      }, {
        ticker: 'BINV',
        coreScore: 75.3,
        researchScore: 73.5,
        liquidityScore: 98,
        srScore: 69.9,
        dataQualityScore: 78,
        structuralNetRR: 0.685,
        entryLow: 57.52,
        entryHigh: 59.0013,
        stopLoss: 54.7913,
        target1: 62.48,
        target2: 62.48,
        eligible: false,
        publicationEligible: false,
        nearMiss: true,
        reasonCodes: ['STRUCTURAL_RR_LOW']
      }]
    }
  }
};

const board = buildUnifiedOpportunityBoard({ runtime, ucp });
assert.strictEqual(board.executionAllowed, false);
assert.strictEqual(board.confidencePolicy.usedInUnifiedScore, false);
assert.strictEqual(board.rows.length, 2);

const binv = board.rows.find((row) => row.ticker === 'BINV');
const aaa = board.rows.find((row) => row.ticker === 'AAA');
assert.strictEqual(binv.source, 'RR68_CHALLENGER');
assert.strictEqual(binv.selectedByUcp, true);
assert.strictEqual(binv.morningStatus, 'PREPARED');
assert.strictEqual(binv.confidence.source, 'ASTRA_TECHNICAL_PROXY');
assert.strictEqual(binv.confidence.usedInUnifiedScore, false);
assert.strictEqual(aaa.source, 'ASTRA_NATIVE_ENTRY');
assert.strictEqual(aaa.selectedByUcp, false);

console.log(JSON.stringify({
  ok: true,
  binvUnifiedScore: binv.unifiedScore,
  aaaUnifiedScore: aaa.unifiedScore,
  binvRank: binv.unifiedRank,
  aaaRank: aaa.unifiedRank
}, null, 2));
