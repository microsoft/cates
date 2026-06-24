// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import type { OptimizerSafety } from './types.js';
import { GENERIC_FILLER_PATTERNS } from '../analyzers/token-efficiency.js';

/**
 * Lossless primitive optimizers.
 *
 * Each optimizer is a PURE function `string -> { content, changes }` that only
 * removes mechanically-redundant or no-op bytes. Together they back the
 * "100% no loss of function" guarantee: the set of meaningful instructions a
 * model receives is unchanged — only blank lines, exact duplicates, and
 * platform-default filler are stripped. The orchestrator independently verifies
 * this with {@link meaningfulSignature} before writing anything to disk.
 */

export interface OptimizerEdit {
  description: string;
  /** 1-based line in the input content the edit relates to (best-effort). */
  line?: number;
}

export interface OptimizerOutput {
  content: string;
  edits: OptimizerEdit[];
}

export interface Optimizer {
  id: string;
  title: string;
  ruleIds: string[];
  safety: OptimizerSafety;
  description: string;
  defaultOn: boolean;
  apply(content: string): OptimizerOutput;
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

// Hot regexes are hoisted to module scope so they are compiled once rather than
// re-created on every per-line call across large files.
const HEADING_RE = /^#{1,6}\s/;
const TABLE_ROW_RE = /^\|/;
const PROSE_EXT_RE = /\.(md|mdc|markdown|txt)$/i;
const PROSE_RULES_RE = /(^|\/)\.(cursorrules|windsurfrules|clinerules)$/i;
const NON_ALNUM_SPACE_RE = /[^a-z0-9\s]/g; // used only in .replace() (stateless)
const WS_RUN_RE = /\s+/g;
const ALNUM_ONLY_RE = /[^a-z0-9]/gi; // .replace() only — safe to share despite /g
const LIST_MARKER_RE = /^[-*+]\s+/;
const BLOCKQUOTE_RE = /^>\s+/;
const ORDERED_MARKER_RE = /^\d+[.)]\s+/;
const BOLD_WRAP_RE = /^\*\*|\*\*$/g;

/**
 * Marks every line that is inside a fenced code block (``` or ~~~), including
 * the fence delimiter lines themselves. Protected lines are NEVER modified, so
 * code examples keep byte-for-byte fidelity (whitespace can be significant).
 */
function protectedMask(lines: string[]): boolean[] {
  const mask = new Array<boolean>(lines.length).fill(false);
  let inCode = false;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trimStart();
    const isFence = trimmed.startsWith('```') || trimmed.startsWith('~~~');
    if (isFence) {
      mask[i] = true;
      inCode = !inCode;
      continue;
    }
    mask[i] = inCode;
  }
  return mask;
}

function isHeading(line: string): boolean {
  return HEADING_RE.test(line.trimStart());
}

/** Markdown table rows carry positional data; never treat them as duplicates. */
function isTableRow(line: string): boolean {
  return TABLE_ROW_RE.test(line.trimStart());
}

/**
 * Whether a primitive is free-form prose (Markdown/text/rules) as opposed to a
 * structured config (JSON/YAML/shell). The content-removing optimizers ONLY run
 * on prose: in structured files an identical line (e.g. `"type": "string",`) is
 * usually structurally significant, so removing a "duplicate" would change
 * meaning — which the signature check cannot detect. Structured primitives are
 * therefore left untouched, preserving the no-loss guarantee.
 */
export function isProseFile(relativePath: string): boolean {
  return PROSE_EXT_RE.test(relativePath) || PROSE_RULES_RE.test(relativePath);
}

/** Analyzer-parity normalization used by TE007 duplicate detection. */
function normalizeForDedupe(line: string): string {
  return line.trim().toLowerCase().replace(NON_ALNUM_SPACE_RE, '');
}

/** Collapses a line to its meaningful instruction signature (order-insensitive). */
export function normLine(line: string): string {
  return line.trim().toLowerCase().replace(NON_ALNUM_SPACE_RE, '').replace(WS_RUN_RE, ' ').trim();
}

function truncate(text: string, max = 72): string {
  const t = text.replace(WS_RUN_RE, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * Decides whether a line is ENTIRELY platform-default filler (TE003) and may be
 * dropped without changing agent behavior. A line that merely *contains* a
 * filler phrase inside a larger, substantive instruction is kept.
 */
function standaloneFiller(line: string): { match: boolean; label: string } {
  const trimmed = line.trim();
  if (trimmed === '') return { match: false, label: '' };
  const core = trimmed
    .replace(LIST_MARKER_RE, '')
    .replace(BLOCKQUOTE_RE, '')
    .replace(ORDERED_MARKER_RE, '')
    .replace(BOLD_WRAP_RE, '');

  let reduced = core;
  const labels: string[] = [];
  for (const { pattern, label } of GENERIC_FILLER_PATTERNS) {
    if (pattern.test(reduced)) {
      labels.push(label);
      reduced = reduced.replace(pattern, ' ');
    }
  }
  if (labels.length === 0) return { match: false, label: '' };
  const remainder = reduced.replace(ALNUM_ONLY_RE, '');
  // <= 8 leftover alphanumerics ⇒ the line was essentially just filler.
  if (remainder.length <= 8) return { match: true, label: labels.join('; ') };
  return { match: false, label: '' };
}

// ─── Optimizers ──────────────────────────────────────────────────────────────

/** TE007: drop later exact duplicates of a normalized instruction line. */
function optimizeDedupeLines(content: string): OptimizerOutput {
  const lines = content.split('\n');
  const mask = protectedMask(lines);
  const seen = new Set<string>();
  const out: string[] = [];
  const edits: OptimizerEdit[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    if (mask[i] || isHeading(raw) || isTableRow(raw)) {
      out.push(raw);
      continue;
    }
    const normalized = normalizeForDedupe(raw);
    if (normalized.length >= 20) {
      if (seen.has(normalized)) {
        edits.push({ description: `removed duplicate instruction "${truncate(raw)}"`, line: i + 1 });
        continue;
      }
      seen.add(normalized);
    }
    out.push(raw);
  }

  return { content: out.join('\n'), edits };
}

/** Remove later byte-identical multi-line instruction blocks within one file. */
function optimizeDedupeBlocks(content: string): OptimizerOutput {
  const lines = content.split('\n');
  const mask = protectedMask(lines);
  const remove = new Set<number>();
  const seen = new Map<string, number>();
  const edits: OptimizerEdit[] = [];

  let i = 0;
  while (i < lines.length) {
    if (mask[i] || lines[i]!.trim() === '') {
      i++;
      continue;
    }
    const start = i;
    const para: string[] = [];
    while (i < lines.length && !mask[i] && lines[i]!.trim() !== '') {
      para.push(lines[i]!.trim());
      i++;
    }
    if (para.length < 2) continue;
    const key = para.join('\n');
    if (key.replace(ALNUM_ONLY_RE, '').length < 30) continue; // ignore trivial blocks
    const firstLine = seen.get(key);
    if (firstLine !== undefined) {
      for (let k = start; k < start + para.length; k++) remove.add(k);
      edits.push({
        description: `removed duplicate ${para.length}-line block (first seen at line ${firstLine})`,
        line: start + 1,
      });
    } else {
      seen.set(key, start + 1);
    }
  }

  if (remove.size === 0) return { content, edits: [] };
  const out = lines.filter((_, idx) => !remove.has(idx));
  return { content: out.join('\n'), edits };
}

/** TE003: drop standalone platform-default / no-op filler lines. */
function optimizeRemoveFiller(content: string): OptimizerOutput {
  const lines = content.split('\n');
  const mask = protectedMask(lines);
  const out: string[] = [];
  const edits: OptimizerEdit[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    if (mask[i]) {
      out.push(raw);
      continue;
    }
    const filler = standaloneFiller(raw);
    if (filler.match) {
      edits.push({ description: `removed platform-default filler (${filler.label})`, line: i + 1 });
      continue;
    }
    out.push(raw);
  }

  return { content: out.join('\n'), edits };
}

/**
 * Whitespace hygiene: strip trailing whitespace (preserving markdown hard
 * breaks), drop leading blank lines, collapse runs of blank lines to one, and
 * end the file with exactly one newline. Code fences are left untouched.
 */
function optimizeWhitespace(content: string): OptimizerOutput {
  if (content.trim() === '') return { content: '', edits: [] };
  const lines = content.split('\n');
  const mask = protectedMask(lines);
  const out: string[] = [];
  const edits: OptimizerEdit[] = [];
  let trailingStripped = 0;
  let blanksCollapsed = 0;
  let lastBlank = false;
  let seenContent = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    if (mask[i]) {
      out.push(raw);
      lastBlank = false;
      seenContent = true;
      continue;
    }
    if (raw.trim() === '') {
      if (!seenContent || lastBlank) {
        blanksCollapsed++;
        continue;
      }
      out.push('');
      lastBlank = true;
      continue;
    }
    const contentPart = raw.replace(/\s+$/, '');
    const trailing = raw.slice(contentPart.length);
    const normalized = /^ {2,}$/.test(trailing) ? `${contentPart}  ` : contentPart;
    if (normalized !== raw) trailingStripped++;
    out.push(normalized);
    lastBlank = false;
    seenContent = true;
  }

  // Drop trailing blank lines, then re-add a single terminating newline.
  while (out.length > 0 && out[out.length - 1] === '') {
    out.pop();
    blanksCollapsed++;
  }

  if (trailingStripped > 0) {
    edits.push({ description: `stripped trailing whitespace on ${trailingStripped} line(s)` });
  }
  if (blanksCollapsed > 0) {
    edits.push({ description: `collapsed ${blanksCollapsed} redundant blank line(s)` });
  }

  const result = out.length === 0 ? '' : `${out.join('\n')}\n`;
  return { content: result, edits };
}

// ─── Registry ────────────────────────────────────────────────────────────────

/**
 * Run order matters only for change attribution (all are lossless). Whitespace
 * runs LAST so it cleans up blank lines left behind by the removal optimizers.
 */
export const OPTIMIZERS: Optimizer[] = [
  {
    id: 'dedupe-lines',
    title: 'Remove duplicate instruction lines',
    ruleIds: ['TE007'],
    safety: 'lossless',
    defaultOn: true,
    description:
      'Removes later exact duplicates of a normalized instruction line, keeping the first. The instruction still appears once, so behavior is unchanged.',
    apply: optimizeDedupeLines,
  },
  {
    id: 'dedupe-blocks',
    title: 'Remove duplicate instruction blocks',
    ruleIds: ['TE007'],
    safety: 'lossless',
    defaultOn: true,
    description:
      'Removes later byte-identical multi-line instruction blocks within a file. The block remains in its first location.',
    apply: optimizeDedupeBlocks,
  },
  {
    id: 'remove-filler',
    title: 'Remove platform-default filler',
    ruleIds: ['TE003'],
    safety: 'lossless',
    defaultOn: true,
    description:
      'Removes standalone lines that only restate model-default behavior (e.g. "You are a helpful assistant"). The model already does these, so removing them changes nothing.',
    apply: optimizeRemoveFiller,
  },
  {
    id: 'whitespace',
    title: 'Normalize whitespace',
    ruleIds: [],
    safety: 'lossless',
    defaultOn: true,
    description:
      'Strips trailing whitespace (preserving markdown hard breaks), collapses runs of blank lines, and ensures a single trailing newline. Code fences are untouched.',
    apply: optimizeWhitespace,
  },
];

export function selectOptimizers(only?: string[], skip?: string[]): Optimizer[] {
  const known = new Set(OPTIMIZERS.map(o => o.id));
  for (const id of [...(only ?? []), ...(skip ?? [])]) {
    if (!known.has(id)) {
      throw new Error(`Unknown optimizer "${id}". Known optimizers: ${[...known].join(', ')}.`);
    }
  }
  let chosen = only && only.length > 0
    ? OPTIMIZERS.filter(o => only.includes(o.id))
    : OPTIMIZERS.filter(o => o.defaultOn);
  if (skip && skip.length > 0) {
    chosen = chosen.filter(o => !skip.includes(o.id));
  }
  return chosen;
}

/**
 * The deterministic "no loss of function" signature of a primitive: the set of
 * its meaningful, non-filler instruction lines plus all code verbatim. Two
 * contents with the same signature deliver the same instructions to a model.
 * The orchestrator asserts signature(original) === signature(optimized).
 */
export function meaningfulSignature(content: string): string {
  const lines = content.split('\n');
  const mask = protectedMask(lines);
  const entries = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    if (mask[i]) {
      entries.add(`CODE:${raw}`);
      continue;
    }
    if (raw.trim() === '') continue;
    if (standaloneFiller(raw).match) continue;
    const norm = normLine(raw);
    entries.add(norm === '' ? `RAW:${raw.trim()}` : `N:${norm}`);
  }
  return [...entries].sort().join('\n');
}
