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
      // Just flag if any are 2+ years old as a maintenance concern
      // (we can't actually check dates, but very low versions are suspicious)
      const hasV1 = revMatches.some(r => /v?[01]\.\d+\.\d+/.test(r));
      if (hasV1) {
        findings.push({
          ruleId: 'HK003',
          dimension: 'security',
          severity: 'low',
          confidence: 'low',
          message: 'Some hook repos are pinned to v0.x/v1.x versions. These may have known vulnerabilities.',
          file: file.relativePath,
          suggestion: 'Update hook versions to latest stable releases for security fixes.',
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

    // Only analyze if it has AI-assistant-related settings
    if (!/copilot|github\.copilot/i.test(content)) continue;

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
        message: 'VS Code settings.json has syntax errors (possibly trailing commas or comments).',
        file: file.relativePath,
        suggestion: 'Ensure settings.json is valid JSONC. VS Code tolerates it but other tools may not.',
      });
      continue;
    }

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
