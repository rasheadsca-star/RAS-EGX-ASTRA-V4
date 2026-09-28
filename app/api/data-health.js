import { getMarketSnapshot } from '../../data-engine/egx-adapter.js';
import egxProvider from '../../data-engine/providers/mock-egx-provider.js';

export default async function handler(req, res) {
  const now = new Date().toISOString();
  const snapshot = await getMarketSnapshot(egxProvider);

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');

  res.status(200).json({
    success: true,
    market: 'EGX',
    dataEngine: 'READY',
    liveFeed: snapshot.status,
    source: snapshot.source,
    snapshot: snapshot.quotes.length ? 'READY' : 'WAITING',
    quoteCount: snapshot.quotes.length,
    checkedAt: now,
    snapshotTime: snapshot.timestamp,
    message: snapshot.quotes.length
      ? 'ASTRA received market snapshot.'
      : 'ASTRA pipeline is online and waiting for live market snapshot.'
  });
}
