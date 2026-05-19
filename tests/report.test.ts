import { describe, it, expect } from 'vitest';
import { createReport } from '../src/scoring/report.js';
import type { AnalysisResult, Finding, Recommendation } from '../src/types.js';

function syntheticResult(opts: { findings?: Finding[]; recs?: Recommendation[]; grade?: AnalysisResult['score']['grade'] } = {}): AnalysisResult {
  return {
    repoPath: '/tmp/cates-report-test',
    timestamp: '2026-01-02T03:04:05.000Z',
    discovery: {
      files: [
        {
          path: '/tmp/cates-report-test/.github/copilot-instructions.md',
          relativePath: '.github/copilot-instructions.md',
          type: 'root-instructions',
          scope: 'always-loaded',
          sizeBytes: 200,
          tokenCount: 80,
          isActive: true,
        },
      ],
      totalTokens: 80,
      alwaysLoadedTokens: 80,
      activeFileCount: 1,
      skippedFiles: [],
      filesScanned: 1,
      conditionalTokens: 0,
      deadFileTokens: 0,
      tokenizer: 'openai-cl100k',
    } as unknown as AnalysisResult['discovery'],
    score: {
      overall: 88,
      grade: opts.grade ?? 'B',
      dimensions: [
        { dimension: 'token-efficiency', score: 90, weight: 0.25, findings: [], deductions: [], summary: '' },
        { dimension: 'security', score: 95, weight: 0.25, findings: [], deductions: [], summary: '' },
      ],
      totalFindings: (opts.findings ?? []).length,
      criticalCount: (opts.findings ?? []).filter(f => f.severity === 'critical').length,
      estimatedTokenWaste: 0,
      estimatedTokenSavingsPercentage: 0,
      findingsPerThousandTokens: 0,
    },
    savings: { conservativeTokensPerInvocation: 0, conservativePercentage: 0, projectedTokensPerInvocation: 0, projectedPercentage: 0 },
    findings: opts.findings ?? [],
    suppressedFindings: [],
    suppressionSummary: { active: 0, expired: 0, suppressedFindings: 0 },
    recommendations: opts.recs ?? [],
  };
}

const sampleFinding: Finding = {
  ruleId: 'SEC001',
  dimension: 'security',
  severity: 'critical',
  confidence: 'certain',
  message: 'Hardcoded secret detected',
  file: '.github/copilot-instructions.md',
  line: 3,
  suggestion: 'Move to env vars',
  tokenImpact: 25,
  evidence: 'api_key = "redacted"',
};

describe('createReport', () => {
  describe('json', () => {
    it('returns valid JSON matching AnalysisResult shape', () => {
      const text = createReport(syntheticResult({ findings: [sampleFinding] }), 'json');
      const parsed = JSON.parse(text);
      expect(parsed.repoPath).toBe('/tmp/cates-report-test');
      expect(parsed.score.overall).toBe(88);
      expect(parsed.findings).toHaveLength(1);
      expect(parsed.findings[0].ruleId).toBe('SEC001');
    });
  });

  describe('sarif', () => {
    it('matches minimal SARIF v2.1.0 shape', () => {
      const text = createReport(syntheticResult({ findings: [sampleFinding] }), 'sarif');
      const parsed = JSON.parse(text);
      expect(parsed.version).toBe('2.1.0');
      expect(parsed.$schema).toMatch(/sarif-schema-2\.1\.0\.json$/);
      expect(parsed.runs).toHaveLength(1);
      expect(parsed.runs[0].tool.driver.name).toBe('cates-analyzer');
      expect(parsed.runs[0].results).toHaveLength(1);
      const r = parsed.runs[0].results[0];
      expect(r.ruleId).toBe('SEC001');
      expect(r.level).toBe('error');
      expect(r.locations[0].physicalLocation.artifactLocation.uri).toBe('.github/copilot-instructions.md');
      expect(r.locations[0].physicalLocation.region.startLine).toBe(3);
    });

    it('emits one rule definition per unique ruleId', () => {
      const text = createReport(
        syntheticResult({
          findings: [
            sampleFinding,
            { ...sampleFinding, file: 'other.md', line: 1 },
            { ...sampleFinding, ruleId: 'TE004', severity: 'high', message: 'verbose' },
          ],
        }),
        'sarif',
      );
      const parsed = JSON.parse(text);
      const ruleIds = parsed.runs[0].tool.driver.rules.map((r: { id: string }) => r.id);
      expect(new Set(ruleIds)).toEqual(new Set(['SEC001', 'TE004']));
    });

    it('maps severities to SARIF levels', () => {
      const text = createReport(
        syntheticResult({
          findings: [
            { ...sampleFinding, severity: 'critical' },
            { ...sampleFinding, ruleId: 'TE004', severity: 'medium' },
            { ...sampleFinding, ruleId: 'SPC003', severity: 'low' },
          ],
        }),
        'sarif',
      );
      const parsed = JSON.parse(text);
      const levels = parsed.runs[0].results.map((r: { level: string }) => r.level);
      expect(levels).toEqual(['error', 'warning', 'note']);
    });
  });

  describe('pretty', () => {
    it('renders the header, score, and a finding row', () => {
      const text = createReport(syntheticResult({ findings: [sampleFinding] }), 'pretty');
      expect(text).toContain('CATES CONFIGURATION ANALYZER');
      expect(text).toContain('Overall Score: 88/100');
      expect(text).toContain('SEC001');
    });

    it('falls back to pretty for an unknown format string', () => {
      const text = createReport(syntheticResult(), 'unknown' as unknown as 'pretty');
      expect(text).toContain('CATES CONFIGURATION ANALYZER');
    });

    it('mentions suppressions when present', () => {
      const r = syntheticResult();
      r.suppressionSummary = { active: 1, expired: 2, suppressedFindings: 3 };
      const text = createReport(r, 'pretty');
      expect(text).toMatch(/Suppressions: 3 finding\(s\) hidden, 2 expired/);
    });
  });
});
