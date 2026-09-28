// ASTRA V4 Dashboard page controller
// Connects dashboard UI contracts with API data.

import { buildDashboardState } from './dashboard-model.js';
import { createStatusCard } from './components/status-card.js';
import { createRecommendationCard } from './components/recommendation-card.js';

export async function loadDashboard() {
  const [healthResponse, recommendationsResponse] = await Promise.all([
    fetch('/api/engine-status'),
    fetch('/api/recommendations')
  ]);

  const health = await healthResponse.json();
  const recommendations = await recommendationsResponse.json();

  const state = buildDashboardState({ health, recommendations });

  return {
    status: createStatusCard('ASTRA Engine', 'ONLINE', state.health),
    recommendations: state.opportunities.map(createRecommendationCard)
  };
}
