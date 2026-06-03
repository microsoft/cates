// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import type { DiscoveryResult, Recommendation, SavingsEstimate, Score } from '../types.js';

export function calculateSavings(
  score: Score,
  discovery: DiscoveryResult,
  recommendations: Recommendation[],
): SavingsEstimate {
  const recommendationTokens = recommendations.reduce((sum, rec) => sum + rec.tokenSavings, 0);
  const projectedTokensPerInvocation = Math.max(score.estimatedTokenWaste, recommendationTokens);

  return {
    conservativeTokensPerInvocation: score.estimatedTokenWaste,
    conservativePercentage: score.estimatedTokenSavingsPercentage,
    projectedTokensPerInvocation,
    projectedPercentage: percentage(projectedTokensPerInvocation, discovery.totalTokens),
  };
}

function percentage(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.min(100, Math.round((part / whole) * 1000) / 10);
}
