import { describe, it, expect } from 'vitest';
import {
  analyzeFunction,
  scanFunction,
  rulesFunction,
  healthzFunction,
  readyzFunction,
  toResponse,
} from '../service/functions/index.js';

function fakeRequest(body: unknown, throwOnJson = false): Parameters<typeof analyzeFunction>[0] {
  return {
    json: async () => {
      if (throwOnJson) throw new SyntaxError('Unexpected token');
      return body;
    },
  } as unknown as Parameters<typeof analyzeFunction>[0];
}

describe('Azure Functions handlers', () => {
  describe('analyzeFunction', () => {
    it('returns 200 and an AnalysisResult body for valid input', async () => {
      const res = await analyzeFunction(
        fakeRequest({
          files: [
            {
              path: '.github/copilot-instructions.md',
              content: 'api_key = "sk-test1234567890abcdef1234567890abcdef"\n',
            },
          ],
        }),
      );
      expect(res.status).toBe(200);
      expect(res.headers?.['X-Robots-Tag']).toBe('noindex, nofollow');
      const body = res.jsonBody as { findings: Array<{ ruleId: string }> };
      expect(body.findings.some(f => f.ruleId === 'SEC001')).toBe(true);
    });

    it('returns 400 on invalid JSON body', async () => {
      const res = await analyzeFunction(fakeRequest({}, true));
      expect(res.status).toBe(400);
      expect((res.jsonBody as { error: string }).error).toBe('Invalid JSON body');
    });

    it('returns 400 on validation failure', async () => {
      const res = await analyzeFunction(fakeRequest({ files: [] }));
      expect(res.status).toBe(400);
    });
  });

  describe('scanFunction', () => {
    it('always returns 501 on the SWA target', async () => {
      const res = await scanFunction();
      expect(res.status).toBe(501);
      const body = res.jsonBody as { error: string; details: string };
      expect(body.error).toMatch(/not available on the public Static Web Apps/);
      expect(body.details).toMatch(/ACA/);
    });
  });

  describe('rulesFunction', () => {
    it('returns the rule catalog', async () => {
      const res = await rulesFunction();
      expect(res.status).toBe(200);
      const body = res.jsonBody as { rules: unknown[]; limits: { maxFilesPerRequest: number } };
      expect(body.rules.length).toBeGreaterThan(30);
      expect(body.limits.maxFilesPerRequest).toBe(50);
    });
  });

  describe('healthzFunction', () => {
    it('returns ok', async () => {
      const res = await healthzFunction();
      expect(res.status).toBe(200);
      expect((res.jsonBody as { status: string }).status).toBe('ok');
    });
  });

  describe('readyzFunction', () => {
    it('returns ready', async () => {
      const res = await readyzFunction();
      expect(res.status).toBe(200);
      expect((res.jsonBody as { status: string }).status).toBe('ready');
    });
  });

  describe('toResponse', () => {
    it('sets Cache-Control: no-store and X-Robots-Tag', () => {
      const res = toResponse({ ok: true, status: 200, body: { hello: 'world' } });
      expect(res.headers?.['Cache-Control']).toBe('no-store');
      expect(res.headers?.['X-Robots-Tag']).toBe('noindex, nofollow');
      expect(res.status).toBe(200);
      expect(res.jsonBody).toEqual({ hello: 'world' });
    });

    it('propagates non-200 status codes', () => {
      const res = toResponse({ ok: false, status: 400, body: { error: 'bad' } });
      expect(res.status).toBe(400);
      expect((res.jsonBody as { error: string }).error).toBe('bad');
    });
  });
});
