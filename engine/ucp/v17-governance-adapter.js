'use strict';

const DEFAULT_V17_URL = process.env.UCP_V17_URL ||
  'https://raw.githubusercontent.com/rasheadsca-star/RAS-EGX-PRO2026-NEXT/main/data/v17/current.json';
const DEFAULT_CONSENSUS_URL = process.env.UCP_V17_CONSENSUS_URL ||
  'https://raw.githubusercontent.com/rasheadsca-star/RAS-EGX-PRO2026-NEXT/main/data/stable/v16-main-app-consensus.json';
const TIMEOUT_MS = Number(process.env.UCP_V17_TIMEOUT_MS || 12000);

async function fetchJson(url, fetchImpl = global.fetch) {
  if (typeof fetchImpl !== 'function') throw new Error('FETCH_NOT_AVAILABLE');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
        'User-Agent': 'Rasheed-EGX-UCP/1.0-V17-Governance'
      },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`V17_HTTP_${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function uniqueSymbols(items = []) {
  return [...new Set(items.map((item) => item?.ticker || item?.symbol).filter(Boolean))];
}

function evaluateV17Governance({ v17 = {}, consensus = {}, requiredSession = null, candidates = [] } = {}) {
  const referenceSession = v17.sessionDate || consensus?.sourceHealth?.v17Session || null;
  const consensusAligned = consensus?.sourceHealth?.v17SessionAligned;
  const sessionAligned = Boolean(
    requiredSession &&
    referenceSession === requiredSession &&
    consensusAligned !== false
  );

  const automaticOrders = v17?.portfolioPolicy?.automaticOrders;
  const promotionAllowed = v17?.championChallenger?.promotionAllowed;
  const policySafe = automaticOrders !== true && promotionAllowed !== true;
  const symbols = uniqueSymbols(candidates);

  const blockers = [];
  if (!requiredSession) blockers.push('V17_REQUIRED_SESSION_UNKNOWN');
  if (!referenceSession) blockers.push('V17_REFERENCE_SESSION_UNKNOWN');
  if (!sessionAligned) blockers.push('V17_SESSION_MISMATCH');
  if (!policySafe) blockers.push('V17_POLICY_UNSAFE');

  const approvedSymbols = sessionAligned && policySafe ? symbols : [];
  const rejectedSymbols = sessionAligned && policySafe ? [] : symbols.map((symbol) => ({
    symbol,
    reason: !sessionAligned ? 'V17_SESSION_MISMATCH' : 'V17_POLICY_UNSAFE'
  }));

  return Object.freeze({
    available: true,
    id: 'V17_GOVERNANCE_SPINE',
    status: blockers.length ? 'GOVERNANCE_BLOCKED' : 'GOVERNANCE_READY',
    requiredSession,
    referenceSession,
    sessionAligned,
    policySafe,
    executionAllowed: false,
    automaticOrdersAllowed: false,
    automaticChampionPromotionAllowed: false,
    sourceStatus: v17.status || null,
    releaseStage: v17?.readiness?.releaseStage || null,
    professionalEvidenceReady: v17?.readiness?.professionalEvidenceReady === true,
    market: sessionAligned ? Object.freeze({
      regime: v17?.market?.regime || null,
      score: Number.isFinite(Number(v17?.market?.score)) ? Number(v17.market.score) : null,
      riskMultiplier: Number.isFinite(Number(v17?.market?.riskMultiplier)) ? Number(v17.market.riskMultiplier) : null,
      maxTradeRiskPct: Number.isFinite(Number(v17?.market?.maxTradeRiskPct)) ? Number(v17.market.maxTradeRiskPct) : null
    }) : null,
    approvedSymbols: Object.freeze(approvedSymbols),
    rejectedSymbols: Object.freeze(rejectedSymbols.map(Object.freeze)),
    blockers: Object.freeze(blockers),
    provenance: Object.freeze({
      v17SchemaVersion: v17.schemaVersion || null,
      v17GeneratedAt: v17.generatedAt || null,
      consensusGeneratedAt: consensus.generatedAt || null,
      consensusMainSession: consensus?.sourceHealth?.mainSession || consensus.sessionDate || null,
      consensusV17Session: consensus?.sourceHealth?.v17Session || null,
      consensusV17SessionAligned: consensusAligned === true
    })
  });
}

async function loadV17Governance({
  requiredSession = null,
  candidates = [],
  fetchImpl = global.fetch,
  v17Url = DEFAULT_V17_URL,
  consensusUrl = DEFAULT_CONSENSUS_URL
} = {}) {
  try {
    const [v17, consensus] = await Promise.all([
      fetchJson(v17Url, fetchImpl),
      fetchJson(consensusUrl, fetchImpl)
    ]);
    return evaluateV17Governance({ v17, consensus, requiredSession, candidates });
  } catch (error) {
    return Object.freeze({
      available: false,
      id: 'V17_GOVERNANCE_SPINE',
      status: 'GOVERNANCE_UNAVAILABLE',
      requiredSession,
      referenceSession: null,
      sessionAligned: false,
      policySafe: false,
      executionAllowed: false,
      automaticOrdersAllowed: false,
      automaticChampionPromotionAllowed: false,
      approvedSymbols: Object.freeze([]),
      rejectedSymbols: Object.freeze(uniqueSymbols(candidates).map((symbol) => Object.freeze({
        symbol,
        reason: 'V17_GOVERNANCE_UNAVAILABLE'
      }))),
      blockers: Object.freeze(['V17_GOVERNANCE_UNAVAILABLE']),
      error: error?.name === 'AbortError' ? 'V17_TIMEOUT' : error?.message || 'V17_LOAD_ERROR'
    });
  }
}

module.exports = {
  DEFAULT_V17_URL,
  DEFAULT_CONSENSUS_URL,
  evaluateV17Governance,
  loadV17Governance
};
