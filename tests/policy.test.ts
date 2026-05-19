import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPolicy, DEFAULT_POLICY } from '../src/policy.js';

describe('loadPolicy', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'cates-policy-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('discovery', () => {
    it('returns empty object when no policy file exists', async () => {
      const result = await loadPolicy(tempDir);
      expect(result).toEqual({});
    });

    it('loads .cates.yml', async () => {
      await writeFile(join(tempDir, '.cates.yml'), 'minScore: 80\n');
      const result = await loadPolicy(tempDir);
      expect(result.minScore).toBe(80);
    });

    it('loads .cates.yaml', async () => {
      await writeFile(join(tempDir, '.cates.yaml'), 'minScore: 75\n');
      const result = await loadPolicy(tempDir);
      expect(result.minScore).toBe(75);
    });

    it('loads .cates.json', async () => {
      await writeFile(join(tempDir, '.cates.json'), JSON.stringify({ minScore: 90 }));
      const result = await loadPolicy(tempDir);
      expect(result.minScore).toBe(90);
    });

    it('prefers .cates.yml over .yaml and .json when multiple exist', async () => {
      await writeFile(join(tempDir, '.cates.yml'), 'minScore: 1\n');
      await writeFile(join(tempDir, '.cates.yaml'), 'minScore: 2\n');
      await writeFile(join(tempDir, '.cates.json'), JSON.stringify({ minScore: 3 }));
      const result = await loadPolicy(tempDir);
      expect(result.minScore).toBe(1);
    });

    it('honors explicit path override', async () => {
      const explicit = join(tempDir, 'custom-policy.yml');
      await writeFile(explicit, 'minScore: 42\n');
      const result = await loadPolicy(tempDir, explicit);
      expect(result.minScore).toBe(42);
    });

    it('uses JSON parser based on .json extension when overriding', async () => {
      const explicit = join(tempDir, 'custom.json');
      await writeFile(explicit, JSON.stringify({ minScore: 55 }));
      const result = await loadPolicy(tempDir, explicit);
      expect(result.minScore).toBe(55);
    });
  });

  describe('parse error handling', () => {
    it('wraps malformed YAML with a clear filename-bearing error', async () => {
      const bad = join(tempDir, '.cates.yml');
      await writeFile(bad, 'minScore: 80\n  invalid: : : ::\n');
      await expect(loadPolicy(tempDir)).rejects.toThrow(/Failed to parse CATES policy file/);
      await expect(loadPolicy(tempDir)).rejects.toThrow(bad);
    });

    it('wraps malformed JSON with a clear filename-bearing error', async () => {
      const bad = join(tempDir, '.cates.json');
      await writeFile(bad, '{ "minScore": 80,, }');
      await expect(loadPolicy(tempDir)).rejects.toThrow(/Failed to parse CATES policy file/);
      await expect(loadPolicy(tempDir)).rejects.toThrow(/cates\.json/);
    });

    it('returns empty object when policy file is empty', async () => {
      await writeFile(join(tempDir, '.cates.yml'), '');
      const result = await loadPolicy(tempDir);
      expect(result).toEqual({});
    });

    it('returns empty object when policy file is just a string', async () => {
      await writeFile(join(tempDir, '.cates.json'), JSON.stringify('not-a-policy'));
      const result = await loadPolicy(tempDir);
      expect(result).toEqual({});
    });
  });

  describe('scalar fields', () => {
    it('parses requireLevel for valid levels', async () => {
      for (const level of [1, 2, 3]) {
        await writeFile(join(tempDir, '.cates.yml'), `requireLevel: ${level}\n`);
        const result = await loadPolicy(tempDir);
        expect(result.requireLevel).toBe(level);
      }
    });

    it('rejects invalid requireLevel (returns undefined)', async () => {
      await writeFile(join(tempDir, '.cates.yml'), 'requireLevel: 4\n');
      const result = await loadPolicy(tempDir);
      expect(result.requireLevel).toBeUndefined();
    });

    it('rejects non-finite numbers for minScore', async () => {
      await writeFile(join(tempDir, '.cates.json'), JSON.stringify({ minScore: 'abc' }));
      const result = await loadPolicy(tempDir);
      expect(result.minScore).toBeUndefined();
    });

    it('parses failOn array, filtering invalid severities', async () => {
      await writeFile(
        join(tempDir, '.cates.yml'),
        'failOn:\n  - critical\n  - bogus\n  - high\n',
      );
      const result = await loadPolicy(tempDir);
      expect(result.failOn).toEqual(['critical', 'high']);
    });

    it('ignores failOn when not an array', async () => {
      await writeFile(join(tempDir, '.cates.yml'), 'failOn: critical\n');
      const result = await loadPolicy(tempDir);
      expect(result.failOn).toBeUndefined();
    });
  });

  describe('rules', () => {
    it('parses shorthand: off → enabled false', async () => {
      await writeFile(join(tempDir, '.cates.yml'), 'rules:\n  SEC001: off\n');
      const result = await loadPolicy(tempDir);
      expect(result.rules?.SEC001).toEqual({ enabled: false });
    });

    it('parses shorthand: on → enabled true', async () => {
      await writeFile(join(tempDir, '.cates.yml'), 'rules:\n  SEC001: on\n');
      const result = await loadPolicy(tempDir);
      expect(result.rules?.SEC001).toEqual({ enabled: true });
    });

    it('parses shorthand: false / true / disabled / enabled / disable / enable', async () => {
      await writeFile(
        join(tempDir, '.cates.json'),
        JSON.stringify({
          rules: {
            R1: false,
            R2: true,
            R3: 'disabled',
            R4: 'enabled',
            R5: 'disable',
            R6: 'enable',
          },
        }),
      );
      const result = await loadPolicy(tempDir);
      expect(result.rules).toEqual({
        R1: { enabled: false },
        R2: { enabled: true },
        R3: { enabled: false },
        R4: { enabled: true },
        R5: { enabled: false },
        R6: { enabled: true },
      });
    });

    it('parses shorthand: severity string', async () => {
      await writeFile(join(tempDir, '.cates.yml'), 'rules:\n  TE004: low\n');
      const result = await loadPolicy(tempDir);
      expect(result.rules?.TE004).toEqual({ severity: 'low' });
    });

    it('parses long form with enabled + severity', async () => {
      await writeFile(
        join(tempDir, '.cates.json'),
        JSON.stringify({ rules: { CMP002: { enabled: true, severity: 'high' } } }),
      );
      const result = await loadPolicy(tempDir);
      expect(result.rules?.CMP002).toEqual({ enabled: true, severity: 'high' });
    });

    it('uppercases rule ids', async () => {
      await writeFile(join(tempDir, '.cates.yml'), 'rules:\n  sec001: off\n');
      const result = await loadPolicy(tempDir);
      expect(result.rules?.SEC001).toBeDefined();
      expect(result.rules?.sec001).toBeUndefined();
    });

    it('drops invalid override values', async () => {
      await writeFile(
        join(tempDir, '.cates.json'),
        JSON.stringify({ rules: { R1: 42, R2: null, R3: { enabled: 'no', severity: 'bogus' } } }),
      );
      const result = await loadPolicy(tempDir);
      expect(result.rules).toBeUndefined();
    });

    it('drops empty rules map', async () => {
      await writeFile(join(tempDir, '.cates.yml'), 'rules: {}\n');
      const result = await loadPolicy(tempDir);
      expect(result.rules).toBeUndefined();
    });

    it('ignores rules when not an object', async () => {
      await writeFile(join(tempDir, '.cates.yml'), 'rules: not-an-object\n');
      const result = await loadPolicy(tempDir);
      expect(result.rules).toBeUndefined();
    });
  });

  describe('dimensions', () => {
    it('parses each known dimension key', async () => {
      const known = [
        'token-efficiency',
        'security',
        'specificity',
        'completeness',
        'conflict-reachability',
        'harness-quality',
      ];
      const payload: Record<string, string> = {};
      for (const d of known) payload[d] = 'off';
      await writeFile(
        join(tempDir, '.cates.json'),
        JSON.stringify({ dimensions: payload }),
      );
      const result = await loadPolicy(tempDir);
      for (const d of known) {
        expect(result.dimensions?.[d as keyof typeof result.dimensions]).toEqual({ enabled: false });
      }
    });

    it('drops unknown dimension keys', async () => {
      await writeFile(
        join(tempDir, '.cates.json'),
        JSON.stringify({ dimensions: { 'not-real': 'off', security: 'off' } }),
      );
      const result = await loadPolicy(tempDir);
      expect(result.dimensions).toEqual({ security: { enabled: false } });
    });

    it('ignores dimensions when not an object', async () => {
      await writeFile(join(tempDir, '.cates.yml'), 'dimensions: hello\n');
      const result = await loadPolicy(tempDir);
      expect(result.dimensions).toBeUndefined();
    });
  });

  describe('suppressions', () => {
    it('keeps valid suppressions and drops invalid shapes', async () => {
      const payload = {
        suppressions: [
          { ruleId: 'SEC001', reason: 'documented' },
          { ruleId: 'SEC002', reason: 'covered by GHAS', file: 'foo.md', expires: '2030-01-01', owner: '@team' },
          { ruleId: '', reason: 'empty id' },
          { reason: 'missing id' },
          { ruleId: 'OK', reason: '' },
          { ruleId: 'OK', reason: 'good', file: 123 },
          'not-an-object',
        ],
      };
      await writeFile(join(tempDir, '.cates.json'), JSON.stringify(payload));
      const result = await loadPolicy(tempDir);
      expect(result.suppressions).toHaveLength(2);
      expect(result.suppressions?.[0]?.ruleId).toBe('SEC001');
      expect(result.suppressions?.[1]?.owner).toBe('@team');
    });

    it('ignores suppressions when not an array', async () => {
      await writeFile(join(tempDir, '.cates.yml'), 'suppressions: hello\n');
      const result = await loadPolicy(tempDir);
      expect(result.suppressions).toBeUndefined();
    });
  });
});

describe('DEFAULT_POLICY', () => {
  it('exposes sane defaults', () => {
    expect(DEFAULT_POLICY.minScore).toBe(0);
    expect(DEFAULT_POLICY.requireLevel).toBe(1);
    expect(DEFAULT_POLICY.failOn).toEqual(['critical']);
    expect(DEFAULT_POLICY.maxAlwaysLoadedTokens).toBe(1500);
  });
});
