// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
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

  it('has no embedded default repository manifest', async () => {
    const repos = await getDemoRepositories();
    expect(repos).toEqual([]);
  });

  it('filters by category when specified', async () => {
    const file = join(dir, 'repos.txt');
    await writeFile(
      file,
      [
        'sample https://github.com/example/repo-one',
        'other https://github.com/example/repo-two',
      ].join('\n'),
    );
    const repos = await getDemoRepositories({ reposFile: file, categories: ['sample'] });
    expect(repos).toEqual([
      {
        category: 'sample',
        owner: 'example',
        repo: 'repo-one',
        url: 'https://github.com/example/repo-one',
      },
    ]);
  });

  it('parses a reposFile with category-prefixed lines, plain URLs, comments, and blanks', async () => {
    const file = join(dir, 'repos.txt');
    await writeFile(
      file,
      [
        '# This is a comment',
        '',
        'sample https://github.com/example/repo-one',
        'https://github.com/example/repo-two',
        '   ',
        'other https://github.com/example/repo-three',
      ].join('\n'),
    );
    const repos = await getDemoRepositories({ reposFile: file });
    expect(repos).toHaveLength(3);
    expect(repos[0]).toMatchObject({ category: 'sample', owner: 'example', repo: 'repo-one' });
    expect(repos[1]).toMatchObject({ category: 'custom', owner: 'example', repo: 'repo-two' });
    expect(repos[2]).toMatchObject({ category: 'other', owner: 'example', repo: 'repo-three' });
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
