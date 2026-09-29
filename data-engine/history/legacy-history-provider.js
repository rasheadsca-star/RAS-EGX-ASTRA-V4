// ASTRA V4 Legacy Historical Data Bridge
// Reads validated historical sessions from the legacy EGX engine.
// Adds runtime diagnostics to verify history loading in production.

const LEGACY_REPO =
  'https://raw.githubusercontent.com/rasheadsca-star/RAS-EGX-PRO2026-NEXT/c8539c78ba38cc58ef34842b34f6a3141a3811fe/data/history';

const WATCHLIST = ['COMI', 'SWDY', 'FWRY', 'TMGH', 'HRHO'];

const CACHE = new Map();

const REQUEST_TIMEOUT_MS = 8000;

async function fetchHistory(symbol) {
  if (CACHE.has(symbol)) {
    return CACHE.get(symbol);
  }

  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS
  );

  try {
    const url = `${LEGACY_REPO}/${symbol}.json`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'ASTRA-V4/1.0'
      },
      signal: controller.signal
    });

    if (!response.ok) {
      console.log(
        'ASTRA HISTORY FETCH FAILED',
        symbol,
        response.status
      );

      CACHE.set(symbol, []);
      return [];
    }

    const payload = await response.json();

    const rows = Array.isArray(payload?.sessions)
      ? payload.sessions
      : [];

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
      .filter(
        (row) =>
          row.date &&
          row.close > 0
      )
      .sort(
        (a, b) =>
          a.date.localeCompare(b.date)
      );

    console.log(
      'ASTRA HISTORY LOADED',
      symbol,
      normalized.length
    );

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


async function loadLegacyHistory() {

  const entries = await Promise.all(
    WATCHLIST.map(
      async (symbol) => [
        symbol,
        await fetchHistory(symbol)
      ]
    )
  );


  console.log(
    'ASTRA HISTORY DEBUG',
    entries.map(
      ([symbol, data]) => ({
        symbol,
        rows: data.length
      })
    )
  );


  return Object.fromEntries(entries);

}


module.exports = {
  WATCHLIST,
  loadLegacyHistory,
  fetchHistory
};
