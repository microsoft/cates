// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import type { Finding, AnalyzerOptions, AnalyzerFile } from '../types.js';
import { countTokens } from '../utils/tokenizer.js';
import { isScannableLine } from '../utils/regex-guards.js';

/**
 * Specificity & Quality Analyzer
 *
 * Detects instructions that are too vague to be actionable,
 * checks for proper project-specific context, and evaluates
 * whether instructions will actually improve agent behavior.
 */

export async function analyzeSpecificity(
  files: AnalyzerFile[],
  _options: AnalyzerOptions,
): Promise<Finding[]> {
  const findings: Finding[] = [];

  for (const file of files) {
    const lines = file.content.split('\n');

    findings.push(...checkVagueInstructions(lines, file.relativePath));
    findings.push(...checkMissingProjectContext(file.content, file.relativePath));
    findings.push(...checkActionability(lines, file.relativePath));
  }

  return findings;
}

// ─── Vague Instructions ──────────────────────────────────────────────────────

const VAGUE_PATTERNS = [
  { pattern: /be (careful|smart|thoughtful|intelligent)/i, label: 'Subjective quality directive' },
  { pattern: /use (best|good|proper|appropriate) (practices|patterns|conventions)/i, label: 'Undefined "best practices"' },
  { pattern: /write (good|clean|high.?quality|professional) code/i, label: 'Undefined quality standard' },
  { pattern: /handle (errors?|edge cases?) (properly|correctly|well|appropriately)/i, label: 'Unspecified error handling' },
  { pattern: /make (it|sure it('?s| is)) (robust|scalable|maintainable|secure)/i, label: 'Undefined quality attribute' },
  { pattern: /follow (the|our|team) (standards?|conventions?|guidelines?)/i, label: 'Undocumented standard reference' },
  { pattern: /when (appropriate|necessary|needed)/i, label: 'Undefined condition trigger' },
  { pattern: /use (common sense|judgment|discretion)/i, label: 'Delegated decision without criteria' },
];

function checkVagueInstructions(lines: string[], file: string): Finding[] {
  const findings: Finding[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim().length < 10) continue;
    if (!isScannableLine(line)) continue;

    for (const { pattern, label } of VAGUE_PATTERNS) {
      if (pattern.test(line)) {
        findings.push({
          ruleId: 'SPC001',
          dimension: 'specificity',
          severity: 'medium',
          confidence: 'high',
          message: `Vague instruction: ${label}. LLMs perform better with specific, measurable criteria.`,
          file,
          line: i + 1,
          evidence: line.trim().slice(0, 80),
          suggestion: 'Replace with specific rules. E.g., instead of "handle errors properly" → "Wrap async calls in try/catch, log errors with structured JSON, return 4xx/5xx with error codes from errors.ts"',
          tokenImpact: -countTokens(line), // negative = may add guidance but improves agent quality
        });
      }
    }
  }

  return findings;
}

// ─── Missing Project Context ─────────────────────────────────────────────────

function checkMissingProjectContext(content: string, file: string): Finding[] {
  const findings: Finding[] = [];
  const tokens = countTokens(content);

  // If file is >500 tokens but has no file path references, it's likely too generic
  const hasFilePaths = /(?:src|lib|app|packages?)\/[a-z][\w/-]*\.\w+/i.test(content);
  const hasDirectoryRefs = /(?:\.\/|\.\.\/|src\/|lib\/|app\/|packages?\/)/i.test(content);
  const hasTechSpecifics = /(?:import|require|from ['"]|package\.json|tsconfig|Cargo\.toml|go\.mod|pom\.xml|Gemfile)/i.test(content);

  if (tokens > 500 && !hasFilePaths && !hasDirectoryRefs && !hasTechSpecifics) {
    findings.push({
      ruleId: 'SPC002',
      dimension: 'specificity',
      severity: 'medium',
      confidence: 'medium',
      message: 'No project-specific file paths or technology references found. Instructions appear generic.',
      file,
      suggestion: 'Ground instructions in your actual project: reference specific directories, config files, naming patterns, or tech stack details.',
    });
  }

  // Check for architecture/structure documentation
  const hasArchitecture = /(?:architecture|structure|layout|organization)/i.test(content);
  const hasModuleRefs = /(?:module|service|component|package|crate|namespace)/i.test(content);

  if (tokens > 300 && !hasArchitecture && !hasModuleRefs) {
    findings.push({
      ruleId: 'SPC003',
      dimension: 'specificity',
      severity: 'low',
      confidence: 'medium',
      message: 'No project architecture or module structure described. Agent may make incorrect structural assumptions.',
      file,
      suggestion: 'Add a brief section describing your project layout: key directories, service boundaries, or module responsibilities.',
    });
  }

  return findings;
}

// ─── Actionability ───────────────────────────────────────────────────────────

function checkActionability(lines: string[], file: string): Finding[] {
  const findings: Finding[] = [];

  // Detect instruction blocks without concrete patterns/examples
  let consecutiveAbstract = 0;
  let abstractStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line.length < 15 || line.startsWith('#') || line.startsWith('```')) {
      consecutiveAbstract = 0;
      continue;
    }
    if (!isScannableLine(line)) {
      consecutiveAbstract = 0;
      continue;
    }

    const isConcrete = /(?:`[^`]+`|['"][^'"]+['"]|\/[\w/-]+\.\w+|\d+(?:px|rem|ms|MB|KB)|[\w]+\(|import |from )/.test(line);

    if (!isConcrete && /^[-*]\s/.test(line)) {
      if (consecutiveAbstract === 0) abstractStart = i;
      consecutiveAbstract++;
    } else {
      consecutiveAbstract = 0;
    }

    if (consecutiveAbstract >= 8) {
      findings.push({
        ruleId: 'SPC004',
        dimension: 'specificity',
        severity: 'low',
        confidence: 'medium',
        message: `Long abstract instruction block (${consecutiveAbstract}+ bullets without concrete examples). May be ignored or misinterpreted.`,
        file,
        line: abstractStart + 1,
        suggestion: 'Break up abstract instructions with concrete examples, file references, or code patterns every 3-4 bullets.',
      });
      consecutiveAbstract = 0;
    }
  }

  return findings;
}
