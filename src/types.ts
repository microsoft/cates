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

export interface DimensionScore {
  dimension: Dimension;
  score: number; // 0-100
  weight: number;
  findings: Finding[];
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
  estimatedMonthlyTokenWaste: number;
  estimatedMonthlyCostWaste: number; // USD at avg model price
}

export interface SavingsEstimate {
  conservativeTokensPerInvocation: number;
  conservativePercentage: number;
  projectedTokensPerInvocation: number;
  projectedPercentage: number;
  projectedMonthlyTokens: number;
  projectedMonthlyCost: number;
  projectedAnnualTokens: number;
  projectedAnnualCost: number;
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

export interface DiscoveryResult {
  files: DiscoveredFile[];
  totalTokens: number;
  alwaysLoadedTokens: number;
  conditionalTokens: number;
  deadFileTokens: number;
}

// ─── Analysis Types ──────────────────────────────────────────────────────────

export interface AnalysisResult {
  repoPath: string;
  timestamp: string;
  discovery: DiscoveryResult;
  score: Score;
  savings: SavingsEstimate;
  findings: Finding[];
  recommendations: Recommendation[];
}

export interface Recommendation {
  priority: number; // 1 = highest
  title: string;
  description: string;
  tokenSavings: number;
  tokenSavingsPercentage?: number; // percent of analyzed active config tokens
  tokenSavingsKind?: 'direct' | 'projected';
  costSavings: number; // USD/month estimated
  effort: 'trivial' | 'easy' | 'moderate' | 'significant';
  before?: string;
  after?: string;
}

// ─── Options ─────────────────────────────────────────────────────────────────

export const AnalyzerOptionsSchema = z.object({
  repoPath: z.string(),
  outputFormat: z.enum(['json', 'pretty', 'sarif']).default('pretty'),
  includeEvidence: z.boolean().default(true),
  maxFileSize: z.number().default(100_000), // 100KB max per file
  maxFiles: z.number().default(50),
  maxDepth: z.number().default(5),
  includeFiles: z.array(z.string()).optional(),
  assumedDailyInvocations: z.number().default(50), // for cost modeling
  assumedModelCostPer1kTokens: z.number().default(0.01), // avg blended
});

export type AnalyzerOptions = z.infer<typeof AnalyzerOptionsSchema>;
