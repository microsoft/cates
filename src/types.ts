import { z } from 'zod';

// ─── Scoring Types ───────────────────────────────────────────────────────────

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type Confidence = 'certain' | 'high' | 'medium' | 'low';

export type Dimension =
  | 'token-efficiency'
  | 'security'
  | 'specificity'
  | 'completeness'
  | 'conflict-reachability'
  | 'harness-quality';

export interface Finding {
  ruleId: string;
  dimension: Dimension;
  severity: Severity;
  confidence: Confidence;
  message: string;
  file: string;
  line?: number;
  evidence?: string;
  suggestion?: string;
  tokenImpact?: number; // estimated tokens saved if fixed
}

export interface Suppression {
  ruleId: string;
  file?: string;
  reason: string;
  expires?: string;
  owner?: string;
}

export interface SuppressionSummary {
  active: number;
  expired: number;
  suppressedFindings: number;
}

export interface DimensionScore {
  dimension: Dimension;
  score: number; // 0-100
  weight: number;
  findings: Finding[];
  deductions: Array<{ severity: Severity; count: number; points: number }>;
  summary: string;
}

export interface Score {
  overall: number; // 0-100
  grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
  dimensions: DimensionScore[];
  totalFindings: number;
  criticalCount: number;
  estimatedTokenWaste: number; // avoidable tokens per invocation
  estimatedTokenSavingsPercentage: number; // percent of analyzed active config tokens
  findingsPerThousandTokens: number;
}

export interface SavingsEstimate {
  conservativeTokensPerInvocation: number;
  conservativePercentage: number;
  projectedTokensPerInvocation: number;
  projectedPercentage: number;
}

// ─── Discovery Types ─────────────────────────────────────────────────────────

export type ConfigScope = 'always-loaded' | 'conditional' | 'on-demand' | 'unknown';
export type ConfigType =
  | 'root-instructions'
  | 'agents-md'
  | 'chat-config'
  | 'agent-definition'
  | 'skill-definition'
  | 'prompt-file'
  | 'rules-config'
  | 'setup-steps'
  | 'hooks-config'
  | 'mcp-config'
  | 'vision-config'
  | 'editor-config'
  | 'extension-config'
  | 'unknown';

export interface DiscoveredFile {
  path: string;
  relativePath: string;
  type: ConfigType;
  scope: ConfigScope;
  sizeBytes: number;
  tokenCount: number;
  isActive: boolean; // false = dead/unreachable file
}

/**
 * A discovered file with its already-loaded content. Passed to all
 * analyzers so each file is read from disk exactly once per analysis run.
 */
export interface AnalyzerFile {
  path: string;
  relativePath: string;
  content: string;
}

export interface DiscoveryResult {
  files: DiscoveredFile[];
  totalTokens: number;
  alwaysLoadedTokens: number;
  conditionalTokens: number;
  deadFileTokens: number;
  /** Canonical tokenizer used to compute the counts above. */
  tokenizer?: string;
  /**
   * Optional side-by-side totals across additional tokenizers. Populated
   * when AnalyzerOptions.compareTokenizers is set. Always includes the
   * canonical tokenizer so reports can render a single table.
   */
  totalTokensByTokenizer?: Record<string, number>;
}

// ─── Analysis Types ──────────────────────────────────────────────────────────

export interface AnalysisResult {
  repoPath: string;
  timestamp: string;
  discovery: DiscoveryResult;
  score: Score;
  savings: SavingsEstimate;
  findings: Finding[];
  suppressedFindings: Finding[];
  suppressionSummary: SuppressionSummary;
  recommendations: Recommendation[];
  disabledFindings?: Finding[];
  disabledRuleIds?: string[];
  disabledDimensions?: Dimension[];
}

export interface Recommendation {
  priority: number; // 1 = highest
  title: string;
  description: string;
  tokenSavings: number;
  tokenSavingsPercentage?: number; // percent of analyzed active config tokens
  tokenSavingsKind?: 'direct' | 'projected';
  effort: 'trivial' | 'easy' | 'moderate' | 'significant';
  ruleIds: string[];
  files: string[];
  safety: 'safe' | 'review-required' | 'manual';
  autofixable: boolean;
  before?: string;
  after?: string;
}

// ─── Options ─────────────────────────────────────────────────────────────────

export const AnalyzerOptionsSchema = z.object({
  repoPath: z.string(),
  outputFormat: z.enum(['json', 'pretty', 'sarif']).default('pretty'),
  includeEvidence: z.boolean().default(true),
  maxFileSize: z.number().int().positive().default(100_000), // 100KB max per file
  maxFiles: z.number().int().positive().default(50),
  maxDepth: z.number().int().nonnegative().default(5),
  includeFiles: z.array(z.string().min(1)).optional(),
  tokenizer: z.enum(['openai-cl100k', 'openai-o200k', 'anthropic-claude', 'approx']).optional(),
  compareTokenizers: z.array(z.enum(['openai-cl100k', 'openai-o200k', 'anthropic-claude', 'approx'])).optional(),
  suppressions: z.array(z.object({
    ruleId: z.string().min(1),
    file: z.string().min(1).optional(),
    reason: z.string().min(1),
    expires: z.string().min(1).optional(),
    owner: z.string().min(1).optional(),
  })).default([]),
  rules: z.record(z.string(), z.object({
    enabled: z.boolean().optional(),
    severity: z.enum(['critical', 'high', 'medium', 'low', 'info']).optional(),
  })).default({}),
  dimensions: z.record(
    z.enum([
      'token-efficiency',
      'security',
      'specificity',
      'completeness',
      'conflict-reachability',
      'harness-quality',
    ]),
    z.object({
      enabled: z.boolean().optional(),
      severity: z.enum(['critical', 'high', 'medium', 'low', 'info']).optional(),
    }),
  ).default({}),
});

export type AnalyzerOptions = z.infer<typeof AnalyzerOptionsSchema>;
