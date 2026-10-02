// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { analyze } from './analyzers/index.js';
import type { AnalysisResult, AnalyzerOptions, Finding } from './types.js';
import { copilotSurface } from './copilot/discovery.js';

/**
 * In-memory entry point that mirrors {@link analyze} for callers who already
 * have file contents in hand (HTTP services, language servers, tests).
 *
 * Implementation note: rather than forking the analyzer pipeline, we
 * materialize the supplied files to a hardened temp directory and call the
 * same `analyze()` function the CLI uses. This guarantees zero scoring
 * divergence between the CLI and any service consumer — every CATES rule
 * runs exactly the same code on exactly the same bytes.
 *
 * @example
 *   const result = await analyzeInMemory({
 *     files: [
 *       { path: '.github/copilot-instructions.md', content: '...' },
 *       { path: '.mcp.json', content: '{ "servers": {...} }' },
 *     ],
 *   });
 *   console.log(result.score.overall);
 */
export interface AnalyzeInMemoryFile {
  /**
   * Repo-relative file path (e.g. `.github/copilot-instructions.md`).
   * Used both for finding messages and for CATES classification — the
   * pattern matchers in `discovery.ts` key off the path.
   */
  path: string;
  /** Raw file content, UTF-8. */
  content: string;
}

export interface AnalyzeInMemoryOptions
  extends Omit<Partial<AnalyzerOptions>, 'repoPath' | 'includeFiles'> {
  files: AnalyzeInMemoryFile[];
}

export async function analyzeInMemory(options: AnalyzeInMemoryOptions): Promise<AnalysisResult> {
  if (!options.files || options.files.length === 0) {
    throw new Error('analyzeInMemory requires at least one file');
  }

  const tempRoot = await realpath(await mkdtemp(join(tmpdir(), 'cates-mem-')));
  try {
    const suppliedPaths = new Set<string>();
    for (const file of options.files) {
      assertSafeRelativePath(file.path);
      const normalizedPath = file.path.split('\\').join('/');
      if (suppliedPaths.has(normalizedPath)) throw new Error(`Duplicate file path: ${file.path}`);
      suppliedPaths.add(normalizedPath);
      const target = join(tempRoot, normalizedPath);
      // Re-check after join to guard against any platform-specific oddities.
      if (!isInside(tempRoot, target)) {
        throw new Error(`Refusing unsafe path: ${file.path}`);
      }
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.content, 'utf-8');
    }

    const { files: _ignored, ...rest } = options;
    const result = await analyze({ ...rest, repoPath: tempRoot });
    if (result.copilot) {
      result.copilot.scope = 'supplied-files';
      const inventoried = new Set(result.copilot.files.map(file => file.path));
      for (const path of suppliedPaths) {
        if (inventoried.has(path)) continue;
        result.copilot.files.push({ path, surface: copilotSurface(path) ?? 'unrecognized', status: 'not-analyzed', tokens: null });
        result.copilot.completeness = 'partial';
      }
      for (const row of result.copilot.coverage) {
        row.files = result.copilot.files.filter(file => file.surface === row.surface).length;
        row.status = row.files ? 'present' : 'not-detected';
      }
    }

    // Strip the temp prefix from absolute paths so callers see the paths
    // they supplied. Relative paths in findings already use `relativePath`
    // and stay untouched.
    return rewritePaths(result, tempRoot);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function rewritePaths(result: AnalysisResult, tempRoot: string): AnalysisResult {
  const strip = (value: string): string =>
    value.startsWith(tempRoot) ? value.slice(tempRoot.length + 1) || '.' : value;

  const rewriteFinding = (finding: Finding): Finding => ({
    ...finding,
    file: strip(finding.file),
  });

  return {
    ...result,
    repoPath: '(in-memory)',
    discovery: {
      ...result.discovery,
      files: result.discovery.files.map(f => ({ ...f, path: strip(f.path) })),
    },
    findings: result.findings.map(rewriteFinding),
    suppressedFindings: result.suppressedFindings.map(rewriteFinding),
    disabledFindings: result.disabledFindings?.map(rewriteFinding),
  };
}

function assertSafeRelativePath(path: string): void {
  if (!path || typeof path !== 'string') {
    throw new Error('File path is required');
  }
  if (isAbsolute(path) || path.startsWith('\\') || path.startsWith('/') || /^[A-Za-z]:/.test(path)) {
    throw new Error(`File path must be repository-relative: ${path}`);
  }
  // Reject explicit traversal segments. join() will further normalize, but
  // we want to reject obviously hostile input loudly so the caller knows.
  const segments = path.split(/[\\/]/);
  if (segments.some(s => s === '..' || s === '.' || s === '')) {
    throw new Error(`File path may not contain '.', '..' or empty segments: ${path}`);
  }
  if (/[\0\r\n]/.test(path)) {
    throw new Error(`File path contains control characters: ${path}`);
  }
}

function isInside(root: string, candidate: string): boolean {
  const realRoot = resolve(root);
  const realCandidate = resolve(candidate);
  return realCandidate === realRoot || realCandidate.startsWith(realRoot + '/') || realCandidate.startsWith(realRoot + '\\');
}
