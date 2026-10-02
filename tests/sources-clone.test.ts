// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { Readable } from 'node:stream';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Coverage for the materialize / spawn path in src/sources.ts.
 *
 * We mock node:child_process so we can simulate successful clones (the
 * common case) and failures (the path that triggers temp-dir cleanup),
 * without requiring a real git binary on the test host.
 */

interface FakeChild extends EventEmitter {
  stderr: Readable;
}

function makeChild(exitCode: number, stderr = ''): FakeChild {
  const child = new EventEmitter() as FakeChild;
  const stderrEmitter = new EventEmitter() as unknown as Readable;
  child.stderr = stderrEmitter;
  setImmediate(() => {
    if (stderr) (stderrEmitter as unknown as EventEmitter).emit('data', stderr);
    child.emit('close', exitCode);
  });
  return child;
}

const spawnMock = vi.fn();

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

beforeEach(() => {
  spawnMock.mockReset();
});

describe('sources.ts materialize path (mocked spawn)', () => {
  it('clones a plain repo URL and returns the analyzePath', async () => {
    const { resolveReviewSource } = await import('../src/sources.js');

    // gh availability probe + clone + cleanup all succeed.
    spawnMock.mockImplementation(() => makeChild(0));
    // We also need to create the cloned directory so stat() succeeds.
    spawnMock.mockImplementation((cmd: string, args: string[]) => {
      if (args.includes('clone')) {
        const targetDir = args[args.length - 1];
        // Synchronously create the dir before the child closes.
        require('node:fs').mkdirSync(targetDir as string, { recursive: true });
      }
      return makeChild(0);
    });

    const resolved = await resolveReviewSource(
      'https://github.com/example/repo',
      { preferGh: false },
    );
    try {
      expect(resolved.kind).toBe('github');
      expect(resolved.displayName).toBe('example/repo');
      expect(resolved.analyzePath).toMatch(/example-repo$/);
    } finally {
      await resolved.cleanup?.();
    }
  });

  it('cleans up the temp directory when clone fails', async () => {
    const { resolveReviewSource } = await import('../src/sources.js');
    spawnMock.mockImplementation(() => makeChild(128, 'fatal: ouch'));
    await expect(
      resolveReviewSource('https://github.com/example/will-fail', { preferGh: false }),
    ).rejects.toThrow(/git clone .* failed/);
  });

  it.each([
    ['blob/main/.github/skills/review/SKILL.md', ['.github/skills/review/SKILL.md']],
    ['tree/main/.github/skills', ['.github/skills/other/SKILL.md', '.github/skills/review/SKILL.md']],
  ])('preserves exact API scope for %s', async (suffix, expectedPaths) => {
    const { handleScan } = await import('../service/api/handlers.js');
    spawnMock.mockImplementation((_command: string, args: string[]) => {
      if (args.includes('clone')) {
        const root = args.at(-1)!;
        for (const name of ['review', 'other']) {
          const directory = join(root, '.github', 'skills', name);
          mkdirSync(directory, { recursive: true });
          writeFileSync(join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: Review changes\ntools: []\n---\nCheck the changes.\n`);
        }
      }
      return makeChild(0);
    });
    const response = await handleScan({ url: `https://github.com/example/repo/${suffix}`, policy: { copilot: 'cli' } });
    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.body.copilot?.files.map(file => file.path).sort()).toEqual(expectedPaths);
      expect(JSON.stringify(response.body)).not.toContain('cates-review-');
      expect(response.body.copilot?.scope).toBe(suffix.startsWith('blob') ? 'selected-files' : 'selected-directory');
    }
  });
});
