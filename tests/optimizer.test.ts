// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyze } from '../src/analyzers/index.js';
import { optimize } from '../src/optimizer/index.js';
import {
  OPTIMIZERS,
  selectOptimizers,
  meaningfulSignature,
  type Optimizer,
} from '../src/optimizer/optimizers.js';
import { renderOptimizationReport } from '../src/optimizer/report.js';

function byId(id: string): Optimizer {
  const found = OPTIMIZERS.find(o => o.id === id);
  if (!found) throw new Error(`no optimizer ${id}`);
  return found;
}

const INSTRUCTIONS = '.github/copilot-instructions.md';

// A primitive that is inefficient in losslessly-fixable ways (filler + an exact
// duplicate instruction + blank-line spam) AND in ways that require human
// judgement (forced verbosity → TE004, which must NOT be auto-applied).
const MESSY = [
  '# Team Guidelines',
  '',
  'You are a helpful assistant. Please be concise.',
  '',
  '## Conventions',
  '',
  '- Use `const` by default and only reach for `let` when reassignment is required.',
  '- Validate every inbound request body with the Zod schemas under `src/schemas`.',
  '- Use `const` by default and only reach for `let` when reassignment is required.',
  '',
  '',
  '',
  '## Output',
  '',
  '- Always explain every code change in detail with comprehensive comments.',
  '',
].join('\n');

describe('optimizers (pure, lossless)', () => {
  it('whitespace: strips trailing ws, keeps hard breaks, collapses blanks, preserves code', () => {
    const input = [
      '',
      'First line.   ',
      'Second line. ',
      '',
      '',
      '',
      '```',
      'code   with   spaces   ',
      '```',
      '',
      '',
    ].join('\n');
    const out = byId('whitespace').apply(input);
    expect(out.content).toBe(
      'First line.  \nSecond line.\n\n```\ncode   with   spaces   \n```\n',
    );
    expect(meaningfulSignature(input)).toBe(meaningfulSignature(out.content));
  });

  it('whitespace: empty content stays empty', () => {
    expect(byId('whitespace').apply('   \n\n').content).toBe('');
  });

  it('dedupe-lines: removes later exact duplicate, keeps first, ignores short lines and code', () => {
    const input = [
      '# Heading',
      'Run the full integration test suite before pushing to the main branch.',
      'short one',
      'short one',
      'Run the full integration test suite before pushing to the main branch.',
      '```',
      'duplicate code line that is quite long but lives inside a fence block',
      'duplicate code line that is quite long but lives inside a fence block',
      '```',
    ].join('\n');
    const out = byId('dedupe-lines').apply(input);
    const lines = out.content.split('\n');
    expect(lines.filter(l => l.startsWith('Run the full integration')).length).toBe(1);
    // short lines (normalized < 20 chars) are left untouched
    expect(lines.filter(l => l === 'short one').length).toBe(2);
    // code-fence duplicates are preserved verbatim
    expect(lines.filter(l => l.includes('duplicate code line')).length).toBe(2);
    expect(meaningfulSignature(input)).toBe(meaningfulSignature(out.content));
  });

  it('dedupe-blocks: removes later byte-identical multi-line block', () => {
    const block = [
      'When generating migrations, always include a reversible down step.',
      'Name the migration file with the UTC timestamp prefix used by the toolchain.',
    ];
    const input = [
      ...block,
      '',
      'A unique separating paragraph that should remain in place untouched here.',
      '',
      ...block,
      '',
    ].join('\n');
    const out = byId('dedupe-blocks').apply(input);
    expect(out.content.split('reversible down step').length - 1).toBe(1);
    expect(out.edits.length).toBe(1);
    expect(meaningfulSignature(input)).toBe(meaningfulSignature(out.content));
  });

  it('dedupe-blocks: ignores trivial short blocks', () => {
    const input = '- a\n- b\n\n- a\n- b\n';
    const out = byId('dedupe-blocks').apply(input);
    expect(out.edits).toEqual([]);
    expect(out.content).toBe(input);
  });

  it('remove-filler: drops standalone filler, keeps filler embedded in real guidance', () => {
    const input = [
      'You are a helpful assistant.',
      'Always follow best practices when touching the `src/payments` module specifically.',
      'Write clean, readable, maintainable code.',
    ].join('\n');
    const out = byId('remove-filler').apply(input);
    const lines = out.content.split('\n').filter(l => l.trim() !== '');
    expect(lines.some(l => l.includes('helpful assistant'))).toBe(false);
    expect(lines.some(l => l.includes('readable, maintainable'))).toBe(false);
    // embedded filler inside a concrete instruction is preserved
    expect(lines.some(l => l.includes('src/payments'))).toBe(true);
  });
});

describe('selectOptimizers', () => {
  it('defaults to all default-on optimizers', () => {
    expect(selectOptimizers().map(o => o.id)).toEqual(OPTIMIZERS.map(o => o.id));
  });
  it('honors only and skip', () => {
    expect(selectOptimizers(['whitespace']).map(o => o.id)).toEqual(['whitespace']);
    expect(selectOptimizers(undefined, ['whitespace']).some(o => o.id === 'whitespace')).toBe(false);
  });
  it('throws on unknown optimizer id', () => {
    expect(() => selectOptimizers(['nope'])).toThrow(/Unknown optimizer/);
    expect(() => selectOptimizers(undefined, ['nope'])).toThrow(/Unknown optimizer/);
  });
});

describe('meaningfulSignature', () => {
  it('is invariant to blank lines, duplicates and filler', () => {
    const a = 'Use the shared logger from src/utils/logger.ts everywhere.\n';
    const b = [
      '',
      'You are a helpful assistant.',
      'Use the shared logger from src/utils/logger.ts everywhere.',
      '',
      'Use the shared logger from src/utils/logger.ts everywhere.',
      '',
    ].join('\n');
    expect(meaningfulSignature(a)).toBe(meaningfulSignature(b));
  });
  it('changes when a real instruction is removed', () => {
    const a = 'Keep functions under 40 lines.\nValidate inputs with Zod.\n';
    const b = 'Keep functions under 40 lines.\n';
    expect(meaningfulSignature(a)).not.toBe(meaningfulSignature(b));
  });
});

describe('optimize() integration', () => {
  let repo: string;
  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'cates-opt-'));
    await mkdir(join(repo, '.github'), { recursive: true });
    await writeFile(join(repo, INSTRUCTIONS), MESSY, 'utf-8');
  });
  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it('reduces tokens losslessly and writes the file', async () => {
    const result = await optimize({ repoPath: repo });

    expect(result.totals.activeTokensSaved).toBeGreaterThan(0);
    expect(result.efficiencyGainPct).toBeGreaterThan(0);
    expect(result.totals.filesChanged).toBe(1);
    expect(result.guarantee.noLossOfFunction).toBe(true);
    expect(result.score.tokenEfficiencyFindingsAfter)
      .toBeLessThan(result.score.tokenEfficiencyFindingsBefore);

    const after = await readFile(join(repo, INSTRUCTIONS), 'utf-8');
    // filler gone
    expect(after).not.toMatch(/helpful assistant/i);
    // exact duplicate collapsed to one
    expect(after.split('reach for `let`').length - 1).toBe(1);
    // meaningful instructions preserved
    expect(after).toMatch(/Zod schemas/);
    expect(after).toMatch(/explain every code change/); // forced verbosity NOT removed
    // signature preservation holds against the original
    expect(meaningfulSignature(MESSY)).toBe(meaningfulSignature(after));
  });

  it('keeps non-lossless work as remaining recommendations (TE004 stays)', async () => {
    const result = await optimize({ repoPath: repo });
    const te004 = result.remainingRecommendations.find(r => r.ruleIds.includes('TE004'));
    expect(te004).toBeDefined();
    expect(te004?.reason).toBeTruthy();
  });

  it('dry-run does not write but still reports the gain', async () => {
    const result = await optimize({ repoPath: repo, dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.totals.activeTokensSaved).toBeGreaterThan(0);
    expect(result.notes.some(n => /Dry run/i.test(n))).toBe(true);
    const onDisk = await readFile(join(repo, INSTRUCTIONS), 'utf-8');
    expect(onDisk).toBe(MESSY); // untouched
  });

  it('writes a .orig backup when requested', async () => {
    await optimize({ repoPath: repo, backup: true });
    const backup = await readFile(join(repo, `${INSTRUCTIONS}.orig`), 'utf-8');
    expect(backup).toBe(MESSY);
    // second run must not clobber the backup
    await optimize({ repoPath: repo, backup: true });
    await expect(access(join(repo, `${INSTRUCTIONS}.orig`))).resolves.toBeUndefined();
  });

  it('respects --only to limit the optimizer set', async () => {
    const result = await optimize({ repoPath: repo, only: ['whitespace'], dryRun: true });
    // Only whitespace is in play; dedupe/filler are excluded entirely.
    expect(result.optimizers.map(o => o.id)).toEqual(['whitespace']);
  });

  it('--skip remove-filler leaves filler in place (strict mechanical mode)', async () => {
    const result = await optimize({ repoPath: repo, skip: ['remove-filler'], dryRun: true });
    expect(result.optimizers.map(o => o.id)).not.toContain('remove-filler');
    // The duplicate line still gets removed (dedupe is mechanical), saving tokens.
    expect(result.totals.activeTokensSaved).toBeGreaterThan(0);
  });

  it('reuses a provided report when tokenizers match', async () => {
    const report = await analyze({ repoPath: repo });
    const result = await optimize({ repoPath: repo, report });
    expect(result.notes.some(n => /Reused the provided CATES report/.test(n))).toBe(true);
    expect(result.efficiencyGainPct).toBeGreaterThan(0);
  });

  it('re-analyzes when the provided report tokenizer differs', async () => {
    const report = await analyze({ repoPath: repo, tokenizer: 'approx' });
    const result = await optimize({ repoPath: repo, report, tokenizer: 'openai-cl100k' });
    expect(result.tokenizer).toBe('openai-cl100k');
    expect(result.notes.some(n => /tokenizer-consistent baseline/.test(n))).toBe(true);
  });

  it('never modifies structured config files (e.g. MCP JSON with duplicate lines)', async () => {
    const mixed = await mkdtemp(join(tmpdir(), 'cates-struct-'));
    try {
      await mkdir(join(mixed, '.github'), { recursive: true });
      await writeFile(join(mixed, INSTRUCTIONS), MESSY, 'utf-8');
      // Two servers share a byte-identical, >20-char description line that the
      // line-deduper WOULD remove if it (wrongly) ran on JSON — breaking config.
      const mcp = [
        '{',
        '  "servers": {',
        '    "alpha": {',
        '      "command": "node",',
        '      "description": "Query the project PostgreSQL database for schema info",',
        '',
        '',
        '      "args": ["a.js"]',
        '    },',
        '    "beta": {',
        '      "command": "node",',
        '      "description": "Query the project PostgreSQL database for schema info",',
        '      "args": ["b.js"]',
        '    }',
        '  }',
        '}',
        '',
      ].join('\n');
      await writeFile(join(mixed, '.mcp.json'), mcp, 'utf-8');

      const result = await optimize({ repoPath: mixed });

      // JSON is byte-for-byte untouched (both description lines survive).
      const afterJson = await readFile(join(mixed, '.mcp.json'), 'utf-8');
      expect(afterJson).toBe(mcp);
      expect(afterJson.split('Query the project PostgreSQL').length - 1).toBe(2);
      // The prose file was still optimized.
      expect(result.totals.filesChanged).toBe(1);
      expect(result.files.every(f => f.relativePath.endsWith('.md'))).toBe(true);
      expect(result.notes.some(n => /structured config/.test(n))).toBe(true);
    } finally {
      await rm(mixed, { recursive: true, force: true });
    }
  });

  it('returns an empty result when there are no config files', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'cates-empty-'));
    try {
      await writeFile(join(empty, 'notes.txt'), 'not a config file', 'utf-8');
      const result = await optimize({ repoPath: empty });
      expect(result.efficiencyGainPct).toBe(0);
      expect(result.files).toEqual([]);
      expect(result.notes.some(n => /No active coding-agent configuration/.test(n))).toBe(true);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});

describe('renderOptimizationReport', () => {
  let repo: string;
  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'cates-rep-'));
    await mkdir(join(repo, '.github'), { recursive: true });
    await writeFile(join(repo, INSTRUCTIONS), MESSY, 'utf-8');
  });
  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it('renders markdown with headline, guarantee and remaining sections', async () => {
    const result = await optimize({ repoPath: repo, dryRun: true, backup: false });
    const md = renderOptimizationReport(result, 'markdown');
    expect(md).toMatch(/# CATES Optimization Report/);
    expect(md).toMatch(/more token-efficient.*guaranteed no loss of function/);
    expect(md).toMatch(/No loss of function/);
    expect(md).toMatch(/Optimizations applied/);
    expect(md).toMatch(/Remaining opportunities/);
    expect(md.endsWith('\n')).toBe(true);
  });

  it('renders valid json', async () => {
    const result = await optimize({ repoPath: repo, dryRun: true });
    const json = renderOptimizationReport(result, 'json');
    const parsed = JSON.parse(json);
    expect(parsed.efficiencyGainPct).toBeGreaterThan(0);
    expect(parsed.guarantee.noLossOfFunction).toBe(true);
    expect(Array.isArray(parsed.files)).toBe(true);
  });

  it('reports "already optimal" when nothing can be saved', async () => {
    const clean = await mkdtemp(join(tmpdir(), 'cates-clean-'));
    try {
      await mkdir(join(clean, '.github'), { recursive: true });
      await writeFile(join(clean, INSTRUCTIONS), '# Title\n\nUse Vitest for tests.\n', 'utf-8');
      const result = await optimize({ repoPath: clean, dryRun: true });
      const md = renderOptimizationReport(result, 'markdown');
      expect(md).toMatch(/already optimal/);
    } finally {
      await rm(clean, { recursive: true, force: true });
    }
  });
});
