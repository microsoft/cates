// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import { resolve, relative, isAbsolute } from 'node:path';
import { readdir, stat, realpath, open } from 'node:fs/promises';
import type { DiscoveredFile, DiscoveryResult, DiscoveryDiagnostic, ConfigType, ConfigScope, AnalyzerOptions } from '../types.js';
import { countTokens, countTokensAcross, getDefaultTokenizer, type TokenizerId } from '../utils/tokenizer.js';
import { parseFrontmatter } from '../utils/config-parser.js';

export interface DiscoveryOutput {
  result: DiscoveryResult;
  /** Real-path -> UTF-8 content for every active file. Lets analyzers run without re-reading from disk. */
  contents: Map<string, string>;
}

/**
 * Securely discovers coding-agent configuration files in a repository.
 *
 * Security hardening:
 * - Resolves symlinks and rejects escapes outside repo boundary
 * - Enforces max file count, size, and depth limits
 * - Skips binary files
 * - No execution of discovered content
 */

const CONFIG_PATTERNS: Array<{ pattern: RegExp; type: ConfigType; scope: ConfigScope; refineScope?: (content: string) => ConfigScope }> = [
  // Always-loaded: global custom instructions
  { pattern: /^\.github\/copilot-instructions\.md$/i, type: 'root-instructions', scope: 'always-loaded' },
  { pattern: /^\.ai\/instructions\.md$/i, type: 'root-instructions', scope: 'always-loaded' },
  { pattern: /^CLAUDE\.md$/i, type: 'root-instructions', scope: 'always-loaded' },
  { pattern: /^GEMINI\.md$/i, type: 'root-instructions', scope: 'always-loaded' },
  { pattern: /^QWEN\.md$/i, type: 'root-instructions', scope: 'always-loaded' },
  // Always-loaded: AGENTS.md at root
  { pattern: /^AGENTS\.md$/i, type: 'agents-md', scope: 'always-loaded' },
  // Conditional: agent memory/instructions in subdirectories (loaded when working in that dir)
  { pattern: /^.+\/AGENTS\.md$/i, type: 'agents-md', scope: 'conditional' },
  { pattern: /^.+\/CLAUDE\.md$/i, type: 'root-instructions', scope: 'conditional' },
  { pattern: /^.+\/GEMINI\.md$/i, type: 'root-instructions', scope: 'conditional' },
  { pattern: /^.+\/QWEN\.md$/i, type: 'root-instructions', scope: 'conditional' },
  // Path-specific instructions (`applyTo` glob). Conditional by default; promoted
  // to always-loaded when the glob applies to every file (e.g. `applyTo: "**"`).
  { pattern: /^\.github\/instructions\/.+\.instructions\.md$/i, type: 'path-instructions', scope: 'conditional', refineScope: instructionsScope },
  { pattern: /^\.ai\/instructions\/.+\.instructions\.md$/i, type: 'path-instructions', scope: 'conditional', refineScope: instructionsScope },
  // On-demand: Prompt files
  { pattern: /^\.github\/prompts\/.*\.md$/i, type: 'prompt-file', scope: 'on-demand' },
  { pattern: /^\.ai\/prompts\/.*\.md$/i, type: 'prompt-file', scope: 'on-demand' },
  { pattern: /^\.claude\/commands\/.*\.md$/i, type: 'prompt-file', scope: 'on-demand' },
  { pattern: /^\.gemini\/commands\/.*\.md$/i, type: 'prompt-file', scope: 'on-demand' },
  // On-demand: custom chat modes (user selects the mode before it loads)
  { pattern: /^\.github\/chatmodes\/.+\.chatmode\.md$/i, type: 'chat-mode', scope: 'on-demand' },
  { pattern: /^\.ai\/chatmodes\/.+\.chatmode\.md$/i, type: 'chat-mode', scope: 'on-demand' },
  // Conditional: chat config
  { pattern: /^\.github\/copilot-chat\.ya?ml$/i, type: 'chat-config', scope: 'conditional' },
  { pattern: /^\.ai\/chat\.ya?ml$/i, type: 'chat-config', scope: 'conditional' },
  // Conditional: Custom agent definitions
  { pattern: /^agents\/.*\.(ya?ml|md)$/i, type: 'agent-definition', scope: 'conditional' },
  { pattern: /^\.github\/agents\/.*\.(ya?ml|md)$/i, type: 'agent-definition', scope: 'conditional' },
  { pattern: /^\.ai\/agents\/.*\.(ya?ml|md)$/i, type: 'agent-definition', scope: 'conditional' },
  { pattern: /^\.claude\/agents\/.*\.md$/i, type: 'agent-definition', scope: 'conditional' },
  { pattern: /^\.gemini\/agents\/.*\.(ya?ml|md)$/i, type: 'agent-definition', scope: 'conditional' },
  // On-demand: skill definitions
  { pattern: /^\.copilot\/.*\.(ya?ml|md)$/i, type: 'skill-definition', scope: 'on-demand' },
  { pattern: /^\.ai\/skills\/.*\.(ya?ml|md)$/i, type: 'skill-definition', scope: 'on-demand' },
  // Rule files used by agentic editors and CLIs
  { pattern: /^\.cursorrules$/i, type: 'rules-config', scope: 'always-loaded' },
  { pattern: /^\.cursor\/rules\/.*\.mdc$/i, type: 'rules-config', scope: 'conditional' },
  { pattern: /^\.windsurfrules$/i, type: 'rules-config', scope: 'always-loaded' },
  { pattern: /^\.windsurf\/rules\/.*\.(md|mdc)$/i, type: 'rules-config', scope: 'conditional' },
  { pattern: /^\.clinerules$/i, type: 'rules-config', scope: 'always-loaded' },
  { pattern: /^\.cline\/rules\/.*\.md$/i, type: 'rules-config', scope: 'conditional' },
  { pattern: /^\.roo\/rules\/.*\.md$/i, type: 'rules-config', scope: 'conditional' },
  { pattern: /^\.ai\/rules\/.*\.(md|mdc|ya?ml|json)$/i, type: 'rules-config', scope: 'conditional' },
  // Coding agent: setup steps (environment prep for coding agents). Canonical
  // location is a GitHub Actions workflow with a `copilot-setup-steps` job.
  { pattern: /^\.github\/workflows\/copilot-setup-steps\.ya?ml$/i, type: 'setup-steps', scope: 'conditional' },
  { pattern: /^\.ai\/agent-setup\.ya?ml$/i, type: 'setup-steps', scope: 'conditional' },
  // Hooks: pre-commit config that can affect agent workflows
  { pattern: /^\.pre-commit-config\.ya?ml$/i, type: 'hooks-config', scope: 'on-demand' },
  { pattern: /^\.claude\/hooks\/.*\.(ya?ml|json|sh|md)$/i, type: 'hooks-config', scope: 'conditional' },
  { pattern: /^\.ai\/hooks\/.*\.(ya?ml|json|sh|md)$/i, type: 'hooks-config', scope: 'conditional' },
  // MCP: Model Context Protocol server configuration
  { pattern: /^\.github\/copilot\/mcp[_-]?.*\.ya?ml$/i, type: 'mcp-config', scope: 'conditional' },
  { pattern: /^mcp\.json$/i, type: 'mcp-config', scope: 'conditional' },
  { pattern: /^\.mcp\.json$/i, type: 'mcp-config', scope: 'conditional' },
  { pattern: /^\.ai\/mcp\.json$/i, type: 'mcp-config', scope: 'conditional' },
  { pattern: /^\.claude\/mcp\.json$/i, type: 'mcp-config', scope: 'conditional' },
  { pattern: /^\.gemini\/mcp\.json$/i, type: 'mcp-config', scope: 'conditional' },
  { pattern: /^\.vscode\/mcp\.json$/i, type: 'mcp-config', scope: 'conditional' },
  // Vision/guardrails file
  { pattern: /^\.github\/copilot\/vision\.ya?ml$/i, type: 'vision-config', scope: 'always-loaded' },
  { pattern: /^\.ai\/vision\.ya?ml$/i, type: 'vision-config', scope: 'always-loaded' },
  { pattern: /^\.github\/copilot\/agent\.ya?ml$/i, type: 'agent-definition', scope: 'conditional' },
  // Editor settings (AI-assistant-related)
  { pattern: /^\.vscode\/settings\.json$/i, type: 'editor-config', scope: 'conditional' },
  { pattern: /^\.cursor\/settings\.json$/i, type: 'editor-config', scope: 'conditional' },
  { pattern: /^\.claude\/settings(?:\.local)?\.json$/i, type: 'editor-config', scope: 'conditional' },
  { pattern: /^\.gemini\/settings\.json$/i, type: 'editor-config', scope: 'conditional' },
  { pattern: /^\.aider\.conf\.ya?ml$/i, type: 'editor-config', scope: 'conditional' },
  { pattern: /^\.aiderignore$/i, type: 'editor-config', scope: 'conditional' },
  // Extension/plugin manifests
  { pattern: /^\.github\/copilot\/.*\.(ya?ml|json|md)$/i, type: 'extension-config', scope: 'conditional' },
  { pattern: /^\.claude\/.*\.(ya?ml|json|md)$/i, type: 'extension-config', scope: 'conditional' },
  { pattern: /^\.gemini\/.*\.(ya?ml|json|md)$/i, type: 'extension-config', scope: 'conditional' },
  { pattern: /^\.aider\..*$/i, type: 'extension-config', scope: 'conditional' },
];

export type FileClassification = { type: ConfigType; scope: ConfigScope; refineScope?: (content: string) => ConfigScope };

export async function discoverFiles(
  options: AnalyzerOptions,
  classify: (path: string) => FileClassification | undefined = path => CONFIG_PATTERNS.find(p => p.pattern.test(path)),
  cached?: DiscoveryOutput,
): Promise<DiscoveryOutput> {
  const repoRoot = await realpath(resolve(options.repoPath));
  const files: DiscoveredFile[] = [];
  const contents = new Map<string, string>();
  const cachedFiles = new Map(cached?.result.files.map(file => [file.path, file]));
  const activeContents: string[] = []; // retained only when comparison is requested
  const tokenizer: TokenizerId = options.tokenizer ?? getDefaultTokenizer();
  const compareSet: TokenizerId[] | undefined = options.compareTokenizers && options.compareTokenizers.length > 0
    ? Array.from(new Set<TokenizerId>([tokenizer, ...options.compareTokenizers]))
    : undefined;
  let filesScanned = 0;
  const diagnostics: DiscoveryDiagnostic[] = [];
  const diagnose = (path: string, reason: DiscoveryDiagnostic['reason'], message: string): void => {
    diagnostics.push({ path: relative(repoRoot, path).split('\\').join('/') || '.', reason, message });
  };

  async function addFile(fullPath: string, relativePath: string, match: FileClassification): Promise<void> {
    filesScanned++;
    const realFullPath = await realpath(fullPath);
    if (!isInside(repoRoot, realFullPath)) {
      throw new Error(`Discovered file escapes repository boundary: ${relativePath}`);
    }
    const cachedFile = cachedFiles.get(realFullPath);
    const cachedContent = cached?.contents.get(realFullPath);
    if (cachedFile && cachedContent !== undefined && cachedFile.sizeBytes <= options.maxFileSize) {
      const scope = match.refineScope ? match.refineScope(cachedContent) : match.scope;
      const tokenCount = !cachedFile.isActive || cached?.result.tokenizer === tokenizer ? cachedFile.tokenCount : countTokens(cachedContent, tokenizer);
      files.push({ ...cachedFile, relativePath, type: match.type, scope, tokenCount });
      contents.set(realFullPath, cachedContent);
      if (compareSet && cachedFile.isActive) activeContents.push(cachedContent);
      if (!cachedFile.isActive) diagnose(realFullPath, 'tokenization-limit', 'BPE token count omitted for a pathological unbroken text span; source remains available to structural checks.');
      return;
    }

    // Open once and reuse the same file descriptor for stat + read so the file
    // cannot be swapped between the size check and the contents read (TOCTOU,
    // CWE-367). Mitigates `js/file-system-race`.
    const fh = await open(realFullPath, 'r');
    try {
      const fileStat = await fh.stat();
      if (!fileStat.isFile()) throw new Error(`Discovered path is not a regular file: ${relativePath}`);

      // Security: enforce size limit
      if (fileStat.size > options.maxFileSize) {
        diagnose(realFullPath, 'oversized', `Not analyzed: file exceeds ${options.maxFileSize} bytes.`);
        files.push({
          path: realFullPath,
          relativePath,
          type: match.type,
          scope: match.scope,
          sizeBytes: fileStat.size,
          tokenCount: 0,
          isActive: false,
        });
        return;
      }

      // Read as Buffer so the binary heuristic operates on raw bytes and
      // we can skip the UTF-8 decode entirely for binary files.
      const bounded = Buffer.alloc(options.maxFileSize + 1);
      let bytesRead = 0;
      while (bytesRead < bounded.length) {
        const chunk = await fh.read(bounded, bytesRead, bounded.length - bytesRead, bytesRead);
        if (chunk.bytesRead === 0) break;
        bytesRead += chunk.bytesRead;
      }
      if (bytesRead > options.maxFileSize) {
        diagnose(realFullPath, 'oversized', 'Not analyzed: file grew beyond the byte limit while being read.');
        return;
      }
      const buffer = bounded.subarray(0, bytesRead);
      if (isBinary(buffer)) {
        diagnose(realFullPath, 'binary', 'Not analyzed: candidate configuration contains binary data.');
        return;
      }
      const content = buffer.toString('utf-8');

      const usesBpe = tokenizer !== 'approx' || compareSet?.some(id => id !== 'approx');
      if (usesBpe && hasPathologicalSpan(content)) {
        diagnose(realFullPath, 'tokenization-limit', 'BPE analysis omitted: a text span exceeds 4,096 non-whitespace characters. Split embedded data or explicitly use the approx tokenizer without BPE comparisons.');
        files.push({ path: realFullPath, relativePath, type: match.type, scope: match.scope, sizeBytes: bytesRead, tokenCount: 0, isActive: false });
        contents.set(realFullPath, content);
        return;
      }
      const tokenCount = countTokens(content, tokenizer);

      // Some file types determine their loading scope from their contents
      // (e.g. `.instructions.md` files whose `applyTo` glob targets every file
      // are effectively always-loaded).
      const scope = match.refineScope ? match.refineScope(content) : match.scope;
      if (match.refineScope && scope === 'unknown') diagnose(realFullPath, 'scope-error', 'Instruction applicability could not be parsed; its loading scope is unknown.');

      files.push({
        path: realFullPath,
        relativePath,
        type: match.type,
        scope,
        sizeBytes: fileStat.size,
        tokenCount,
        isActive: true,
      });
      contents.set(realFullPath, content);
      if (compareSet) activeContents.push(content);
    } finally {
      await fh.close();
    }
  }

  async function discoverIncludedFiles(includeFiles: string[]): Promise<void> {
    if (includeFiles.length > options.maxFiles) {
      throw new Error(`--files listed ${includeFiles.length} files, exceeding --max-files ${options.maxFiles}`);
    }

    for (const includeFile of includeFiles) {
      const fullPath = resolve(repoRoot, includeFile);
      const realFilePath = await realpath(fullPath);
      if (!isInside(repoRoot, realFilePath)) {
        throw new Error(`Included file escapes repository boundary: ${includeFile}`);
      }

      const fileStat = await stat(realFilePath);
      if (!fileStat.isFile()) {
        throw new Error(`Included path must be a file: ${includeFile}`);
      }

      const relativePath = relative(repoRoot, realFilePath).split('\\').join('/');
      const match = classify(relativePath) ?? {
        type: 'unknown' as const,
        scope: 'conditional' as const,
      };
      await addFile(realFilePath, relativePath, match);
    }
  }

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > options.maxDepth) {
      diagnose(dir, 'max-depth', `Directory not traversed: depth exceeds ${options.maxDepth}.`);
      return;
    }
    if (filesScanned >= options.maxFiles) {
      diagnose(dir, 'max-files', `Discovery stopped at ${options.maxFiles} candidates; additional files may exist.`);
      return;
    }

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || !['EACCES', 'EPERM', 'ENOENT'].includes(String(error.code))) throw error;
      diagnose(dir, 'unreadable', `Directory not traversed (${String(error.code)}).`);
      return;
    }

    for (const entry of entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      if (filesScanned >= options.maxFiles) {
        diagnose(dir, 'max-files', `Discovery stopped at ${options.maxFiles} candidates; remaining entries were not assessed.`);
        break;
      }

      const fullPath = resolve(dir, entry.name);

      // Security: resolve real path and verify it's within repo boundary
      if (entry.isSymbolicLink()) {
        diagnose(fullPath, 'symlink', 'Automatic discovery does not follow symbolic links.');
        continue;
      }

      // Skip common irrelevant directories
      if (entry.isDirectory()) {
        if (['node_modules', '.git', 'dist', 'build', 'vendor', '__pycache__'].includes(entry.name)) {
          continue;
        }
        await walk(fullPath, depth + 1);
        continue;
      }

      if (!entry.isFile()) continue;

      const relativePath = relative(repoRoot, fullPath).split('\\').join('/');
      const match = classify(relativePath);
      if (!match) continue;

      try {
        await addFile(fullPath, relativePath, match);
      } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || !['EACCES', 'EPERM', 'ENOENT'].includes(String(error.code))) throw error;
        diagnose(fullPath, 'unreadable', `Candidate not analyzed (${String(error.code)}).`);
      }
    }
  }

  if (options.includeFiles?.length) {
    await discoverIncludedFiles(options.includeFiles);
  } else {
    const scanRoot = options.scanSubpath ? await realpath(resolve(repoRoot, options.scanSubpath)) : repoRoot;
    if (!isInside(repoRoot, scanRoot)) throw new Error('Selected scan directory escapes repository boundary');
    if (!(await stat(scanRoot)).isDirectory()) throw new Error('Selected scan path must be a directory');
    await walk(scanRoot, 0);
  }

  const activeFiles = files.filter(f => f.isActive);
  const alwaysLoadedTokens = activeFiles
    .filter(f => f.scope === 'always-loaded')
    .reduce((sum, f) => sum + f.tokenCount, 0);
  const conditionalTokens = activeFiles
    .filter(f => f.scope === 'conditional')
    .reduce((sum, f) => sum + f.tokenCount, 0);
  const deadFileTokens = files
    .filter(f => !f.isActive)
    .reduce((sum, f) => sum + f.tokenCount, 0);

  let totalTokensByTokenizer: Record<string, number> | undefined;
  if (compareSet) {
    const totals: Record<string, number> = {};
    for (const id of compareSet) totals[id] = 0;
    for (const content of activeContents) {
      const counts = countTokensAcross(content, compareSet);
      for (const id of compareSet) totals[id]! += counts[id];
    }
    totalTokensByTokenizer = totals;
  }

  return {
    result: {
      files,
      totalTokens: activeFiles.reduce((sum, f) => sum + f.tokenCount, 0),
      alwaysLoadedTokens,
      conditionalTokens,
      deadFileTokens,
      tokenizer,
      ...(totalTokensByTokenizer ? { totalTokensByTokenizer } : {}),
      ...(diagnostics.length ? { diagnostics } : {}),
    },
    contents,
  };
}

function isBinary(buffer: Buffer): boolean {
  // Check for null bytes or high ratio of non-printable bytes in the first 8KB.
  const sampleLen = Math.min(buffer.length, 8192);
  if (sampleLen === 0) return false;
  let nonPrintable = 0;
  for (let i = 0; i < sampleLen; i++) {
    const byte = buffer[i]!;
    if (byte === 0) return true;
    if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) nonPrintable++;
  }
  return nonPrintable / sampleLen > 0.1;
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Determines the loading scope of a `.instructions.md` file from its `applyTo`
 * frontmatter. VS Code / Copilot apply these conditionally based on the glob (or
 * a semantic match when `applyTo` is absent), so they default to `conditional`.
 * A glob that targets every file makes the file effectively always-loaded, which
 * counts against the always-loaded token budget.
 */
function instructionsScope(content: string): ConfigScope {
  let applyTo: unknown;
  try {
    applyTo = parseFrontmatter(content).metadata.applyTo;
  } catch {
    return 'unknown'; // Reported as a scope-error by discovery, never silently treated as globally loaded.
  }
  const globs = typeof applyTo === 'string' ? applyTo.split(',').map(glob => glob.trim()) : Array.isArray(applyTo) ? applyTo : [];
  return globs.some(g => g === '**' || g === '**/*') ? 'always-loaded' : 'conditional';
}

function hasPathologicalSpan(content: string): boolean {
  let length = 0;
  for (const character of content) {
    if (/\s/u.test(character)) length = 0;
    else if (++length > 4096) return true;
  }
  return false;
}
