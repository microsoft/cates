// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import { randomUUID } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import {
  handleAnalyze,
  handleHealthz,
  handleReadyz,
  handleRules,
  handleScan,
  type HandlerResult,
} from './api/handlers.js';

/**
 * Express wrapper around the framework-agnostic handlers. Used by the
 * Docker deployment target.
 *
 * Production hardening:
 * - helmet sets a strict CSP, HSTS, X-Frame-Options, no X-Powered-By, etc.
 * - JSON body parser is capped at 1 MB (matches the schema-level guard).
 * - In-process rate limiting (token bucket per IP) — cheap defense for the
 *   public demo. Place a real WAF / Front Door in front for prod.
 * - Concurrent /api/scan operations are bounded by a process-wide semaphore
 *   so a flood of slow clones cannot saturate the event loop.
 * - `trust proxy` is configurable via TRUST_PROXY (default: `loopback` for
 *   local dev; set to `1` or a CIDR behind a trusted reverse proxy so `req.ip` is the
 *   real client IP and per-IP rate-limit buckets work correctly).
 * - Server NEVER logs request bodies or response bodies. Only method, path,
 *   status, duration, and request-id.
 */

const MAX_CONCURRENT_SCANS = Number(process.env.CATES_MAX_CONCURRENT_SCANS) || 4;

export function createServer(): express.Express {
  const app = express();

  app.disable('x-powered-by');
  // When deployed behind a trusted reverse proxy, set TRUST_PROXY
  // to '1' (or a CIDR) so req.ip reflects the X-Forwarded-For client IP.
  // Default to 'loopback' which is safe for local dev.
  app.set('trust proxy', process.env.TRUST_PROXY ?? 'loopback');
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          // Results may be shared via #fragment permalinks; never iframed.
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
        },
      },
      // The page should never be indexed and should never be embedded.
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  app.use((_req, res, next) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.use(privacyPreservingLogger);
  app.use(rateLimit({ windowMs: 60_000, max: 60 }));

  // ─── API ──────────────────────────────────────────────────────────────────
  app.post('/api/analyze', wrapAsync(req => handleAnalyze(req.body)));
  app.post('/api/scan', scanConcurrencyLimiter(MAX_CONCURRENT_SCANS), wrapAsync(req => handleScan(req.body)));
  app.get('/api/rules', wrap(() => handleRules()));
  app.get('/api/healthz', wrap(() => handleHealthz()));
  app.get('/api/readyz', wrap(() => handleReadyz()));

  // ─── Static frontend (mounted last so /api/* wins) ────────────────────────
  app.use(
    express.static(new URL('./web/', import.meta.url).pathname, {
      etag: true,
      maxAge: '1h',
      index: 'index.html',
    }),
  );

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: 'Internal server error', details: message });
  });

  return app;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function wrap<T>(invoke: () => HandlerResult<T>) {
  return (_req: Request, res: Response) => {
    const result = invoke();
    res.status(result.status).json(result.body);
  };
}

function wrapAsync<T>(invoke: (req: Request) => Promise<HandlerResult<T>>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await invoke(req);
      res.status(result.status).json(result.body);
    } catch (err) {
      next(err);
    }
  };
}

function privacyPreservingLogger(req: Request, res: Response, next: NextFunction): void {
  // Stamp every request with a stable correlation id, echo it back to the
  // client, and include it in the structured log line. This lets operators
  // join a user-reported error to the corresponding access log entry without
  // ever logging request or response bodies.
  const requestId = String(req.headers['x-request-id'] ?? randomUUID());
  res.setHeader('X-Request-Id', requestId);
  if (process.env.NODE_ENV === 'test' || process.env.CATES_QUIET === '1') return next();
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    // Never log req.body, req.query, or any header that could carry user
    // content. Only the bare access tuple.
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        t: new Date().toISOString(),
        requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: duration,
      }),
    );
  });
  next();
}

interface RateLimitState {
  windowStart: number;
  count: number;
}

function rateLimit(options: { windowMs: number; max: number }) {
  const buckets = new Map<string, RateLimitState>();
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip ?? 'unknown';
    const now = Date.now();
    let bucket = buckets.get(ip);
    if (!bucket || now - bucket.windowStart > options.windowMs) {
      bucket = { windowStart: now, count: 0 };
      buckets.set(ip, bucket);
    }
    bucket.count += 1;
    if (bucket.count > options.max) {
      res.status(429).json({ error: 'Too many requests' });
      return;
    }
    next();
  };
}

/**
 * Bounds concurrent /api/scan operations across the whole process. Scans
 * shell out to git/gh and can hold a worker for tens of seconds, so a flood
 * of unrelated clients could starve all other endpoints if unbounded. The
 * per-IP `rateLimit` middleware does not help here because the cost lives
 * on the server side, not the client.
 *
 * Excess requests get HTTP 503 with a Retry-After hint instead of being
 * silently queued (which would build a hidden backlog and hide latency in
 * dashboards).
 */
function scanConcurrencyLimiter(max: number) {
  let inFlight = 0;
  return (_req: Request, res: Response, next: NextFunction): void => {
    if (inFlight >= max) {
      res.setHeader('Retry-After', '10');
      res.status(503).json({ error: 'Scan capacity exceeded; retry shortly' });
      return;
    }
    inFlight++;
    res.on('finish', () => { inFlight--; });
    res.on('close', () => { if (!res.writableEnded) inFlight--; });
    next();
  };
}

// ─── Entry point ─────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT) || 8080;
const SHUTDOWN_GRACE_MS = Number(process.env.CATES_SHUTDOWN_GRACE_MS) || 15_000;

// Allow `node service/server.js` or `tsx service/server.ts` to start the
// service directly. Tests can `import { createServer }` without binding.
const isEntryPoint =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url.endsWith(process.argv[1] ?? '');

if (isEntryPoint) {
  const app = createServer();
  const server = app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`cates-service listening on :${PORT}`);
  });

  // Graceful shutdown: stop accepting new connections, let in-flight work
  // drain, then exit. Many orchestrators send SIGTERM before SIGKILL during
  // rolling deploys, so honoring this avoids cut-off scans.
  const shutdown = (signal: NodeJS.Signals) => {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ t: new Date().toISOString(), event: 'shutdown', signal }));
    const forceExit = setTimeout(() => {
      // eslint-disable-next-line no-console
      console.error(JSON.stringify({ t: new Date().toISOString(), event: 'shutdown-forced', signal }));
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    forceExit.unref();
    server.close(err => {
      clearTimeout(forceExit);
      process.exit(err ? 1 : 0);
    });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
