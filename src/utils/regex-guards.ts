/**
 * ReDoS mitigation helpers.
 *
 * Most CATES analyzers run regular expressions against individual lines of
 * configuration files. Even though files are already size-capped at 100KB by
 * discovery, a single pathological line (e.g. a minified JSON blob) could
 * still feed a 100KB string into a backtracking regex.
 *
 * `MAX_SCAN_LINE_BYTES` caps the longest line any analyzer will run a regex
 * against. Lines longer than this are skipped — they are practically never
 * meaningful in human-readable agent configuration, but trivially exploitable
 * by an adversarial paste against the hosted service.
 */
export const MAX_SCAN_LINE_BYTES = 4096;

/**
 * True when a line is short enough to safely run analyzer regex against.
 * Use as the first guard in per-line loops.
 */
export function isScannableLine(line: string): boolean {
  return line.length <= MAX_SCAN_LINE_BYTES;
}
