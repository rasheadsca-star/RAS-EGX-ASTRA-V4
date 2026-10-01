'use strict';

const DEFAULT_RC2_BASE_URL =
  process.env.UCP_RC2_BASE_URL ||
  'https://egx-tfe-v20-fusion-rc2.vercel.app';

const EXPECTED_ENGINE = 'TFE_V20_FUSION_RC2';
const REQUEST_TIMEOUT_MS = Number(process.env.UCP_RC2_TIMEOUT_MS || 20000);

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeCandidate(item = {}) {
  return Object.freeze({
    ticker: item.ticker || null,
    nameAr: item.nameAr || null,
    nameEn: item.nameEn || null,
    decision: item.decision || item.publicationState || 'RESEARCH_CANDIDATE',
    publicationState: item.publicationState || null,
    publicationEligible: item.publicationEligible === true,
    technicalEligible: item.technicalEligible === true,
    researchScore: safeNumber(item.scores?.research),
    fusionRankScore: safeNumber(item.scores?.fusionRank),
    liquidityScore: safeNumber(item.scores?.liquidity),
    srScore: safeNumber(item.scores?.supportResistance),
    structuralNetRR: safeNumber(
      item.tradePlan?.structuralNetRR ?? item.structuralNetRR
    ),
    entry: safeNumber(item.tradePlan?.entry ?? item.entry),
    stopLoss: safeNumber(item.tradePlan?.stop ?? item.stopLoss),
    target1: safeNumber(item.tradePlan?.target1 ?? item.target1),
    target2: safeNumber(item.tradePlan?.target2 ?? item.target2),
    reasonCodes: Object.freeze(
      Array.isArray(item.reasonCodes) ? [...item.reasonCodes] : []
    ),
    qualityState: item.quality?.state || null,
    publicationHold: item.quality?.publicationHold === true
  });
}

function validateResearchPermissions(permissions = {}) {
  return (
    permissions.researchOnly === true &&
    permissions.executionAllowed === false &&
    permissions.productionAllocation === false &&
    permissions.automaticOrders === false &&
    permissions.automaticChampionPromotion === false
  );
}

async function fetchJson(url, fetchImpl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetchImpl(url, {
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
        'User-Agent': 'Rasheed-EGX-UCP/1.0-RC2-Shadow'
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`RC2_HTTP_${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function loadRc2ShadowScan({
  fetchImpl = global.fetch,
  baseUrl = DEFAULT_RC2_BASE_URL,
  limit = 20
} = {}) {
  if (typeof fetchImpl !== 'function') {
    return Object.freeze({
      available: false,
      status: 'SHADOW_UNAVAILABLE',
      engineId: EXPECTED_ENGINE,
      error: 'FETCH_NOT_AVAILABLE',
      candidates: Object.freeze([])
    });
  }

  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 20));
  const url =
    baseUrl.replace(/\/$/, '') +
    `/api/index?route=scan&limit=${safeLimit}&ucp=${Date.now()}`;

  try {
    const payload = await fetchJson(url, fetchImpl);

    if (payload?.ok !== true) {
      throw new Error('RC2_RESPONSE_NOT_OK');
    }

    if (payload?.engine !== EXPECTED_ENGINE) {
      throw new Error('RC2_ENGINE_ID_MISMATCH');
    }

    if (payload?.mode !== 'RESEARCH_ONLY') {
      throw new Error('RC2_MODE_NOT_RESEARCH_ONLY');
    }

    if (!validateResearchPermissions(payload?.permissions)) {
      throw new Error('RC2_PERMISSION_CONTRACT_VIOLATION');
    }

    const candidates = Array.isArray(payload.recommendations)
      ? payload.recommendations.map(normalizeCandidate)
      : [];

    return Object.freeze({
      available: true,
      status: 'SHADOW_READY',
      engineId: EXPECTED_ENGINE,
      mode: payload.mode,
      schemaVersion: payload.schemaVersion || null,
      sourceCommit: payload.sourceCommit || null,
      generatedAt: payload.generatedAt || null,
      sessionDate: payload.universe?.sessionDate || null,
      permissions: Object.freeze({ ...payload.permissions }),
      universe: Object.freeze({
        mode: payload.universe?.mode || null,
        sessionDate: payload.universe?.sessionDate || null,
        currentVerifiedCandidates:
          safeNumber(payload.universe?.currentVerifiedCandidates),
        alphaDataBranch: payload.universe?.alphaDataBranch || null,
        overlayBranch: payload.universe?.overlayBranch || null
      }),
      summary: Object.freeze({
        scanned: safeNumber(payload.summary?.scanned),
        technicalEligibleTotal:
          safeNumber(payload.summary?.technicalEligibleTotal),
        publicationEligibleTotal:
          safeNumber(payload.summary?.publicationEligibleTotal),
        withheldForPriceReconciliation:
          safeNumber(payload.summary?.withheldForPriceReconciliation),
        returned: candidates.length
      }),
      candidates: Object.freeze(candidates),
      endpoint: baseUrl.replace(/\/$/, '')
    });
  } catch (error) {
    return Object.freeze({
      available: false,
      status: 'SHADOW_UNAVAILABLE',
      engineId: EXPECTED_ENGINE,
      mode: 'RESEARCH_ONLY',
      sourceCommit: null,
      sessionDate: null,
      error: error?.name === 'AbortError'
        ? 'RC2_TIMEOUT'
        : error?.message || 'RC2_SHADOW_ERROR',
      candidates: Object.freeze([]),
      endpoint: baseUrl.replace(/\/$/, '')
    });
  }
}

module.exports = {
  DEFAULT_RC2_BASE_URL,
  EXPECTED_ENGINE,
  loadRc2ShadowScan,
  normalizeCandidate,
  validateResearchPermissions
};
