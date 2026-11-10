// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { analyzeInMemory } from '../src/analyze-in-memory.js';
import { RuntimeEvidenceSchema, summarizeRuntimeEvidence, type RuntimeEvidence } from '../src/assurance.js';
import { readBoundedJson } from '../src/utils/read-json.js';
import { calculateScore } from '../src/scoring/calculator.js';
import { createReport } from '../src/scoring/report.js';
import { evaluateConformance, evaluateGates } from '../src/conformance.js';
import { handleAnalyze, handleScan } from '../service/api/handlers.js';
import { resolveReviewSource } from '../src/sources.js';
import type { AnalysisResult, Finding } from '../src/types.js';

vi.mock('../src/sources.js', () => ({ resolveReviewSource: vi.fn() }));

const files = [{ path: '.github/copilot-instructions.md', content: 'Use TypeScript and run npm test.\n' }];
const cohort = {
  revision: 'before', taskSuite: 'representative-v1', client: 'test-client/1',
  model: 'test-model/1', environment: 'disposable-fixture',
  attemptedTasks: 10, acceptedTasks: 5, totalCost: 10,
  currency: 'USD', includesAllAttempts: true, evidence: 'redacted/baseline.json',
};
function evidence(): RuntimeEvidence {
  return {
    version: 1, recordedAt: '2026-01-02T03:04:05Z',
    context: { revision: 'after', client: cohort.client, model: cohort.model, environment: cohort.environment },
    checks: [
      { kind: 'effective-configuration', description: 'Inspect effective loading and permissions', status: 'pass', evidence: 'redacted/config.json' },
      { kind: 'permission-allow', description: 'Permitted synthetic read', status: 'pass', evidence: 'redacted/allow.json' },
      { kind: 'permission-deny', description: 'Host incorrectly allowed forbidden synthetic write', status: 'fail', evidence: 'redacted/deny.json' },
      { kind: 'task-acceptance', description: 'Acceptance criteria pending', status: 'not-run' },
    ],
    outcomes: {
      baseline: { ...cohort },
      candidate: { ...cohort, revision: 'after', acceptedTasks: 8, totalCost: 12, evidence: 'redacted/candidate.json' },
    },
  };
}

describe('caller-reported runtime evidence', () => {
  it('keeps failures and missing checks visible and calculates bounded descriptive outcomes', () => {
    const report = summarizeRuntimeEvidence(evidence());
    expect(report.status).toBe('reported-not-verified');
    expect(report.failedChecks).toBe(1);
    expect(report.unassessedChecks).toEqual(['task-acceptance']);
    expect(report.outcomes?.baseline.acceptanceRate).toBe(0.5);
    expect(report.outcomes?.candidate.acceptanceRate).toBe(0.8);
    expect(report.outcomes?.baseline.costPerAcceptedTask).toBe(2);
    expect(report.outcomes?.candidate.costPerAcceptedTask).toBe(1.5);
    expect(report.outcomes?.comparable).toBe(true);
    expect(report.outcomes?.costPerAcceptedTaskChange).toBe(-0.5);
    expect(report.outcomes?.note).toMatch(/not causal/);
    expect(report.note).toMatch(/did not execute/);
  });

  it.each([
    { acceptedTasks: 0 },
    { totalCost: null },
    { includesAllAttempts: false },
  ])('does not turn unknown or incomplete cost into savings: %j', patch => {
    const input = evidence();
    Object.assign(input.outcomes!.candidate, patch);
    const report = summarizeRuntimeEvidence(input);
    expect(report.outcomes?.candidate.costPerAcceptedTask).toBeNull();
    expect(report.outcomes?.costPerAcceptedTaskChange).toBeNull();
    expect(report.outcomes?.comparable).toBe(false);
  });

  it('handles zero attempts, zero known cost and no outcome cohorts explicitly', () => {
    const input = evidence();
    input.outcomes!.candidate.attemptedTasks = 0;
    input.outcomes!.candidate.acceptedTasks = 0;
    expect(summarizeRuntimeEvidence(input).outcomes?.candidate.acceptanceRate).toBeNull();
    input.outcomes!.candidate.attemptedTasks = 1;
    input.outcomes!.candidate.acceptedTasks = 1;
    input.outcomes!.candidate.totalCost = 0;
    expect(summarizeRuntimeEvidence(input).outcomes?.candidate.costPerAcceptedTask).toBe(0);
    delete input.outcomes;
    input.checks = [];
    const report = summarizeRuntimeEvidence(input);
    expect(report).not.toHaveProperty('outcomes');
    expect(report.unassessedChecks).toHaveLength(4);
  });

  it.each(['taskSuite', 'client', 'model', 'environment', 'currency'] as const)(
    'does not compare incompatible %s labels', key => {
      const input = evidence();
      input.outcomes!.baseline[key] = key === 'currency' ? 'EUR' : 'different';
      expect(summarizeRuntimeEvidence(input).outcomes?.comparable).toBe(false);
      expect(summarizeRuntimeEvidence(input).outcomes?.costPerAcceptedTaskChange).toBeNull();
    },
  );

  it('does not compare a candidate that differs from the reported revision/context', () => {
    const input = evidence();
    input.context.revision = 'another-revision';
    expect(summarizeRuntimeEvidence(input).outcomes?.costPerAcceptedTaskChange).toBeNull();
  });

  it.each([
    { version: 2 },
    { recordedAt: 'yesterday' },
    { checks: [{ kind: 'permission-deny', description: 'Unsubstantiated', status: 'pass' }] },
    { checks: Array.from({ length: 51 }, () => evidence().checks[0]) },
    { context: { ...evidence().context, revision: 'x'.repeat(513) } },
    { extra: 'unrecognized' },
    { outcomes: { baseline: { ...cohort, acceptedTasks: 11 }, candidate: cohort } },
    { outcomes: { baseline: { ...cohort, totalCost: -1 }, candidate: cohort } },
    { outcomes: { baseline: { ...cohort, attemptedTasks: 0.5 }, candidate: cohort } },
    { outcomes: { baseline: { ...cohort, totalCost: Infinity }, candidate: cohort } },
  ])('rejects invalid records: %j', patch => {
    expect(RuntimeEvidenceSchema.safeParse({ ...evidence(), ...patch }).success).toBe(false);
  });
});

describe('assessment boundaries and integration', () => {
  let base: AnalysisResult;
  beforeAll(async () => { base = await analyzeInMemory({ files }); });

  it('leaves scores, findings, savings, conformance and gates identical with failed runtime evidence', async () => {
    const attached = await analyzeInMemory({ files, runtimeEvidence: evidence() });
    expect(attached.score).toEqual(base.score);
    expect(attached.findings).toEqual(base.findings);
    expect(attached.savings).toEqual(base.savings);
    expect(evaluateConformance(attached)).toEqual(evaluateConformance(base));
    const policy = { minScore: 90, failOn: ['critical'] as const };
    expect(evaluateGates(attached, { ...policy, failOn: [...policy.failOn] }))
      .toEqual(evaluateGates(base, { ...policy, failOn: [...policy.failOn] }));
    expect(attached.runtimeEvidence?.failedChecks).toBe(1);
    expect(base.runtimeEvidence).toBeUndefined();
    expect(base.assessment?.runtimeStatus).toBe('not-assessed');
    expect(base.assessment?.unverified).toHaveLength(4);
    expect(evaluateConformance(base).assessmentNotice).toMatch(/not runtime assurance/);
  });

  it('puts a critical warning beside an A-grade and discloses static limits in every format', () => {
    const finding: Finding = { ruleId: 'SEC001', dimension: 'security', severity: 'critical',
      confidence: 'certain', file: files[0]!.path, message: 'Synthetic critical finding' };
    const result = { ...base, findings: [finding], score: calculateScore([finding], base.discovery) };
    expect(result.score.overall).toBe(94);
    expect(result.score.grade).toBe('A');
    const pretty = createReport(result, 'pretty');
    expect(pretty).toContain('Grade: A; static criteria only');
    expect(pretty).toContain('CRITICAL: 1 unresolved finding(s), regardless of grade.');
    expect(pretty.indexOf('CRITICAL:')).toBeLessThan(pretty.indexOf('Dimension Scores:'));
    expect(pretty).toContain('NOT ASSESSED');
    expect(pretty).toContain('not measured request usage');
    expect(pretty).toContain('Runtime evidence: NOT SUPPLIED');
    const json = JSON.parse(createReport(result, 'json'));
    const sarif = JSON.parse(createReport(result, 'sarif'));
    expect(json.assessment.criticalFindings).toBe(1);
    expect(sarif.runs[0].properties.assessment).toEqual(json.assessment);
  });

  it('discloses policy exclusions and discovery limitations, including synthetic legacy results', async () => {
    const result = await analyzeInMemory({
      files: [{ ...files[0]!, content: 'api_key = "sk-test1234567890abcdef1234567890abcdef"\n' }],
      dimensions: { completeness: { enabled: false } },
      rules: { TE003: { enabled: false } },
      suppressions: [{ ruleId: 'SEC001', reason: 'Reviewed synthetic fixture' }],
    });
    expect(result.assessment?.disabledDimensions).toContain('completeness');
    expect(result.assessment?.disabledRuleIds).toContain('TE003');
    expect(result.assessment?.disabledFindings).toBeGreaterThan(0);
    expect(result.assessment?.suppressedFindings).toBe(1);
    expect(result.assessment?.excludedCriticalFindings).toBe(1);
    result.discovery.diagnostics = [{ path: 'too-large.md', reason: 'oversized', message: 'Excluded file' }];
    result.discovery.files.push({ ...result.discovery.files[0]!, isActive: false, relativePath: 'too-large.md' });
    delete result.assessment;
    const json = JSON.parse(createReport(result, 'json'));
    expect(json.assessment.discoveryLimitations).toBe(1);
    expect(json.assessment.inactiveFiles).toBe(1);
    const pretty = createReport(result, 'pretty');
    expect(pretty).toContain('Policy exclusions:');
    expect(pretty).toContain('CRITICAL EXCLUSIONS: 1');
    expect(pretty).toContain('completeness');
    expect(pretty).toContain('after severity overrides');
  });

  it('does not present an empty core scan as a passing assessment', async () => {
    const empty = await analyzeInMemory({ files: [{ path: 'README.md', content: 'Not an agent configuration' }] });
    expect(empty.assessment?.assessedFiles).toBe(0);
    expect(createReport(empty, 'pretty')).toContain('no active core-scan files; the grade is not a passing assessment');
    expect(empty.assessment?.coverageNotice).toContain('no complete-repository coverage');
  });

  it('renders reported failures and outcome deltas without claiming verification', async () => {
    const result = await analyzeInMemory({ files, runtimeEvidence: evidence() });
    const pretty = createReport(result, 'pretty');
    expect(pretty).toContain('Runtime evidence: REPORTED, NOT VERIFIED');
    expect(pretty).toContain('REPORTED RUNTIME FAILURES: 1');
    expect(pretty).toContain('permission-deny: fail');
    expect(pretty).toContain('Cost/accepted task change: -0.5');
    expect(pretty).toContain('not causal savings');
    const sarif = JSON.parse(createReport(result, 'sarif'));
    expect(sarif.runs[0].properties.runtimeEvidence.failedChecks).toBe(1);
    delete result.runtimeEvidence!.outcomes;
    expect(createReport(result, 'pretty')).not.toContain('Cost/accepted task change:');
    result.runtimeEvidence = summarizeRuntimeEvidence(await readBoundedJson(
      'examples/runtime-evidence.json', 100_000, 'Runtime evidence',
    ).then(value => RuntimeEvidenceSchema.parse(value)));
    expect(createReport(result, 'pretty')).toContain('unknown/not comparable');
  });

  it('accepts and isolates HTTP evidence, rejects invalid evidence with explicit 400', async () => {
    const valid = await handleAnalyze({ files, runtimeEvidence: evidence() });
    expect(valid.ok).toBe(true);
    if (valid.ok) {
      expect(valid.body.runtimeEvidence?.status).toBe('reported-not-verified');
      expect(valid.body.score).toEqual(base.score);
    }
    const invalid = await handleAnalyze({ files, runtimeEvidence: { version: 1 } });
    expect(invalid).toMatchObject({ ok: false, status: 400, body: { error: 'Invalid analyze request' } });
    const invalidScan = await handleScan({ url: 'https://github.com/example/repo', runtimeEvidence: { version: 1 } });
    expect(invalidScan).toMatchObject({ ok: false, status: 400 });
  });
});

describe('bounded local evidence and CLI', () => {
  let directory: string;
  beforeAll(async () => { directory = await mkdtemp(join(tmpdir(), 'cates-evidence-')); });
  afterAll(async () => { await rm(directory, { recursive: true, force: true }); });
  const cli = (...args: string[]) => spawnSync(process.execPath,
    ['--import', 'tsx', 'src/cli/index.ts', ...args], { encoding: 'utf8' });

  it('reads JSON and rejects oversized, malformed and non-file inputs explicitly', async () => {
    const path = join(directory, 'input.json');
    await writeFile(path, JSON.stringify(evidence()));
    expect(await readBoundedJson(path, 100_000, 'Runtime evidence')).toEqual(evidence());
    await expect(readBoundedJson(path, 10, 'Runtime evidence')).rejects.toThrow('exceeds');
    await expect(readBoundedJson(directory, 100_000, 'Runtime evidence')).rejects.toThrow('regular JSON file');
    await writeFile(path, 'not JSON');
    await expect(readBoundedJson(path, 100_000, 'Runtime evidence')).rejects.toThrow();
    await expect(readBoundedJson(join(directory, 'missing'), 100_000, 'Runtime evidence')).rejects.toThrow('ENOENT');
  });

  it('attaches the documented template via CLI and preserves normal score/gate behavior', async () => {
    const result = cli('fixtures/good', '--runtime-evidence', 'examples/runtime-evidence.json', '--format', 'json');
    expect(result.status, result.stderr).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.runtimeEvidence.status).toBe('reported-not-verified');
    expect(parsed.runtimeEvidence.outcomes.candidate.costPerAcceptedTask).toBeNull();
    expect(parsed.runtimeEvidence.unassessedChecks).toHaveLength(4);
    expect(parsed.assessment.kind).toBe('static-configuration');
  });

  it('fails explicitly for invalid evidence instead of returning success-shaped output', async () => {
    const path = join(directory, 'invalid.json');
    await writeFile(path, '{"version":2}');
    const result = cli('fixtures/good', '--runtime-evidence', path, '--format', 'json');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Error:');
    expect(result.stdout).toBe('');
  });

  it('supports review and completion without fetching or executing evidence references', async () => {
    const input = RuntimeEvidenceSchema.parse(JSON.parse(await readFile('examples/runtime-evidence.json', 'utf8')));
    vi.mocked(resolveReviewSource).mockResolvedValue({
      repoPath: new URL('../fixtures/good', import.meta.url).pathname,
      analyzePath: new URL('../fixtures/good', import.meta.url).pathname,
      displayName: 'fixture-review',
    });
    const result = await handleScan({ url: 'https://github.com/example/repo', runtimeEvidence: input });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.body.runtimeEvidence?.unassessedChecks).toHaveLength(4);
    expect(cli('completion', 'bash').stdout).toContain('--runtime-evidence');
  });
});
