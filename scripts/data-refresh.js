// ASTRA V4 Daily Canonical Data Refresh
// Pulls the validated current-session market snapshot and the latest 60 daily
// history sessions per registered symbol from the canonical PRO repository.
// The V4 runtime then reads these local compact stores instead of making
// hundreds of remote requests per API invocation.

const fs = require('fs');
const path = require('path');
const { getEGXSymbols } = require('../data-engine/registry/egx-symbol-registry');

const BASE =
  process.env.ASTRA_CANONICAL_SOURCE_BASE ||
  'https://raw.githubusercontent.com/rasheadsca-star/RAS-EGX-PRO2026-NEXT/main/data';

const HISTORY_BASE = `${BASE}/history`;
const TIMEOUT_MS = 15000;
const CONCURRENCY = 12;
const HISTORY_SESSIONS = 60;
const MIN_HISTORY_COVERAGE = 0.80;
const MIN_MARKET_ROWS = 80;

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'ASTRA-V4-DAILY-REFRESH/4.0' },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function runWorker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      try {
        results[index] = await worker(items[index]);
      } catch (error) {
        results[index] = {
          ok: false,
          symbol: items[index],
          error: error?.message || String(error)
        };
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(limit, items.length) },
      () => runWorker()
    )
  );

  return results;
}

function normalizeSession(row, symbol) {
  const close = Number(row?.close || 0);
  if (!row?.date || !Number.isFinite(close) || close <= 0) return null;

  return {
    ticker: symbol,
    date: String(row.date),
    open: Number(row.open || 0),
    high: Number(row.high || close),
    low: Number(row.low || close),
    close,
    volume: Number(row.volume || 0),
    source: row.primarySource || row.source || 'canonical-history'
  };
}

async function main() {
  const [market, fetchStatus, sourceHealth, sessionEvidence] =
    await Promise.all([
      fetchJson(`${BASE}/market.json`),
      fetchJson(`${BASE}/fetch-status.json`),
      fetchJson(`${BASE}/source-health.json`).catch(() => ({})),
      fetchJson(`${BASE}/stable/v16-source-session-evidence.json`).catch(() => ({}))
    ]);

  const marketRows = Array.isArray(market?.rows) ? market.rows : [];
  const expectedSession =
    fetchStatus?.expectedSession ||
    marketRows
      .map((row) => row?.sourceSessionDate || row?.marketSessionDate)
      .filter(Boolean)
      .sort()
      .pop() ||
    null;

  const currentSessionRows = expectedSession
    ? marketRows.filter(
        (row) =>
          row?.sourceSessionDate === expectedSession ||
          row?.marketSessionDate === expectedSession
      )
    : marketRows;

  if (marketRows.length < MIN_MARKET_ROWS) {
    throw new Error(
      `Canonical market coverage too low: ${marketRows.length} rows`
    );
  }

  const symbols = getEGXSymbols();

  const historyResults = await mapLimit(
    symbols,
    CONCURRENCY,
    async (symbol) => {
      const payload = await fetchJson(`${HISTORY_BASE}/${symbol}.json`);
      const sessions = Array.isArray(payload?.sessions)
        ? payload.sessions
            .map((row) => normalizeSession(row, symbol))
            .filter(Boolean)
            .sort((a, b) => a.date.localeCompare(b.date))
            .slice(-HISTORY_SESSIONS)
        : [];

      return {
        ok: sessions.length > 0,
        symbol,
        sessions,
        lastSession: sessions.at(-1)?.date || null,
        availableSessions: Number(payload?.availableSessions || sessions.length),
        generatedAt: payload?.generatedAt || null,
        primarySource: payload?.primarySource || null,
        staleData: payload?.staleData === true,
        updateFailed: payload?.updateFailed === true,
        warnings: Array.isArray(payload?.warnings) ? payload.warnings : []
      };
    }
  );

  const goodHistory = historyResults.filter((item) => item?.ok);
  const coverage = goodHistory.length / Math.max(1, symbols.length);

  if (coverage < MIN_HISTORY_COVERAGE) {
    throw new Error(
      `Historical coverage too low: ${goodHistory.length}/${symbols.length} (${(coverage * 100).toFixed(1)}%)`
    );
  }

  const sourceGeneratedAt =
    fetchStatus?.generatedAt ||
    market?.generatedAt ||
    new Date().toISOString();

  const historyIndex = {
    schemaVersion: '4.1.0',
    generatedAt: sourceGeneratedAt,
    source: {
      repository: 'rasheadsca-star/RAS-EGX-PRO2026-NEXT',
      branch: 'main',
      expectedSession,
      marketGeneratedAt: market?.generatedAt || null,
      fetchStatusGeneratedAt: fetchStatus?.generatedAt || null,
      sourceHealthGeneratedAt: sourceHealth?.generatedAt || null,
      sessionEvidenceGeneratedAt: sessionEvidence?.generatedAt || null
    },
    coverage: {
      registeredSymbols: symbols.length,
      loadedSymbols: goodHistory.length,
      coveragePct: Number((coverage * 100).toFixed(2)),
      retainedSessionsPerSymbol: HISTORY_SESSIONS
    },
    symbols: Object.fromEntries(
      historyResults
        .filter((item) => item?.ok)
        .map((item) => [
          item.symbol,
          {
            lastSession: item.lastSession,
            availableSessions: item.availableSessions,
            generatedAt: item.generatedAt,
            primarySource: item.primarySource,
            staleData: item.staleData,
            updateFailed: item.updateFailed,
            warnings: item.warnings,
            sessions: item.sessions
          }
        ])
    )
  };

  const canonicalMarket = {
    schemaVersion: '4.1.0',
    generatedAt: sourceGeneratedAt,
    source: {
      repository: 'rasheadsca-star/RAS-EGX-PRO2026-NEXT',
      branch: 'main',
      sourceName: market?.source || fetchStatus?.sourceName || null,
      expectedSession,
      executionGrade: fetchStatus?.executionGrade === true,
      currentSessionRows: Number(
        fetchStatus?.currentSessionRows || currentSessionRows.length
      ),
      sourceSessionVerifiedRows: Number(
        fetchStatus?.sourceSessionVerifiedRows ||
        sessionEvidence?.matchingRows ||
        0
      ),
      coveragePct: Number(
        fetchStatus?.coveragePct ||
        sourceHealth?.coveragePct ||
        0
      ),
      delayed: true
    },
    rows: marketRows.filter((row) => Number(row?.price) > 0)
  };

  writeJson(
    path.join(__dirname, '..', 'data', 'canonical-market.json'),
    canonicalMarket
  );

  writeJson(
    path.join(__dirname, '..', 'data', 'history-index.json'),
    historyIndex
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        expectedSession,
        marketRows: canonicalMarket.rows.length,
        currentSessionRows: currentSessionRows.length,
        historySymbols: goodHistory.length,
        historyCoveragePct: Number((coverage * 100).toFixed(2)),
        source: canonicalMarket.source
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('ASTRA DAILY REFRESH FAILED');
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
