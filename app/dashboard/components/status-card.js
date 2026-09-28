// ASTRA V4 dashboard status card component contract

export function createStatusCard(title, status, details = {}) {
  return {
    title,
    status,
    details
  };
}
