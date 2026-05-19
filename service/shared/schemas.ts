import { z } from 'zod';

// ─── Shared scalar schemas ───────────────────────────────────────────────────

export const SeveritySchema = z.enum(['critical', 'high', 'medium', 'low', 'info']);
export const DimensionSchema = z.enum([
  'token-efficiency',
  'security',
  'specificity',
  'completeness',
  'conflict-reachability',
  'harness-quality',
]);
export const TokenizerSchema = z.enum([
  'openai-cl100k',
  'openai-o200k',
  'anthropic-claude',
  'approx',
]);

// ─── Policy subset accepted over the wire ────────────────────────────────────
// Mirrors CatesPolicy in src/policy.ts. We deliberately accept only the long
// form (`{ enabled, severity }`) over HTTP — shorthand parsing is for the
// hand-edited .cates.yml on disk. The web UI builds the long form.

export const RuleOverrideSchema = z.object({
  enabled: z.boolean().optional(),
  severity: SeveritySchema.optional(),
});

export const PolicyInputSchema = z
  .object({
    minScore: z.number().min(0).max(100).optional(),
    requireLevel: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    failOn: z.array(SeveritySchema).optional(),
    maxAlwaysLoadedTokens: z.number().int().nonnegative().optional(),
    rules: z.record(z.string().min(1), RuleOverrideSchema).optional(),
    dimensions: z.record(DimensionSchema, RuleOverrideSchema).optional(),
  })
  .strict();

export type PolicyInput = z.infer<typeof PolicyInputSchema>;

// ─── Requests ────────────────────────────────────────────────────────────────

// Hard limits keep the service stateless and DoS-resistant on shared hosts
// like Azure Functions consumption plans.
const MAX_FILES_PER_REQUEST = 50;
const MAX_BYTES_PER_FILE = 100_000; // 100 KB
const MAX_TOTAL_BYTES = 1_000_000; // 1 MB

export const FilePayloadSchema = z.object({
  path: z
    .string()
    .min(1)
    .max(512)
    .refine(p => !p.startsWith('/') && !p.includes('..'), {
      message: 'Path must be repo-relative and not contain ..',
    }),
  content: z.string().max(MAX_BYTES_PER_FILE, {
    message: `File content exceeds ${MAX_BYTES_PER_FILE} bytes`,
  }),
});

export const AnalyzeRequestSchema = z
  .object({
    files: z
      .array(FilePayloadSchema)
      .min(1)
      .max(MAX_FILES_PER_REQUEST)
      .refine(
        files => files.reduce((sum, f) => sum + f.content.length, 0) <= MAX_TOTAL_BYTES,
        { message: `Total payload exceeds ${MAX_TOTAL_BYTES} bytes` },
      ),
    policy: PolicyInputSchema.optional(),
    tokenizer: TokenizerSchema.optional(),
  })
  .strict();

export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;

export const ScanRequestSchema = z
  .object({
    // Must be a GitHub URL — argv-injection guards in parseGitHubLink will
    // additionally validate the components before any shell-out happens.
    url: z
      .string()
      .url()
      .refine(u => {
        try {
          return new URL(u).hostname.toLowerCase() === 'github.com';
        } catch {
          return false;
        }
      }, { message: 'Only github.com URLs are accepted' }),
    policy: PolicyInputSchema.optional(),
    tokenizer: TokenizerSchema.optional(),
  })
  .strict();

export type ScanRequest = z.infer<typeof ScanRequestSchema>;

// ─── Limits exposed for callers (UI, docs, OpenAPI) ──────────────────────────

export const SERVICE_LIMITS = {
  maxFilesPerRequest: MAX_FILES_PER_REQUEST,
  maxBytesPerFile: MAX_BYTES_PER_FILE,
  maxTotalBytes: MAX_TOTAL_BYTES,
} as const;
