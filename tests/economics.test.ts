// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import request from 'supertest';
import example from '../examples/economics.json';
import { analyzeEconomics, formatEconomics, EconomicsInputSchema, ECONOMICS_LIMITS, type EconomicsInput } from '../src/index.js';
import { readEconomicsInput } from '../src/economics/input.js';
import { analyzeInMemory } from '../src/analyze-in-memory.js';
import { evaluateConformance, evaluateGates } from '../src/conformance.js';
import { createReport } from '../src/scoring/report.js';
import { handleEconomics } from '../service/api/handlers.js';
import { createServer } from '../service/server.js';

function ledger(): EconomicsInput {
  return EconomicsInputSchema.parse(structuredClone(example));
}

describe('experimental economics accounting', () => {
  it('counts exclusive token classes once and includes all attempts, children, and rejected work', () => {
    const result = analyzeEconomics(ledger());
    expect(result.stability).toBe('experimental');
    expect(result.requests.map(r => r.cost)).toEqual([
      expect.closeTo(0.0042, 10), expect.closeTo(0.00528, 10),
      expect.closeTo(0.002, 10), expect.closeTo(0.0016, 10),
    ]);
    expect(result.costs.model).toBeCloseTo(0.01308, 10);
    expect(result.costs.total).toBeCloseTo(0.53808, 10);
    expect(result.costs.perAcceptedTask).toBeCloseTo(0.53808, 10);
    expect(result.tokens).toMatchObject({
      input: 3300, output: 700, total: 4000,
      cacheRead: 400, cacheWrite: 400, reasoning: 250,
      perAcceptedTask: 4000,
    });
    expect(result.tokens.cacheReadShare).toBeCloseTo(400 / 3300);
    expect(result.tokens.reasoningShare).toBeCloseTo(250 / 700);
    expect(result.outcomes).toMatchObject({ tasks: 2, accepted: 1, terminal: 2, acceptanceRate: 0.5 });
    expect(result.attribution.retries.cost).toBeCloseTo(0.00528);
    expect(result.attribution.failed.cost).toBeCloseTo(0.0042);
    expect(result.attribution.models).toHaveLength(1);
    expect(result.attribution.models[0]?.cost).toBeCloseTo(0.01308);
    expect(result.attribution.tasks[1]?.model.cost).toBeCloseTo(0.0016);
    expect(result.attribution.purposes.find(p => p.purpose === 'verification')?.cost).toBeCloseTo(0.002);
  });

  it('retains source, rate provenance, adjustments, and evaluation evidence', () => {
    const input = ledger();
    const result = analyzeEconomics(input);
    expect(result.source).toEqual(input.source);
    expect(result.pricing).toEqual(input.rateCards);
    expect(result.additionalCosts).toEqual(input.additionalCosts);
    expect(result.requests[0]?.usage).toEqual(input.requests[0]?.usage);
    expect(result.requests[0]?.startedAt).toEqual(input.requests[0]?.startedAt);
    expect(result.requests[0]?.endedAt).toEqual(input.requests[0]?.endedAt);
    expect(result.attribution.tasks[0]?.outcomeEvidence).toBe(input.tasks[0]?.outcomeEvidence);
    expect(result.gaps).toContainEqual(expect.stringMatching(/Scenario inputs/));
  });

  it('uses reported model charges instead of adding them to rate-card estimates', () => {
    const input = ledger();
    input.requests[0]!.billing = { amount: 0.1, source: 'invoice-line-1' };
    const result = analyzeEconomics(input);
    expect(result.requests[0]).toMatchObject({
      cost: 0.1, costBasis: 'reported', billingSource: 'invoice-line-1',
      estimatedCost: expect.closeTo(0.0042, 10),
      reconciliationDelta: expect.closeTo(0.0958, 10),
    });
    expect(result.costs.total).toBeCloseTo(0.63388, 10);
    expect(result.costs.reportedRequests).toBe(1);
  });

  it('treats explicit free pricing and zero invoice amounts as known zero', () => {
    const input = ledger();
    input.rateCards[0]!.perMillion = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    input.requests[0]!.billing = { amount: 0, source: 'free-tier-receipt' };
    expect(analyzeEconomics(input).costs.model).toBe(0);
  });

  it('does not treat missing rates or null token counts as free usage', () => {
    const input = ledger();
    delete input.rateCards[0]!.perMillion.cacheWrite;
    const result = analyzeEconomics(input);
    expect(result.requests[0]?.cost).toBeNull();
    expect(result.requests[0]?.knownSubtotal).toBeCloseTo(0.0032, 10);
    expect(result.costs.total).toBeNull();
    expect(result.costs.perAcceptedTask).toBeNull();
    expect(result.costs.unpricedRequests).toBe(1);
    expect(result.gaps).toContainEqual(expect.stringMatching(/attempt-1.*missing usage/));
    input.requests[1]!.usage.cacheRead = null;
    input.requests[2]!.usage.input = null;
    input.requests[3]!.usage.output = null;
    const unknown = analyzeEconomics(input);
    expect(unknown.tokens.input).toBeNull();
    expect(unknown.tokens.output).toBeNull();
    expect(unknown.tokens.perAcceptedTask).toBeNull();
    expect(unknown.tokens.cacheReadShare).toBeNull();
    expect(unknown.gaps).toContainEqual(expect.stringMatching(/Token accounting contains unknown/));
  });

  it('can have known billing with unknown tokens without fabricating a token estimate', () => {
    const input = ledger();
    input.requests[0]!.usage = { input: null, output: null, cacheRead: null, cacheWrite: null };
    input.requests[0]!.billing = { amount: 0.1, source: 'receipt' };
    delete input.requests[0]!.rateCardId;
    const result = analyzeEconomics(input);
    expect(result.costs.total).toBeCloseTo(0.63388);
    expect(result.tokens.total).toBeNull();
    expect(result.requests[0]?.reconciliationDelta).toBeNull();
    expect(result.gaps).toContainEqual(expect.stringMatching(/Reasoning breakdown/));
  });

  it('does not require a rate for a zero-usage bucket or a reasoning breakdown for output pricing', () => {
    const input = ledger();
    input.requests = [input.requests[3]!];
    delete input.requests[0]!.usage.reasoning;
    delete input.rateCards[0]!.perMillion.cacheRead;
    delete input.rateCards[0]!.perMillion.cacheWrite;
    const result = analyzeEconomics(input);
    expect(result.costs.model).toBeCloseTo(0.0016);
    expect(result.tokens.reasoning).toBeNull();
    expect(result.tokens.reasoningShare).toBeNull();
  });

  it('requires explicit non-model cost coverage before reporting total economics', () => {
    const input = ledger();
    input.costCoverage.storage = 'unknown';
    const result = analyzeEconomics(input);
    expect(result.costs.model).toBeCloseTo(0.01308);
    expect(result.costs.total).toBeNull();
    expect(result.costs.knownSubtotal).toBeCloseTo(0.53808);
    expect(result.gaps).toContain('Incomplete storage cost coverage.');
    input.costCoverage.storage = 'complete';
    input.additionalCosts[0]!.amount = null;
    expect(analyzeEconomics(input).costs.total).toBeNull();
  });

  it.each(['partial', 'unknown'] as const)('does not extrapolate %s request coverage', coverage => {
    const input = ledger();
    input.requestCoverage = coverage;
    const result = analyzeEconomics(input);
    expect(result.costs.total).toBeNull();
    expect(result.costs.model).toBeNull();
    expect(result.costs.knownSubtotal).toBeGreaterThan(0);
    expect(result.tokens.perAcceptedTask).toBeNull();
    expect(result.attribution.models[0]?.cost).toBeNull();
    expect(result.gaps).toContainEqual(expect.stringMatching(/Request capture is/));
  });

  it('does not equate a succeeded request with an accepted task', () => {
    const input = ledger();
    input.tasks[0]!.outcome = 'pending';
    input.tasks[1]!.outcome = 'unknown';
    const result = analyzeEconomics(input);
    expect(result.outcomes).toMatchObject({ accepted: 0, pending: 1, unknown: 1, terminal: 0, acceptanceRate: null });
    expect(result.costs.perAcceptedTask).toBeNull();
    expect(result.tokens.perAcceptedTask).toBeNull();
    expect(result.gaps).toContainEqual(expect.stringMatching(/Some task outcomes are unknown/));
    expect(result.gaps).toContainEqual(expect.stringMatching(/No accepted tasks/));
  });

  it('retains abandoned and cancelled work without calling it automatically waste', () => {
    const input = ledger();
    input.tasks[1]!.outcome = 'abandoned';
    input.requests[3]!.status = 'cancelled';
    const result = analyzeEconomics(input);
    expect(result.outcomes.abandoned).toBe(1);
    expect(result.attribution.cancelled.cost).toBeCloseTo(0.0016);
    expect(result.costs.total).toBeCloseTo(0.53808);
  });

  it('measures elapsed task latency rather than summing parallel requests', () => {
    const result = analyzeEconomics(ledger());
    expect(result.latency.requests).toEqual({ samples: 4, p50Ms: 10_000, p95Ms: 105_000 });
    expect(result.latency.tasks).toEqual({ samples: 2, p50Ms: 60_000, p95Ms: 120_000 });
  });

  it('supports truly zero-call tasks without NaN, infinity, or invented acceptance', () => {
    const input = ledger();
    input.requests = [];
    input.additionalCosts = [];
    input.rateCards = [];
    const result = analyzeEconomics(input);
    expect(result.costs.total).toBe(0);
    expect(result.tokens.total).toBe(0);
    expect(result.tokens.cacheReadShare).toBeNull();
    expect(result.latency.requests).toEqual({ samples: 0, p50Ms: null, p95Ms: null });
    expect(result.attribution.tasks[0]?.model.cost).toBe(0);
    expect(JSON.stringify(result)).not.toMatch(/NaN|Infinity/);
  });

  it('is deterministic, leaves caller data untouched, and accepts reordered records', () => {
    const input = ledger();
    const before = structuredClone(input);
    expect(analyzeEconomics(input)).toEqual(analyzeEconomics(input));
    expect(input).toEqual(before);
    input.requests.reverse();
    expect(analyzeEconomics(input).costs.total).toBeCloseTo(analyzeEconomics(before).costs.total!);
  });
});

describe('economics schema invariants', () => {
  const invalid: [string, (input: EconomicsInput) => void, RegExp][] = [
    ['duplicate request', x => x.requests.push(x.requests[0]!), /Duplicate requests ID/],
    ['control characters', x => { x.requests[0]!.id = 'request\u001b[2J'; }, /control characters/],
    ['duplicate task', x => x.tasks.push(x.tasks[0]!), /Duplicate tasks ID/],
    ['duplicate charge', x => x.additionalCosts.push(x.additionalCosts[0]!), /Duplicate additionalCosts ID/],
    ['unknown task', x => { x.requests[0]!.taskId = 'missing'; }, /Unknown task/],
    ['unknown charge task', x => { x.additionalCosts[0]!.taskId = 'missing'; }, /Unknown task/],
    ['unknown parent', x => { x.requests[0]!.parentRequestId = 'missing'; }, /another request/],
    ['self parent', x => { x.requests[0]!.parentRequestId = x.requests[0]!.id; }, /another request/],
    ['cross-task retry', x => { x.requests[3]!.retryOf = x.requests[0]!.id; }, /same task/],
    ['future parent', x => { x.requests[0]!.parentRequestId = x.requests[1]!.id; }, /cannot start after/],
    ['unknown rate', x => { x.requests[0]!.rateCardId = 'missing'; }, /Unknown rate card/],
    ['wrong provider', x => { x.requests[0]!.provider = 'other'; }, /provider\/model/],
    ['wrong model', x => { x.requests[0]!.model = 'other'; }, /provider\/model/],
    ['expired rate', x => { x.rateCards[0]!.effectiveTo = x.requests[0]!.startedAt; }, /not effective/],
    ['future rate', x => { x.rateCards[0]!.effectiveFrom = '2026-10-02T00:00:00Z'; }, /not effective/],
    ['empty rate interval', x => { x.rateCards[0]!.effectiveTo = x.rateCards[0]!.effectiveFrom; }, /non-empty interval/],
    ['cache double count', x => { x.requests[0]!.usage.cacheRead = 700; }, /disjoint subsets/],
    ['reasoning double count', x => { x.requests[0]!.usage.reasoning = 201; }, /subset of output/],
    ['negative tokens', x => { x.requests[0]!.usage.input = -1; }, /Too small/],
    ['fractional tokens', x => { x.requests[0]!.usage.input = 1.5; }, /int/],
    ['infinite rate', x => { x.rateCards[0]!.perMillion.input = Infinity; }, /Invalid input/],
    ['negative cost', x => { x.additionalCosts[0]!.amount = -1; }, /Only adjustments/],
    ['non-applicable costs', x => { x.costCoverage.tools = 'not-applicable'; }, /cannot contain charges/],
    ['no outcome evidence', x => { delete x.tasks[0]!.outcomeEvidence; }, /evaluation reference/],
    ['bad timestamp', x => { x.requests[0]!.startedAt = 'yesterday'; }, /Invalid ISO datetime/],
    ['negative duration', x => { x.requests[0]!.endedAt = '2026-10-01T09:59:59Z'; }, /End precedes start/],
    ['outside window', x => { x.tasks[0]!.startedAt = '2026-10-01T09:59:59Z'; }, /Outside capture window/],
    ['outside task', x => { x.requests[0]!.endedAt = '2026-10-01T10:03:00Z'; }, /within its task/],
    ['negative window', x => { x.window.endedAt = '2026-10-01T09:00:00Z'; }, /Window ends before/],
    ['too many records', x => { x.requests = Array.from({ length: ECONOMICS_LIMITS.maxRecords + 1 }, () => x.requests[0]!); }, /Too big/],
  ];
  it.each(invalid)('rejects %s', (_name, mutate, error) => {
    const input = ledger();
    mutate(input);
    expect(() => analyzeEconomics(input)).toThrow(error);
  });

  it('rejects mixed parent/retry cycles even when timestamps are identical', () => {
    const input = ledger();
    input.requests[1]!.startedAt = input.requests[0]!.startedAt;
    input.requests[0]!.parentRequestId = input.requests[1]!.id;
    expect(() => analyzeEconomics(input)).toThrow(/cycle/);
  });

  it('rejects extra fields (including raw prompts), unsupported versions, missing buckets and coverage', () => {
    expect(() => analyzeEconomics({ ...ledger(), prompt: 'private prompt' })).toThrow(/Unrecognized key/);
    expect(() => analyzeEconomics({ ...ledger(), schemaVersion: 2 })).toThrow();
    expect(() => analyzeEconomics({ ...ledger(), costCoverage: {} })).toThrow();
    const input = ledger();
    expect(() => analyzeEconomics({ ...input, requests: [{ ...input.requests[0], usage: { input: 1, output: 2 } }] })).toThrow();
  });

  it('accepts equivalent timezone offsets and open-ended rate cards', () => {
    const input = ledger();
    input.requests[0]!.startedAt = '2026-10-01T12:00:00+02:00';
    delete input.rateCards[0]!.effectiveTo;
    expect(analyzeEconomics(input).costs.model).toBeCloseTo(0.01308);
  });
});

describe('economics interfaces and scan isolation', () => {
  it('renders experimental, incomplete, and scenario caveats in text and preserves JSON detail', () => {
    const input = ledger();
    input.requestCoverage = 'partial';
    const text = formatEconomics(analyzeEconomics(input));
    expect(text).toMatch(/EXPERIMENTAL \(not scored\)/);
    expect(text).toMatch(/Evidence: scenario/);
    expect(text).toMatch(/Total cost: unknown/);
    expect(text).toMatch(/Reasoning \(output subset\): 250/);
    expect(text).toMatch(/human-review: complete/);
    input.requestCoverage = 'complete';
    input.source.kind = 'observed';
    expect(formatEconomics(analyzeEconomics(input))).toMatch(/No missing fields detected/);
  });

  it('returns the same report through the public API, handler, and HTTP endpoint', async () => {
    const input = ledger();
    const expected = analyzeEconomics(input);
    expect(await handleEconomics(input)).toEqual({ ok: true, status: 200, body: expected });
    const result = await request(createServer()).post('/api/economics').send(input);
    expect(result.status).toBe(200);
    expect(result.body).toEqual(JSON.parse(JSON.stringify(expected)));
    expect(result.headers['content-security-policy']).toContain("default-src 'self'");
    const invalid = await request(createServer()).post('/api/economics').send({ schemaVersion: 1 });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toBe('Invalid economics ledger');
  });

  it('rejects oversized HTTP bodies before evaluation', async () => {
    const response = await request(createServer()).post('/api/economics').send({ padding: 'x'.repeat(1_100_000) });
    expect([400, 413, 500]).toContain(response.status);
    expect(response.body.stability).toBeUndefined();
  });

  it('reads only bounded local JSON files and reports invalid input explicitly', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cates-economics-'));
    try {
      const path = join(dir, 'usage.json');
      await writeFile(path, JSON.stringify(ledger()));
      expect(await readEconomicsInput(path)).toEqual(ledger());
      await writeFile(path, 'not-json');
      await expect(readEconomicsInput(path)).rejects.toThrow(SyntaxError);
      await writeFile(path, 'x'.repeat(ECONOMICS_LIMITS.maxBytes + 1));
      await expect(readEconomicsInput(path)).rejects.toThrow(/exceeds/);
      await expect(readEconomicsInput(dir)).rejects.toThrow(/regular JSON file/);
      await expect(readEconomicsInput(join(dir, 'missing'))).rejects.toThrow(/ENOENT/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('exposes the command with pretty/JSON output, explicit usage errors, and shell completion', () => {
    const cli = ['--import', 'tsx', 'src/cli/index.ts'];
    const json = execFileSync(process.execPath, [...cli, 'economics', 'examples/economics.json', '--format', 'json'], { encoding: 'utf8' });
    expect(JSON.parse(json).costs.total).toBeCloseTo(0.53808);
    const pretty = execFileSync(process.execPath, [...cli, 'economics', 'examples/economics.json'], { encoding: 'utf8' });
    expect(pretty).toMatch(/CATES Token Economics - EXPERIMENTAL/);
    for (const args of [
      ['economics', 'examples/economics.json', '--format', 'sarif'],
      ['economics', 'does-not-exist.json'],
      ['economics', 'package.json'],
    ]) {
      const result = spawnSync(process.execPath, [...cli, ...args], { encoding: 'utf8' });
      expect(result.status).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr).toMatch(/Error:/);
    }
    expect(execFileSync(process.execPath, [...cli, 'completion', 'bash'], { encoding: 'utf8' })).toContain('economics');
  }, 30_000);

  it('does not alter scan results, SARIF, scores, or conformance/gates', async () => {
    const options = { files: [{ path: 'AGENTS.md', content: '# Agent\nUse TypeScript. Run npm test.\n' }] };
    const before = await analyzeInMemory(options);
    analyzeEconomics(ledger());
    const after = await analyzeInMemory(options);
    const snapshot = (result: typeof before) => ({
      ...result,
      timestamp: '(capture time)',
      discovery: {
        ...result.discovery,
        files: result.discovery.files.map(file => ({ ...file, path: file.relativePath })),
      },
    });
    expect(snapshot(after)).toEqual(snapshot(before));
    expect(after).not.toHaveProperty('economics');
    expect(evaluateConformance(after)).toEqual(evaluateConformance(before));
    expect(evaluateGates(after, {})).toEqual(evaluateGates(before, {}));
    expect(createReport(after, 'sarif')).toEqual(createReport(before, 'sarif'));
    const original = JSON.parse(await readFile(new URL('../examples/economics.json', import.meta.url), 'utf8'));
    expect(original).toEqual(ledger());
  });
});
