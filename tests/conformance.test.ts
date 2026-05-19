import { describe, it, expect } from 'vitest';
import { evaluateConformance, evaluateGates } from '../src/conformance.js';
import type { AnalysisResult, Finding, Severity, DiscoveryResult } from '../src/types.js';

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    ruleId: overrides.ruleId ?? 'TE001',
    dimension: overrides.dimension ?? 'token-efficiency',
    severity: overrides.severity ?? 'medium',
    confidence: overrides.confidence ?? 'high',
    message: overrides.message ?? 'msg',
    file: overrides.file ?? 'a.md',
    ...overrides,
  };
}

function discovery(overrides: Partial<DiscoveryResult> = {}): DiscoveryResult {
  return {
    files: overrides.files ?? [
      {
        path: '/tmp/a.md',
        relativePath: 'a.md',
        type: 'root-instructions',
        scope: 'always-loaded',
        sizeBytes: 100,
        tokenCount: 50,
        isActive: true,
      },
    ],
    totalTokens: overrides.totalTokens ?? 50,
    alwaysLoadedTokens: overrides.alwaysLoadedTokens ?? 100,
    activeFileCount: overrides.activeFileCount ?? 1,
    skippedFiles: overrides.skippedFiles ?? [],
    filesScanned: overrides.filesScanned ?? 1,
    tokenComparison: overrides.tokenComparison,
  } as DiscoveryResult;
}

function result(opts: {
  score?: number;
  grade?: AnalysisResult['score']['grade'];
  criticalCount?: number;
  findings?: Finding[];
  alwaysLoadedTokens?: number;
  files?: DiscoveryResult['files'];
} = {}): AnalysisResult {
  return {
    repoPath: '/tmp/test',
    timestamp: new Date().toISOString(),
    discovery: discovery({
      alwaysLoadedTokens: opts.alwaysLoadedTokens ?? 100,
      files: opts.files,
    }),
    score: {
      overall: opts.score ?? 95,
      grade: opts.grade ?? 'A',
      dimensions: [],
      totalFindings: (opts.findings ?? []).length,
      criticalCount: opts.criticalCount ?? 0,
      estimatedTokenWaste: 0,
      estimatedTokenSavingsPercentage: 0,
      findingsPerThousandTokens: 0,
    },
    savings: {
      conservativeTokensPerInvocation: 0,
      conservativePercentage: 0,
      projectedTokensPerInvocation: 0,
      projectedPercentage: 0,
    },
    findings: opts.findings ?? [],
    suppressedFindings: [],
    suppressionSummary: { active: 0, expired: 0, suppressedFindings: 0 },
    recommendations: [],
  };
}

describe('evaluateConformance', () => {
  it('returns Level 3 when no findings and high score', () => {
    const conf = evaluateConformance(result({ score: 95, alwaysLoadedTokens: 500 }));
    expect(conf.level).toBe(3);
    expect(conf.label).toBe('CATES Level 3');
    expect(conf.passed).toBe(true);
    expect(conf.failures).toEqual([]);
    expect(conf.nextLevelActions).toEqual(['Maintain Level 3 by keeping CI gates enabled.']);
  });

  it('flags Level 0 when there are critical findings', () => {
    const conf = evaluateConformance(
      result({ criticalCount: 1, findings: [finding({ severity: 'critical' })], score: 90 }),
    );
    expect(conf.level).toBe(0);
    expect(conf.label).toBe('Not conformant');
    expect(conf.passed).toBe(false);
    expect(conf.failures).toContain('Critical findings must be resolved.');
  });

  it('flags Level 0 when SEC001 is present (even if severity reclassified)', () => {
    const conf = evaluateConformance(
      result({ findings: [finding({ ruleId: 'SEC001', severity: 'low' })] }),
    );
    expect(conf.level).toBe(0);
    expect(conf.failures).toContain('Hardcoded secrets must be removed.');
  });

  it('flags Level 0 when score below 40', () => {
    const conf = evaluateConformance(result({ score: 30 }));
    expect(conf.level).toBe(0);
    expect(conf.failures).toContain('Overall score must be at least 40.');
  });

  it('flags Level 0 when discovery is empty', () => {
    const conf = evaluateConformance(result({ files: [] }));
    expect(conf.level).toBe(0);
    expect(conf.failures).toContain('At least one coding-agent configuration file must be measured.');
  });

  it('reaches Level 1 when L1 passes but L2 has highs or low score', () => {
    const conf = evaluateConformance(
      result({ score: 60, findings: [finding({ severity: 'high' })] }),
    );
    expect(conf.level).toBe(1);
    expect(conf.label).toBe('CATES Level 1');
    expect(conf.passed).toBe(true);
    expect(conf.nextLevelActions.length).toBeGreaterThan(0);
  });

  it('reaches Level 2 when L2 passes but L3 has medium findings', () => {
    const conf = evaluateConformance(
      result({
        score: 80,
        findings: [finding({ severity: 'medium' })],
        alwaysLoadedTokens: 700,
      }),
    );
    expect(conf.level).toBe(2);
  });

  it('fails when requireLevel exceeds achieved level', () => {
    const r = result({ score: 30 });
    const conf = evaluateConformance(r, { requireLevel: 3 });
    expect(conf.passed).toBe(false);
    expect(conf.failures.length).toBeGreaterThan(0);
  });

  it('exposes failures at the requested level (Level 2 mode)', () => {
    const conf = evaluateConformance(
      result({ score: 80, findings: [finding({ severity: 'high' })] }),
      { requireLevel: 2 },
    );
    expect(conf.failures).toContain('Critical and high findings must be resolved.');
  });

  it('exposes failures at the requested level (Level 3 mode)', () => {
    const conf = evaluateConformance(
      result({
        score: 80,
        findings: [finding({ ruleId: 'MCP004', severity: 'low' })],
        alwaysLoadedTokens: 700,
      }),
      { requireLevel: 3 },
    );
    expect(conf.failures).toContain('All MCP servers/tools must have descriptions.');
  });

  it('flags Level 2 long-form failures (SEC004, CNF001, always-loaded budget)', () => {
    const conf = evaluateConformance(
      result({
        score: 85,
        findings: [finding({ ruleId: 'SEC004', severity: 'medium' }), finding({ ruleId: 'CNF001', severity: 'high' })],
        alwaysLoadedTokens: 2000,
      }),
      { requireLevel: 2 },
    );
    expect(conf.failures).toContain('Prompt protection must be present in instruction-bearing configs.');
    expect(conf.failures).toContain('Contradictory instructions must be resolved.');
    expect(conf.failures).toContain('Always-loaded tokens must be at or below 1,500.');
  });

  it('flags Level 3 long-form failures (PRM001, MCP004, 800 token budget)', () => {
    const conf = evaluateConformance(
      result({
        score: 80,
        findings: [
          finding({ ruleId: 'PRM001', severity: 'low' }),
          finding({ ruleId: 'MCP004', severity: 'low' }),
        ],
        alwaysLoadedTokens: 900,
      }),
      { requireLevel: 3 },
    );
    expect(conf.failures).toContain('All prompt files must have purpose headers.');
    expect(conf.failures).toContain('All MCP servers/tools must have descriptions.');
    expect(conf.failures).toContain('Always-loaded tokens must be at or below 800.');
    expect(conf.failures).toContain('Overall score must be at least 90.');
  });
});

describe('evaluateGates', () => {
  const passing = () =>
    result({ score: 95, alwaysLoadedTokens: 500 });

  it('passes when no policy is set', () => {
    expect(evaluateGates(passing())).toEqual({ passed: true, failures: [] });
  });

  it('fails minScore gate', () => {
    const gates = evaluateGates(passing(), { minScore: 99 });
    expect(gates.passed).toBe(false);
    expect(gates.failures[0]).toMatch(/Score 95 is below required minimum 99/);
  });

  it('fails maxAlwaysLoadedTokens gate', () => {
    const gates = evaluateGates(result({ alwaysLoadedTokens: 2000 }), { maxAlwaysLoadedTokens: 1500 });
    expect(gates.passed).toBe(false);
    expect(gates.failures[0]).toMatch(/Always-loaded tokens 2000 exceed maximum 1500/);
  });

  it('fails failOn gate when matching severity present', () => {
    const gates = evaluateGates(
      result({ findings: [finding({ severity: 'critical' as Severity })] }),
      { failOn: ['critical', 'high'] },
    );
    expect(gates.passed).toBe(false);
    expect(gates.failures[0]).toMatch(/1 finding\(s\) matched fail-on severities: critical, high/);
  });

  it('passes failOn gate when no matching severity', () => {
    const gates = evaluateGates(passing(), { failOn: ['critical'] });
    expect(gates.passed).toBe(true);
  });

  it('fails requireLevel gate by surfacing conformance failures', () => {
    const r = result({ score: 30 });
    const gates = evaluateGates(r, { requireLevel: 3 });
    expect(gates.passed).toBe(false);
    expect(gates.failures.some(f => f.startsWith('Level 3:'))).toBe(true);
  });

  it('CLI policy overrides repo policy fields', () => {
    const gates = evaluateGates(passing(), { minScore: 50 }, { minScore: 99 });
    expect(gates.passed).toBe(false);
    expect(gates.failures[0]).toMatch(/below required minimum 99/);
  });

  it('CLI undefined fields fall back to repo policy', () => {
    const gates = evaluateGates(
      passing(),
      { minScore: 99 },
      { minScore: undefined, maxAlwaysLoadedTokens: undefined },
    );
    expect(gates.passed).toBe(false);
    expect(gates.failures[0]).toMatch(/below required minimum 99/);
  });

  it('accumulates failures across multiple gates', () => {
    const gates = evaluateGates(
      result({ score: 30, alwaysLoadedTokens: 2000, findings: [finding({ severity: 'critical' as Severity })] }),
      { minScore: 80, maxAlwaysLoadedTokens: 1500, failOn: ['critical'], requireLevel: 1 },
    );
    expect(gates.passed).toBe(false);
    expect(gates.failures.length).toBeGreaterThanOrEqual(3);
  });
});
