// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import type {
  AnalyzerOptions,
  ConfigScope,
  ConfigType,
  ExperimentalDimension,
  ExperimentalDimensionScore,
  ExperimentalFinding,
  ExperimentalReport,
} from '../types.js';
import { detectCacheShaping } from './cache-shaping.js';
import { detectOutputShaping } from './output-shaping.js';

/**
 * EXPERIMENTAL aggregator. Runs the cache/output-shaping detectors, applies
 * rule-level policy overrides, and produces the isolated `experimental` channel.
 *
 * CRITICAL ISOLATION: nothing here ever touches `result.findings`,
 * `result.score`, or conformance. The dimension scores below are display-only
 * (weight 0) and are NEVER folded into `score.overall`.
 */

export interface ExperimentalInput {
  relativePath: string;
  content: string;
  scope: ConfigScope;
  type: ConfigType;
}

const SEVERITY_DEDUCTIONS: Record<string, number> = {
  critical: 25,
  high: 15,
  medium: 8,
  low: 3,
  info: 0,
};

const EXPERIMENTAL_NOTE =
  '🧪 EXPERIMENTAL (non-normative): cache/output-shaping is OFF by default, carries ZERO scoring weight, ' +
  'and is excluded from conformance and CI gates. Token-impact figures are advisory static estimates ' +
  '(cached-input ≈ 0.1× input; output ≈ 2–5× input — verify per model/provider). Rule IDs are SemVer-exempt.';

export function analyzeExperimental(files: ExperimentalInput[], options: AnalyzerOptions): ExperimentalReport {
  const raw: ExperimentalFinding[] = [
    ...detectCacheShaping(files.map(f => ({ relativePath: f.relativePath, content: f.content, scope: f.scope }))),
    ...detectOutputShaping(files.map(f => ({ relativePath: f.relativePath, content: f.content, type: f.type }))),
  ];

  const findings = applyRuleOverrides(raw, options.rules);

  const dimensions: ExperimentalDimensionScore[] = (['cache-shaping', 'output-shaping'] as ExperimentalDimension[])
    .map(dimension => buildDimensionScore(dimension, findings));

  const estimatedTokenImpact = findings.reduce((sum, f) => sum + (f.tokenImpact ?? 0), 0);

  return {
    enabled: true,
    findings,
    dimensions,
    estimatedTokenImpact,
    note: EXPERIMENTAL_NOTE,
  };
}

/** Rule-level overrides only (e.g. `rules: { OS002: off, CS001: { severity: low } }`). */
function applyRuleOverrides(
  findings: ExperimentalFinding[],
  rules: AnalyzerOptions['rules'],
): ExperimentalFinding[] {
  const out: ExperimentalFinding[] = [];
  for (const finding of findings) {
    const override = rules[finding.ruleId] ?? rules[finding.ruleId.toUpperCase()];
    if (override?.enabled === false) continue;
    out.push(override?.severity ? { ...finding, severity: override.severity } : finding);
  }
  return out;
}

function buildDimensionScore(
  dimension: ExperimentalDimension,
  findings: ExperimentalFinding[],
): ExperimentalDimensionScore {
  const dimFindings = findings.filter(f => f.dimension === dimension);
  let score = 100;
  for (const f of dimFindings) score -= SEVERITY_DEDUCTIONS[f.severity] ?? 0;
  score = Math.max(0, Math.min(100, score));
  const estimatedTokenImpact = dimFindings.reduce((sum, f) => sum + (f.tokenImpact ?? 0), 0);
  const label = dimension === 'cache-shaping' ? 'Cache-shaping' : 'Output-shaping';
  return {
    dimension,
    score,
    findings: dimFindings,
    estimatedTokenImpact,
    summary: `${label} (experimental, not scored): ${dimFindings.length} finding${dimFindings.length === 1 ? '' : 's'}, ~${estimatedTokenImpact.toLocaleString()} est. tokens`,
  };
}
