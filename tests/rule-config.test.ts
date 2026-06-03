// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import { describe, expect, it } from 'vitest';
import { applyRuleConfig } from '../src/rule-config.js';
import type { Finding } from '../src/types.js';

function f(ruleId: string, dimension: Finding['dimension'], severity: Finding['severity'] = 'medium'): Finding {
  return {
    ruleId,
    dimension,
    severity,
    confidence: 'high',
    message: `${ruleId} ${dimension}`,
    file: 'test.md',
  };
}

describe('applyRuleConfig', () => {
  const findings: Finding[] = [
    f('SEC001', 'security', 'critical'),
    f('SEC003', 'security', 'high'),
    f('TE001', 'token-efficiency', 'medium'),
    f('TE004', 'token-efficiency', 'high'),
  ];

  it('disables a single rule by id', () => {
    const result = applyRuleConfig(findings, { rules: { SEC001: { enabled: false } } });
    expect(result.findings.map(x => x.ruleId)).toEqual(['SEC003', 'TE001', 'TE004']);
    expect(result.disabledFindings.map(x => x.ruleId)).toEqual(['SEC001']);
  });

  it('disables an entire dimension', () => {
    const result = applyRuleConfig(findings, { dimensions: { security: { enabled: false } } });
    expect(result.findings.map(x => x.ruleId)).toEqual(['TE001', 'TE004']);
    expect(result.disabledFindings).toHaveLength(2);
    expect(result.disabledDimensions).toContain('security');
  });

  it('rule-level enable overrides a disabled dimension', () => {
    const result = applyRuleConfig(findings, {
      dimensions: { security: { enabled: false } },
      rules: { SEC001: { enabled: true } },
    });
    expect(result.findings.map(x => x.ruleId).sort()).toEqual(['SEC001', 'TE001', 'TE004']);
  });

  it('rule-level severity override is applied', () => {
    const result = applyRuleConfig(findings, { rules: { TE004: { severity: 'low' } } });
    const te004 = result.findings.find(x => x.ruleId === 'TE004');
    expect(te004?.severity).toBe('low');
  });

  it('treats rule ids case-insensitively', () => {
    const result = applyRuleConfig(findings, { rules: { sec001: { enabled: false } } });
    expect(result.findings.map(x => x.ruleId)).not.toContain('SEC001');
  });

  it('returns identity result when no config is supplied', () => {
    const result = applyRuleConfig(findings, {});
    expect(result.findings).toHaveLength(findings.length);
    expect(result.disabledFindings).toHaveLength(0);
  });
});
