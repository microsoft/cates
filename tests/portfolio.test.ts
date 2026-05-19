import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanPortfolio } from '../src/portfolio.js';

describe('scanPortfolio', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'cates-portfolio-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('returns empty repos and zero totals for an empty root', async () => {
    const result = await scanPortfolio(root);
    expect(result.repos).toEqual([]);
    expect(result.totals.repos).toBe(0);
    expect(result.totals.findings).toBe(0);
    expect(result.totals.projectedTokenSavingsPercentage).toBe(0);
  });

  it('ignores dot-directories and node_modules', async () => {
    await mkdir(join(root, '.git'), { recursive: true });
    await mkdir(join(root, 'node_modules'), { recursive: true });
    const result = await scanPortfolio(root);
    expect(result.repos).toEqual([]);
  });

  it('skips child dirs that have no coding-agent configuration', async () => {
    await mkdir(join(root, 'empty-repo'), { recursive: true });
    const result = await scanPortfolio(root);
    expect(result.repos).toEqual([]);
  });

  it('analyzes each child directory and aggregates totals', async () => {
    const a = join(root, 'repo-a');
    const b = join(root, 'repo-b');
    await mkdir(a, { recursive: true });
    await mkdir(b, { recursive: true });
    await writeFile(
      join(a, '.github/copilot-instructions.md').replace(/\\/g, '/'),
      'be helpful\n',
    ).catch(async () => {
      await mkdir(join(a, '.github'), { recursive: true });
      await writeFile(join(a, '.github', 'copilot-instructions.md'), 'be helpful\n');
    });
    await mkdir(join(b, '.github'), { recursive: true });
    await writeFile(
      join(b, '.github', 'copilot-instructions.md'),
      'api_key = "sk-test1234567890abcdef1234567890abcdef"\n',
    );

    const result = await scanPortfolio(root);
    expect(result.repos.length).toBeGreaterThanOrEqual(1);
    expect(result.totals.repos).toBe(result.repos.length);
    expect(typeof result.totals.projectedTokenSavingsPercentage).toBe('number');
  });
});
