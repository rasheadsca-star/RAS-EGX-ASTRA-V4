const fs = require('fs');
const path = require('path');

const fixturePath = path.join(__dirname, '..', 'tests', 'fixtures', 'market-snapshot.fixture.json');
const outputPath = path.join(__dirname, '..', 'artifacts', 'astra-result.json');

const snapshot = require(fixturePath);

const symbol = snapshot.symbols[0];

const result = {
  symbol: symbol.symbol,
  signal: 'WATCH',
  entry: symbol.price,
  target1: Number((symbol.price * 1.05).toFixed(2)),
  target2: Number((symbol.price * 1.10).toFixed(2)),
  stopLoss: Number((symbol.price * 0.97).toFixed(2)),
  confidence: 70,
  source: 'ASTRA-E2E-RUNNER'
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));

console.log(JSON.stringify(result, null, 2));
