// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import type { ConfigType, ExperimentalFinding } from '../types.js';
import { countTokens } from '../utils/tokenizer.js';

/**
 * EXPERIMENTAL — Output-Shaping detectors (OS0xx). Non-normative, zero scoring
 * weight. See docs/EXPERIMENTAL-CACHE-OUTPUT-DIMENSIONS.md.
 *
 * These static detectors flag possible output inflation: no output contract, full-file-rewrite
 * mandates, unconditional verbose reasoning, echo/restatement, verbose formats.
 * Per-response token estimates are advisory only.
 */

export interface OutputFile {
  relativePath: string;
  content: string;
  type: ConfigType;
}

const INSTRUCTION_TYPES = new Set<ConfigType>([
  'root-instructions',
  'agents-md',
  'path-instructions',
  'chat-mode',
  'agent-definition',
  'rules-config',
]);

// Any of these counts as the config bounding its output.
const OUTPUT_CONTRACT_RE = /\b(be concise|keep it (short|brief|concise)|code only|no preamble|no prose|without (explanation|preamble)|max(imum)?\s+\d+\s+(words?|lines?|tokens?|characters?)|output format|respond with only|return only|terse|one[- ]line)\b/i;

const FULL_FILE_RE = /\b(return|output|provide|give|emit|print|write out|reply with|respond with)\b[^.\n]*\b(the\s+)?(complete|entire|whole|full)\s+(file|contents?|source)\b/i;
const VERBOSE_REASON_RE = /\b(always|on every (response|answer|reply)|for (every|each) (response|answer))\b[^.\n]*\b(explain|reasoning|step[- ]by[- ]step|chain[- ]of[- ]thought|think (through|out loud))/i;
const VERBOSE_REASON_ALT_RE = /\b(explain your (full |complete )?reasoning|think step[- ]by[- ]step|show your (work|reasoning)|walk (me )?through your thinking)\b[^.\n]*\b(every|always|each time)?/i;
const ECHO_RE = /\b(restate|echo|repeat back|repeat the|reiterate|quote back|summari[sz]e the (prompt|request|question))\b[^.\n]*\b(prompt|question|input|request|task|instructions?|context)?/i;
const VERBOSE_FORMAT_RE = /\b(always )?(use|include|provide|format (as|with))\b[^.\n]*\b(detailed table|full table|comprehensive (summary|report|breakdown)|decorative|section headers for (every|each)|elaborate formatting)\b/i;

function fenceMask(lines: string[]): boolean[] {
  const mask = new Array<boolean>(lines.length).fill(false);
  let inCode = false;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]!.trimStart();
    if (t.startsWith('```') || t.startsWith('~~~')) {
      mask[i] = true;
      inCode = !inCode;
      continue;
    }
    mask[i] = inCode;
  }
  return mask;
}

export function detectOutputShaping(files: OutputFile[]): ExperimentalFinding[] {
  const findings: ExperimentalFinding[] = [];

  for (const file of files) {
    const lines = file.content.split('\n');
    const mask = fenceMask(lines);
    const fileTokens = countTokens(file.content);

    // OS001 — substantial instruction file that never bounds output at all.
    if (INSTRUCTION_TYPES.has(file.type) && fileTokens >= 150 && !OUTPUT_CONTRACT_RE.test(file.content)) {
      findings.push(mk('OS001', 'medium', 'medium', file.relativePath, undefined,
        'No recognized output contract found; review whether output expectations are sufficiently clear for this workflow.',
        'Define task-appropriate output expectations and verify that concision does not reduce correctness or require retries.',
        '', 300));
    }

    const firstMatch = (re: RegExp): number => {
      for (let i = 0; i < lines.length; i++) {
        if (mask[i]) continue;
        if (re.test(lines[i]!)) return i;
      }
      return -1;
    };

    // OS002 — full-file rewrite mandate.
    const os002 = firstMatch(FULL_FILE_RE);
    if (os002 >= 0) {
      findings.push(mk('OS002', 'high', 'medium', file.relativePath, os002 + 1,
        'Full-file output directive may generate more tokens than targeted edits when the workflow supports patches.',
        'Prefer diffs/patches or targeted edits; reserve full-file output for newly created files.',
        lines[os002]!.trim().slice(0, 80), 1000));
    }

    // OS003 — unconditional verbose reasoning.
    const os003 = firstMatch(VERBOSE_REASON_RE);
    const os003alt = os003 < 0 ? firstMatch(VERBOSE_REASON_ALT_RE) : -1;
    const os003line = os003 >= 0 ? os003 : os003alt;
    if (os003line >= 0) {
      findings.push(mk('OS003', 'medium', 'medium', file.relativePath, os003line + 1,
        'Verbose explanation directive may increase output; static wording does not measure hidden reasoning or actual response length.',
        'Make explanation depth task-appropriate and evaluate quality, output usage, and retries before claiming savings.',
        lines[os003line]!.trim().slice(0, 80), 400));
    }

    // OS004 — echo / restatement.
    const os004 = firstMatch(ECHO_RE);
    if (os004 >= 0) {
      findings.push(mk('OS004', 'low', 'low', file.relativePath, os004 + 1,
        'Echo/restatement directive may add unnecessary output when confirmation is not needed.',
        'Keep confirmation where it prevents mistakes; remove redundant restatement only after reviewing the workflow.',
        lines[os004]!.trim().slice(0, 80), 150));
    }

    // OS005 — verbose format mandate.
    const os005 = firstMatch(VERBOSE_FORMAT_RE);
    if (os005 >= 0) {
      findings.push(mk('OS005', 'info', 'low', file.relativePath, os005 + 1,
        'Verbose format mandate requires heavyweight formatting on every response where compact output would suffice.',
        'Default to compact output; reserve rich formatting for when it is explicitly requested.',
        lines[os005]!.trim().slice(0, 80), 100));
    }
  }

  return findings;
}

function mk(
  ruleId: string,
  severity: ExperimentalFinding['severity'],
  confidence: ExperimentalFinding['confidence'],
  file: string,
  line: number | undefined,
  message: string,
  suggestion: string,
  evidence: string,
  tokenImpact: number,
): ExperimentalFinding {
  return {
    ruleId,
    dimension: 'output-shaping',
    stability: 'experimental',
    severity,
    confidence,
    message,
    file,
    ...(line !== undefined ? { line } : {}),
    ...(evidence ? { evidence } : {}),
    suggestion,
    tokenImpact,
    tokenClass: 'output',
  };
}
