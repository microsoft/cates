// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import { z } from 'zod';
import type { AnalysisResult } from './types.js';

export const ASSESSMENT_NOTICE = 'Static configuration assessment, not runtime assurance or security certification.';
export const SAVINGS_NOTICE = 'Token impacts are configuration heuristics, not measured request usage, bills, or proven savings; estimates may overlap.';

const text = z.string().trim().min(1).max(512);
const checkSchema = z.object({
  kind: z.enum(['effective-configuration', 'permission-allow', 'permission-deny', 'task-acceptance']),
  description: text,
  status: z.enum(['pass', 'fail', 'not-run']),
  evidence: text.optional(),
}).strict().refine(check => check.status === 'not-run' || check.evidence !== undefined, {
  message: 'A reported pass/fail must cite a redacted evidence reference',
});

const cohortSchema = z.object({
  revision: text,
  taskSuite: text,
  client: text,
  model: text,
  environment: text,
  attemptedTasks: z.number().int().nonnegative().max(1_000_000),
  acceptedTasks: z.number().int().nonnegative().max(1_000_000),
  totalCost: z.number().finite().nonnegative().max(1_000_000_000).nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  includesAllAttempts: z.boolean(),
  evidence: text,
}).strict().refine(cohort => cohort.acceptedTasks <= cohort.attemptedTasks, {
  message: 'Accepted tasks cannot exceed attempted tasks',
});

/** Caller-reported records only. References are never fetched or executed. */
export const RuntimeEvidenceSchema = z.object({
  version: z.literal(1),
  recordedAt: z.string().datetime({ offset: true }),
  context: z.object({ revision: text, client: text, model: text, environment: text }).strict(),
  checks: z.array(checkSchema).max(50),
  outcomes: z.object({ baseline: cohortSchema, candidate: cohortSchema }).strict().optional(),
}).strict();

export type RuntimeEvidence = z.infer<typeof RuntimeEvidenceSchema>;

export function summarizeRuntimeEvidence(input: RuntimeEvidence) {
  const record = RuntimeEvidenceSchema.parse(input);
  const { outcomes: evidenceOutcomes, ...metadata } = record;
  const metrics = (cohort: z.infer<typeof cohortSchema>) => ({
    ...cohort,
    acceptanceRate: cohort.attemptedTasks > 0 ? cohort.acceptedTasks / cohort.attemptedTasks : null,
    costPerAcceptedTask: cohort.includesAllAttempts && cohort.acceptedTasks > 0 && cohort.totalCost !== null
      ? cohort.totalCost / cohort.acceptedTasks : null,
  });
  let outcomes;
  if (evidenceOutcomes) {
    const baseline = metrics(evidenceOutcomes.baseline);
    const candidate = metrics(evidenceOutcomes.candidate);
    const matchingContext = (['taskSuite', 'client', 'model', 'environment', 'currency'] as const)
      .every(key => baseline[key] === candidate[key])
      && (['revision', 'client', 'model', 'environment'] as const)
        .every(key => candidate[key] === record.context[key]);
    const comparable = matchingContext && baseline.costPerAcceptedTask !== null && candidate.costPerAcceptedTask !== null;
    outcomes = {
      baseline, candidate, comparable,
      costPerAcceptedTaskChange: matchingContext && baseline.costPerAcceptedTask !== null && candidate.costPerAcceptedTask !== null
        ? candidate.costPerAcceptedTask - baseline.costPerAcceptedTask : null,
      note: 'Descriptive caller-reported comparison, not causal savings. Matching labels do not establish matched task difficulty or statistical significance.',
    };
  }
  return {
    status: 'reported-not-verified' as const,
    ...metadata,
    ...(outcomes ? { outcomes } : {}),
    failedChecks: record.checks.filter(check => check.status === 'fail').length,
    unassessedChecks: (['effective-configuration', 'permission-allow', 'permission-deny', 'task-acceptance'] as const)
      .filter(kind => !record.checks.some(check => check.kind === kind && check.status !== 'not-run')),
    note: 'CATES did not execute these probes, verify artifacts, or bind the reported revision to this scan. Validate scope, freshness and provenance independently. Reported checks never change static scores or gates.',
  };
}

export type RuntimeEvidenceSummary = ReturnType<typeof summarizeRuntimeEvidence>;

export function assessmentSummary(result: Pick<AnalysisResult,
  'discovery' | 'findings' | 'suppressedFindings' | 'disabledFindings' | 'disabledRuleIds' | 'disabledDimensions'>) {
  return {
    kind: 'static-configuration' as const,
    notice: ASSESSMENT_NOTICE,
    scoreBasis: 'Scores start at 100 and deduct detected findings after severity overrides, disabled rules/dimensions and suppressions. No findings is not proof of safety; compare only under the same policy and scope.',
    coverageNotice: 'Only discovered active configuration files are assessed. Unrecognized, excluded and external surfaces are not covered; no complete-repository coverage is claimed.',
    savingsNotice: SAVINGS_NOTICE,
    runtimeStatus: 'not-assessed' as const,
    criticalFindings: result.findings.filter(f => f.severity === 'critical').length,
    excludedCriticalFindings: [...result.suppressedFindings, ...(result.disabledFindings ?? [])]
      .filter(f => f.severity === 'critical').length,
    assessedFiles: result.discovery.files.filter(file => file.isActive).length,
    inactiveFiles: result.discovery.files.filter(file => !file.isActive).length,
    discoveryLimitations: result.discovery.diagnostics?.length ?? 0,
    suppressedFindings: result.suppressedFindings.length,
    disabledFindings: result.disabledFindings?.length ?? 0,
    disabledRuleIds: result.disabledRuleIds ?? [],
    disabledDimensions: result.disabledDimensions ?? [],
    unverified: [
      'Effective client loading, precedence and external settings',
      'Runtime tool permissions, sandbox and backend authorization',
      'Agent task correctness and behavioral preservation',
      'Actual request tokens, costs and economic benefit',
    ],
  };
}
