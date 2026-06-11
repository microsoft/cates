// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import type { Finding, AnalyzerOptions, AnalyzerFile } from '../types.js';
import { isScannableLine } from '../utils/regex-guards.js';

/**
 * Slash-Command Analyzer
 *
 * Custom commands (Claude `.claude/commands/`, Gemini `.gemini/commands/`,
 * generic `commands/`) can run shell *as a side effect of being invoked*:
 *
 * - A `!`-prefixed line is executed in the shell before the prompt is sent,
 *   so its output is injected into context (Claude command bang-syntax).
 * - `allowed-tools:`/`allowedTools:` frontmatter that grants `Bash` lets the
 *   command run arbitrary shell once invoked.
 *
 * CMD001 (security) flags commands that auto-execute shell on invocation, since
 * `/command`-triggered execution is an easy, low-friction path to running
 * attacker-influenced commands (e.g. via a poisoned argument or pasted text).
 */

const COMMAND_PATH_PATTERNS: RegExp[] = [
  /^\.claude\/commands\/.+\.md$/i,
  /^\.gemini\/commands\/.+\.md$/i,
  /^commands\/.+\.md$/i,
  /^\.github\/commands\/.+\.md$/i,
];

function isCommandFile(relativePath: string): boolean {
  return COMMAND_PATH_PATTERNS.some(p => p.test(relativePath));
}

export async function analyzeCommands(
  files: AnalyzerFile[],
  _options: AnalyzerOptions,
): Promise<Finding[]> {
  const findings: Finding[] = [];

  const commandFiles = files.filter(f => isCommandFile(f.relativePath));
  if (commandFiles.length === 0) return findings;

  for (const file of commandFiles) {
    const lines = file.content.split('\n');
    const fm = file.content.match(/^---\s*\n([\s\S]*?)\n---\s*(\n|$)/);
    const frontmatter = fm ? fm[1]! : '';
    const frontmatterLineCount = fm ? frontmatter.split('\n').length + 2 : 0;

    // (a) Frontmatter grants shell tools => command can run arbitrary shell.
    const toolGrant = frontmatter.match(/(?:^|\n)\s*(?:allowed[_-]?tools|allowedTools|tools)\s*:.*\bBash\b/i);
    if (toolGrant) {
      findings.push({
        ruleId: 'CMD001',
        dimension: 'security',
        severity: 'high',
        confidence: 'medium',
        message: 'Command grants shell (Bash) access in its tool allowlist, so invoking it can run arbitrary shell with whatever arguments/text were passed in.',
        file: file.relativePath,
        line: 1,
        evidence: toolGrant[0].trim().slice(0, 80),
        suggestion: 'Remove Bash from the command\'s allowed tools, or constrain it to a specific command (e.g. `Bash(npm test)`) so a `/command` invocation cannot run arbitrary shell.',
      });
    }

    // (b) `!`-prefixed bang execution that runs before the prompt is sent.
    for (let i = 0; i < lines.length; i++) {
      if (fm && i + 1 <= frontmatterLineCount) continue; // skip frontmatter region
      const line = lines[i]!;
      if (!isScannableLine(line)) continue;
      // Inline `` !`cmd` `` or a line starting with `! cmd`. Exclude markdown
      // images `![alt]` and bare negation in prose.
      const bang = line.match(/(^|\s)!`[^`]+`/) ?? line.match(/^\s*!\s*[A-Za-z./][\w./-]*(?:\s|$)/);
      if (bang && !/^\s*!\[/.test(line)) {
        findings.push({
          ruleId: 'CMD001',
          dimension: 'security',
          severity: 'high',
          confidence: 'medium',
          message: 'Command auto-executes shell on invocation (`!`-prefixed bang directive). Its output is injected into context every time the command runs, with no approval step.',
          file: file.relativePath,
          line: i + 1,
          evidence: line.trim().slice(0, 80),
          suggestion: 'Avoid running shell as a side effect of invoking a command. If the output is needed, have the agent run the command through the normal (approvable) tool path, or pin it to a fixed, non-parameterized command.',
        });
        break; // one bang finding per command file is enough
      }
    }
  }

  return findings;
}
