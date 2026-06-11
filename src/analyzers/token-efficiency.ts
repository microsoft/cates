// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import type { Finding, AnalyzerOptions, AnalyzerFile } from '../types.js';
import { countTokens } from '../utils/tokenizer.js';
import { isScannableLine } from '../utils/regex-guards.js';

/**
 * Token Efficiency Analyzer
 *
 * Detects patterns that waste tokens on every invocation:
 * - Redundant/repeated instructions
 * - Overly verbose phrasing where concise would suffice
 * - Large code examples that could be referenced instead
 * - Generic filler that's already implied by the platform
 * - Instructions that force verbose output unnecessarily
 */

interface FileContent {
  path: string;
  relativePath: string;
  content: string;
  tokenCount: number;
}

export async function analyzeTokenEfficiency(
  files: AnalyzerFile[],
  _options: AnalyzerOptions,
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const fileContents: FileContent[] = files.map(file => ({
    path: file.path,
    relativePath: file.relativePath,
    content: file.content,
    tokenCount: countTokens(file.content),
  }));

  for (const fc of fileContents) {
    findings.push(...checkRedundantPhrasing(fc));
    findings.push(...checkVerboseExamples(fc));
    findings.push(...checkGenericFiller(fc));
    findings.push(...checkForcedVerbosity(fc));
    findings.push(...checkNegativeConstraintSpam(fc));
    findings.push(...checkUnboundedIncludes(fc));
  }

  // Cross-file: check for duplicate content across files
  findings.push(...checkCrossFileDuplication(fileContents));

  return findings;
}

// TE008: instruction files that pull in context via unbounded include
// directives (recursive globs, whole-directory references, or a large number of
// @file includes) silently expand the loaded context every time the file is
// active. A single `@src/**` can inject thousands of tokens that grow with the
// repo, defeating the point of a tight instruction file.
function checkUnboundedIncludes(fc: FileContent): Finding[] {
  const findings: Finding[] = [];

  // Only instruction-bearing text files use @-style includes. Skip JSON/code.
  if (!/\.(md|mdc|markdown|txt)$/i.test(fc.relativePath) &&
      !/(^|\/)(\.cursorrules|\.windsurfrules|\.clinerules)$/i.test(fc.relativePath)) {
    return findings;
  }

  const lines = fc.content.split('\n');
  let inFence = false;
  // Path-like @include: an @ followed by something containing a slash, a glob
  // star, or a known file extension. Excludes emails/decorators/handles.
  const includeRe = /(^|[\s(])@(?:import\s+|include\s+)?((?:\.{0,2}\/)?[\w.@/-]*(?:\/|\*|\.(?:md|mdc|markdown|txt|ts|tsx|js|jsx|py|go|rs|java|rb|json|ya?ml))[\w./*-]*)/i;

  let includeCount = 0;
  let firstIncludeLine = 0;
  const unboundedHits: Array<{ line: number; evidence: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!isScannableLine(line)) continue;
    const fence = line.trim().match(/^(```|~~~)/);
    if (fence) { inFence = !inFence; continue; }
    if (inFence) continue;

    const m = includeRe.exec(line);
    if (!m) continue;
    const target = m[2]!;
    includeCount++;
    if (includeCount === 1) firstIncludeLine = i + 1;

    // Unbounded if recursive glob, directory reference (trailing slash), or
    // single-level wildcard over a directory.
    if (/\*\*/.test(target) || /\/\s*$/.test(target) || /\/\*/.test(target) || /^@?\*/.test(target)) {
      unboundedHits.push({ line: i + 1, evidence: line.trim().slice(0, 80) });
    }
  }

  if (unboundedHits.length > 0) {
    const first = unboundedHits[0]!;
    findings.push({
      ruleId: 'TE008',
      dimension: 'token-efficiency',
      severity: 'medium',
      confidence: 'high',
      message: `Unbounded context include: a recursive glob or whole-directory reference injects an unpredictable, repo-sized amount of content into context whenever this file is active (${unboundedHits.length} such include${unboundedHits.length > 1 ? 's' : ''}).`,
      file: fc.relativePath,
      line: first.line,
      evidence: first.evidence,
      suggestion: 'Replace directory/recursive includes with references to the few specific files the agent actually needs, or summarize the directory inline. Pull large content on-demand from prompt files instead of always-loaded instructions.',
      tokenImpact: 1500 * unboundedHits.length,
    });
  } else if (includeCount > 10) {
    findings.push({
      ruleId: 'TE008',
      dimension: 'token-efficiency',
      severity: 'low',
      confidence: 'medium',
      message: `High include fan-out: ${includeCount} @file includes are pulled into context from one instruction file. Each adds tokens on every activation.`,
      file: fc.relativePath,
      line: firstIncludeLine,
      suggestion: 'Consolidate to the handful of references the agent needs most often, and move the rest to on-demand prompt files.',
      tokenImpact: (includeCount - 5) * 150,
    });
  }

  return findings;
}

function checkRedundantPhrasing(fc: FileContent): Finding[] {
  const findings: Finding[] = [];
  const lines = fc.content.split('\n');

  // Detect repeated sentences/phrases (normalized)
  const seenNormalized = new Map<string, number>();
  for (let i = 0; i < lines.length; i++) {
    const normalized = lines[i]!.trim().toLowerCase().replace(/[^a-z0-9\s]/g, '');
    if (normalized.length < 20) continue;

    const prevLine = seenNormalized.get(normalized);
    if (prevLine !== undefined) {
      findings.push({
        ruleId: 'TE007',
        dimension: 'token-efficiency',
        severity: 'medium',
        confidence: 'high',
        message: `Duplicated instruction (also on line ${prevLine + 1})`,
        file: fc.relativePath,
        line: i + 1,
        evidence: lines[i]!.trim().slice(0, 80),
        suggestion: 'Remove duplicate — it adds tokens on every invocation without adding value.',
        tokenImpact: countTokens(lines[i]!),
      });
    } else {
      seenNormalized.set(normalized, i);
    }
  }

  return findings;
}

function checkVerboseExamples(fc: FileContent): Finding[] {
  const findings: Finding[] = [];
  const codeBlockPattern = /```[\s\S]*?```/g;
  let match;

  while ((match = codeBlockPattern.exec(fc.content)) !== null) {
    const block = match[0];
    const tokens = countTokens(block);

    if (tokens > 200) {
      const lineNum = fc.content.slice(0, match.index).split('\n').length;
      findings.push({
        ruleId: 'TE002',
        dimension: 'token-efficiency',
        severity: 'medium',
        confidence: 'medium',
        message: `Large code example (${tokens} tokens). Consider referencing a file instead.`,
        file: fc.relativePath,
        line: lineNum,
        evidence: block.slice(0, 80) + '...',
        suggestion: 'Replace inline examples >200 tokens with @file references to reduce per-invocation tokens.',
        tokenImpact: Math.round(tokens * 0.8), // assume 80% saveable
      });
    }
  }

  return findings;
}

// Filler phrases the platform already handles
const GENERIC_FILLER_PATTERNS = [
  { pattern: /you are a helpful assistant/i, label: '"You are a helpful assistant"' },
  { pattern: /please be concise/i, label: '"Please be concise"' },
  { pattern: /respond in (markdown|plain text)/i, label: 'format instructions (platform default)' },
  { pattern: /you (are|have access to|can use) (a|the following) tools/i, label: 'tool availability declaration' },
  { pattern: /if you (don'?t|do not) know.*(say so|admit)/i, label: 'uncertainty acknowledgment (built-in)' },
  { pattern: /always follow (best practices|coding standards)/i, label: 'generic best practices (too vague to be actionable)' },
  { pattern: /write clean,? readable,? maintainable code/i, label: 'generic quality instructions' },
];

function checkGenericFiller(fc: FileContent): Finding[] {
  const findings: Finding[] = [];
  const lines = fc.content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!isScannableLine(line)) continue;
    for (const { pattern, label } of GENERIC_FILLER_PATTERNS) {
      if (pattern.test(line)) {
        findings.push({
          ruleId: 'TE003',
          dimension: 'token-efficiency',
          severity: 'low',
          confidence: 'high',
          message: `Generic filler: ${label} — this is either platform-default behavior or too vague to be useful.`,
          file: fc.relativePath,
          line: i + 1,
          evidence: line.trim().slice(0, 80),
          suggestion: 'Remove — either already the default behavior or replace with specific, actionable instructions.',
          tokenImpact: countTokens(line),
        });
      }
    }
  }

  return findings;
}

function checkForcedVerbosity(fc: FileContent): Finding[] {
  const findings: Finding[] = [];
  const patterns = [
    { pattern: /always (explain|describe|comment) (every|each|all)/i, label: 'Forces verbose explanations on every response' },
    { pattern: /include (detailed|comprehensive|thorough) (comments|explanations|descriptions) (in|for) (every|each|all)/i, label: 'Forces detailed comments everywhere' },
    { pattern: /never (abbreviate|shorten|summarize)/i, label: 'Prohibits concise responses' },
  ];

  const lines = fc.content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!isScannableLine(line)) continue;
    for (const { pattern, label } of patterns) {
      if (pattern.test(line)) {
        findings.push({
          ruleId: 'TE004',
          dimension: 'token-efficiency',
          severity: 'high',
          confidence: 'medium',
          message: `Forced verbosity: ${label}. This multiplies output tokens on EVERY interaction.`,
          file: fc.relativePath,
          line: i + 1,
          evidence: line.trim().slice(0, 80),
          suggestion: 'Make verbosity conditional ("when explaining architecture...") rather than global.',
          tokenImpact: 500, // estimated per-response waste
        });
      }
    }
  }

  return findings;
}

function checkNegativeConstraintSpam(fc: FileContent): Finding[] {
  const findings: Finding[] = [];
  const lines = fc.content.split('\n');
  const negativeLines: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (/^[-*]\s*(do not|don'?t|never|avoid|must not|should not)/i.test(lines[i]!.trim())) {
      negativeLines.push(i);
    }
  }

  // If >60% of bullet points are negative constraints, flag it
  const bulletLines = lines.filter(l => /^[-*]\s/.test(l.trim()));
  if (bulletLines.length > 5 && negativeLines.length / bulletLines.length > 0.6) {
    findings.push({
      ruleId: 'TE005',
      dimension: 'token-efficiency',
      severity: 'medium',
      confidence: 'medium',
      message: `Heavy negative constraint pattern (${negativeLines.length}/${bulletLines.length} bullets are "don't" rules). Negative instructions are token-expensive and less effective.`,
      file: fc.relativePath,
      line: negativeLines[0]! + 1,
      suggestion: 'Replace "don\'t do X" lists with "do Y instead" — positive instructions are more token-efficient and produce better results.',
      tokenImpact: Math.round(negativeLines.length * 15), // ~15 tokens per unnecessary negative
    });
  }

  return findings;
}

function checkCrossFileDuplication(files: FileContent[]): Finding[] {
  const findings: Finding[] = [];
  if (files.length < 2) return findings;

  // Extract meaningful paragraphs (3+ lines) from each file and check for overlap
  for (let i = 0; i < files.length; i++) {
    const paragraphsA = extractParagraphs(files[i]!.content);
    for (let j = i + 1; j < files.length; j++) {
      const paragraphsB = extractParagraphs(files[j]!.content);

      for (const paraA of paragraphsA) {
        for (const paraB of paragraphsB) {
          if (similarity(paraA.normalized, paraB.normalized) > 0.85) {
            findings.push({
              ruleId: 'TE006',
              dimension: 'token-efficiency',
              severity: 'high',
              confidence: 'high',
              message: `Near-duplicate content found across files (wastes tokens when both are loaded).`,
              file: files[i]!.relativePath,
              line: paraA.line,
              evidence: paraA.text.slice(0, 80) + '...',
              suggestion: `Also in ${files[j]!.relativePath}:${paraB.line}. Deduplicate to a single location based on precedence rules.`,
              tokenImpact: countTokens(paraA.text),
            });
          }
        }
      }
    }
  }

  return findings;
}

function extractParagraphs(content: string): Array<{ text: string; normalized: string; line: number }> {
  const blocks: Array<{ text: string; normalized: string; line: number }> = [];
  const lines = content.split('\n');
  let current: string[] = [];
  let startLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === '') {
      if (current.length >= 3) {
        const text = current.join('\n');
        blocks.push({
          text,
          normalized: text.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' '),
          line: startLine + 1,
        });
      }
      current = [];
      startLine = i + 1;
    } else {
      current.push(line);
    }
  }

  if (current.length >= 3) {
    const text = current.join('\n');
    blocks.push({
      text,
      normalized: text.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' '),
      line: startLine + 1,
    });
  }

  return blocks;
}

// Simple Jaccard similarity on word sets
function similarity(a: string, b: string): number {
  const wordsA = new Set(a.split(' ').filter(w => w.length > 3));
  const wordsB = new Set(b.split(' ').filter(w => w.length > 3));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) intersection++;
  }
  return intersection / Math.max(wordsA.size, wordsB.size);
}
