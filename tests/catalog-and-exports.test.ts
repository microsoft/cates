// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import { describe, it, expect } from 'vitest';
import { RULE_CATALOG, getRule, rulesAsJson, stableRules, experimentalRules } from '../src/rules/catalog.js';
import * as lib from '../src/index.js';

describe('rules/catalog', () => {
  it('has 49 stable rules and 10 experimental rules (the documented counts)', () => {
    expect(stableRules()).toHaveLength(49);
    expect(experimentalRules()).toHaveLength(10);
    expect(RULE_CATALOG).toHaveLength(59);
  });

  it('experimental rules are all CS/OS and marked stability experimental', () => {
    for (const rule of experimentalRules()) {
      expect(rule.id).toMatch(/^(CS|OS)\d{3}$/);
      expect(rule.stability).toBe('experimental');
      expect(['cache-shaping', 'output-shaping']).toContain(rule.dimension);
    }
    // Stable rules must never be on an experimental dimension.
    for (const rule of stableRules()) {
      expect(rule.stability ?? 'stable').toBe('stable');
    }
  });

  it('getRule returns metadata for known ids and undefined for unknown', () => {
    expect(getRule('SEC001')?.title).toMatch(/secret/i);
    expect(getRule('NOPE000')).toBeUndefined();
  });

  it('rulesAsJson returns parseable JSON containing every rule', () => {
    const json = rulesAsJson();
    const parsed = JSON.parse(json) as Array<{ id: string }>;
    expect(parsed).toHaveLength(RULE_CATALOG.length);
    const ids = new Set(parsed.map(r => r.id));
    for (const r of RULE_CATALOG) expect(ids.has(r.id)).toBe(true);
  });

  it('every rule has the required shape', () => {
    for (const r of RULE_CATALOG) {
      expect(typeof r.id).toBe('string');
      expect(typeof r.title).toBe('string');
      expect(typeof r.dimension).toBe('string');
      expect(typeof r.severity).toBe('string');
      expect(typeof r.summary).toBe('string');
      expect(typeof r.detection).toBe('string');
      expect(typeof r.remediation).toBe('string');
      expect(typeof r.catesSection).toBe('string');
    }
  });
});

describe('library entry point (src/index.ts)', () => {
  it('re-exports the documented public surface', () => {
    expect(typeof lib.analyze).toBe('function');
    expect(typeof lib.analyzeInMemory).toBe('function');
    expect(typeof lib.createReport).toBe('function');
    expect(typeof lib.evaluateConformance).toBe('function');
    expect(typeof lib.evaluateGates).toBe('function');
    expect(typeof lib.getRule).toBe('function');
    expect(Array.isArray(lib.RULE_CATALOG)).toBe(true);
  });
});
