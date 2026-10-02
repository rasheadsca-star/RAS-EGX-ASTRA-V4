'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { trainProspectiveModel } = require('./prospective-calibration');
const { DEFAULT_POLICY: MODEL_POLICY } = require('./institutional-decision-engine');
const SECTOR_MAP = require('./sector-map.json');

const ROOT = __dirname;
const LEDGER_PATH = path.join(ROOT, 'data', 'prospective-evidence.json');
const TRAINING_PATH = path.join(ROOT, 'data', 'training-records.json');
const MODEL_PATH = path.join(ROOT, 'model.json');

const PROD_URL = process.env.ASTRA_V5_PROD_URL || 'https://ras-egx-astra-v4.vercel.app';
const HISTORY_BASE = process.env.ASTRA_V5_HISTORY_BASE ||
  'https://raw.githubusercontent.com/rasheadsca-star/RAS-EGX-PRO2026-NEXT/main/data/history';

const POLICY = Object.freeze({
  version: 'astra-v5-prospective-evidence-policy/v2',
  maxCandidatesPerSession: 60,
  minScoreCoveragePct: 70,
  minDataQualityScore: 40,
  minLiquidityScore: 30,
  entryExpirySessions: 3,
  maxHoldSessions: 10,
  roundTripCostPct: 0.60,
  slippagePct: 0.15,
  sameBarAmbiguity: 'STOP_FIRST',
  targetDefinition: 'TARGET1_BEFORE_STOP_WITHIN_MAX_HOLD',
  prospectiveOnly: true,
  executionAllowed: false
});

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value, digits = 6) {
  const n = finite(value);
  if (n === null) return null;
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}

function dateOnly(value) {
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((out, key) => {
      out[key] = stable(value[key]);
      return out;
    }, {});
  }
  return value;
}

function hashObject(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_error) {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

async function fetchJson(url, attempts = 4) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'Cache-Control': 'no-cache',
          'User-Agent': 'ASTRA-V5-PROSPECTIVE-FACTORY/1.0'
        },
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, 1500 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error('FETCH_FAILED');
}

function sectorForTicker(ticker) {
  const key = String(ticker || '').toUpperCase();
  const mapped = SECTOR_MAP?.symbolToSector?.[key] || null;
  return {
    sector: mapped || SECTOR_MAP.unknownLabel || 'غير مصنف',
    sectorSource: mapped ? 'LEGACY_SECTOR_MAP_EXACT' : 'UNCLASSIFIED'
  };
}

function tradePlan(row = {}) {
  const entryLow = finite(row.entryLow ?? row.entry);
  const entryHigh = finite(row.entryHigh ?? row.entry);
  const stopLoss = finite(row.stopLoss);
  const target1 = finite(row.target1);
  const target2 = finite(row.target2);

  const low = entryLow ?? entryHigh;
  const high = entryHigh ?? entryLow;
  if (!(low > 0) || !(high > 0) || !(stopLoss > 0) || !(target1 > 0)) return null;
  if (high < low || stopLoss >= high || target1 <= low) return null;

  return Object.freeze({
    entryLow: round(low),
    entryHigh: round(high),
    stopLoss: round(stopLoss),
    target1: round(target1),
    target2: round(target2),
    roundTripCostPct: round(finite(row.roundTripCostPct) ?? POLICY.roundTripCostPct, 4),
    slippagePct: round(finite(row.estimatedSlippagePct) ?? POLICY.slippagePct, 4)
  });
}

function featureSnapshot(row = {}, marketRegime = {}) {
  const cross = row.crossSectional || {};
  return Object.freeze({
    technicalScore: finite(row.technicalScore),
    researchScore: finite(row.researchScore),
    liquidityScore: finite(row.liquidityScore),
    supportResistanceScore: finite(row.supportResistanceScore),
    dataQualityScore: finite(row.dataQualityScore),
    structuralNetRR: finite(row.structuralNetRR),
    riskSafetyScore: finite(row.riskSafetyScore),
    technicalPercentile: finite(cross.technicalPercentile),
    researchPercentile: finite(cross.researchPercentile),
    liquidityPercentile: finite(cross.liquidityPercentile),
    supportResistancePercentile: finite(cross.supportResistancePercentile),
    structuralRrPercentile: finite(cross.structuralRrPercentile),
    riskSafetyPercentile: finite(cross.riskSafetyPercentile),
    crossSectionalScore: finite(row.crossSectionalScore),
    regimeScore: finite(marketRegime.score),
    regimeRiskMultiplier: finite(marketRegime.riskMultiplier)
  });
}

function eligibleObservationRows(board = {}) {
  const regime = board.marketRegime || {};
  return (board.rows || [])
    .map(row => ({ row, plan: tradePlan(row) }))
    .filter(({ row, plan }) => {
      if (!row?.ticker || !plan) return false;
      if ((finite(row.scoreCoveragePct) ?? 0) < POLICY.minScoreCoveragePct) return false;
      if ((finite(row.dataQualityScore) ?? 0) < POLICY.minDataQualityScore) return false;
      if ((finite(row.liquidityScore) ?? 0) < POLICY.minLiquidityScore) return false;
      return true;
    })
    .sort((a, b) =>
      (finite(a.row.unifiedRank) ?? 9999) - (finite(b.row.unifiedRank) ?? 9999) ||
      String(a.row.ticker).localeCompare(String(b.row.ticker))
    )
    .slice(0, POLICY.maxCandidatesPerSession)
    .map(({ row, plan }) => ({
      ticker: row.ticker,
      source: row.source || null,
      selectedByUcp: row.selectedByUcp === true,
      nearMiss: row.nearMiss === true,
      unifiedRank: finite(row.unifiedRank),
      unifiedScore: finite(row.unifiedScore),
      crossSectionalRank: finite(row.crossSectionalRank),
      crossSectionalScore: finite(row.crossSectionalScore),
      scoreCoveragePct: finite(row.scoreCoveragePct),
      riskLevel: row.riskLevel || 'UNKNOWN',
      ...(() => {
        if (row.sector || row.sectorName) return {
          sector: row.sector || row.sectorName,
          sectorSource: row.sectorSource || 'UNIFIED_BOARD'
        };
        return sectorForTicker(row.ticker);
      })(),
      morningAtCapture: row.morningStatus || 'NOT_PREPARED',
      reasonCodes: Array.isArray(row.reasonCodes) ? [...row.reasonCodes] : [],
      tradePlan: plan,
      decisionMarketState: Object.freeze({
        sessionDate: dateOnly(board.sessionDate),
        generatedAt: board.generatedAt || null,
        regime: regime.regime || 'UNKNOWN',
        regimeScore: finite(regime.score),
        regimeRiskMultiplier: finite(regime.riskMultiplier),
        maxTradeRiskPct: finite(regime.maxTradeRiskPct),
        unifiedRank: finite(row.unifiedRank),
        unifiedScore: finite(row.unifiedScore),
        crossSectionalRank: finite(row.crossSectionalRank),
        crossSectionalScore: finite(row.crossSectionalScore),
        dataQualityScore: finite(row.dataQualityScore),
        liquidityScore: finite(row.liquidityScore)
      }),
      slippage: {
        estimatedPct: plan.slippagePct,
        realizedProxyPct: null,
        measurement: 'NOT_YET_OBSERVED'
      },
      features: featureSnapshot(row, regime),
      evidenceVersion: 2,
      prospectiveOnly: true,
      executionAllowed: false,
      morningEvidence: [],
      outcome: {
        status: 'OPEN',
        targetBeforeStop: null,
        entered: false,
        entrySession: null,
        exitSession: null,
        fillPrice: null,
        exitPrice: null,
        entryReferencePrice: null,
        entrySlippageProxyPct: null,
        slippageMeasurement: 'NOT_YET_OBSERVED',
        grossReturnPct: null,
        netReturnPct: null,
        sourceLastSession: null,
        sameBarAmbiguity: null,
        resolvedAt: null
      }
    }));
}

function assertProductionBoard(board = {}) {
  if (board.success !== true) throw new Error('UNIFIED_BOARD_NOT_SUCCESSFUL');
  if (board.executionAllowed !== false) throw new Error('UNIFIED_BOARD_EXECUTION_PERMISSION_BREACH');
  if (!board.sessionDate) throw new Error('UNIFIED_BOARD_SESSION_MISSING');
  if (!Array.isArray(board.rows) || !board.rows.length) throw new Error('UNIFIED_BOARD_ROWS_MISSING');
}

function assertUcp(ucp = {}) {
  if (ucp.success !== true) throw new Error('UCP_NOT_SUCCESSFUL');
  if (ucp.executionAllowed !== false) throw new Error('UCP_EXECUTION_PERMISSION_BREACH');
  if (ucp.recommendationMutationAllowed !== false) throw new Error('UCP_RECOMMENDATION_MUTATION_BREACH');
}

async function fetchProductionEvidence() {
  const stamp = Date.now();
  const [board, ucp] = await Promise.all([
    fetchJson(`${PROD_URL.replace(/\/$/, '')}/api/unified-opportunities?v5=${stamp}`),
    fetchJson(`${PROD_URL.replace(/\/$/, '')}/api/ucp-shadow?v5=${stamp}`)
  ]);
  assertProductionBoard(board);
  assertUcp(ucp);
  return { board, ucp };
}

function sourceIdentity(board = {}, ucp = {}) {
  return Object.freeze({
    productionDeploymentCommit: board.deploymentCommit || ucp.deploymentCommit || null,
    ucpDecisionHash: ucp?.snapshot?.decisionHash || null,
    boardSessionDate: board.sessionDate || null,
    ucpSessionDate: ucp?.snapshot?.sessionDate || null,
    targetSessionDate: ucp?.snapshot?.morningConfirmation?.targetSessionDate || null,
    ucpStatus: ucp.status || null
  });
}

function captureCohort(ledger, board, ucp, now = new Date().toISOString()) {
  const sessionDate = dateOnly(board.sessionDate);
  if (!sessionDate) throw new Error('CAPTURE_SESSION_INVALID');

  const existing = (ledger.cohorts || []).find(x => x.decisionSessionDate === sessionDate);
  if (existing) return { changed: false, reason: 'SESSION_ALREADY_FROZEN', cohort: existing };

  const candidates = eligibleObservationRows(board);
  const identity = sourceIdentity(board, ucp);
  const frozen = {
    schemaVersion: 'astra-v5-prospective-cohort/v1',
    cohortId: `${sessionDate}:${hashObject({ sessionDate, identity, candidates }).slice(0, 16)}`,
    decisionSessionDate: sessionDate,
    targetSessionDate: dateOnly(identity.targetSessionDate),
    capturedAt: now,
    boardGeneratedAt: board.generatedAt || null,
    sourceIdentity: identity,
    marketRegime: board.marketRegime || {},
    observationPolicy: POLICY,
    candidateCount: candidates.length,
    candidates
  };
  frozen.captureHash = hashObject({
    decisionSessionDate: frozen.decisionSessionDate,
    targetSessionDate: frozen.targetSessionDate,
    sourceIdentity: frozen.sourceIdentity,
    marketRegime: frozen.marketRegime,
    candidates: frozen.candidates.map(c => ({
      ticker: c.ticker,
      source: c.source,
      tradePlan: c.tradePlan,
      features: c.features
    }))
  });

  ledger.cohorts = Array.isArray(ledger.cohorts) ? ledger.cohorts : [];
  ledger.cohorts.push(frozen);
  return { changed: true, reason: 'COHORT_CAPTURED', cohort: frozen };
}

function morningCandidateMap(ucp = {}) {
  const confirmation = ucp?.snapshot?.morningConfirmation || {};
  const map = new Map();
  for (const item of confirmation.preparedCandidates || []) {
    if (item?.ticker) map.set(String(item.ticker).toUpperCase(), item);
  }
  return { confirmation, map };
}

function compactMorningObservation({ row = {}, item = null, confirmation = {}, now }) {
  const status = item?.lifecycleState || row.morningStatus || confirmation.status || 'NOT_PREPARED';
  const payload = item ? stable(item) : null;
  return {
    observedAt: now,
    status,
    targetSessionDate: dateOnly(confirmation.targetSessionDate),
    sourceSessionDate: dateOnly(confirmation.sourceSessionDate || confirmation.sessionDate),
    source: confirmation.source || item?.source || null,
    generatedAt: confirmation.generatedAt || item?.generatedAt || null,
    latestSourceMinute: finite(confirmation.latestSourceMinute ?? item?.latestSourceMinute),
    marketCoveragePct: finite(confirmation.marketCoveragePct ?? item?.marketCoveragePct),
    currentPrice: finite(item?.currentPrice ?? item?.price),
    changePct: finite(item?.changePct),
    turnover: finite(item?.turnover),
    volumeRatio: finite(item?.volumeRatio ?? item?.relativeVolume),
    openingGapPct: finite(item?.openingGapPct ?? item?.gapPct),
    candidateEvidenceHash: payload ? hashObject(payload) : null,
    candidateEvidence: payload
  };
}

function enrichMorning(ledger, board, ucpOrNow = {}, maybeNow = null) {
  const backwardCompatibleNow = typeof ucpOrNow === 'string' ? ucpOrNow : null;
  const ucp = typeof ucpOrNow === 'object' && ucpOrNow !== null ? ucpOrNow : {};
  const now = maybeNow || backwardCompatibleNow || new Date().toISOString();
  const boardByTicker = new Map((board.rows || []).filter(x => x?.ticker).map(x => [String(x.ticker).toUpperCase(), x]));
  const morning = morningCandidateMap(ucp);
  let changed = false;
  let updates = 0;

  for (const cohort of ledger.cohorts || []) {
    const targetSessionDate = dateOnly(cohort.targetSessionDate);
    const observedTargetSession = dateOnly(morning.confirmation.targetSessionDate);
    const boardSessionDate = dateOnly(board.sessionDate);
    if (targetSessionDate && observedTargetSession && targetSessionDate !== observedTargetSession) continue;
    if (!observedTargetSession && cohort.decisionSessionDate !== boardSessionDate) continue;

    for (const candidate of cohort.candidates || []) {
      const ticker = String(candidate.ticker || '').toUpperCase();
      const row = boardByTicker.get(ticker) || {};
      const item = morning.map.get(ticker) || null;
      const observation = compactMorningObservation({
        row,
        item,
        confirmation: morning.confirmation,
        now
      });
      const last = candidate.morningEvidence?.at(-1);
      if (last && hashObject({ ...last, observedAt: null }) === hashObject({ ...observation, observedAt: null })) continue;
      candidate.morningEvidence = Array.isArray(candidate.morningEvidence) ? candidate.morningEvidence : [];
      candidate.morningEvidence.push(observation);
      changed = true;
      updates += 1;
    }
  }

  return { changed, updates };
}

function historyRows(payload = {}) {
  return (Array.isArray(payload.sessions) ? payload.sessions : Array.isArray(payload.rows) ? payload.rows : [])
    .map(row => ({
      date: dateOnly(row.date),
      open: finite(row.open ?? row.close),
      high: finite(row.high),
      low: finite(row.low),
      close: finite(row.close)
    }))
    .filter(row => row.date && row.open > 0 && row.high > 0 && row.low > 0 && row.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function intersects(row, low, high) {
  return row.low <= high && row.high >= low;
}

function simulatedFill(row, low, high) {
  if (!intersects(row, low, high)) return null;
  if (row.open >= low && row.open <= high) return row.open;
  if (row.open > high && row.low <= high) return high;
  if (row.open < low && row.high >= low) return low;
  return Math.min(high, Math.max(low, row.open));
}

function netReturn(fill, exit, plan) {
  if (!(fill > 0) || !(exit > 0)) return null;
  const gross = ((exit - fill) / fill) * 100;
  const friction = (finite(plan.roundTripCostPct) ?? POLICY.roundTripCostPct) +
    (finite(plan.slippagePct) ?? POLICY.slippagePct);
  return {
    grossReturnPct: round(gross, 4),
    netReturnPct: round(gross - friction, 4)
  };
}

function resolveOutcome(cohort, candidate, rows, now = new Date().toISOString()) {
  const plan = candidate.tradePlan || {};
  const targetSessionDate = dateOnly(cohort.targetSessionDate);
  const low = finite(plan.entryLow);
  const high = finite(plan.entryHigh);
  const stop = finite(plan.stopLoss);
  const target = finite(plan.target1);
  const sourceLastSession = rows.at(-1)?.date || null;
  const entryReferencePrice = low > 0 && high > 0 ? (low + high) / 2 : null;

  if (!targetSessionDate || !(low > 0) || !(high >= low) || !(stop > 0) || !(target > 0)) {
    return {
      ...candidate.outcome,
      status: 'UNRESOLVABLE',
      targetBeforeStop: null,
      sourceLastSession,
      resolvedAt: now,
      resolutionReason: 'INCOMPLETE_FROZEN_PLAN'
    };
  }

  const future = rows.filter(row => row.date >= targetSessionDate);
  if (!future.length) {
    return { ...candidate.outcome, status: 'OPEN', sourceLastSession };
  }

  const entryWindow = future.slice(0, POLICY.entryExpirySessions);
  let entryRowIndex = -1;
  let fillPrice = null;
  for (let i = 0; i < entryWindow.length; i += 1) {
    const fill = simulatedFill(entryWindow[i], low, high);
    if (fill !== null) {
      entryRowIndex = i;
      fillPrice = fill;
      break;
    }
  }

  if (entryRowIndex < 0) {
    if (future.length >= POLICY.entryExpirySessions) {
      return {
        ...candidate.outcome,
        status: 'NOT_ENTERED',
        targetBeforeStop: null,
        entered: false,
        entrySession: null,
        exitSession: entryWindow.at(-1)?.date || null,
        fillPrice: null,
        exitPrice: null,
        entryReferencePrice: round(entryReferencePrice),
        entrySlippageProxyPct: null,
        slippageMeasurement: 'NOT_ENTERED',
        grossReturnPct: null,
        netReturnPct: null,
        sourceLastSession,
        resolvedAt: now
      };
    }
    return { ...candidate.outcome, status: 'OPEN', entered: false, sourceLastSession };
  }

  const entryRow = entryWindow[entryRowIndex];
  const entrySlippageProxyPct = entryReferencePrice > 0
    ? round(((fillPrice - entryReferencePrice) / entryReferencePrice) * 100, 4)
    : null;
  const slippageMeasurement = 'DAILY_OHLC_SIMULATED_FILL_VS_FROZEN_ENTRY_MIDPOINT_PROXY';
  candidate.slippage = {
    estimatedPct: finite(plan.slippagePct) ?? POLICY.slippagePct,
    realizedProxyPct: entrySlippageProxyPct,
    measurement: slippageMeasurement
  };
  const absoluteEntryIndex = future.findIndex(row => row.date === entryRow.date);
  const holdRows = future.slice(absoluteEntryIndex, absoluteEntryIndex + POLICY.maxHoldSessions);

  for (const row of holdRows) {
    const stopHit = row.low <= stop;
    const targetHit = row.high >= target;

    if (stopHit) {
      const returns = netReturn(fillPrice, stop, plan);
      return {
        status: 'STOP',
        targetBeforeStop: false,
        entered: true,
        entrySession: entryRow.date,
        exitSession: row.date,
        fillPrice: round(fillPrice),
        exitPrice: round(stop),
        entryReferencePrice: round(entryReferencePrice),
        entrySlippageProxyPct,
        slippageMeasurement,
        ...returns,
        sourceLastSession,
        sameBarAmbiguity: targetHit ? POLICY.sameBarAmbiguity : null,
        resolvedAt: now
      };
    }

    if (targetHit) {
      const returns = netReturn(fillPrice, target, plan);
      return {
        status: 'TARGET1',
        targetBeforeStop: true,
        entered: true,
        entrySession: entryRow.date,
        exitSession: row.date,
        fillPrice: round(fillPrice),
        exitPrice: round(target),
        entryReferencePrice: round(entryReferencePrice),
        entrySlippageProxyPct,
        slippageMeasurement,
        ...returns,
        sourceLastSession,
        sameBarAmbiguity: null,
        resolvedAt: now
      };
    }
  }

  if (holdRows.length >= POLICY.maxHoldSessions) {
    const exit = holdRows[POLICY.maxHoldSessions - 1];
    const returns = netReturn(fillPrice, exit.close, plan);
    return {
      status: 'TIME_EXIT',
      targetBeforeStop: false,
      entered: true,
      entrySession: entryRow.date,
      exitSession: exit.date,
      fillPrice: round(fillPrice),
      exitPrice: round(exit.close),
      entryReferencePrice: round(entryReferencePrice),
        entrySlippageProxyPct,
        slippageMeasurement,
        ...returns,
      sourceLastSession,
      sameBarAmbiguity: null,
      resolvedAt: now
    };
  }

  return {
    ...candidate.outcome,
    status: 'OPEN',
    targetBeforeStop: null,
    entered: true,
    entrySession: entryRow.date,
    fillPrice: round(fillPrice),
    entryReferencePrice: round(entryReferencePrice),
    entrySlippageProxyPct,
    slippageMeasurement,
    sourceLastSession
  };
}

async function resolveLedger(ledger, now = new Date().toISOString()) {
  const cache = new Map();
  let changed = false;
  let updated = 0;

  for (const cohort of ledger.cohorts || []) {
    for (const candidate of cohort.candidates || []) {
      if (['TARGET1', 'STOP', 'TIME_EXIT', 'NOT_ENTERED', 'UNRESOLVABLE'].includes(candidate.outcome?.status)) continue;
      if (!cache.has(candidate.ticker)) {
        try {
          const payload = await fetchJson(
            `${HISTORY_BASE.replace(/\/$/, '')}/${encodeURIComponent(candidate.ticker)}.json?v5=${Date.now()}`,
            3
          );
          cache.set(candidate.ticker, historyRows(payload));
        } catch (error) {
          cache.set(candidate.ticker, null);
          console.warn(`V5 history unavailable for ${candidate.ticker}: ${error.message}`);
        }
      }

      const rows = cache.get(candidate.ticker);
      if (!rows) continue;
      const next = resolveOutcome(cohort, candidate, rows, now);
      if (JSON.stringify(next) !== JSON.stringify(candidate.outcome)) {
        candidate.outcome = next;
        changed = true;
        updated += 1;
      }
    }
  }

  return { changed, updated };
}

function backfillObservationMetadata(ledger) {
  let changed = 0;
  for (const cohort of ledger.cohorts || []) {
    for (const candidate of cohort.candidates || []) {
      if (!candidate.sector || candidate.sectorSource === 'UNAVAILABLE') {
        const mapped = sectorForTicker(candidate.ticker);
        candidate.sector = mapped.sector;
        candidate.sectorSource = mapped.sectorSource;
        changed += 1;
      }
      if (!candidate.decisionMarketState) {
        candidate.decisionMarketState = {
          sessionDate: cohort.decisionSessionDate || null,
          generatedAt: cohort.boardGeneratedAt || null,
          regime: cohort.marketRegime?.regime || 'UNKNOWN',
          regimeScore: finite(cohort.marketRegime?.score),
          regimeRiskMultiplier: finite(cohort.marketRegime?.riskMultiplier),
          maxTradeRiskPct: finite(cohort.marketRegime?.maxTradeRiskPct),
          unifiedRank: finite(candidate.unifiedRank),
          unifiedScore: finite(candidate.unifiedScore),
          crossSectionalRank: finite(candidate.crossSectionalRank),
          crossSectionalScore: finite(candidate.crossSectionalScore),
          dataQualityScore: finite(candidate.features?.dataQualityScore),
          liquidityScore: finite(candidate.features?.liquidityScore)
        };
        changed += 1;
      }
      if (!candidate.slippage) {
        candidate.slippage = {
          estimatedPct: finite(candidate.tradePlan?.slippagePct) ?? POLICY.slippagePct,
          realizedProxyPct: finite(candidate.outcome?.entrySlippageProxyPct),
          measurement: candidate.outcome?.slippageMeasurement || 'NOT_YET_OBSERVED'
        };
        changed += 1;
      }
      if (candidate.evidenceVersion !== 2) {
        candidate.evidenceVersion = 2;
        changed += 1;
      }
    }
  }
  return changed;
}

function trainingRecords(ledger) {
  const records = [];
  for (const cohort of ledger.cohorts || []) {
    for (const candidate of cohort.candidates || []) {
      const outcome = candidate.outcome || {};
      if (typeof outcome.targetBeforeStop !== 'boolean') continue;
      records.push({
        recordId: `${cohort.cohortId}:${candidate.ticker}`,
        prospectiveOnly: true,
        source: 'ASTRA_V5_FORWARD_PROSPECTIVE',
        capturedAt: cohort.capturedAt,
        sessionDate: cohort.decisionSessionDate,
        targetSessionDate: cohort.targetSessionDate,
        ticker: candidate.ticker,
        setupSource: candidate.source,
        selectedByUcp: candidate.selectedByUcp === true,
        outcome: outcome.status,
        targetBeforeStop: outcome.targetBeforeStop,
        entrySession: outcome.entrySession,
        exitSession: outcome.exitSession,
        netReturnPct: outcome.netReturnPct,
        sector: candidate.sector || null,
        sectorSource: candidate.sectorSource || 'UNAVAILABLE',
        marketRegime: cohort.marketRegime || {},
        decisionMarketState: candidate.decisionMarketState || {},
        morningEvidence: candidate.morningEvidence?.at(-1) || null,
        slippage: {
          estimatedPct: candidate.slippage?.estimatedPct ?? candidate.tradePlan?.slippagePct ?? null,
          realizedProxyPct: outcome.entrySlippageProxyPct ?? candidate.slippage?.realizedProxyPct ?? null,
          measurement: outcome.slippageMeasurement || candidate.slippage?.measurement || null
        },
        features: candidate.features,
        frozenTradePlan: candidate.tradePlan,
        captureHash: cohort.captureHash
      });
    }
  }
  return records.sort((a, b) =>
    String(a.capturedAt || a.sessionDate).localeCompare(String(b.capturedAt || b.sessionDate)) ||
    String(a.ticker).localeCompare(String(b.ticker))
  );
}

function observedCalendarDays(cohorts = []) {
  const dates = cohorts
    .map(x => new Date(x.capturedAt || x.decisionSessionDate))
    .filter(d => !Number.isNaN(d.getTime()))
    .sort((a, b) => a - b);
  if (!dates.length) return 0;
  return Math.floor((dates.at(-1) - dates[0]) / 86400000) + 1;
}

function summarize(ledger) {
  const candidates = (ledger.cohorts || []).flatMap(c => c.candidates || []);
  const resolved = candidates.filter(c => typeof c.outcome?.targetBeforeStop === 'boolean');
  const positive = resolved.filter(c => c.outcome.targetBeforeStop === true).length;
  const negative = resolved.filter(c => c.outcome.targetBeforeStop === false).length;
  return {
    decisionSessions: (ledger.cohorts || []).length,
    candidatesCaptured: candidates.length,
    resolvedLabels: resolved.length,
    positiveOutcomes: positive,
    negativeOutcomes: negative,
    notEntered: candidates.filter(c => c.outcome?.status === 'NOT_ENTERED').length,
    open: candidates.filter(c => c.outcome?.status === 'OPEN').length,
    sectorCoverage: candidates.filter(c => Boolean(c.sector) && c.sectorSource !== 'UNCLASSIFIED').length,
    sectorRecorded: candidates.filter(c => Boolean(c.sector)).length,
    sectorUnclassified: candidates.filter(c => c.sectorSource === 'UNCLASSIFIED').length,
    morningEvidenceCaptured: candidates.filter(c => Array.isArray(c.morningEvidence) && c.morningEvidence.length > 0).length,
    slippageProxyObserved: candidates.filter(c => finite(c.outcome?.entrySlippageProxyPct) !== null).length,
    observedCalendarDays: observedCalendarDays(ledger.cohorts || []),
    criticalBreaches: 0
  };
}

function finalize(ledger, now = new Date().toISOString()) {
  ledger.schemaVersion = 'astra-v5-prospective-evidence/v2';
  ledger.policyVersion = POLICY.version;
  ledger.updatedAt = now;
  ledger.summary = summarize(ledger);
  ledger.safety = {
    prospectiveOnly: true,
    retrospectiveRowsAccepted: false,
    usedForCurrentAppSelection: false,
    executionAllowed: false,
    writesToProductionData: false
  };
  return ledger;
}

function trainFromLedger(ledger) {
  const records = trainingRecords(ledger);
  const model = trainProspectiveModel({
    records,
    modelVersion: `astra-v5-forward-${dateOnly(new Date().toISOString())}`
  });
  return { records, model };
}

async function cycle() {
  const now = new Date().toISOString();
  const ledger = readJson(LEDGER_PATH, {
    schemaVersion: 'astra-v5-prospective-evidence/v2',
    policyVersion: POLICY.version,
    cohorts: []
  });

  const { board, ucp } = await fetchProductionEvidence();
  const metadataBackfillCount = backfillObservationMetadata(ledger);
  const capture = captureCohort(ledger, board, ucp, now);
  const morning = enrichMorning(ledger, board, ucp, now);
  const resolution = await resolveLedger(ledger, now);
  finalize(ledger, now);

  const { records, model } = trainFromLedger(ledger);

  writeJson(LEDGER_PATH, ledger);
  writeJson(TRAINING_PATH, {
    schemaVersion: 'astra-v5-training-records/v2',
    generatedAt: now,
    prospectiveOnly: true,
    target: POLICY.targetDefinition,
    count: records.length,
    records
  });
  writeJson(MODEL_PATH, model);

  return {
    schemaVersion: 'astra-v5-evidence-factory-run/v1',
    generatedAt: now,
    productionSessionDate: board.sessionDate,
    targetSessionDate: ucp?.snapshot?.morningConfirmation?.targetSessionDate || null,
    productionDeploymentCommit: board.deploymentCommit || ucp.deploymentCommit || null,
    metadataBackfillCount,
    capture: {
      changed: capture.changed,
      reason: capture.reason,
      candidateCount: capture.cohort?.candidateCount ?? 0
    },
    morning,
    resolution,
    summary: ledger.summary,
    model: {
      status: model.status,
      modelVersion: model.modelVersion,
      trainingSample: model.trainingSample,
      validationMetrics: model.validationMetrics
    },
    safety: {
      prospectiveOnly: true,
      executionAllowed: false,
      usedForCurrentAppSelection: false,
      currentAppMutation: false
    }
  };
}

if (require.main === module) {
  cycle()
    .then(result => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch(error => {
      console.error(error?.stack || error);
      process.exitCode = 1;
    });
}

module.exports = {
  POLICY,
  tradePlan,
  featureSnapshot,
  eligibleObservationRows,
  sectorForTicker,
  captureCohort,
  enrichMorning,
  historyRows,
  simulatedFill,
  resolveOutcome,
  backfillObservationMetadata,
  trainingRecords,
  summarize,
  finalize,
  cycle
};
