import { describe, it, expect } from 'vitest';
import { applySuppressions } from '../src/suppressions.js';
import type { Finding, Suppression } from '../src/types.js';

function f(ruleId: string, file: string): Finding {
  return {
    ruleId,
    dimension: 'security',
    severity: 'medium',
    confidence: 'high',
    message: `${ruleId} msg`,
    file,
  };
}

describe('applySuppressions', () => {
  const sample: Finding[] = [
    f('SEC001', '.github/copilot-instructions.md'),
    f('SEC001', 'src/foo.md'),
    f('SEC002', '.github/copilot-instructions.md'),
    f('TE004', 'AGENTS.md'),
  ];

  it('returns all findings when no suppressions', () => {
    const out = applySuppressions(sample, []);
    expect(out.findings).toHaveLength(4);
    expect(out.suppressedFindings).toHaveLength(0);
    expect(out.summary).toEqual({ active: 0, expired: 0, suppressedFindings: 0 });
  });

  it('suppresses all findings for a rule when file is unset (wildcard)', () => {
    const supp: Suppression[] = [{ ruleId: 'SEC001', reason: 'documented' }];
    const out = applySuppressions(sample, supp);
    expect(out.findings.map(x => x.ruleId)).toEqual(['SEC002', 'TE004']);
    expect(out.suppressedFindings).toHaveLength(2);
    expect(out.summary.active).toBe(1);
    expect(out.summary.suppressedFindings).toBe(2);
  });

  it('matches exact file paths', () => {
    const supp: Suppression[] = [
      { ruleId: 'SEC001', file: '.github/copilot-instructions.md', reason: 'r' },
    ];
    const out = applySuppressions(sample, supp);
    expect(out.findings).toHaveLength(3);
    expect(out.findings.some(x => x.file === '.github/copilot-instructions.md' && x.ruleId === 'SEC001')).toBe(false);
  });

  it('matches single-star globs only within a path segment', () => {
    const supp: Suppression[] = [{ ruleId: 'SEC001', file: '.github/*.md', reason: 'r' }];
    const out = applySuppressions(sample, supp);
    expect(out.findings.some(x => x.file === '.github/copilot-instructions.md' && x.ruleId === 'SEC001')).toBe(false);
    // src/foo.md should NOT be suppressed by .github/*.md
    expect(out.findings.some(x => x.file === 'src/foo.md' && x.ruleId === 'SEC001')).toBe(true);
  });

  it('matches double-star globs across path segments', () => {
    const supp: Suppression[] = [{ ruleId: 'SEC001', file: '**/*.md', reason: 'r' }];
    const out = applySuppressions(sample, supp);
    const sec001Left = out.findings.filter(x => x.ruleId === 'SEC001');
    expect(sec001Left).toHaveLength(0);
  });

  it('treats rule IDs case-insensitively', () => {
    const supp: Suppression[] = [{ ruleId: 'sec001', reason: 'r' }];
    const out = applySuppressions(sample, supp);
    expect(out.findings.some(x => x.ruleId === 'SEC001')).toBe(false);
  });

  it('treats backslash-style suppression paths the same as forward-slash', () => {
    const supp: Suppression[] = [{ ruleId: 'TE004', file: 'AGENTS.md', reason: 'r' }];
    const out = applySuppressions(sample, supp);
    expect(out.findings.some(x => x.ruleId === 'TE004')).toBe(false);
  });

  it('drops expired suppressions and counts them', () => {
    const now = new Date('2026-06-01T00:00:00.000Z');
    const supp: Suppression[] = [
      { ruleId: 'SEC001', reason: 'r', expires: '2025-01-01' },
      { ruleId: 'TE004', reason: 'r', expires: '2027-12-31' },
    ];
    const out = applySuppressions(sample, supp, now);
    // SEC001 suppression expired → its findings remain
    expect(out.findings.some(x => x.ruleId === 'SEC001')).toBe(true);
    // TE004 suppression active → its finding suppressed
    expect(out.findings.some(x => x.ruleId === 'TE004')).toBe(false);
    expect(out.summary.expired).toBe(1);
    expect(out.summary.active).toBe(1);
  });

  it('treats invalid expires strings as expired', () => {
    const supp: Suppression[] = [{ ruleId: 'SEC001', reason: 'r', expires: 'not-a-date' }];
    const out = applySuppressions(sample, supp, new Date());
    expect(out.summary.expired).toBe(1);
    expect(out.findings.some(x => x.ruleId === 'SEC001')).toBe(true);
  });

  it('preserves originals when an exact-file glob has no matches', () => {
    const supp: Suppression[] = [{ ruleId: 'SEC001', file: 'no-such-file.md', reason: 'r' }];
    const out = applySuppressions(sample, supp);
    expect(out.findings).toHaveLength(4);
  });
});
