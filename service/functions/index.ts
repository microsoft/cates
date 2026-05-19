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
 */

function toResponse<T>(result: HandlerResult<T>): HttpResponseInit {
  return {
    status: result.status,
    jsonBody: result.body,
    headers: {
      'X-Robots-Tag': 'noindex, nofollow',
      'Cache-Control': 'no-store',
    },
  };
}

app.http('analyze', {
  route: 'analyze',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request: HttpRequest, _ctx: InvocationContext) => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return { status: 400, jsonBody: { error: 'Invalid JSON body' } };
    }
    const result = await handleAnalyze(body);
    return toResponse(result);
  },
});

app.http('scan', {
  route: 'scan',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async () => ({
    status: 501,
    jsonBody: {
      error: 'Repo scanning is not available on the public Static Web Apps deployment',
      details:
        'Use the paste endpoint, or deploy CATES Service to ACA for /api/scan support.',
    },
  }),
});

app.http('rules', {
  route: 'rules',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async () => toResponse(handleRules()),
});

app.http('healthz', {
  route: 'healthz',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async () => toResponse(handleHealthz()),
});

app.http('readyz', {
  route: 'readyz',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async () => toResponse(handleReadyz()),
});
