// ASTRA V4 Legacy Historical Data Bridge
// Reads the validated historical sessions already built by the prior EGX engine.
// The source is pinned to an immutable Git commit so history cannot silently drift.

const LEGACY_REPO = 'https://raw.githubusercontent.com/rasheadsca-star/RAS-EGX-PRO2026-NEXT/c8539c78ba38cc58ef34842b34f6a3141a3811fe/data/history';
const WATCHLIST = ['COMI', 'SWDY', 'FWRY', 'TMGH', 'HRHO'];
const CACHE = new Map();
const REQUEST_TIMEOUT_MS = 8000;

async function fetchHistory(symbol) {
  if (CACHE.has(symbol)) return CACHE.get(symbol);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${LEGACY_REPO}/${symbol}.json`, {
      headers: { 'User-Agent': 'ASTRA-V4/1.0' },
      signal: controller.signal
    });
    if (!response.ok) return [];

    const payload = await response.json();
    const rows = Array.isArray(payload?.sessions) ? payload.sessions : [];
    const normalized = rows
      .map((row) => ({
        date: row.date,
        open: Number(row.open || 0),
        high: Number(row.high || 0),
        low: Number(row.low || 0),
        close: Number(row.close || 0),
        volume: Number(row.volume || 0),
        source: row.primarySource || payload.primarySource || 'legacy-history'
      }))
      .filter((row) => row.date && row.close > 0)
      .sort((a, b) => a.date.localeCompare(b.date));

    CACHE.set(symbol, normalized);
    return normalized;
  } catch (_) {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function loadLegacyHistory() {
  const entries = await Promise.all(
    WATCHLIST.map(async (symbol) => [symbol, await fetchHistory(symbol)])
  );
  return Object.fromEntries(entries);
}

module.exports = { WATCHLIST, loadLegacyHistory, fetchHistory };
