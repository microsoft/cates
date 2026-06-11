// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import { parse as parseYaml } from 'yaml';
import type { Finding, AnalyzerOptions, AnalyzerFile } from '../types.js';
import { countTokens } from '../utils/tokenizer.js';

/**
 * Prompt Files Analyzer
 *
 * Evaluates prompt-library markdown files for:
 * - Token efficiency (are prompts bloated for their purpose?)
 * - Reusability (do they have clear trigger/usage context?)
 * - Security (no hardcoded secrets or injection vectors)
 * - Quality (well-structured, with clear intent)
 */

export async function analyzePrompts(
  files: AnalyzerFile[],
  _options: AnalyzerOptions,
): Promise<Finding[]> {
  const findings: Finding[] = [];

  const promptFiles = files.filter(f =>
    f.relativePath.includes('prompts/') || f.relativePath.includes('commands/')
  );
  if (promptFiles.length === 0) return findings;

  for (const file of promptFiles) {
    const content = file.content;
    const tokens = countTokens(content);
    const lines = content.split('\n');

    // Check: Prompt without clear purpose/header
    const hasHeader = /^#\s/.test(content) || /^(purpose|description|goal|when to use)/im.test(content);
    if (!hasHeader && tokens > 50) {
      findings.push({
        ruleId: 'PRM001',
        dimension: 'specificity',
        severity: 'low',
        confidence: 'medium',
        message: 'Prompt file lacks a purpose header. Users won\'t know when to invoke it.',
        file: file.relativePath,
        suggestion: 'Add a top-level heading or "Purpose:" line describing when this prompt should be used.',
      });
    }

    // Check: Oversized prompt (>1000 tokens is unusual for a reusable prompt)
    if (tokens > 1000) {
      findings.push({
        ruleId: 'PRM002',
        dimension: 'token-efficiency',
        severity: 'medium',
        confidence: 'medium',
        message: `Prompt file is ${tokens} tokens. Large prompts increase loaded context on every invocation.`,
        file: file.relativePath,
        suggestion: 'Consider splitting into a base prompt + context-specific additions, or reference files with @file instead of inlining.',
        tokenImpact: tokens - 500, // assume 500 is reasonable
      });
    }

    // Check: Prompt with hardcoded file paths that may drift
    const hardcodedPaths = lines.filter(l => /(?:src|lib|app)\/[\w/]+\.\w+/.test(l));
    if (hardcodedPaths.length > 5) {
      findings.push({
        ruleId: 'PRM003',
        dimension: 'specificity',
        severity: 'low',
        confidence: 'medium',
        message: `Prompt references ${hardcodedPaths.length} specific file paths. These may drift as the project evolves.`,
        file: file.relativePath,
        suggestion: 'Use glob patterns or directory references instead of exact paths to reduce maintenance burden.',
      });
    }

    // Check: Prompt without variable/placeholder markers
    const hasVariables = /\{\{.*\}\}|\$\{.*\}|<.*>|\[.*\]/m.test(content);
    if (!hasVariables && tokens > 200) {
      findings.push({
        ruleId: 'PRM004',
        dimension: 'completeness',
        severity: 'low',
        confidence: 'low',
        message: 'Large prompt with no variable placeholders. May be too rigid for reuse across contexts.',
        file: file.relativePath,
        suggestion: 'Consider adding placeholders (e.g., {{component_name}}) to make the prompt adaptable.',
      });
    }
  }

  // Check: Too many prompt files (organizational concern)
  if (promptFiles.length > 15) {
    findings.push({
      ruleId: 'PRM005',
      dimension: 'completeness',
      severity: 'low',
      confidence: 'medium',
      message: `${promptFiles.length} prompt files found. Large prompt libraries can be hard to maintain and discover.`,
      file: '(prompt library)',
      suggestion: 'Consider organizing into subdirectories by workflow (e.g., prompts/review/, prompts/generate/) or adding an index.md.',
    });
  }

  return findings;
}

/**
 * MCP (Model Context Protocol) Configuration Analyzer
 *
 * Checks MCP server configs for:
 * - Security (no exposed credentials, proper auth)
 * - Efficiency (tool registration, unnecessary tools)
 * - Quality (descriptions, documentation)
 */

export async function analyzeMcp(
  files: AnalyzerFile[],
  _options: AnalyzerOptions,
): Promise<Finding[]> {
  const findings: Finding[] = [];

  const mcpFiles = files.filter(f =>
    f.relativePath.includes('mcp') || f.relativePath.endsWith('mcp.json')
  );
  if (mcpFiles.length === 0) return findings;

  for (const file of mcpFiles) {
    const content = file.content;

    // Parse JSON or YAML
    let config: unknown;
    try {
      if (file.relativePath.endsWith('.json')) {
        config = JSON.parse(content);
      } else {
        config = parseYaml(content);
      }
    } catch {
      findings.push({
        ruleId: 'MCP001',
        dimension: 'completeness',
        severity: 'medium',
        confidence: 'certain',
        message: 'MCP config file has invalid syntax (failed to parse).',
        file: file.relativePath,
        suggestion: 'Fix YAML/JSON syntax errors.',
      });
      continue;
    }

    if (config && typeof config === 'object') {
      const configStr = JSON.stringify(config);

      // Check for hardcoded secrets in MCP config
      if (/(?:api[_-]?key|secret|token|password)\s*["']?\s*[:=]\s*["']?[a-z0-9_-]{16,}/i.test(configStr)) {
        findings.push({
          ruleId: 'MCP002',
          dimension: 'security',
          severity: 'critical',
          confidence: 'high',
          message: 'Potential secrets in MCP server configuration.',
          file: file.relativePath,
          suggestion: 'Use environment variable references (e.g., ${SECRET_NAME}) instead of hardcoded values.',
        });
      }

      // Check for localhost/insecure endpoints
      if (/http:\/\/(?!localhost|127\.0\.0\.1)/i.test(configStr)) {
        findings.push({
          ruleId: 'MCP003',
          dimension: 'security',
          severity: 'high',
          confidence: 'high',
          message: 'MCP config references non-localhost HTTP (unencrypted) endpoint.',
          file: file.relativePath,
          suggestion: 'Use HTTPS for all non-local MCP server connections.',
        });
      }

      // Check for tools without descriptions
      const servers = (config as Record<string, unknown>)['mcpServers'] ??
                      (config as Record<string, unknown>)['servers'] ??
                      (config as Record<string, unknown>)['tools'];
      if (servers && typeof servers === 'object') {
        const serverEntries = Object.values(servers as Record<string, unknown>);
        const missingDescriptions = serverEntries.filter(s =>
          s && typeof s === 'object' && !('description' in (s as Record<string, unknown>))
        );
        if (missingDescriptions.length > 0) {
          findings.push({
            ruleId: 'MCP004',
            dimension: 'specificity',
            severity: 'low',
            confidence: 'medium',
            message: `${missingDescriptions.length} MCP server(s) lack descriptions. Agents can't self-select tools effectively without them.`,
            file: file.relativePath,
            suggestion: 'Add a "description" field to each MCP server/tool so the agent knows when to use it.',
          });
        }
      }

      // Check for stdio vs sse transport security
      if (/\"command\"/.test(configStr) && /node|python|npx|uvx/.test(configStr)) {
        // stdio transport — check if command is safe
        const cmdMatch = configStr.match(/"command"\s*:\s*"([^"]+)"/);
        if (cmdMatch && /\||\$\(|`|&&|;/.test(cmdMatch[1]!)) {
          findings.push({
            ruleId: 'MCP005',
            dimension: 'security',
            severity: 'high',
            confidence: 'high',
            message: 'MCP stdio command contains shell operators. Potential command injection risk.',
            file: file.relativePath,
            evidence: cmdMatch[1]!.slice(0, 60),
            suggestion: 'Use simple command + args arrays. Avoid shell operators in MCP server commands.',
          });
        }
      }

      // MCP006: unpinned package execution (supply-chain risk). An MCP server
      // launched via `npx`/`uvx`/`dlx` without a version pin will silently pull
      // whatever the registry serves at run time — a compromised or typosquatted
      // release then runs locally with the agent's privileges.
      if (servers && typeof servers === 'object') {
        for (const [name, value] of Object.entries(servers as Record<string, unknown>)) {
          if (!value || typeof value !== 'object') continue;
          const entry = value as Record<string, unknown>;
          const command = typeof entry['command'] === 'string' ? (entry['command'] as string) : '';
          const args = Array.isArray(entry['args']) ? (entry['args'] as unknown[]).map(String) : [];
          if (!/(^|\/)(npx|uvx|bunx|pnpm|yarn|npm)$/i.test(command)) continue;
          if (command.toLowerCase() === 'pnpm' || command.toLowerCase() === 'yarn' || command.toLowerCase() === 'npm') {
            if (!args.some(a => /^(dlx|exec)$/i.test(a))) continue;
          }
          // Identify a package-spec arg (skip flags, paths, and dlx/exec verbs).
          const pkgArgs = args.filter(a =>
            !a.startsWith('-') && !/^(dlx|exec)$/i.test(a) && !/^[./]/.test(a) && a !== '.'
          );
          if (pkgArgs.length === 0) continue;
          const pinned = pkgArgs.some(a => /@\d+\.\d+|@[0-9a-f]{7,40}$|@\d+$/.test(a));
          if (!pinned) {
            findings.push({
              ruleId: 'MCP006',
              dimension: 'security',
              severity: 'medium',
              confidence: 'medium',
              message: `MCP server "${name}" runs an unpinned package via ${command}. An unpinned release auto-updates and runs locally with the agent's privileges (supply-chain risk).`,
              file: file.relativePath,
              evidence: `${command} ${pkgArgs[0]}`.slice(0, 80),
              suggestion: 'Pin the package to an exact version (e.g. @1.2.3) or a vetted commit, and review updates before bumping. Avoid @latest for code that runs on the developer machine.',
            });
          }
        }
      }
    }
  }

  return findings;
}

/**
 * Setup Steps Analyzer
 *
 * Checks the coding agent environment setup for:
 * - Security (no exposed secrets, minimal permissions)
 * - Efficiency (fast setup, cached deps)
 * - Completeness (tools installed, tests available)
 */

export async function analyzeSetupSteps(
  files: AnalyzerFile[],
  _options: AnalyzerOptions,
): Promise<Finding[]> {
  const findings: Finding[] = [];

  const setupFiles = files.filter(f =>
    f.relativePath.includes('copilot-setup-steps') || f.relativePath.includes('agent-setup')
  );
  if (setupFiles.length === 0) return findings;

  for (const file of setupFiles) {
    const content = file.content;
    const lines = content.split('\n');

    // Check for curl-pipe-bash patterns
    for (let i = 0; i < lines.length; i++) {
      if (/curl.*\|.*(?:sh|bash)/i.test(lines[i]!)) {
        findings.push({
          ruleId: 'STP001',
          dimension: 'security',
          severity: 'high',
          confidence: 'high',
          message: 'Pipe-to-shell pattern in setup steps. Coding agent could execute tampered scripts.',
          file: file.relativePath,
          line: i + 1,
          evidence: lines[i]!.trim().slice(0, 80),
          suggestion: 'Pin to specific versions, verify checksums, or use package managers instead.',
        });
      }
    }

    // Check for missing caching (slow setup = wasted compute)
    const hasCache = /cache|restore.*cache|actions\/cache/i.test(content);
    if (!hasCache && content.includes('install')) {
      findings.push({
        ruleId: 'STP002',
        dimension: 'token-efficiency',
        severity: 'low',
        confidence: 'medium',
        message: 'Setup steps install dependencies without caching. This slows every coding agent session.',
        file: file.relativePath,
        suggestion: 'Add dependency caching (actions/cache or setup-node/setup-python cache options) to speed up agent environment.',
      });
    }

    // Check for broad permissions
    if (/permissions:\s*write-all/i.test(content) || /permissions:\s*\n\s+contents:\s*write/i.test(content)) {
      // That's expected for coding agent, but check for dangerous ones
      if (/id-token:\s*write/i.test(content) || /packages:\s*write/i.test(content)) {
        findings.push({
          ruleId: 'STP003',
          dimension: 'security',
          severity: 'medium',
          confidence: 'medium',
          message: 'Setup steps grant broad permissions beyond what coding agent typically needs.',
          file: file.relativePath,
          suggestion: 'Restrict permissions to minimum required: contents:write is standard; id-token and packages may not be needed.',
        });
      }
    }

    // Check for missing test framework setup
    const hasTestSetup = /test|jest|vitest|pytest|rspec|cargo test|go test/i.test(content);
    if (!hasTestSetup) {
      findings.push({
        ruleId: 'STP004',
        dimension: 'completeness',
        severity: 'medium',
        confidence: 'medium',
        message: 'Setup steps don\'t appear to install/configure a test framework. Coding agent can\'t verify its work.',
        file: file.relativePath,
        suggestion: 'Ensure the test framework is available so the coding agent can run tests to validate changes.',
      });
    }

    // Check for missing linter setup
    const hasLinter = /lint|eslint|prettier|ruff|rubocop|clippy|golangci/i.test(content);
    if (!hasLinter) {
      findings.push({
        ruleId: 'STP005',
        dimension: 'completeness',
        severity: 'low',
        confidence: 'low',
        message: 'No linter configured in setup steps. Coding agent may produce style-inconsistent code.',
        file: file.relativePath,
        suggestion: 'Install project linters so the coding agent gets immediate style feedback.',
      });
    }
  }

  return findings;
}

/**
 * Hooks Configuration Analyzer (.pre-commit-config.yaml)
 *
 * Checks for proper integration with AI tooling and efficiency.
 */

export async function analyzeHooks(
  files: AnalyzerFile[],
  _options: AnalyzerOptions,
): Promise<Finding[]> {
  const findings: Finding[] = [];

  const hookFiles = files.filter(f =>
    f.relativePath.includes('pre-commit') || f.relativePath.includes('hooks')
  );
  if (hookFiles.length === 0) return findings;

  for (const file of hookFiles) {
    const content = file.content;

    // Check for hooks that might conflict with agent workflows
    if (/interactive|confirm|prompt.*user/i.test(content)) {
      findings.push({
        ruleId: 'HK001',
        dimension: 'conflict-reachability',
        severity: 'medium',
        confidence: 'medium',
        message: 'Hooks may require interactive input. This blocks automated agent workflows.',
        file: file.relativePath,
        suggestion: 'Ensure all hooks can run non-interactively (use --yes flags or CI mode).',
      });
    }

    // Check for very slow hooks that waste agent time
    if (/docker|container|build.*image/i.test(content)) {
      findings.push({
        ruleId: 'HK002',
        dimension: 'token-efficiency',
        severity: 'low',
        confidence: 'low',
        message: 'Hooks include heavy operations (Docker builds). This delays agent feedback loops.',
        file: file.relativePath,
        suggestion: 'Consider running heavy checks in CI rather than pre-commit hooks for agent-driven workflows.',
      });
    }

    // Check for outdated hook versions (pinning matters for security)
    const revMatches = content.match(/rev:\s*v?(\d+\.\d+\.\d+)/g);
    if (revMatches && revMatches.length > 0) {
      // Flag only pre-1.0 (v0.x) pins. A 0.x release signals an unstable,
      // pre-release tool surface; 1.x+ is intentionally excluded because many
      // mature, actively-maintained hooks legitimately sit at 1.x and flagging
      // them produced pure noise.
      const hasV0 = revMatches.some(r => /v?0\.\d+\.\d+/.test(r));
      if (hasV0) {
        findings.push({
          ruleId: 'HK003',
          dimension: 'security',
          severity: 'low',
          confidence: 'low',
          message: 'Some hook repos are pinned to a pre-1.0 (v0.x) release. Pre-release tooling changes quickly and may carry unpatched issues.',
          file: file.relativePath,
          suggestion: 'Prefer a 1.0+ stable release where available, and review the changelog before bumping pinned hook versions.',
        });
      }
    }
  }

  return findings;
}

/**
 * Editor Config Analyzer
 *
 * Checks editor AI-assistant settings for efficiency and conflicts.
 */

export async function analyzeEditorConfig(
  files: AnalyzerFile[],
  _options: AnalyzerOptions,
): Promise<Finding[]> {
  const findings: Finding[] = [];

  const editorFiles = files.filter(f => f.relativePath.includes('settings.json'));
  if (editorFiles.length === 0) return findings;

  for (const file of editorFiles) {
    const content = file.content;

    // Analyze when the file carries AI-assistant settings OR a tool-permission
    // allowlist (Claude `settings.json`). Other editor settings are ignored.
    const hasCopilot = /copilot|github\.copilot/i.test(content);
    const hasPermissions = /"permissions"/.test(content);
    if (!hasCopilot && !hasPermissions) continue;

    let settings: Record<string, unknown>;
    try {
      // VS Code settings can have comments — strip them
      const cleaned = content.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      settings = JSON.parse(cleaned);
    } catch {
      findings.push({
        ruleId: 'EDC001',
        dimension: 'completeness',
        severity: 'low',
        confidence: 'medium',
        message: 'Editor/agent settings file has syntax errors (possibly trailing commas or comments).',
        file: file.relativePath,
        suggestion: 'Ensure the settings file is valid JSONC. VS Code tolerates it but other tools may not.',
      });
      continue;
    }

    // EDC003 — overly permissive tool allowlist. An `allow` entry that grants
    // unconstrained shell, write, or all-tools access turns a per-action
    // approval model into standing permission. Constrained entries such as
    // `Bash(npm test)` or read-only `Read(*)` are intentionally NOT flagged.
    const permissions = settings['permissions'] as Record<string, unknown> | undefined;
    const allow = permissions && Array.isArray(permissions['allow'])
      ? (permissions['allow'] as unknown[]).map(String)
      : [];
    const dangerous = allow.filter(entry => isDangerousAllow(entry));
    if (dangerous.length > 0) {
      findings.push({
        ruleId: 'EDC003',
        dimension: 'security',
        severity: 'high',
        confidence: 'high',
        message: `Tool allowlist grants unconstrained access: ${dangerous.slice(0, 3).join(', ')}. The agent can run shell, write files, or use any tool with no per-action approval.`,
        file: file.relativePath,
        evidence: dangerous.slice(0, 3).join(', ').slice(0, 80),
        suggestion: 'Constrain each allowed tool to specific, safe invocations (e.g. `Bash(npm test)` instead of `Bash`/`Bash(*)`), and never allow a bare `*`. Keep destructive tools behind the approval prompt.',
      });
    }

    if (!hasCopilot) continue;

    // Check for assistant disabled for specific languages (might be intentional, flag as info)
    const copilotEnable = settings['github.copilot.enable'] as Record<string, boolean> | undefined;
    if (copilotEnable) {
      const disabled = Object.entries(copilotEnable).filter(([_, v]) => v === false);
      if (disabled.length > 5) {
        findings.push({
          ruleId: 'EDC002',
          dimension: 'completeness',
          severity: 'low',
          confidence: 'low',
          message: `AI assistance disabled for ${disabled.length} languages/contexts. Ensure this is intentional.`,
          file: file.relativePath,
          suggestion: 'Review disabled languages — some may have been set temporarily and forgotten.',
        });
      }
    }
  }

  return findings;
}

/**
 * True when a permission-allowlist entry grants unconstrained shell, write, or
 * all-tools access. Constrained calls (`Bash(npm test)`) and read-only wildcards
 * (`Read(*)`) are safe and return false.
 */
function isDangerousAllow(entry: string): boolean {
  const e = entry.trim();
  if (e === '*' || e === '"*"') return true;
  // Tool with no argument constraint, e.g. `Bash`, or wildcard arg `Bash(*)`.
  const m = e.match(/^([A-Za-z]+)(?:\(\s*(.*?)\s*\))?$/);
  if (!m) return false;
  const tool = m[1]!;
  const arg = m[2];
  const dangerousTools = /^(Bash|Shell|Exec|Execute|Run|Write|Edit|MultiEdit|Update|NotebookEdit)$/i;
  if (!dangerousTools.test(tool)) return false;
  // No parens at all => unconstrained. `(*)`/`(:*)`/empty => unconstrained.
  if (arg === undefined) return true;
  return arg === '' || arg === '*' || arg === ':*' || arg === '**';
}
