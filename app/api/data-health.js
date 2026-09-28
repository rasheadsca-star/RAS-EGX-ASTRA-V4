export default async function handler(req, res) {
  const now = new Date().toISOString();

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');

  res.status(200).json({
    success: true,
    market: 'EGX',
    dataEngine: 'READY',
    liveFeed: 'NOT_CONNECTED',
    snapshot: 'WAITING',
    checkedAt: now,
    message: 'ASTRA pipeline is online and waiting for live market snapshot.'
  });
}
