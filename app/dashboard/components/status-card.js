// ASTRA V4 dashboard status card component contract

export function createStatusCard(title, status, details = {}) {
  return {
    title,
    status,
    details,
    dataState: details.dataState || details.status || 'UNKNOWN',
    lastUpdate: details.lastUpdate || details.updatedAt || null
  };
}
