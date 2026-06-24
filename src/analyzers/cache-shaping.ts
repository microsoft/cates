// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import type { ConfigScope, ExperimentalFinding } from '../types.js';
import { countTokens } from '../utils/tokenizer.js';

/**
 * EXPERIMENTAL — Cache-Shaping detectors (CS0xx). Non-normative, zero scoring
 * weight. See docs/EXPERIMENTAL-CACHE-OUTPUT-DIMENSIONS.md.
 *
 * Static config smells that predict poor prompt-cache economics: volatile tokens
 * in the cacheable prefix, dynamic-before-static ordering, live-state directives,
 * unstable ordering, and fragmented preambles. All detection is deterministic
 * and operates on config at rest — no runtime cache-hit measurement.
 */

export interface CacheFile {
  relativePath: string;
  content: string;
  scope: ConfigScope;
}

const VOLATILE_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\b(current|today'?s)\s+(date|time|datetime|timestamp)\b/i, label: 'current date/time directive' },
  { re: /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?/, label: 'embedded ISO timestamp' },
  { re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i, label: 'embedded UUID' },
  { re: /\bcommit\s+[0-9a-f]{7,40}\b/i, label: 'embedded git commit SHA' },
  { re: /\b[0-9a-f]{40}\b/, label: 'embedded git SHA' },
  { re: /\bbuild\s*#?\s*\d{2,}/i, label: 'embedded build number' },
];

const LIVE_STATE_RE = /\b(always |please )?(include|inject|embed|prepend|add)\b[^.\n]*\b(current git status|latest logs?|recent commits?|current time|today'?s date|live (state|data|output)|uptime|now\(\))/i;
const UNSTABLE_ORDER_RE = /\b(randomi[sz]e|shuffle|re-?sort|reorder|rotate)\b[^.\n]*\b(tools?|context|retrieved|results?|order)/i;
const PLACEHOLDER_RE = /(\$\{[^}]+\}|\{\{[^}]+\}\}|@(?:import|include)\b|@[\w./-]+\.(?:md|markdown|txt))/;

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

export function detectCacheShaping(files: CacheFile[]): ExperimentalFinding[] {
  const findings: ExperimentalFinding[] = [];

  for (const file of files) {
    const lines = file.content.split('\n');
    const mask = fenceMask(lines);

    // CS001 — only the always-loaded prefix is the high-value cache target.
    if (file.scope === 'always-loaded') {
      for (let i = 0; i < lines.length; i++) {
        if (mask[i]) continue;
        const hit = VOLATILE_PATTERNS.find(p => p.re.test(lines[i]!));
        if (hit) {
          findings.push(mk('CS001', 'high', 'high', file.relativePath, i + 1,
            `Volatile token in always-loaded config (${hit.label}) busts the cacheable prefix on every call.`,
            'Move volatile values out of the always-loaded prefix; supply them via tool inputs at the end of context.',
            lines[i]!.trim().slice(0, 80), countTokens(file.content), 'cached-input'));
          break; // one per file is enough signal
        }
      }
    }

    // CS003 — live/volatile state pulled into the preamble.
    for (let i = 0; i < lines.length; i++) {
      if (mask[i]) continue;
      if (LIVE_STATE_RE.test(lines[i]!)) {
        findings.push(mk('CS003', 'medium', 'medium', file.relativePath, i + 1,
          'Non-deterministic context directive injects live/volatile state into the preamble, reducing cache reuse.',
          'Fetch volatile state on-demand via tools instead of embedding it in always-loaded instructions.',
          lines[i]!.trim().slice(0, 80), countTokens(file.content), 'cached-input'));
        break;
      }
    }

    // CS004 — directives that re-order tools/context per call.
    for (let i = 0; i < lines.length; i++) {
      if (mask[i]) continue;
      if (UNSTABLE_ORDER_RE.test(lines[i]!)) {
        findings.push(mk('CS004', 'low', 'medium', file.relativePath, i + 1,
          'Unstable tool/context ordering directive changes the prefix between calls, defeating the cache.',
          'Keep tool and context ordering stable and deterministic across calls.',
          lines[i]!.trim().slice(0, 80), 0, 'cached-input'));
        break;
      }
    }

    // CS002 — variable placeholder ahead of a large static block.
    const cs002 = detectDynamicBeforeStatic(file, lines, mask);
    if (cs002) findings.push(cs002);
  }

  // CS005 — fragmented preamble shared across files (cross-file).
  const cs005 = detectFragmentedPreamble(files);
  if (cs005) findings.push(cs005);

  return findings;
}

function detectDynamicBeforeStatic(file: CacheFile, lines: string[], mask: boolean[]): ExperimentalFinding | undefined {
  let placeholderLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (mask[i]) continue;
    if (PLACEHOLDER_RE.test(lines[i]!)) {
      placeholderLine = i;
      break;
    }
  }
  if (placeholderLine < 0) return undefined;

  const staticAfter = lines.slice(placeholderLine + 1).join('\n');
  const staticTokens = countTokens(staticAfter);
  // Only flag when a substantial static block sits AFTER the first placeholder
  // and the placeholder is near the top — that static block can't be cached.
  if (staticTokens < 200 || placeholderLine > lines.length * 0.5) return undefined;

  return mk('CS002', 'medium', 'medium', file.relativePath, placeholderLine + 1,
    `Dynamic-before-static ordering: a variable placeholder precedes ~${staticTokens} tokens of static content, shrinking the cacheable prefix.`,
    'Put stable, static content first; move variable/dynamic content to the end.',
    lines[placeholderLine]!.trim().slice(0, 80), staticTokens, 'cached-input');
}

function detectFragmentedPreamble(files: CacheFile[]): ExperimentalFinding | undefined {
  const preambles = new Map<string, string[]>(); // normalized preamble -> files
  for (const file of files) {
    const preamble = file.content
      .split('\n')
      .filter(l => l.trim() !== '' && !l.trim().startsWith('#'))
      .slice(0, 3)
      .join(' ')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (preamble.length < 40) continue;
    const list = preambles.get(preamble) ?? [];
    list.push(file.relativePath);
    preambles.set(preamble, list);
  }
  for (const [, sharing] of preambles) {
    if (sharing.length >= 2) {
      return mk('CS005', 'info', 'medium', sharing[0]!, undefined,
        `Fragmented preamble: ${sharing.length} files repeat a near-identical preamble that could be one shared, cacheable prelude (also see TE006).`,
        'Hoist the shared preamble into a single, stable, precedence-appropriate prelude.',
        sharing.join(', ').slice(0, 80), 0, 'cached-input');
    }
  }
  return undefined;
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
  tokenClass: 'cached-input' | 'output',
): ExperimentalFinding {
  return {
    ruleId,
    dimension: 'cache-shaping',
    stability: 'experimental',
    severity,
    confidence,
    message,
    file,
    ...(line !== undefined ? { line } : {}),
    ...(evidence ? { evidence } : {}),
    suggestion,
    tokenImpact,
    tokenClass,
  };
}
