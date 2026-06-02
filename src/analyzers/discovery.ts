import { resolve, relative, isAbsolute } from 'node:path';
import { readdir, stat, realpath, open } from 'node:fs/promises';
import type { DiscoveredFile, DiscoveryResult, ConfigType, ConfigScope, AnalyzerOptions } from '../types.js';
import { countTokens, countTokensAcross, getDefaultTokenizer, type TokenizerId } from '../utils/tokenizer.js';

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

const CONFIG_PATTERNS: Array<{ pattern: RegExp; type: ConfigType; scope: ConfigScope }> = [
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
  // On-demand: Prompt files
  { pattern: /^\.github\/prompts\/.*\.md$/i, type: 'prompt-file', scope: 'on-demand' },
  { pattern: /^\.ai\/prompts\/.*\.md$/i, type: 'prompt-file', scope: 'on-demand' },
  { pattern: /^\.claude\/commands\/.*\.md$/i, type: 'prompt-file', scope: 'on-demand' },
  { pattern: /^\.gemini\/commands\/.*\.md$/i, type: 'prompt-file', scope: 'on-demand' },
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
  // Coding agent: setup steps (environment prep for coding agents)
  { pattern: /^\.github\/copilot-setup-steps\.ya?ml$/i, type: 'setup-steps', scope: 'conditional' },
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

type FileClassification = { type: ConfigType; scope: ConfigScope };

export async function discoverFiles(options: AnalyzerOptions): Promise<DiscoveryOutput> {
  const repoRoot = await realpath(resolve(options.repoPath));
  const files: DiscoveredFile[] = [];
  const contents = new Map<string, string>();
  const activeContents: string[] = []; // retained only when comparison is requested
  const tokenizer: TokenizerId = options.tokenizer ?? getDefaultTokenizer();
  const compareSet: TokenizerId[] | undefined = options.compareTokenizers && options.compareTokenizers.length > 0
    ? Array.from(new Set<TokenizerId>([tokenizer, ...options.compareTokenizers]))
    : undefined;
  let filesScanned = 0;

  async function addFile(fullPath: string, relativePath: string, match: FileClassification): Promise<void> {
    filesScanned++;
    const realFullPath = await realpath(fullPath);
    if (!isInside(repoRoot, realFullPath)) {
      throw new Error(`Discovered file escapes repository boundary: ${relativePath}`);
    }

    // Open once and reuse the same file descriptor for stat + read so the file
    // cannot be swapped between the size check and the contents read (TOCTOU,
    // CWE-367). Mitigates `js/file-system-race`.
    const fh = await open(realFullPath, 'r');
    try {
      const fileStat = await fh.stat();

      // Security: enforce size limit
      if (fileStat.size > options.maxFileSize) {
        files.push({
          path: realFullPath,
          relativePath,
          type: match.type,
          scope: match.scope,
          sizeBytes: fileStat.size,
          tokenCount: 0,
          isActive: false, // too large = likely not a real config
        });
        return;
      }

      // Read as Buffer so the binary heuristic operates on raw bytes and
      // we can skip the UTF-8 decode entirely for binary files.
      const buffer = await fh.readFile();
      if (isBinary(buffer)) return;
      const content = buffer.toString('utf-8');

      const tokenCount = countTokens(content, tokenizer);

      files.push({
        path: realFullPath,
        relativePath,
        type: match.type,
        scope: match.scope,
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
      const match = CONFIG_PATTERNS.find(p => p.pattern.test(relativePath)) ?? {
        type: 'unknown' as const,
        scope: 'conditional' as const,
      };
      await addFile(realFilePath, relativePath, match);
    }
  }

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > options.maxDepth) return;
    if (filesScanned >= options.maxFiles) return;

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // permission denied, etc.
    }

    for (const entry of entries) {
      if (filesScanned >= options.maxFiles) break;

      const fullPath = resolve(dir, entry.name);

      // Security: resolve real path and verify it's within repo boundary
      if (entry.isSymbolicLink()) {
        try {
          const real = await realpath(fullPath);
          if (!isInside(repoRoot, real)) continue; // symlink escape attempt
        } catch {
          continue; // broken symlink
        }
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
      const match = CONFIG_PATTERNS.find(p => p.pattern.test(relativePath));
      if (!match) continue;

      await addFile(fullPath, relativePath, match);
    }
  }

  if (options.includeFiles?.length) {
    await discoverIncludedFiles(options.includeFiles);
  } else {
    await walk(repoRoot, 0);
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
