import type { Finding, Suppression, SuppressionSummary } from './types.js';

export interface SuppressionResult {
  findings: Finding[];
  suppressedFindings: Finding[];
  summary: SuppressionSummary;
}

export function applySuppressions(findings: Finding[], suppressions: Suppression[], now = new Date()): SuppressionResult {
  const activeSuppressions = suppressions.filter(suppression => !isExpired(suppression, now));
  const expired = suppressions.length - activeSuppressions.length;
  const remaining: Finding[] = [];
  const suppressedFindings: Finding[] = [];

  for (const finding of findings) {
    if (activeSuppressions.some(suppression => matchesSuppression(finding, suppression))) {
      suppressedFindings.push(finding);
    } else {
      remaining.push(finding);
    }
  }

  return {
    findings: remaining,
    suppressedFindings,
    summary: {
      active: activeSuppressions.length,
      expired,
      suppressedFindings: suppressedFindings.length,
    },
  };
}

function matchesSuppression(finding: Finding, suppression: Suppression): boolean {
  if (suppression.ruleId.toUpperCase() !== finding.ruleId.toUpperCase()) return false;
  if (!suppression.file) return true;
  return filePatternMatches(finding.file, suppression.file);
}

function isExpired(suppression: Suppression, now: Date): boolean {
  if (!suppression.expires) return false;
  const expiresAt = new Date(`${suppression.expires}T23:59:59.999Z`);
  return Number.isNaN(expiresAt.getTime()) || expiresAt < now;
}

function filePatternMatches(file: string, pattern: string): boolean {
  const normalizedFile = normalizePath(file);
  const normalizedPattern = normalizePath(pattern);
  if (normalizedPattern === normalizedFile) return true;
  if (!normalizedPattern.includes('*')) return false;

  const escaped = normalizedPattern
    .replace(/\*\*/g, '\0')
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^/]*')
    .replace(/\0/g, '.*');
  return new RegExp(`^${escaped}$`).test(normalizedFile);
}

function normalizePath(path: string): string {
  return path.split('\\').join('/').replace(/^\.\//, '');
}
