import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { spawn } from 'node:child_process';

export type ReviewSourceKind = 'local' | 'github';

export interface ReviewSourceOptions {
  keepWorktree?: boolean;
  preferGh?: boolean;
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
    return {
      owner,
      repo,
      ref,
      subpath: rest.slice(1).join('/'),
      fileMode: mode === 'blob',
    };
  }

  return { owner, repo };
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
    if (options.preferGh !== false && await commandExists('gh')) {
      await run('gh', ['repo', 'clone', remote, repoPath, '--', '--depth', '1']);
    } else {
      await run('git', ['clone', '--depth', '1', remote, repoPath]);
    }

    if (link.pullNumber !== undefined) {
      if (await commandExists('gh')) {
        await run('gh', ['pr', 'checkout', String(link.pullNumber), '--repo', `${link.owner}/${link.repo}`], repoPath);
      } else {
        await run('git', ['fetch', 'origin', `pull/${link.pullNumber}/head:cates-pr-${link.pullNumber}`], repoPath);
        await run('git', ['checkout', `cates-pr-${link.pullNumber}`], repoPath);
      }
    } else if (link.ref) {
      await run('git', ['fetch', '--depth', '1', 'origin', link.ref], repoPath);
      await run('git', ['checkout', 'FETCH_HEAD'], repoPath);
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

async function commandExists(command: string): Promise<boolean> {
  try {
    await run(command, ['--version']);
    return true;
  } catch {
    return false;
  }
}

function run(command: string, args: string[], cwd?: string): Promise<void> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'ignore', 'pipe'],
      shell: false,
    });

    let stderr = '';
    child.stderr.on('data', chunk => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) {
        resolveRun();
      } else {
        reject(new Error(`${command} ${args.join(' ')} failed${stderr ? `: ${stderr.trim()}` : ''}`));
      }
    });
  });
}
