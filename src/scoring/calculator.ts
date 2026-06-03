// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import type { Finding, Score, DimensionScore, Dimension, DiscoveryResult } from '../types.js';

const DIMENSION_WEIGHTS: Record<Dimension, number> = {
  'security': 0.25,
  'token-efficiency': 0.25,
  'specificity': 0.15,
  'completeness': 0.15,
  'conflict-reachability': 0.10,
  'harness-quality': 0.10,
};

const SEVERITY_DEDUCTIONS: Record<string, number> = {
  'critical': 25,
  'high': 15,
  'medium': 8,
  'low': 3,
  'info': 0,
};

export function calculateScore(
  findings: Finding[],
  discovery: DiscoveryResult,
): Score {
  const dimensions: DimensionScore[] = [];

  for (const [dimension, weight] of Object.entries(DIMENSION_WEIGHTS)) {
    const dimFindings = findings.filter(f => f.dimension === dimension);
    let score = 100;

    for (const finding of dimFindings) {
      score -= SEVERITY_DEDUCTIONS[finding.severity] ?? 0;
    }

    score = Math.max(0, Math.min(100, score));
    const deductions = Object.entries(SEVERITY_DEDUCTIONS)
      .map(([severity, points]) => {
        const count = dimFindings.filter(f => f.severity === severity).length;
        return { severity: severity as DimensionScore['deductions'][number]['severity'], count, points: count * points };
      })
      .filter(deduction => deduction.count > 0);

    dimensions.push({
      dimension: dimension as Dimension,
      score,
      weight,
      findings: dimFindings,
      deductions,
      summary: getSummary(dimension as Dimension, score, dimFindings.length),
    });
  }

  const overall = Math.round(
    dimensions.reduce((sum, d) => sum + d.score * d.weight, 0)
  );

  const grade = getGrade(overall);
  const criticalCount = findings.filter(f => f.severity === 'critical').length;

  const tokenWaste = findings
    .filter(f => f.dimension === 'token-efficiency' && f.tokenImpact && f.tokenImpact > 0)
    .reduce((sum, f) => sum + (f.tokenImpact ?? 0), 0);

  const estimatedTokenSavingsPercentage = discovery.totalTokens > 0
    ? roundPercent((tokenWaste / discovery.totalTokens) * 100)
    : 0;
  const findingsPerThousandTokens = discovery.totalTokens > 0
    ? roundPercent((findings.length / discovery.totalTokens) * 1000)
    : 0;

  return {
    overall,
    grade,
    dimensions,
    totalFindings: findings.length,
    criticalCount,
    estimatedTokenWaste: tokenWaste,
    estimatedTokenSavingsPercentage,
    findingsPerThousandTokens,
  };
}

function roundPercent(value: number): number {
  return Math.round(value * 10) / 10;
}

function getGrade(score: number): Score['grade'] {
  if (score >= 95) return 'A+';
  if (score >= 85) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

function getSummary(dimension: Dimension, score: number, findingCount: number): string {
  const quality = score >= 85 ? 'Excellent' : score >= 70 ? 'Good' : score >= 50 ? 'Needs work' : 'Critical attention needed';

  const labels: Record<Dimension, string> = {
    'security': 'Security posture',
    'token-efficiency': 'Token efficiency',
    'specificity': 'Instruction specificity',
    'completeness': 'Coverage completeness',
    'conflict-reachability': 'Conflict & reachability',
    'harness-quality': 'Agent harness quality',
  };

  return `${labels[dimension]}: ${quality} (${findingCount} finding${findingCount === 1 ? '' : 's'})`;
}
