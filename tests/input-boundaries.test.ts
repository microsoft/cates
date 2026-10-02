// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeInMemory } from '../src/analyze-in-memory.js';
import { copilotSurface, classifyCopilotFile, COPILOT_SURFACES } from '../src/copilot/discovery.js';
import { loadPolicy } from '../src/policy.js';
import { createReport } from '../src/scoring/report.js';
import { parseGitHubLink } from '../src/sources.js';
import { isRecord, parseFrontmatter, parseJsonConfig, parseYamlConfig } from '../src/utils/config-parser.js';
import type { AnalysisResult } from '../src/types.js';

// Fixed seed and bounded mutations make every failure reproducible without network or native tooling.
function mutations(seeds: string[]): string[] {
  let state = 0xca7e5;
  function next(limit: number): number {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % limit;
  }
  const fragments = ['\0', '\r\n', '\uFEFF', '\uD800', '{}', '[]', '"', "'", ': ', '#', '&a [*a]', '%', '%2F', '../', '\\', '<script>', '日本語'];
  return [...seeds, ...Array.from({ length: 128 }, () => {
    const source = seeds[next(seeds.length)]!;
    const offset = next(source.length + 1);
    return (source.slice(0, offset) + fragments[next(fragments.length)]!
      + source.slice(offset + next(8))).slice(0, 2048);
  })];
}

function outcome<T>(operation: () => T): { value: T } | { error: string } {
  try {
    return { value: operation() };
  } catch (error) {
    if (!(error instanceof Error) || !['Error', 'SyntaxError', 'URIError', 'YAMLParseError', 'YAMLReferenceError', 'ZodError'].includes(error.name)) {
      throw error;
    }
    return { error: `${error.name}: ${error.message}` };
  }
}

describe('reproducible input-boundary mutations', () => {
  let directory: string;
  let markdown: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'cates-input-boundaries-'));
    markdown = await readFile(new URL('../fixtures/good/.github/copilot-instructions.md', import.meta.url), 'utf8');
  });
  afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

  it('keeps JSON, JSONC, YAML and frontmatter results deterministic and bounded', () => {
    const samples = mutations([
      markdown, '{}', 'tools: []\nmodel: example\n',
      '{"url":"https://example.test/a//b","enabled":true}',
      '{/* comment */"items":[1,2,],}',
      '---\nname: review\ndescription: Review changes\n---\nReview the diff.',
      'a: &a [*a]\n', '{"__proto__":{"polluted":true}}',
    ]);
    const parsers = [parseJsonConfig, (input: string) => parseJsonConfig(input, true), parseYamlConfig];
    for (const [index, input] of samples.entries()) {
      for (const parser of parsers) {
        const result = outcome(() => parser(input));
        expect(result, `parser case ${index}`).toEqual(outcome(() => parser(input)));
        if ('value' in result) expect(isRecord(result.value)).toBe(true);
      }
      const result = outcome(() => parseFrontmatter(input));
      expect(result, `frontmatter case ${index}`).toEqual(outcome(() => parseFrontmatter(input)));
      if ('value' in result) {
        expect(isRecord(result.value.metadata)).toBe(true);
        expect(result.value.body.length).toBeLessThanOrEqual(input.length);
      }
      expect({}).not.toHaveProperty('polluted');
    }
  });

  it('normalizes generated JSON and YAML policies consistently', async () => {
    for (const index of Array.from({ length: 64 }, (_, index) => index)) {
      const policy = {
        minScore: index % 2 ? index : String(index),
        failOn: ['critical', 'invalid', 'low'],
        rules: { SEC001: index % 2 === 0 ? 'off' : 'high' },
        experimental: index % 2 === 0,
        copilot: ['all', 'cli', 'vscode', 'cloud-agent', 'code-review'][index % 5],
      };
      const content = JSON.stringify(policy);
      const jsonPath = join(directory, '.cates.json');
      const yamlPath = join(directory, '.cates.yml');
      await writeFile(jsonPath, content);
      await writeFile(yamlPath, content);
      const result = await loadPolicy(directory, jsonPath);
      expect(result, `policy case ${index}`).toEqual(await loadPolicy(directory, yamlPath));
      expect(result.failOn).toEqual(['critical', 'low']);
      expect(result.minScore).toBe(index % 2 ? index : undefined);
    }
  });

  it('classifies candidate paths consistently without reading or executing resources', () => {
    for (const [index, input] of mutations([
      '.github/agents/review.md', '.github/hooks/check.json', '.mcp.json',
      '.github/copilot/settings.json', '.github/skills/review/SKILL.md',
      'nested/AGENTS.md', '.github/workflows/copilot-setup-steps.yml',
    ]).entries()) {
      const surface = copilotSurface(input);
      const classification = classifyCopilotFile(input);
      expect(classification, `discovery case ${index}`).toEqual(classifyCopilotFile(input));
      expect(Boolean(classification)).toBe(Boolean(surface));
      if (surface) expect(COPILOT_SURFACES).toContain(surface);
    }
  });

  it('rejects malformed GitHub URLs or returns safe, deterministic source components', () => {
    for (const [index, input] of mutations([
      'https://github.com/microsoft/cates',
      'https://github.com/microsoft/cates/tree/main/.github',
      'https://github.com/microsoft/cates/blob/main/AGENTS.md',
      'https://github.com/microsoft/cates/pull/34',
      'https://github.com/%/cates', 'https://example.test/microsoft/cates',
    ]).entries()) {
      const result = outcome(() => parseGitHubLink(input));
      expect(result, `URL case ${index}`).toEqual(outcome(() => parseGitHubLink(input)));
      if ('value' in result && result.value) {
        for (const identifier of [result.value.owner, result.value.repo]) {
          expect(identifier).toMatch(/^[A-Za-z0-9._-]+$/);
          expect(identifier).not.toMatch(/^-|\.\./);
        }
        if (result.value.ref) expect(result.value.ref).not.toMatch(/^-|\.\.|[\0\r\n;&$`]/);
        if (result.value.subpath) expect(result.value.subpath).not.toMatch(/^[-/]|\.\.|[\0\r\n]/);
      }
    }
  });

  it('round-trips arbitrary report text through JSON and SARIF and renders the text report', async () => {
    const baseline = await analyzeInMemory({
      tokenizer: 'approx',
      files: [{ path: '.github/copilot-instructions.md', content: markdown }],
    });
    for (const [index, input] of mutations(['plain text', markdown.slice(0, 100),
      '"quoted"\ntext', '<script>alert("not executed")</script>', '日本語']).entries()) {
      const result: AnalysisResult = {
        ...baseline,
        findings: [{
          ruleId: 'SEC001', dimension: 'security', severity: 'high',
          confidence: 'certain', message: input, file: `source/${input}`, line: 1,
        }],
      };
      const json = JSON.parse(createReport(result, 'json'));
      const sarif = JSON.parse(createReport(result, 'sarif'));
      expect(json.findings[0].message, `JSON case ${index}`).toBe(input);
      expect(sarif.runs[0].results[0].message.text, `SARIF case ${index}`).toBe(input);
      expect(sarif.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri).toBe(`source/${input}`);
      expect(createReport(result, 'pretty').length).toBeLessThan(100_000);
    }
  });
});
