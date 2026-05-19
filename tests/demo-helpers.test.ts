import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDemoRepositories } from '../src/demo.js';

describe('demo helpers via getDemoRepositories', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cates-demo-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns the default 100-repository manifest when no reposFile is given', async () => {
    const repos = await getDemoRepositories();
    expect(repos.length).toBeGreaterThan(50);
  });

  it('filters by category when specified', async () => {
    const repos = await getDemoRepositories({ categories: ['microsoft'] });
    expect(repos.every(r => r.category === 'microsoft')).toBe(true);
    expect(repos.length).toBeGreaterThan(0);
  });

  it('parses a reposFile with category-prefixed lines, plain URLs, comments, and blanks', async () => {
    const file = join(dir, 'repos.txt');
    await writeFile(
      file,
      [
        '# This is a comment',
        '',
        'microsoft https://github.com/microsoft/vscode',
        'https://github.com/openai/openai-python',
        '   ',
        'github https://github.com/github/docs',
      ].join('\n'),
    );
    const repos = await getDemoRepositories({ reposFile: file });
    expect(repos).toHaveLength(3);
    expect(repos[0]).toMatchObject({ category: 'microsoft', owner: 'microsoft', repo: 'vscode' });
    expect(repos[1]).toMatchObject({ category: 'custom', owner: 'openai', repo: 'openai-python' });
    expect(repos[2]).toMatchObject({ category: 'github', owner: 'github', repo: 'docs' });
  });

  it('throws a line-numbered error when a URL is unparseable', async () => {
    const file = join(dir, 'broken.txt');
    await writeFile(file, '# comment\nnot-a-url\n');
    await expect(getDemoRepositories({ reposFile: file })).rejects.toThrow(/line 2/);
  });

  it('strips .git suffix when parsing repo names', async () => {
    const file = join(dir, 'gitsuffix.txt');
    await writeFile(file, 'https://github.com/example/repo.git\n');
    const repos = await getDemoRepositories({ reposFile: file });
    expect(repos[0]?.repo).toBe('repo');
  });
});
