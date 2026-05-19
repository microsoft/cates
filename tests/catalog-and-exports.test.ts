import { describe, it, expect } from 'vitest';
import { RULE_CATALOG, getRule, rulesAsJson } from '../src/rules/catalog.js';
import * as lib from '../src/index.js';

describe('rules/catalog', () => {
  it('has 42 rules (the documented count)', () => {
    expect(RULE_CATALOG).toHaveLength(42);
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
