// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeInMemory } from '../src/analyze-in-memory.js';
import { evaluateConformance } from '../src/conformance.js';
import { formatExperimental } from '../src/scoring/report.js';
import { optimize } from '../src/optimizer/index.js';
import { renderOptimizationReport } from '../src/optimizer/report.js';
import type { AnalysisResult } from '../src/types.js';

const INSTRUCTIONS = '.github/copilot-instructions.md';

// A primitive exhibiting several cache- and output-shaping smells at once.
const SMELLY = [
  '# Service Agent',
  '',
  "Today's date is relevant. Build #4821 is current.",
  '',
  '## Stack',
  'TypeScript service using Drizzle ORM and Zod across the src directory for validation here.',
  '',
  '## Behavior',
  '- Always explain your reasoning step by step on every response.',
  '- When editing, return the complete file contents in your reply.',
  '- Restate the prompt back before answering the question.',
  '- Always use a comprehensive summary table for each response.',
  '- Always include the current git status at the top of context.',
  '',
].join('\n');

async function analyzeSmelly(experimental: boolean, extra: Record<string, unknown> = {}): Promise<AnalysisResult> {
  return analyzeInMemory({ files: [{ path: INSTRUCTIONS, content: SMELLY }], experimental, ...extra } as Parameters<typeof analyzeInMemory>[0]);
}

describe('experimental isolation guardrails (the critical ones)', () => {
  it('overall score and grade are IDENTICAL with and without experimental', async () => {
    const base = await analyzeSmelly(false);
    const xp = await analyzeSmelly(true);
    expect(xp.score.overall).toBe(base.score.overall);
    expect(xp.score.grade).toBe(base.score.grade);
    // every stable dimension score is byte-identical too
    expect(xp.score.dimensions.map(d => d.score)).toEqual(base.score.dimensions.map(d => d.score));
  });

  it('conformance is IDENTICAL with experimental on', async () => {
    const base = await analyzeSmelly(false);
    const xp = await analyzeSmelly(true);
    expect(evaluateConformance(xp)).toEqual(evaluateConformance(base));
  });

  it('result.findings NEVER contains an experimental (CS/OS) finding', async () => {
    const xp = await analyzeSmelly(true);
    expect(xp.findings.some(f => /^(CS|OS)\d/.test(f.ruleId))).toBe(false);
    expect(xp.findings.some(f => (f as { stability?: string }).stability === 'experimental')).toBe(false);
  });

  it('experimental channel is absent unless enabled', async () => {
    const base = await analyzeSmelly(false);
    expect(base.experimental).toBeUndefined();
    const xp = await analyzeSmelly(true);
    expect(xp.experimental?.enabled).toBe(true);
  });
});

describe('cache-shaping detectors (CS0xx)', () => {
  it('CS001 flags volatile tokens in always-loaded config', async () => {
    const xp = await analyzeSmelly(true);
    const cs001 = xp.experimental!.findings.find(f => f.ruleId === 'CS001');
    expect(cs001).toBeDefined();
    expect(cs001!.tokenClass).toBe('cached-input');
    expect(cs001!.dimension).toBe('cache-shaping');
  });

  it('CS003 flags live-state directives in the preamble', async () => {
    const xp = await analyzeSmelly(true);
    expect(xp.experimental!.findings.some(f => f.ruleId === 'CS003')).toBe(true);
  });

  it('CS002 flags a variable placeholder ahead of a large static block', async () => {
    const big = Array.from({ length: 60 }, (_, i) => `- Convention number ${i} about the codebase structure and testing approach used here.`).join('\n');
    const content = `# Template\n\nContext: \${USER_REQUEST}\n\n## Standards\n${big}\n`;
    const r = await analyzeInMemory({ files: [{ path: INSTRUCTIONS, content }], experimental: true });
    expect(r.experimental!.findings.some(f => f.ruleId === 'CS002')).toBe(true);
  });

  it('CS004 flags unstable tool/context ordering directives', async () => {
    const content = '# Agent\n\nShuffle the tool list on each call to add variety to results.\n';
    const r = await analyzeInMemory({ files: [{ path: INSTRUCTIONS, content }], experimental: true });
    expect(r.experimental!.findings.some(f => f.ruleId === 'CS004')).toBe(true);
  });

  it('CS005 flags a fragmented preamble shared across files', async () => {
    const shared = [
      'This repository is a TypeScript service.',
      'All code must be strictly linted before every commit.',
      'Full unit test coverage is required across the codebase.',
    ].join('\n');
    const r = await analyzeInMemory({
      files: [
        { path: INSTRUCTIONS, content: `# A\n\n${shared}\n\nUse Drizzle ORM.\n` },
        { path: 'AGENTS.md', content: `# B\n\n${shared}\n\nUse Vitest for tests.\n` },
      ],
      experimental: true,
    });
    expect(r.experimental!.findings.some(f => f.ruleId === 'CS005')).toBe(true);
  });
});

describe('output-shaping detectors (OS0xx)', () => {
  it('flags OS002 (full file), OS003 (verbose reasoning), OS004 (echo), OS005 (verbose format)', async () => {
    const xp = await analyzeSmelly(true);
    const ids = new Set(xp.experimental!.findings.map(f => f.ruleId));
    expect(ids.has('OS002')).toBe(true);
    expect(ids.has('OS003')).toBe(true);
    expect(ids.has('OS004')).toBe(true);
    expect(ids.has('OS005')).toBe(true);
    for (const f of xp.experimental!.findings.filter(f => f.ruleId.startsWith('OS'))) {
      expect(f.tokenClass).toBe('output');
    }
  });

  it('OS001 flags a substantial instruction file with no output contract; clean files produce nothing', async () => {
    const big = Array.from({ length: 40 }, (_, i) => `- Rule ${i}: keep modules small and cohesive across the service codebase.`).join('\n');
    const noContract = `# Agent\n\n## Rules\n${big}\n`;
    const withContract = `# Agent\n\nBe concise; code only, no preamble.\n\n## Rules\n${big}\n`;
    const a = await analyzeInMemory({ files: [{ path: INSTRUCTIONS, content: noContract }], experimental: true });
    const b = await analyzeInMemory({ files: [{ path: INSTRUCTIONS, content: withContract }], experimental: true });
    expect(a.experimental!.findings.some(f => f.ruleId === 'OS001')).toBe(true);
    expect(b.experimental!.findings.some(f => f.ruleId === 'OS001')).toBe(false);
  });

  it('clean config yields no experimental findings', async () => {
    const clean = '# Agent\n\nBe concise; code only, no preamble.\n\nUse TypeScript and Vitest for tests.\n';
    const r = await analyzeInMemory({ files: [{ path: INSTRUCTIONS, content: clean }], experimental: true });
    expect(r.experimental!.findings).toHaveLength(0);
    expect(r.experimental!.estimatedTokenImpact).toBe(0);
  });
});

describe('experimental rule overrides + report', () => {
  it('rules[id] = off removes an experimental finding; severity override applies', async () => {
    const off = await analyzeSmelly(true, { rules: { OS002: { enabled: false } } });
    expect(off.experimental!.findings.some(f => f.ruleId === 'OS002')).toBe(false);
    const soft = await analyzeSmelly(true, { rules: { CS001: { severity: 'low' } } });
    expect(soft.experimental!.findings.find(f => f.ruleId === 'CS001')?.severity).toBe('low');
  });

  it('formatExperimental renders a labeled section, or an off message', async () => {
    const xp = await analyzeSmelly(true);
    expect(formatExperimental(xp)).toMatch(/Experimental — NOT scored/);
    expect(formatExperimental(xp)).toMatch(/cache-shaping/);
    const base = await analyzeSmelly(false);
    expect(formatExperimental(base)).toMatch(/Experimental mode is off/);
  });
});

describe('optimizer experimental mode', () => {
  let repo: string;
  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'cates-xp-opt-'));
    await mkdir(join(repo, '.github'), { recursive: true });
    await writeFile(join(repo, INSTRUCTIONS), SMELLY, 'utf-8');
  });
  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it('surfaces experimental token impact without auto-applying it', async () => {
    const plain = await optimize({ repoPath: repo, dryRun: true });
    expect(plain.experimental).toBeUndefined();

    const result = await optimize({ repoPath: repo, dryRun: true, experimental: true });
    expect(result.experimental?.enabled).toBe(true);
    expect(result.experimental!.estimatedTokenImpact).toBeGreaterThan(0);
    const md = renderOptimizationReport(result, 'markdown');
    expect(md).toMatch(/Experimental opportunities/);
    expect(md).toMatch(/NOT auto-applied/);
  });
});
