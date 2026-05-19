import { analyzeInMemory } from '../../src/analyze-in-memory.js';
import { analyze } from '../../src/analyzers/index.js';
import { RULE_CATALOG } from '../../src/rules/catalog.js';
import { resolveReviewSource } from '../../src/sources.js';
import {
  AnalyzeRequestSchema,
  ScanRequestSchema,
  SERVICE_LIMITS,
  type AnalyzeRequest,
  type ScanRequest,
  type PolicyInput,
} from '../shared/schemas.js';
import type { AnalysisResult, AnalyzerOptions } from '../../src/types.js';

/**
 * Framework-agnostic HTTP handlers. Each handler accepts raw JSON (which we
 * validate with Zod) and returns a HandlerResult. Express, Functions, or
 * any other host translates HandlerResult to its native response shape.
 *
 * Handlers never throw on validation errors — they return a typed
 * HandlerResult so wrappers can map status codes consistently.
 */

export type HandlerResult<T> =
  | { ok: true; status: 200; body: T }
  | { ok: false; status: 400 | 413 | 422 | 500 | 502; body: { error: string; details?: unknown } };

export async function handleAnalyze(rawBody: unknown): Promise<HandlerResult<AnalysisResult>> {
  const parsed = AnalyzeRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return badRequest('Invalid analyze request', parsed.error.flatten());
  }
  return runAnalyzeInMemory(parsed.data);
}

export async function handleScan(rawBody: unknown): Promise<HandlerResult<AnalysisResult>> {
  const parsed = ScanRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return badRequest('Invalid scan request', parsed.error.flatten());
  }
  return runScan(parsed.data);
}

export function handleRules(): HandlerResult<{ rules: typeof RULE_CATALOG; limits: typeof SERVICE_LIMITS }> {
  return { ok: true, status: 200, body: { rules: RULE_CATALOG, limits: SERVICE_LIMITS } };
}

export function handleHealthz(): HandlerResult<{ status: 'ok' }> {
  return { ok: true, status: 200, body: { status: 'ok' } };
}

export function handleReadyz(): HandlerResult<{ status: 'ready' }> {
  return { ok: true, status: 200, body: { status: 'ready' } };
}

// ─── Internals ───────────────────────────────────────────────────────────────

async function runAnalyzeInMemory(req: AnalyzeRequest): Promise<HandlerResult<AnalysisResult>> {
  try {
    const policyOptions = applyPolicy(req.policy);
    const result = await analyzeInMemory({
      files: req.files,
      tokenizer: req.tokenizer,
      ...policyOptions,
    });
    return { ok: true, status: 200, body: result };
  } catch (err) {
    return serverError('Analysis failed', err);
  }
}

async function runScan(req: ScanRequest): Promise<HandlerResult<AnalysisResult>> {
  let cleanup: (() => Promise<void>) | undefined;
  try {
    const resolved = await resolveReviewSource(req.url, { preferGh: false });
    cleanup = resolved.cleanup;
    const policyOptions = applyPolicy(req.policy);
    const options: Parameters<typeof analyze>[0] = {
      repoPath: resolved.analyzePath,
      tokenizer: req.tokenizer,
      ...policyOptions,
    };
    const result = await analyze(options);
    return {
      ok: true,
      status: 200,
      body: { ...result, repoPath: resolved.displayName },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/unsafe (git ref|GitHub|subpath)/i.test(message) || /Invalid GitHub/i.test(message)) {
      return badRequest('Invalid GitHub URL', message);
    }
    return { ok: false, status: 502, body: { error: 'Scan failed', details: message } };
  } finally {
    if (cleanup) await cleanup().catch(() => undefined);
  }
}

function applyPolicy(policy: PolicyInput | undefined): Partial<AnalyzerOptions> {
  if (!policy) return {};
  return {
    rules: policy.rules ?? {},
    dimensions: policy.dimensions ?? {},
  };
}

function badRequest(error: string, details: unknown): HandlerResult<never> {
  return { ok: false, status: 400, body: { error, details } };
}

function serverError(error: string, err: unknown): HandlerResult<never> {
  const details = err instanceof Error ? err.message : String(err);
  return { ok: false, status: 500, body: { error, details } };
}
