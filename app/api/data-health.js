import { getMarketSnapshot } from '../../data-engine/egx-adapter.js';
import { egxLiveProvider } from '../../data-engine/providers/egx-live-provider.js';

export default async function handler(req, res) {
  const now = new Date().toISOString();
  const snapshot = await getMarketSnapshot(egxLiveProvider);

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');

  const hasRealQuotes = snapshot.quotes.some((q) => q.price > 0);

  res.status(200).json({
    success: true,
    market: 'EGX',
    dataEngine: 'READY',
    liveFeed: hasRealQuotes ? 'CONNECTED' : 'WAITING_FOR_SOURCE',
    source: snapshot.source,
    snapshot: hasRealQuotes ? 'READY' : 'WAITING',
    quoteCount: snapshot.quotes.length,
    checkedAt: now,
    snapshotTime: snapshot.timestamp,
    message: hasRealQuotes
      ? 'ASTRA received verified market quotes.'
      : 'ASTRA provider connected but real EGX quotes are not available yet.'
  });
}
