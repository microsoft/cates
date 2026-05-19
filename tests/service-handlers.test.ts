import { describe, expect, it } from 'vitest';
import {
  handleAnalyze,
  handleHealthz,
  handleRules,
  handleScan,
} from '../service/api/handlers.js';

describe('Service handlers', () => {
  describe('handleAnalyze', () => {
    it('returns 200 with an AnalysisResult for valid input', async () => {
      const result = await handleAnalyze({
        files: [
          {
            path: '.github/copilot-instructions.md',
            content: 'api_key = "sk-test1234567890abcdef1234567890abcdef"\n',
          },
        ],
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.status).toBe(200);
        expect(result.body.findings.some(f => f.ruleId === 'SEC001')).toBe(true);
      }
    });

    it('returns 400 for empty files array', async () => {
      const result = await handleAnalyze({ files: [] });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(400);
    });

    it('returns 400 for missing files key', async () => {
      const result = await handleAnalyze({});
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(400);
    });

    it('returns 400 for absolute or traversal paths', async () => {
      const abs = await handleAnalyze({
        files: [{ path: '/etc/passwd', content: 'x' }],
      });
      expect(abs.ok).toBe(false);
      const trav = await handleAnalyze({
        files: [{ path: '../escape.md', content: 'x' }],
      });
      expect(trav.ok).toBe(false);
    });

    it('returns 400 when files exceed the per-file size cap', async () => {
      const oversized = 'a'.repeat(100_001);
      const result = await handleAnalyze({
        files: [{ path: 'big.md', content: oversized }],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(400);
    });

    it('applies policy.dimensions overrides', async () => {
      const result = await handleAnalyze({
        files: [
          {
            path: '.github/copilot-instructions.md',
            content: 'api_key = "sk-test1234567890abcdef1234567890abcdef"\n',
          },
        ],
        policy: { dimensions: { security: { enabled: false } } },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.body.findings.some(f => f.ruleId === 'SEC001')).toBe(false);
        expect(result.body.disabledDimensions).toContain('security');
      }
    });
  });

  describe('handleScan', () => {
    it('returns 400 for non-github URLs', async () => {
      const result = await handleScan({ url: 'https://example.com/owner/repo' });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(400);
    });

    it('returns 400 for argv-injection-shaped refs', async () => {
      const result = await handleScan({
        url: 'https://github.com/example/repo/tree/--upload-pack=evil',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(400);
    });
  });

  describe('handleRules', () => {
    it('returns the full rule catalog and the service limits', () => {
      const result = handleRules();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.body.rules.length).toBeGreaterThan(30);
        expect(result.body.limits.maxFilesPerRequest).toBe(50);
        expect(result.body.limits.maxBytesPerFile).toBe(100_000);
      }
    });
  });

  describe('handleHealthz', () => {
    it('returns 200 ok', () => {
      const result = handleHealthz();
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.body.status).toBe('ok');
    });
  });
});
