// ASTRA V4 Dashboard page controller
// Connects dashboard UI contracts with API data.

import { buildDashboardState } from './dashboard-model.js';
import { createStatusCard } from './components/status-card.js';
import { createRecommendationCard } from './components/recommendation-card.js';

export async function loadDashboard() {
  const [healthResponse, recommendationsResponse, dataHealthResponse] = await Promise.all([
    fetch('/api/engine-status', { cache: 'no-store' }),
    fetch('/api/recommendations', { cache: 'no-store' }),
    fetch('/api/data-health', { cache: 'no-store' })
  ]);

  const health = await healthResponse.json();
  const recommendations = await recommendationsResponse.json();
  const dataHealth = await dataHealthResponse.json();

  const state = buildDashboardState({
    health,
    recommendations,
    dataHealth
  });

  return {
    status: createStatusCard('ASTRA Engine', 'ONLINE', state.health),
    dataStatus: dataHealth,
    recommendations: state.opportunities.map(createRecommendationCard)
  };
}
