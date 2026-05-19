import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { analyze } from '../src/analyzers/index.js';
import { analyzeInMemory } from '../src/analyze-in-memory.js';

const FIXTURES = resolve(import.meta.dirname, '../fixtures');

async function loadFiles(repoPath: string, relativePaths: string[]) {
  return Promise.all(
    relativePaths.map(async path => ({
      path,
      content: await readFile(resolve(repoPath, path), 'utf-8'),
    })),
  );
}

describe('analyzeInMemory', () => {
  it('produces the same finding identifiers as the on-disk CLI path (parity)', async () => {
    const repoPath = resolve(FIXTURES, 'bad');
    const onDisk = await analyze({ repoPath });

    // Mirror the same set of files the on-disk discovery surfaced.
    const files = await loadFiles(
      repoPath,
      onDisk.discovery.files.map(f => f.relativePath),
    );
    const inMemory = await analyzeInMemory({ files });

    const ruleIdMultiset = (xs: { ruleId: string }[]) =>
      xs.map(f => f.ruleId).sort();

    expect(ruleIdMultiset(inMemory.findings)).toEqual(ruleIdMultiset(onDisk.findings));
    expect(inMemory.score.overall).toBe(onDisk.score.overall);
    expect(inMemory.score.grade).toBe(onDisk.score.grade);
  });

  it('returns repo-relative paths in findings (no temp dir leak)', async () => {
    const result = await analyzeInMemory({
      files: [
        {
          path: '.github/copilot-instructions.md',
          content: 'api_key = "sk-test1234567890abcdef1234567890abcdef"\n',
        },
      ],
    });
    for (const finding of result.findings) {
      expect(finding.file).not.toContain('cates-mem-');
      expect(finding.file.startsWith('/')).toBe(false);
    }
    const secrets = result.findings.filter(f => f.ruleId === 'SEC001');
    expect(secrets.length).toBeGreaterThan(0);
  });

  it('rejects absolute paths', async () => {
    await expect(
      analyzeInMemory({ files: [{ path: '/etc/passwd', content: 'root:x:0:0' }] }),
    ).rejects.toThrow(/repository-relative/);
  });

  it('rejects path traversal', async () => {
    await expect(
      analyzeInMemory({ files: [{ path: '../escape.md', content: 'evil' }] }),
    ).rejects.toThrow(/\.\./);
  });

  it('rejects empty file list', async () => {
    await expect(analyzeInMemory({ files: [] })).rejects.toThrow(/at least one file/);
  });

  it('rejects control characters in paths', async () => {
    await expect(
      analyzeInMemory({ files: [{ path: 'foo\nbar.md', content: 'x' }] }),
    ).rejects.toThrow(/control characters/);
  });

  it('honors rule/dimension toggles for in-memory input', async () => {
    const baseline = await analyzeInMemory({
      files: [
        {
          path: '.github/copilot-instructions.md',
          content: 'api_key = "sk-test1234567890abcdef1234567890abcdef"\n',
        },
      ],
    });
    expect(baseline.findings.some(f => f.ruleId === 'SEC001')).toBe(true);

    const withSecurityOff = await analyzeInMemory({
      files: [
        {
          path: '.github/copilot-instructions.md',
          content: 'api_key = "sk-test1234567890abcdef1234567890abcdef"\n',
        },
      ],
      dimensions: { security: { enabled: false } },
    });
    expect(withSecurityOff.findings.some(f => f.ruleId === 'SEC001')).toBe(false);
    expect(withSecurityOff.disabledDimensions).toContain('security');
  });
});
