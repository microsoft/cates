// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import type { Finding, AnalyzerOptions, AnalyzerFile } from '../types.js';

/**
 * Completeness Analyzer
 *
 * Checks whether agent configurations cover the essential areas
 * that lead to high-quality, efficient agent behavior.
 */

const ESSENTIAL_TOPICS = [
  {
    id: 'testing',
    label: 'Testing strategy',
    patterns: [/test/i, /spec/i, /assert/i, /vitest|jest|pytest|rspec|xunit/i],
    description: 'How tests should be written, what framework, coverage expectations',
  },
  {
    id: 'error-handling',
    label: 'Error handling patterns',
    patterns: [/error/i, /exception/i, /try.?catch/i, /result.*err/i],
    description: 'How errors should be handled, logged, and propagated',
  },
  {
    id: 'code-style',
    label: 'Code style/conventions',
    patterns: [/style/i, /naming/i, /convention/i, /camelCase|snake_case|PascalCase/i, /eslint|prettier|rustfmt/i],
    description: 'Naming conventions, formatting rules, style preferences',
  },
  {
    id: 'architecture',
    label: 'Architecture/structure',
    patterns: [/architect/i, /structure/i, /layer/i, /module/i, /service/i, /component/i],
    description: 'Project layout, module boundaries, dependency rules',
  },
  {
    id: 'security',
    label: 'Security practices',
    patterns: [/secur/i, /auth/i, /sanitiz/i, /validat/i, /inject/i, /xss|csrf|cors/i],
    description: 'Security requirements, input validation, auth patterns',
  },
  {
    id: 'scope-limits',
    label: 'Scope/boundary definitions',
    patterns: [/scope/i, /boundar/i, /limit/i, /restrict/i, /only.*files?/i, /do not.*modify/i],
    description: 'What the agent should and should not touch',
  },
  {
    id: 'output-format',
    label: 'Output expectations',
    patterns: [/output/i, /format/i, /respond/i, /return/i, /commit.*message/i, /pr.*description/i],
    description: 'Expected output format, commit messages, PR descriptions',
  },
];

export async function analyzeCompleteness(
  files: AnalyzerFile[],
  _options: AnalyzerOptions,
): Promise<Finding[]> {
  const findings: Finding[] = [];

  // Concatenate all config content to check coverage
  const allContent = files.map(f => f.content).join('\n');

  if (allContent.trim().length === 0) {
    findings.push({
      ruleId: 'CMP001',
      dimension: 'completeness',
      severity: 'high',
      confidence: 'certain',
      message: 'No agent configuration content found. Agents will rely entirely on default behavior.',
      file: '(none)',
      suggestion: 'Create a root instruction file with project-specific context to guide agent behavior.',
    });
    return findings;
  }

  // Check which essential topics are covered
  const missingTopics: typeof ESSENTIAL_TOPICS = [];

  for (const topic of ESSENTIAL_TOPICS) {
    const covered = topic.patterns.some(p => p.test(allContent));
    if (!covered) {
      missingTopics.push(topic);
    }
  }

  if (missingTopics.length > 0) {
    for (const topic of missingTopics) {
      findings.push({
        ruleId: 'CMP002',
        dimension: 'completeness',
        severity: missingTopics.length > 4 ? 'high' : 'medium',
        confidence: 'medium',
        message: `Missing topic: ${topic.label}. ${topic.description}.`,
        file: '(root instructions)',
        suggestion: `Add a section covering ${topic.label.toLowerCase()} to reduce agent guesswork and retry sessions.`,
      });
    }
  }

  // Check for file organization (single massive file vs well-structured)
  if (files.length === 1) {
    const content = files[0]!.content;
    const lineCount = content.split('\n').length;
    if (lineCount > 200) {
      findings.push({
        ruleId: 'CMP003',
        dimension: 'completeness',
        severity: 'low',
        confidence: 'medium',
        message: `Single large config file (${lineCount} lines). Consider splitting into scoped files for conditional loading.`,
        file: files[0]!.relativePath,
        suggestion: 'Split always-needed instructions from task-specific ones (directory-scoped agent files or prompt files).',
      });
    }
  }

  return findings;
}
