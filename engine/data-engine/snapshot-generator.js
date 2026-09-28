// ASTRA V4 Snapshot Generator

export function generateSnapshot(validatedData = []) {
  return {
    generatedAt: new Date().toISOString(),
    rows: validatedData,
    rowCount: validatedData.length,
    status: 'GENERATED'
  };
}
