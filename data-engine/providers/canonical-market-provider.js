// ASTRA V4 Canonical Market Provider
// Consumes the validated post-market dataset produced by the legacy PRO pipeline.
// This avoids per-request scraping/Yahoo fan-out while preserving delayed-data gates.

const SOURCE_BASE =
  process.env.ASTRA_CANONICAL_SOURCE_BASE ||
  'https://raw.githubusercontent.com/rasheadsca-star/RAS-EGX-PRO2026-NEXT/main/data';

const REQUEST_TIMEOUT_MS = 12000;

async function fetchJson(path) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${SOURCE_BASE}/${path}`, {
      headers: { 'User-Agent': 'ASTRA-V4/4.0' },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${path}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
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

function normalizeRow(row, expectedSession) {
  const symbol = String(row?.symbol || row?.ticker || '').trim().toUpperCase();
  const price = Number(row?.price ?? row?.last ?? 0);

  if (!symbol || !Number.isFinite(price) || price <= 0) return null;

  const sessionDate =
    row?.sourceSessionDate ||
    row?.marketSessionDate ||
    null;

  const updatedAt =
    row?.sourceSessionCheckedAt ||
    row?.updatedAt ||
    null;

  const sourceLatencySeconds = ageSeconds(updatedAt);

  const sessionVerified =
    Boolean(expectedSession) &&
    sessionDate === expectedSession;

  return {
    symbol,
    price,
    change: Number(row?.change || 0),
    changePercent: Number(
      row?.changePct ??
      row?.changePercent ??
      0
    ),
    previousClose: Number(row?.previousClose || 0),
    volume: Number(row?.volume || 0),
    high: Number(row?.high || price),
    low: Number(row?.low || price),
    timestamp: row?.updatedAt || row?.sourceSessionCheckedAt || null,
    source: 'MUBASHER_CANONICAL_DELAYED',
    sourceUrl: row?.sourceUrl || null,
    sourceVerified: sessionVerified,
    sourceLatencySeconds,
    confidence: sessionVerified ? 90 : 50,
    delayed: true,
    intradayCandles: [],
    sourceSessionDate: sessionDate,
    expectedSession,
    sessionVerified
  };
}

const canonicalMarketProvider = {
  name: 'MUBASHER_CANONICAL_DELAYED',

  async fetchQuotes() {
    const [market, status] = await Promise.all([
      fetchJson('market.json'),
      fetchJson('fetch-status.json').catch(() => ({}))
    ]);

    const rows = Array.isArray(market?.rows) ? market.rows : [];
    const expectedSession =
      status?.expectedSession ||
      latestSession(rows);

    const quotes = rows
      .map((row) => normalizeRow(row, expectedSession))
      .filter(Boolean)
      .filter((quote) =>
        !expectedSession ||
        quote.sourceSessionDate === expectedSession
      );

    return quotes;
  },

  async getQuotes() {
    return this.fetchQuotes();
  }
};

module.exports = { canonicalMarketProvider };
