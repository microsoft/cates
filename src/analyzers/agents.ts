// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import type { Finding, AnalyzerOptions, AnalyzerFile } from '../types.js';

/**
 * Subagent Definition Analyzer
 *
 * Custom subagents (Claude `.claude/agents/`, generic `agents/`, Copilot
 * `.github/agents/`, etc.) are delegated their own context window and tool
 * access. Two failure modes matter for coding agents:
 *
 * - AGT001 (security): a subagent with no declared tool scope inherits the
 *   orchestrator's full toolset, violating least privilege. A narrowly-scoped
 *   "doc writer" subagent should not be able to run shell or push code.
 * - AGT002 (specificity): a subagent with no description/trigger forces the
 *   orchestrator to guess when to delegate, wasting tokens on mis-routing.
 */

const AGENT_PATH_PATTERNS: RegExp[] = [
  /^agents\/[^/]+\.(ya?ml|md)$/i,
  /^\.github\/agents\/.+\.(ya?ml|md)$/i,
  /^\.ai\/agents\/.+\.(ya?ml|md)$/i,
  /^\.claude\/agents\/.+\.md$/i,
  /^\.gemini\/agents\/.+\.(ya?ml|md)$/i,
  /^\.github\/copilot\/agent\.ya?ml$/i,
];

function isAgentFile(relativePath: string): boolean {
  return AGENT_PATH_PATTERNS.some(p => p.test(relativePath));
}

/** Extract YAML frontmatter from a markdown file, or the whole body for .yml. */
function extractMetadataBlock(file: AnalyzerFile): string {
  if (/\.ya?ml$/i.test(file.relativePath)) return file.content;
  const fm = file.content.match(/^---\s*\n([\s\S]*?)\n---\s*(\n|$)/);
  return fm ? fm[1]! : '';
}

const TOOL_KEY_RE = /(^|\n)\s*(tools|allowed[_-]?tools|allowedTools|permissions)\s*:/i;
const DESC_KEY_RE = /(^|\n)\s*(description|summary|role|purpose|when[_-]?to[_-]?use)\s*:/i;
const NAME_KEY_RE = /(^|\n)\s*(name|id|title)\s*:/i;

export async function analyzeAgents(
  files: AnalyzerFile[],
  _options: AnalyzerOptions,
): Promise<Finding[]> {
  const findings: Finding[] = [];

  const agentFiles = files.filter(f => isAgentFile(f.relativePath));
  if (agentFiles.length === 0) return findings;

  for (const file of agentFiles) {
    const meta = extractMetadataBlock(file);

    // AGT001 — no tool scope declared => inherits the full toolset.
    if (!TOOL_KEY_RE.test(meta)) {
      findings.push({
        ruleId: 'AGT001',
        dimension: 'security',
        severity: 'high',
        confidence: 'medium',
        message: 'Subagent declares no tool scope. It inherits the orchestrator\'s full tool/permission set, which breaks least privilege.',
        file: file.relativePath,
        suggestion: 'Add an explicit `tools:` (or `allowed-tools:`) list granting only the tools this subagent needs. A reviewer/doc subagent rarely needs shell, write, or VCS tools.',
      });
    }

    // AGT002 — no description/trigger => orchestrator cannot route reliably.
    const hasDescription = DESC_KEY_RE.test(meta) || /^#{1,3}\s+\S/m.test(file.content);
    const hasIdentity = NAME_KEY_RE.test(meta);
    if (!hasDescription && !hasIdentity) {
      findings.push({
        ruleId: 'AGT002',
        dimension: 'specificity',
        severity: 'low',
        confidence: 'medium',
        message: 'Subagent lacks a description/trigger. The orchestrator must guess when to delegate, causing mis-routing and wasted token round-trips.',
        file: file.relativePath,
        suggestion: 'Add a `description:` (and `name:`) in frontmatter stating exactly when this subagent should be invoked.',
      });
    }
  }

  return findings;
}
