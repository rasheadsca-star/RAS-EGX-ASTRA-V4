// ASTRA V4 Canonical Market Provider
// Primary path: atomically synchronized local market snapshot committed together
// with the local history index. Remote source is emergency fallback only.

const fs = require('fs');
const path = require('path');

const SOURCE_BASE =
  process.env.ASTRA_CANONICAL_SOURCE_BASE ||
  'https://raw.githubusercontent.com/rasheadsca-star/RAS-EGX-PRO2026-NEXT/main/data';

const LOCAL_MARKET_PATH =
  path.join(__dirname, '..', '..', 'data', 'canonical-market.json');

const REQUEST_TIMEOUT_MS = 12000;

async function fetchJson(remotePath) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${SOURCE_BASE}/${remotePath}`, {
      headers: { 'User-Agent': 'ASTRA-V4/4.2-CONTINUITY' },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${remotePath}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function readLocalMarket() {
  try {
    if (!fs.existsSync(LOCAL_MARKET_PATH)) return null;
    const payload = JSON.parse(fs.readFileSync(LOCAL_MARKET_PATH, 'utf8'));
    if (!Array.isArray(payload?.rows) || !payload.rows.length) return null;
    return payload;
  } catch (error) {
    console.log('ASTRA LOCAL CANONICAL MARKET ERROR', error?.message || error);
    return null;
  }
}

function ageSeconds(timestamp) {
  const ms = Date.parse(timestamp || '');
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, (Date.now() - ms) / 1000);
}

function latestSession(rows) {
  return rows
    .map((row) => row?.sourceSessionDate || row?.marketSessionDate || null)
    .filter(Boolean)
    .sort()
    .pop() || null;
}

function normalizeRow(row, expectedSession, snapshotMeta = {}) {
  const symbol = String(row?.symbol || row?.ticker || '').trim().toUpperCase();
  const price = Number(row?.price ?? row?.last ?? 0);

  if (!symbol || !Number.isFinite(price) || price <= 0) return null;

  const sessionDate =
    row?.sourceSessionDate ||
    row?.marketSessionDate ||
    expectedSession ||
    null;

  const updatedAt =
    row?.sourceSessionCheckedAt ||
    row?.updatedAt ||
    snapshotMeta.generatedAt ||
    null;

  const sourceLatencySeconds = ageSeconds(updatedAt);
  const sessionVerified = Boolean(expectedSession) && sessionDate === expectedSession;

  return {
    symbol,
    price,
    change: Number(row?.change || 0),
    changePercent: Number(row?.changePct ?? row?.changePercent ?? 0),
    previousClose: Number(row?.previousClose || 0),
    volume: Number(row?.volume || 0),
    high: Number(row?.high || price),
    low: Number(row?.low || price),
    timestamp: updatedAt,
    source: 'MUBASHER_CANONICAL_DELAYED',
    sourceUrl: row?.sourceUrl || null,
    sourceVerified: sessionVerified,
    sourceLatencySeconds,
    confidence: sessionVerified ? 90 : 50,
    delayed: true,
    intradayCandles: [],
    sourceSessionDate: sessionDate,
    expectedSession,
    sessionVerified,
    snapshotGeneratedAt: snapshotMeta.generatedAt || null,
    snapshotMode: snapshotMeta.mode || null
  };
}

function normalizePayload(payload = {}, mode = 'LOCAL_ATOMIC_SNAPSHOT') {
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const expectedSession =
    payload?.source?.expectedSession ||
    payload?.expectedSession ||
    latestSession(rows);

  const quotes = rows
    .map((row) => normalizeRow(row, expectedSession, {
      generatedAt: payload?.generatedAt || null,
      mode
    }))
    .filter(Boolean)
    .filter((quote) => !expectedSession || quote.sourceSessionDate === expectedSession);

  return {
    quotes,
    expectedSession,
    generatedAt: payload?.generatedAt || null,
    executionGrade: payload?.source?.executionGrade === true,
    mode
  };
}

const canonicalMarketProvider = {
  name: 'MUBASHER_CANONICAL_DELAYED',

  async fetchQuotes() {
    const local = readLocalMarket();

    if (local) {
      const normalized = normalizePayload(local, 'LOCAL_ATOMIC_SNAPSHOT');
      if (normalized.quotes.length) return normalized.quotes;
    }

    // Emergency fallback only. It protects availability when a deployment is
    // missing/corrupt, but normal production remains pinned to synchronized
    // market+history files committed in one refresh transaction.
    const [market, status] = await Promise.all([
      fetchJson('market.json'),
      fetchJson('fetch-status.json').catch(() => ({}))
    ]);

    const payload = {
      generatedAt: market?.generatedAt || status?.generatedAt || null,
      source: {
        expectedSession: status?.expectedSession || latestSession(market?.rows || []),
        executionGrade: status?.executionGrade === true
      },
      rows: Array.isArray(market?.rows) ? market.rows : []
    };

    return normalizePayload(payload, 'REMOTE_EMERGENCY_FALLBACK').quotes;
  },

  async getQuotes() {
    return this.fetchQuotes();
  }
};

module.exports = {
  canonicalMarketProvider,
  LOCAL_MARKET_PATH,
  readLocalMarket,
  normalizePayload
};
