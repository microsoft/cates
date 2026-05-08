import type { AnalyzerOptions, DiscoveryResult, Recommendation, SavingsEstimate, Score } from '../types.js';
import { estimateMonthlyCost } from '../utils/tokenizer.js';

export function calculateSavings(
  score: Score,
  discovery: DiscoveryResult,
  recommendations: Recommendation[],
  options: AnalyzerOptions,
): SavingsEstimate {
  const recommendationTokens = recommendations.reduce((sum, rec) => sum + rec.tokenSavings, 0);
  const projectedTokensPerInvocation = Math.max(score.estimatedTokenWaste, recommendationTokens);
  const projectedMonthlyCost = Math.max(
    score.estimatedMonthlyCostWaste,
    recommendations.reduce((sum, rec) => sum + rec.costSavings, 0),
    estimateMonthlyCost({
      tokenCount: projectedTokensPerInvocation,
      dailyInvocations: options.assumedDailyInvocations,
      costPer1kTokens: options.assumedModelCostPer1kTokens,
    }),
  );
  const projectedMonthlyTokens = projectedTokensPerInvocation * options.assumedDailyInvocations * 22;

  return {
    conservativeTokensPerInvocation: score.estimatedTokenWaste,
    conservativePercentage: score.estimatedTokenSavingsPercentage,
    projectedTokensPerInvocation,
    projectedPercentage: percentage(projectedTokensPerInvocation, discovery.totalTokens),
    projectedMonthlyTokens,
    projectedMonthlyCost,
    projectedAnnualTokens: projectedMonthlyTokens * 12,
    projectedAnnualCost: projectedMonthlyCost * 12,
  };
}

function percentage(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}
