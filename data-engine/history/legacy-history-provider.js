// ASTRA V4 Historical Data Bridge
// Loads the validated legacy historical store through the data-driven EGX registry.
// The registry currently contains every symbol with a validated historical JSON file.

const { getEGXSymbols, getRegistryMeta } = require('../registry/egx-symbol-registry');

const LEGACY_REPO =
  'https://raw.githubusercontent.com/rasheadsca-star/RAS-EGX-PRO2026-NEXT/c8539c78ba38cc58ef34842b34f6a3141a3811fe/data/history';

const WATCHLIST = getEGXSymbols();
const CACHE = new Map();

const REQUEST_TIMEOUT_MS = 8000;
const BATCH_SIZE = 20;

async function fetchHistory(symbol) {
  if (CACHE.has(symbol)) {
    return CACHE.get(symbol);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const url = `${LEGACY_REPO}/${symbol}.json`;

    const response = await fetch(url, {
      headers: { 'User-Agent': 'ASTRA-V4/1.0' },
      signal: controller.signal
    });

    if (!response.ok) {
      console.log('ASTRA HISTORY FETCH FAILED', symbol, response.status);
      CACHE.set(symbol, []);
      return [];
    }

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
        source:
          row.primarySource ||
          payload.primarySource ||
          'legacy-history'
      }))
      .filter((row) => row.date && row.close > 0)
      .sort((a, b) => a.date.localeCompare(b.date));

    CACHE.set(symbol, normalized);
    return normalized;
  } catch (error) {
    console.log(
      'ASTRA HISTORY ERROR',
      symbol,
      error?.message || 'unknown'
    );
    CACHE.set(symbol, []);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function loadLegacyHistory(symbols = WATCHLIST) {
  const requested = Array.from(
    new Set(
      Array.isArray(symbols) && symbols.length
        ? symbols
        : WATCHLIST
    )
  );

  const entries = [];

  for (let offset = 0; offset < requested.length; offset += BATCH_SIZE) {
    const batch = requested.slice(offset, offset + BATCH_SIZE);

    const batchEntries = await Promise.all(
      batch.map(async (symbol) => [
        symbol,
        await fetchHistory(symbol)
      ])
    );

    entries.push(...batchEntries);
  }

  const loaded = entries.filter(([, data]) => data.length > 0).length;

  console.log(
    'ASTRA HISTORY SCAN',
    JSON.stringify({
      ...getRegistryMeta(),
      requestedSymbols: requested.length,
      loadedSymbols: loaded,
      failedSymbols: requested.length - loaded,
      batchSize: BATCH_SIZE
    })
  );

  return Object.fromEntries(entries);
}

module.exports = {
  WATCHLIST,
  BATCH_SIZE,
  loadLegacyHistory,
  fetchHistory,
  getRegistryMeta
};
