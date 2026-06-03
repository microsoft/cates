// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { spawn } from 'node:child_process';

export type ReviewSourceKind = 'local' | 'github';

export interface ReviewSourceOptions {
  keepWorktree?: boolean;
  preferGh?: boolean;
  /**
   * If supplied, the underlying clone/checkout child processes are killed
   * when the signal aborts. Lets HTTP callers enforce per-request deadlines.
   */
  signal?: AbortSignal;
}

export interface ResolvedReviewSource {
  kind: ReviewSourceKind;
  input: string;
  repoPath: string;
  analyzePath: string;
  displayName: string;
  cleanup?: () => Promise<void>;
}

interface GitHubLink {
  owner: string;
  repo: string;
  ref?: string;
  subpath?: string;
  pullNumber?: number;
  fileMode?: boolean;
}

export async function resolveReviewSource(input: string, options: ReviewSourceOptions = {}): Promise<ResolvedReviewSource> {
  const github = parseGitHubLink(input);
  if (github) return materializeGitHubSource(input, github, options);

  const localPath = resolve(input);
  const localStat = await stat(localPath);
  if (!localStat.isDirectory()) {
    throw new Error(`Local source must be a directory: ${input}`);
  }

  return {
    kind: 'local',
    input,
    repoPath: localPath,
    analyzePath: localPath,
    displayName: localPath,
  };
}

export function parseGitHubLink(input: string): GitHubLink | undefined {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return undefined;
  }

  if (url.hostname.toLowerCase() !== 'github.com') return undefined;

  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const [owner, repoPart, mode, ...rest] = parts;
  if (!owner || !repoPart) return undefined;

  const repo = repoPart.endsWith('.git') ? repoPart.slice(0, -4) : repoPart;
  if (!repo) return undefined;

  // Defense against argument injection into git/gh argv (CWE-88).
  // GitHub itself forbids these characters in owner/repo names, so anything
  // that fails here is either malformed or hostile.
  assertSafeGitHubIdentifier(owner, 'owner', input);
  assertSafeGitHubIdentifier(repo, 'repository name', input);

  if (mode === 'pull') {
    const pullNumber = Number(rest[0]);
    if (!Number.isInteger(pullNumber) || pullNumber <= 0) {
      throw new Error(`Invalid GitHub pull request URL: ${input}`);
    }
    return { owner, repo, pullNumber };
  }

  if (mode === 'tree' || mode === 'blob') {
    const ref = rest[0];
    if (!ref) throw new Error(`GitHub ${mode} URL is missing a branch, tag, or commit ref: ${input}`);
    assertSafeGitRef(ref, input);
    const subpath = rest.slice(1).join('/');
    if (subpath) assertSafeSubpath(subpath, input);
    return {
      owner,
      repo,
      ref,
      subpath,
      fileMode: mode === 'blob',
    };
  }

  return { owner, repo };
}

function assertSafeGitHubIdentifier(value: string, label: string, input: string): void {
  // GitHub usernames and repo names are alphanumerics, hyphen, underscore, dot.
  // Reject anything that could be parsed as a CLI flag or shell metacharacter.
  if (!/^[A-Za-z0-9._-]+$/.test(value) || value.startsWith('-') || value.includes('..')) {
    throw new Error(`Refusing unsafe GitHub ${label} in URL: ${input}`);
  }
}

function assertSafeGitRef(ref: string, input: string): void {
  // Git refs cannot legally start with '-', and we additionally block ASCII
  // characters that have meaning to shells, gh, or argument parsers even
  // though spawn() is called with shell: false. This blocks --upload-pack
  // and similar argument-injection vectors (cf. CVE-2017-1000117).
  if (
    ref.startsWith('-') ||
    ref.includes('..') ||
    ref.includes(' ') ||
    /[\\\0\n\r\t<>|;&$`"']/.test(ref) ||
    !/^[A-Za-z0-9._/-]+$/.test(ref)
  ) {
    throw new Error(`Refusing unsafe git ref in URL: ${input}`);
  }
}

function assertSafeSubpath(subpath: string, input: string): void {
  // Subpaths are later joined onto the cloned repo and re-checked by
  // assertInside(), but reject obviously hostile shapes early.
  if (
    subpath.startsWith('-') ||
    subpath.startsWith('/') ||
    subpath.includes('..') ||
    /[\0\n\r]/.test(subpath)
  ) {
    throw new Error(`Refusing unsafe subpath in URL: ${input}`);
  }
}

async function materializeGitHubSource(
  input: string,
  link: GitHubLink,
  options: ReviewSourceOptions,
): Promise<ResolvedReviewSource> {
  const tempRoot = await mkdtemp(join(tmpdir(), 'cates-review-'));
  const repoPath = join(tempRoot, `${link.owner}-${link.repo}`);
  const remote = `https://github.com/${link.owner}/${link.repo}.git`;

  try {
    if (options.preferGh !== false && await commandExists('gh', options.signal)) {
      await run('gh', ['repo', 'clone', remote, repoPath, '--', '--depth', '1'], undefined, options.signal);
    } else {
      await run('git', ['clone', '--depth', '1', remote, repoPath], undefined, options.signal);
    }

    if (link.pullNumber !== undefined) {
      if (await commandExists('gh', options.signal)) {
        await run('gh', ['pr', 'checkout', String(link.pullNumber), '--repo', `${link.owner}/${link.repo}`], repoPath, options.signal);
      } else {
        await run('git', ['fetch', 'origin', `pull/${link.pullNumber}/head:cates-pr-${link.pullNumber}`], repoPath, options.signal);
        await run('git', ['checkout', `cates-pr-${link.pullNumber}`], repoPath, options.signal);
      }
    } else if (link.ref) {
      await run('git', ['fetch', '--depth', '1', 'origin', link.ref], repoPath, options.signal);
      await run('git', ['checkout', 'FETCH_HEAD'], repoPath, options.signal);
    }

    const targetSubpath = link.fileMode && link.subpath ? dirname(link.subpath) : link.subpath;
    const analyzePath = targetSubpath && targetSubpath !== '.'
      ? resolve(repoPath, targetSubpath)
      : repoPath;

    await assertInside(repoPath, analyzePath);
    const analyzeStat = await stat(analyzePath);
    if (!analyzeStat.isDirectory()) {
      throw new Error(`GitHub source resolved to a non-directory target: ${targetSubpath ?? basename(analyzePath)}`);
    }

    return {
      kind: 'github',
      input,
      repoPath,
      analyzePath,
      displayName: formatGitHubDisplay(link),
      cleanup: options.keepWorktree ? undefined : async () => {
        await rm(tempRoot, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (!options.keepWorktree) await rm(tempRoot, { recursive: true, force: true });
    throw error;
  }
}

function formatGitHubDisplay(link: GitHubLink): string {
  const base = `${link.owner}/${link.repo}`;
  if (link.pullNumber !== undefined) return `${base}#${link.pullNumber}`;
  if (link.ref && link.subpath) return `${base}@${link.ref}:${link.fileMode ? dirname(link.subpath) : link.subpath}`;
  if (link.ref) return `${base}@${link.ref}`;
  return base;
}

async function assertInside(root: string, candidate: string): Promise<void> {
  const realRoot = resolve(root);
  const realCandidate = resolve(candidate);
  const rel = relative(realRoot, realCandidate);
  if (rel !== '' && (rel.startsWith('..') || isAbsolute(rel))) {
    throw new Error('Resolved GitHub path escapes the cloned repository boundary');
  }
}

async function commandExists(command: string, signal?: AbortSignal): Promise<boolean> {
  try {
    await run(command, ['--version'], undefined, signal);
    return true;
  } catch {
    return false;
  }
}

function run(command: string, args: string[], cwd?: string, signal?: AbortSignal): Promise<void> {
  return new Promise((resolveRun, reject) => {
    if (signal?.aborted) {
      reject(new Error(`${command} aborted before start`));
      return;
    }
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'ignore', 'pipe'],
      shell: false,
    });

    const onAbort = () => {
      child.kill('SIGTERM');
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    let stderr = '';
    child.stderr.on('data', chunk => {
      stderr += String(chunk);
    });
    child.on('error', err => {
      signal?.removeEventListener('abort', onAbort);
      reject(err);
    });
    child.on('close', code => {
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) {
        reject(new Error(`${command} aborted: deadline exceeded`));
        return;
      }
      if (code === 0) {
        resolveRun();
      } else {
        reject(new Error(`${command} ${args.join(' ')} failed${stderr ? `: ${stderr.trim()}` : ''}`));
      }
    });
  });
}
