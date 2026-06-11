// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import type { Finding, AnalyzerOptions, AnalyzerFile } from '../types.js';

/**
 * Conflict & Reachability Analyzer
 *
 * Detects instructions that contradict each other or are unreachable/dead.
 * Also checks for proper harness quality (guardrails, scope limits, failure handling).
 */

export async function analyzeConflicts(
  files: AnalyzerFile[],
  _options: AnalyzerOptions,
): Promise<Finding[]> {
  const findings: Finding[] = [];

  const allInstructions: Array<{ text: string; file: string; line: number }> = [];

  for (const file of files) {
    const lines = file.content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.trim();
      if (line.length > 20 && (line.startsWith('-') || line.startsWith('*') || line.startsWith('•'))) {
        allInstructions.push({ text: line.slice(1).trim(), file: file.relativePath, line: i + 1 });
      }
    }
  }

  findings.push(...checkContradictions(allInstructions));
  findings.push(...checkHarnessQuality(files));

  return findings;
}

// ─── Contradiction Detection ─────────────────────────────────────────────────

interface Instruction {
  text: string;
  file: string;
  line: number;
}

// Pairs of contradictory instruction patterns
const CONTRADICTION_PAIRS: Array<[RegExp, RegExp, string]> = [
  [/always (use|prefer|write) (comments|documentation)/i, /never (add|write|include) (comments|documentation)/i, 'Contradictory commenting policy'],
  [/always use (strict|explicit) types/i, /use (any|dynamic|inferred) types/i, 'Contradictory typing policy'],
  [/use (functional|immutable)/i, /use (classes|oop|object.?oriented|mutable)/i, 'Contradictory paradigm preference'],
  [/keep (responses?|output) (short|concise|brief|minimal)/i, /provide (detailed|comprehensive|thorough|verbose)/i, 'Contradictory verbosity instructions'],
  [/do not (modify|change|touch) (existing|other)/i, /refactor (as needed|freely|when)/i, 'Contradictory modification policy'],
  [/single (file|module) (per|for each)/i, /keep (everything|all|code) (in one|together|in the same)/i, 'Contradictory file organization'],
  [/use (semicolons|;)/i, /no semicolons/i, 'Contradictory semicolon preference'],
  [/prefer (named|default) exports/i, /avoid (named|default) exports/i, 'Contradictory export style'],
];

function checkContradictions(instructions: Instruction[]): Finding[] {
  const findings: Finding[] = [];

  for (const [patternA, patternB, label] of CONTRADICTION_PAIRS) {
    const matchesA = instructions.filter(i => patternA.test(i.text));
    const matchesB = instructions.filter(i => patternB.test(i.text));

    if (matchesA.length > 0 && matchesB.length > 0) {
      const a = matchesA[0]!;
      const b = matchesB[0]!;
      findings.push({
        ruleId: 'CNF001',
        dimension: 'conflict-reachability',
        severity: 'high',
        confidence: 'high',
        message: `${label}: "${a.text.slice(0, 50)}" conflicts with "${b.text.slice(0, 50)}"`,
        file: a.file,
        line: a.line,
        evidence: `${a.file}:${a.line} vs ${b.file}:${b.line}`,
        suggestion: 'Resolve the contradiction. Conflicting instructions cause unpredictable behavior and wasted retry sessions.',
      });
    }
  }

  return findings;
}

// ─── Harness Quality ─────────────────────────────────────────────────────────

const HARNESS_CHECKS = [
  {
    id: 'scope-limits',
    label: 'Scope limitations',
    patterns: [/only.*(?:files?|director)/i, /do not.*(?:outside|beyond)/i, /restrict.*to/i, /scope/i],
    severity: 'medium' as const,
  },
  {
    id: 'failure-handling',
    label: 'Failure/error escalation behavior',
    patterns: [/if.*(?:fail|error|unable|cannot)/i, /when.*(?:stuck|unsure|unclear)/i, /ask.*(?:user|clarif)/i],
    severity: 'medium' as const,
  },
  {
    id: 'output-constraints',
    label: 'Output format constraints',
    patterns: [/respond.*(?:format|json|markdown)/i, /output.*(?:must|should)/i, /do not.*(?:explain|comment)/i],
    severity: 'low' as const,
  },
  {
    id: 'prohibited-actions',
    label: 'Explicitly prohibited actions',
    patterns: [/never|must not|do not|prohibited/i],
    severity: 'low' as const,
  },
  {
    id: 'verification-steps',
    label: 'Self-verification/testing instructions',
    patterns: [/verify|validate|check.*(?:before|after)|run.*test|ensure.*(?:pass|compil)/i],
    severity: 'medium' as const,
  },
];

function checkHarnessQuality(files: AnalyzerFile[]): Finding[] {
  const findings: Finding[] = [];

  const allContent = files.map(f => f.content).join('\n');

  // Only evaluate harness quality when there is actual instruction prose to
  // govern. A repo that only ships an MCP config or a settings file has no
  // instruction layer, so reporting "missing scope limits / failure handling"
  // there is noise, not signal. Require a minimum of instruction-style lines
  // (headings or bullets) before judging guardrail coverage.
  const instructionLines = allContent
    .split('\n')
    .filter(l => /^\s*(#{1,6}\s+\S|[-*•]\s+\S)/.test(l)).length;
  if (instructionLines < 3) return findings;

  const missing = HARNESS_CHECKS.filter(check =>
    !check.patterns.some(p => p.test(allContent))
  );

  for (const check of missing) {
    findings.push({
      ruleId: 'CNF002',
      dimension: 'harness-quality',
      severity: check.severity,
      confidence: 'medium',
      message: `Missing harness element: ${check.label}. Agent may behave unpredictably in edge cases.`,
      file: '(combined configuration)',
      suggestion: `Add instructions for ${check.label.toLowerCase()} to create proper guardrails.`,
    });
  }

  return findings;
}
