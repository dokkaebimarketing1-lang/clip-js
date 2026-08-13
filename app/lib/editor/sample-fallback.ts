export const shouldUseSampleFallback = (sampleMode: boolean, hasRealData: boolean): boolean =>
  sampleMode && !hasRealData;
