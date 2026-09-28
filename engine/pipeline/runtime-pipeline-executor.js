// ASTRA V4 Runtime Pipeline Executor
// Connects runtime analyzer and recommender into a single execution flow.

const runPipeline = ({ snapshot, analyzer, recommender, calculator }) => {
  const analysis = analyzer(snapshot);
  const recommendation = recommender(analysis);
  const trade = calculator(recommendation, snapshot);

  return {
    timestamp: new Date().toISOString(),
    analysis,
    recommendation: {
      ...recommendation,
      ...trade
    }
  };
};

module.exports = { runPipeline };
