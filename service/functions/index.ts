import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import {
  handleAnalyze,
  handleHealthz,
  handleReadyz,
  handleRules,
  type HandlerResult,
} from '../api/handlers.js';

/**
 * Azure Functions v4 wrappers for the public-demo (Static Web Apps) target.
 *
 * Each function is a thin shell that:
 *   1. Reads the JSON body where applicable.
 *   2. Calls the framework-agnostic handler defined in service/api/handlers.ts.
 *   3. Translates HandlerResult into an HttpResponseInit.
 *
 * /api/scan is intentionally returned as 501 here because Azure Functions
 * doesn't ship `git`/`gh` binaries — the ACA target continues to handle
 * scan workloads. Phase 2 will swap in isomorphic-git to enable scan on
 * SWA too.
 *
 * The individual functions are also exported so unit tests can invoke them
 * directly without a running Functions host.
 */

export function toResponse<T>(result: HandlerResult<T>): HttpResponseInit {
  return {
    status: result.status,
    jsonBody: result.body,
    headers: {
      'X-Robots-Tag': 'noindex, nofollow',
      'Cache-Control': 'no-store',
    },
  };
}

export async function analyzeFunction(
  request: HttpRequest,
  _ctx?: InvocationContext,
): Promise<HttpResponseInit> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { status: 400, jsonBody: { error: 'Invalid JSON body' } };
  }
  const result = await handleAnalyze(body);
  return toResponse(result);
}

export async function scanFunction(): Promise<HttpResponseInit> {
  return {
    status: 501,
    jsonBody: {
      error: 'Repo scanning is not available on the public Static Web Apps deployment',
      details:
        'Use the paste endpoint, or deploy CATES Service to ACA for /api/scan support.',
    },
  };
}

export async function rulesFunction(): Promise<HttpResponseInit> {
  return toResponse(handleRules());
}

export async function healthzFunction(): Promise<HttpResponseInit> {
  return toResponse(handleHealthz());
}

export async function readyzFunction(): Promise<HttpResponseInit> {
  return toResponse(handleReadyz());
}

app.http('analyze', { route: 'analyze', methods: ['POST'], authLevel: 'anonymous', handler: analyzeFunction });
app.http('scan', { route: 'scan', methods: ['POST'], authLevel: 'anonymous', handler: scanFunction });
app.http('rules', { route: 'rules', methods: ['GET'], authLevel: 'anonymous', handler: rulesFunction });
app.http('healthz', { route: 'healthz', methods: ['GET'], authLevel: 'anonymous', handler: healthzFunction });
app.http('readyz', { route: 'readyz', methods: ['GET'], authLevel: 'anonymous', handler: readyzFunction });
