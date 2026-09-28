// ASTRA V4 Dashboard data model
// Provides a clean contract between APIs and UI components.

export function buildDashboardState({ health, recommendations }) {
  return {
    health: health || {},
    opportunities: recommendations || [],
    updatedAt: new Date().toISOString()
  };
}
