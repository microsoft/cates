import { describe, it, expect } from 'vitest';
import { generateRecommendations } from '../src/scoring/recommendations.js';
import type { DiscoveryResult, Finding } from '../src/types.js';

function f(ruleId: string, overrides: Partial<Finding> = {}): Finding {
  return {
    ruleId,
    dimension: overrides.dimension ?? (ruleId.startsWith('SEC') || ruleId.startsWith('MCP') ? 'security' : 'token-efficiency'),
    severity: overrides.severity ?? 'medium',
    confidence: overrides.confidence ?? 'high',
    message: overrides.message ?? `${ruleId} message`,
    file: overrides.file ?? `${ruleId.toLowerCase()}.md`,
    tokenImpact: overrides.tokenImpact ?? 100,
  };
}

const discovery: DiscoveryResult = {
  files: [],
  totalTokens: 5000,
  alwaysLoadedTokens: 0,
  activeFileCount: 1,
  skippedFiles: [],
  filesScanned: 1,
} as unknown as DiscoveryResult;

describe('generateRecommendations', () => {
  it('returns [] when no findings', () => {
    expect(generateRecommendations([], discovery)).toEqual([]);
  });

  it('emits the critical-secret recommendation for SEC001 critical', () => {
    const recs = generateRecommendations(
      [f('SEC001', { severity: 'critical', dimension: 'security', tokenImpact: 30 })],
      discovery,
    );
    expect(recs[0]?.title).toMatch(/Remove secrets/);
    expect(recs[0]?.priority).toBe(1);
    expect(recs[0]?.tokenSavings).toBe(30);
  });

  it('emits the dedupe recommendation for TE006', () => {
    const recs = generateRecommendations(
      [f('TE006', { tokenImpact: 200 }), f('TE006', { tokenImpact: 150 })],
      discovery,
    );
    const dedupe = recs.find(r => r.title.includes('Deduplicate'));
    expect(dedupe).toBeDefined();
    expect(dedupe?.tokenSavings).toBe(350);
  });

  it('emits the MCP description recommendation for MCP004', () => {
    const recs = generateRecommendations([f('MCP004')], discovery);
    expect(recs.some(r => /descriptions to MCP server configs/i.test(r.title))).toBe(true);
  });

  it('emits the MCP HTTPS recommendation for MCP003', () => {
    const recs = generateRecommendations([f('MCP003')], discovery);
    expect(recs.some(r => /MCP server connections with HTTPS/.test(r.title))).toBe(true);
  });

  it('emits the MCP command-injection recommendation for MCP005', () => {
    const recs = generateRecommendations([f('MCP005')], discovery);
    const rec = recs.find(r => /command injection risk/i.test(r.title));
    expect(rec).toBeDefined();
    expect(rec?.priority).toBe(1);
  });

  it('emits the pipe-to-shell recommendation for STP001', () => {
    const recs = generateRecommendations([f('STP001')], discovery);
    expect(recs.some(r => /pipe-to-shell/i.test(r.title))).toBe(true);
  });

  it('emits dependency-cache recommendation for STP002', () => {
    const recs = generateRecommendations([f('STP002')], discovery);
    expect(recs.some(r => /Cache dependencies/i.test(r.title))).toBe(true);
  });

  it('emits test-framework recommendation for STP004', () => {
    const recs = generateRecommendations([f('STP004')], discovery);
    expect(recs.some(r => /test framework/i.test(r.title))).toBe(true);
  });

  it('emits non-interactive-hooks recommendation for HK001', () => {
    const recs = generateRecommendations([f('HK001')], discovery);
    expect(recs.some(r => /non-interactive/i.test(r.title))).toBe(true);
  });

  it('emits heavy-hooks recommendation for HK002', () => {
    const recs = generateRecommendations([f('HK002')], discovery);
    expect(recs.some(r => /heavy hooks/i.test(r.title))).toBe(true);
  });

  it('emits SEC004 protection recommendation only when more than 2 occurrences', () => {
    const few = generateRecommendations([f('SEC004'), f('SEC004')], discovery);
    expect(few.some(r => /system prompt protection/i.test(r.title))).toBe(false);
    const many = generateRecommendations([f('SEC004'), f('SEC004'), f('SEC004')], discovery);
    expect(many.some(r => /system prompt protection/i.test(r.title))).toBe(true);
  });

  it('sorts recommendations by priority ascending', () => {
    const recs = generateRecommendations(
      [
        f('STP002'), // priority 5
        f('SEC001', { severity: 'critical', dimension: 'security' }), // priority 1
        f('TE006'), // priority 2
      ],
      discovery,
    );
    const priorities = recs.map(r => r.priority);
    expect(priorities).toEqual([...priorities].sort((a, b) => a - b));
  });

  it('marks autofixable=true when SEC004 (autofixable) is the rule', () => {
    const recs = generateRecommendations(
      [f('SEC004'), f('SEC004'), f('SEC004')],
      discovery,
    );
    const protection = recs.find(r => /system prompt protection/i.test(r.title));
    expect(protection?.autofixable).toBe(true);
  });

  it('computes tokenSavingsPercentage from discovery.totalTokens', () => {
    const recs = generateRecommendations(
      [f('TE006', { tokenImpact: 500 })],
      { ...discovery, totalTokens: 5000 } as DiscoveryResult,
    );
    const rec = recs.find(r => r.title.includes('Deduplicate'));
    expect(rec?.tokenSavingsPercentage).toBeGreaterThan(0);
  });

  it('treats zero total tokens safely', () => {
    const recs = generateRecommendations(
      [f('TE006', { tokenImpact: 500 })],
      { ...discovery, totalTokens: 0 } as DiscoveryResult,
    );
    expect(recs[0]?.tokenSavingsPercentage).toBe(0);
  });

  it('classifies recommendation safety: security finding → manual', () => {
    const recs = generateRecommendations(
      [f('SEC001', { severity: 'critical', dimension: 'security' })],
      discovery,
    );
    expect(recs[0]?.safety).toBe('manual');
  });
});
