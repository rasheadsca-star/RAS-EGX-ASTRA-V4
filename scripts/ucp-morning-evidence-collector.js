'use strict';

const fs = require('fs');
const path = require('path');

const MARKET_URL = process.env.UCP_MARKET_URL ||
  'https://raw.githubusercontent.com/rasheadsca-star/RAS-EGX-PRO2026-NEXT/main/data/market.json';
const UCP_URL = process.env.UCP_URL || 'https://ras-egx-astra-v4.vercel.app/api/ucp-shadow';
const OUTPUT = path.join(process.cwd(), 'data', 'ucp', 'morning-evidence.json');
const MIN_BASELINE_SESSIONS = Number(process.env.UCP_MORNING_MIN_BASELINE_SESSIONS || 5);
const MAX_SOURCE_AGE_MINUTES = Number(process.env.UCP_MORNING_MAX_SOURCE_AGE_MINUTES || 20);

function cairoClock(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(value);
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return {
    sessionDate: `${p.year}-${p.month}-${p.day}`,
    minuteOfDay: Number(p.hour) * 60 + Number(p.minute),
    display: `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`
  };
}

async function fetchJson(url) {
  const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}ucpMorning=${Date.now()}`, {
    headers: { Accept: 'application/json', 'Cache-Control': 'no-cache', 'User-Agent': 'Rasheed-EGX-UCP-Morning/1.0' }
  });
  if (!response.ok) throw new Error(`HTTP_${response.status}:${url}`);
  return response.json();
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function ageMinutes(timestamp, now = Date.now()) {
  const time = Date.parse(timestamp || '');
  return Number.isFinite(time) ? (now - time) / 60000 : Infinity;
}

function loadStore() {
  try { return JSON.parse(fs.readFileSync(OUTPUT, 'utf8')); }
  catch { return { schemaVersion: 'rasheed-egx-ucp-morning-evidence/v1', evidenceByTicker: {}, baselineSessions: [] }; }
}

function median(values = []) {
  const valid = values.map(Number).filter(Number.isFinite).sort((a,b) => a-b);
  if (!valid.length) return null;
  const i = Math.floor(valid.length / 2);
  return valid.length % 2 ? valid[i] : (valid[i-1] + valid[i]) / 2;
}

function candidateRange(candidate = {}) {
  const frozen = candidate.frozenAlpha || candidate;
  const low = num(frozen.entryLow ?? frozen.tradePlan?.entryLow ?? frozen.entry);
  const high = num(frozen.entryHigh ?? frozen.tradePlan?.entryHigh ?? frozen.entry);
  const center = num(frozen.entry);
  return {
    low: low ?? center,
    high: high ?? center,
    stop: num(frozen.stopLoss ?? frozen.tradePlan?.stop),
    target1: num(frozen.target1 ?? frozen.tradePlan?.target1)
  };
}

function buildEvidence({ market, ucp, existing, now = new Date() }) {
  const clock = cairoClock(now);
  const rows = Array.isArray(market?.rows) ? market.rows : [];
  const currentRows = rows.filter(row =>
    (row.sourceSessionDate || row.marketSessionDate) === clock.sessionDate &&
    ageMinutes(row.updatedAt || row.sourceSessionCheckedAt, now.getTime()) <= MAX_SOURCE_AGE_MINUTES
  );
  const rowMap = new Map(currentRows.map(row => [String(row.symbol || row.ticker || '').toUpperCase(), row]));
  const expectedUniverse = Number(ucp?.snapshot?.dataGate?.metrics?.expectedUniverseSize || rows.length || 0);
  const marketCoveragePct = expectedUniverse > 0 ? Number(((currentRows.length / expectedUniverse) * 100).toFixed(2)) : null;
  const breadthRows = currentRows.filter(row => num(row.changePct) !== null);
  const advancers = breadthRows.filter(row => num(row.changePct) > 0).length;
  const decliners = breadthRows.filter(row => num(row.changePct) < 0).length;
  const breadthPct = breadthRows.length ? Number(((advancers / breadthRows.length) * 100).toFixed(2)) : null;
  const marketBreadthPass = breadthPct === null ? null : breadthPct >= 45;

  const prepared = Array.isArray(ucp?.snapshot?.morningConfirmation?.preparedCandidates)
    ? ucp.snapshot.morningConfirmation.preparedCandidates : [];
  const previousBaselines = Array.isArray(existing?.baselineSessions) ? existing.baselineSessions : [];
  const priorSessions = previousBaselines.filter(x => x?.sessionDate && x.sessionDate !== clock.sessionDate);
  const evidenceByTicker = {};

  for (const candidate of prepared) {
    const ticker = String(candidate.ticker || '').toUpperCase();
    if (!ticker) continue;
    const row = rowMap.get(ticker);
    const range = candidateRange(candidate);
    const baselines = priorSessions
      .map(s => s?.rows?.[ticker])
      .filter(Boolean);
    const volumeBaseline = median(baselines.map(x => x.volume));
    const turnoverBaseline = median(baselines.map(x => x.turnover));
    const volumeBaselineAvailable = baselines.length >= MIN_BASELINE_SESSIONS && volumeBaseline > 0 && turnoverBaseline > 0;
    const price = num(row?.price ?? row?.last);
    const open = num(row?.open);
    const previousClose = num(row?.previousClose);
    const volume = num(row?.volume);
    const turnover = num(row?.valueTraded ?? row?.turnover);
    const gapPct = open !== null && previousClose > 0 ? ((open - previousClose) / previousClose) * 100 : null;
    const entryLow = range.low;
    const entryHigh = range.high;
    const tolerance = entryLow !== null && entryHigh !== null ? Math.max((entryHigh - entryLow) * 0.5, (entryLow + entryHigh) * 0.005) : null;
    const priceAcceptancePass = price !== null && entryLow !== null && entryHigh !== null && tolerance !== null
      ? price >= entryLow - tolerance && price <= entryHigh + tolerance : null;
    const openingGapPass = gapPct === null ? null : Math.abs(gapPct) <= 5;
    const relativeVolume = volumeBaselineAvailable && volume !== null ? volume / volumeBaseline : null;
    const relativeTurnover = volumeBaselineAvailable && turnover !== null ? turnover / turnoverBaseline : null;
    const relativeVolumePass = relativeVolume === null ? null : relativeVolume >= 0.75;
    const relativeTurnoverPass = relativeTurnover === null ? null : relativeTurnover >= 0.75;
    const stopBreached = price !== null && range.stop !== null ? price <= range.stop : false;

    evidenceByTicker[ticker] = {
      sourceSessionDate: clock.sessionDate,
      latestSourceMinute: clock.minuteOfDay,
      marketCoveragePct,
      candidatePresent: Boolean(row),
      volumeBaselineAvailable,
      baselineSessionCount: baselines.length,
      currentPrice: price,
      openingPrice: open,
      previousClose,
      openingGapPct: gapPct === null ? null : Number(gapPct.toFixed(4)),
      cumulativeVolume: volume,
      cumulativeTurnover: turnover,
      baselineMedianVolume: volumeBaseline,
      baselineMedianTurnover: turnoverBaseline,
      relativeVolumeRatio: relativeVolume === null ? null : Number(relativeVolume.toFixed(4)),
      relativeTurnoverRatio: relativeTurnover === null ? null : Number(relativeTurnover.toFixed(4)),
      marketBreadthPct: breadthPct,
      openingGapPass,
      priceAcceptancePass,
      relativeVolumePass,
      relativeTurnoverPass,
      marketBreadthPass,
      stopBreached,
      sourceTimestamp: row?.updatedAt || row?.sourceSessionCheckedAt || market?.updatedAt || market?.generatedAt || null,
      source: market?.source || 'PRO_CURRENT_MARKET',
      limitations: volumeBaselineAvailable ? [] : ['HISTORICAL_10_20_TO_10_45_BASELINE_NOT_ESTABLISHED']
    };
  }

  const baselineRows = {};
  for (const [ticker, row] of rowMap.entries()) {
    baselineRows[ticker] = {
      volume: num(row.volume),
      turnover: num(row.valueTraded ?? row.turnover),
      price: num(row.price ?? row.last)
    };
  }
  const baselineSessions = [
    ...priorSessions,
    { sessionDate: clock.sessionDate, capturedAt: now.toISOString(), minuteOfDay: clock.minuteOfDay, rows: baselineRows }
  ].slice(-30);

  const allEvidence = Object.values(evidenceByTicker);
  const completeSource = prepared.length > 0 && marketCoveragePct >= 90 && allEvidence.every(item =>
    item.candidatePresent === true && item.volumeBaselineAvailable === true &&
    ['openingGapPass','priceAcceptancePass','relativeVolumePass','relativeTurnoverPass','marketBreadthPass']
      .every(k => typeof item[k] === 'boolean')
  );

  return {
    schemaVersion: 'rasheed-egx-ucp-morning-evidence/v1',
    sessionDate: clock.sessionDate,
    generatedAt: now.toISOString(),
    cairoTime: clock.display,
    latestSourceMinute: clock.minuteOfDay,
    source: 'UCP_CURRENT_MARKET_MORNING_COLLECTOR',
    sourceMarketGeneratedAt: market?.generatedAt || null,
    sourceMarketUpdatedAt: market?.updatedAt || null,
    completeSource,
    marketCoveragePct,
    breadth: { observed: breadthRows.length, advancers, decliners, advancerPct: breadthPct, pass: marketBreadthPass },
    preparedCandidateCount: prepared.length,
    evidenceByTicker,
    baselineSessions,
    policy: { minBaselineSessions: MIN_BASELINE_SESSIONS, maxSourceAgeMinutes: MAX_SOURCE_AGE_MINUTES, window: '10:20-10:45 Africa/Cairo' },
    notes: [
      'Evidence is built only from same-session fresh market rows.',
      'Historical morning baselines are accumulated prospectively from this collector; no full-day volume is substituted for a morning baseline.',
      'Incomplete evidence remains WAITING_DATA and never fails open.'
    ]
  };
}

async function main() {
  const clock = cairoClock();
  if (clock.minuteOfDay < 620 || clock.minuteOfDay > 645) {
    console.log(JSON.stringify({ changed:false, reason:'OUTSIDE_10_20_TO_10_45_CAIRO_WINDOW', clock }, null, 2));
    return;
  }
  const [market, ucp] = await Promise.all([fetchJson(MARKET_URL), fetchJson(UCP_URL)]);
  const target = ucp?.snapshot?.morningConfirmation?.targetSessionDate || null;
  if (target && target !== clock.sessionDate) {
    console.log(JSON.stringify({ changed:false, reason:'TARGET_SESSION_MISMATCH', clock, target }, null, 2));
    return;
  }
  const existing = loadStore();
  const output = buildEvidence({ market, ucp, existing });
  fs.mkdirSync(path.dirname(OUTPUT), { recursive:true });
  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({ changed:true, sessionDate:output.sessionDate, preparedCandidateCount:output.preparedCandidateCount, marketCoveragePct:output.marketCoveragePct, completeSource:output.completeSource }, null, 2));
}

if (require.main === module) main().catch(error => { console.error(error?.stack || error); process.exit(1); });
module.exports = { cairoClock, ageMinutes, median, candidateRange, buildEvidence };
