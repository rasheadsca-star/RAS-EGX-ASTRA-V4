const fs = require('fs');
const path = require('path');

const { analyze } = require('../engine/analysis-engine/runtime-analyzer');
const { generateRecommendation } = require('../engine/recommendation-engine/runtime-recommender');

const fixturePath = path.join(__dirname, '..', 'tests', 'fixtures', 'market-snapshot.fixture.json');
const outputPath = path.join(__dirname, '..', 'artifacts', 'astra-result.json');

const snapshot = require(fixturePath);

const analysis = analyze(snapshot);
const recommendation = generateRecommendation(analysis);

const result = {
  generatedAt: new Date().toISOString(),
  source: 'ASTRA-RUNTIME-ENGINE',
  market: snapshot.market,
  analysis,
  recommendations: recommendation.recommendations
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));

console.log(JSON.stringify(result, null, 2));
