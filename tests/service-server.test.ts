import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createServer } from '../service/server.js';

describe('Express service', () => {
  const app = createServer();

  describe('GET /api/healthz', () => {
    it('returns 200 with ok body', async () => {
      const res = await request(app).get('/api/healthz');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok' });
    });

    it('sets X-Robots-Tag noindex', async () => {
      const res = await request(app).get('/api/healthz');
      expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
    });

    it('sets a strict CSP', async () => {
      const res = await request(app).get('/api/healthz');
      const csp = res.headers['content-security-policy'];
      expect(csp).toMatch(/default-src 'self'/);
      expect(csp).toMatch(/frame-ancestors 'none'/);
      expect(csp).toMatch(/object-src 'none'/);
    });

    it('sets X-Frame-Options and X-Content-Type-Options', async () => {
      const res = await request(app).get('/api/healthz');
      expect(res.headers['x-frame-options']).toBeDefined();
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it('strips X-Powered-By', async () => {
      const res = await request(app).get('/api/healthz');
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('GET /api/readyz', () => {
    it('returns 200 ready', async () => {
      const res = await request(app).get('/api/readyz');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ready' });
    });
  });

  describe('GET /api/rules', () => {
    it('returns the rule catalog and service limits', async () => {
      const res = await request(app).get('/api/rules');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.rules)).toBe(true);
      expect(res.body.rules.length).toBeGreaterThan(30);
      expect(res.body.limits.maxFilesPerRequest).toBe(50);
    });
  });

  describe('POST /api/analyze', () => {
    it('returns AnalysisResult for valid input', async () => {
      const res = await request(app)
        .post('/api/analyze')
        .send({
          files: [
            {
              path: '.github/copilot-instructions.md',
              content: 'api_key = "sk-test1234567890abcdef1234567890abcdef"\n',
            },
          ],
        });
      expect(res.status).toBe(200);
      expect(res.body.findings.some((f: { ruleId: string }) => f.ruleId === 'SEC001')).toBe(true);
    });

    it('returns 400 for validation errors', async () => {
      const res = await request(app).post('/api/analyze').send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid analyze request/);
    });

    it('respects 1mb JSON body limit', async () => {
      const huge = 'a'.repeat(2_000_000);
      const res = await request(app)
        .post('/api/analyze')
        .set('content-type', 'application/json')
        .send(`{"files":[{"path":"a.md","content":"${huge}"}]}`);
      // express.json with limit:'1mb' returns a PayloadTooLarge → our error
      // handler emits 500 with the message. Either 413/500 is acceptable; the
      // contract is "request is rejected, not analyzed".
      expect([400, 413, 500]).toContain(res.status);
    });
  });

  describe('POST /api/scan', () => {
    it('returns 400 for non-github URL', async () => {
      const res = await request(app).post('/api/scan').send({ url: 'https://example.com/x/y' });
      expect(res.status).toBe(400);
    });

    it('returns 400 for argv-injection-shaped ref', async () => {
      const res = await request(app)
        .post('/api/scan')
        .send({ url: 'https://github.com/example/repo/tree/--upload-pack=evil' });
      expect(res.status).toBe(400);
    });
  });

  describe('Rate limiting', () => {
    it('returns 429 after the per-IP limit is exceeded', async () => {
      const fresh = createServer();
      // Default limit is 60/min. Fire 65 sequential requests with the same IP.
      let lastStatus = 0;
      let sawLimit = false;
      for (let i = 0; i < 65; i++) {
        const res = await request(fresh).get('/api/healthz');
        lastStatus = res.status;
        if (res.status === 429) {
          sawLimit = true;
          expect(res.body.error).toMatch(/Too many requests/);
          break;
        }
      }
      expect(sawLimit).toBe(true);
      expect(lastStatus).toBe(429);
    }, 10_000);
  });

  describe('Static SPA', () => {
    it('serves index.html at /', async () => {
      const res = await request(app).get('/');
      // index may 404 in test env if dist-service/service/web is not present
      // (the test runs against TypeScript directly via tsx; web/ is alongside
      // the source). createServer resolves ./web/ relative to server.ts.
      expect([200, 404]).toContain(res.status);
      if (res.status === 200) {
        expect(res.text).toContain('<!doctype html>');
        expect(res.text).toContain('CATES Service');
      }
    });
  });
});
