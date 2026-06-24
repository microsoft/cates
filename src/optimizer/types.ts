// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import type { AnalysisResult, ConfigScope, ConfigType, ExperimentalReport, Suppression } from '../types.js';
import type { TokenizerId } from '../utils/tokenizer.js';

/**
 * Every optimizer the tool ships is `lossless`: it only removes mechanically
 * redundant or no-op bytes (blank lines, exact duplicate instructions,
 * platform-default filler) and never rewrites or reorders meaningful guidance.
 * This is what backs the tool's "100% no loss of function" guarantee — a
 * property that can be checked deterministically, unlike an LLM rewrite.
 */
export type OptimizerSafety = 'lossless';

/** A single concrete edit an optimizer made to one file. */
export interface OptimizerChangeRecord {
  optimizerId: string;
  ruleIds: string[];
  description: string;
  /** 1-based line in the ORIGINAL file the change relates to (best-effort). */
  line?: number;
}

/** Per-file optimization outcome. */
export interface FileOptimization {
  relativePath: string;
  type: ConfigType;
  scope: ConfigScope;
  changed: boolean;
  tokensBefore: number;
  tokensAfter: number;
  tokensSaved: number;
  bytesBefore: number;
  bytesAfter: number;
  changes: OptimizerChangeRecord[];
  /** True when the no-loss invariant held and the edit was kept. */
  functionPreserved: boolean;
  /** Populated only when an edit was reverted because the invariant failed. */
  reverted?: string;
}

/** Aggregate token totals before and after optimization. */
export interface OptimizationTotals {
  activeTokensBefore: number;
  activeTokensAfter: number;
  activeTokensSaved: number;
  /** % of active config tokens removed (the headline efficiency gain). */
  activeReductionPct: number;
  alwaysLoadedTokensBefore: number;
  alwaysLoadedTokensAfter: number;
  alwaysLoadedTokensSaved: number;
  /** % of always-loaded tokens removed (saved on EVERY invocation). */
  alwaysLoadedReductionPct: number;
  filesScanned: number;
  filesChanged: number;
}

/** CATES score / findings movement caused by the optimization. */
export interface ScoreDelta {
  overallBefore: number;
  overallAfter: number;
  gradeBefore: string;
  gradeAfter: string;
  totalFindingsBefore: number;
  totalFindingsAfter: number;
  tokenEfficiencyFindingsBefore: number;
  tokenEfficiencyFindingsAfter: number;
}

/**
 * A CATES recommendation the optimizer deliberately did NOT auto-apply because
 * doing so safely requires human judgement (restructuring, rescoping, rewriting)
 * and therefore falls outside the lossless guarantee.
 */
export interface RemainingRecommendation {
  title: string;
  ruleIds: string[];
  files: string[];
  tokenSavings: number;
  effort: string;
  safety: string;
  reason: string;
}

/** Metadata describing one optimizer, surfaced in the report. */
export interface AppliedOptimizerInfo {
  id: string;
  title: string;
  ruleIds: string[];
  safety: OptimizerSafety;
  description: string;
  filesTouched: number;
  tokensSaved: number;
}

/** The achievement report the tool produces. */
export interface OptimizationResult {
  repoPath: string;
  timestamp: string;
  tokenizer: string;
  dryRun: boolean;
  /** Headline: % of active config tokens removed with no loss of function. */
  efficiencyGainPct: number;
  /** Always-loaded tokens removed — the recurring per-invocation saving. */
  estimatedTokensSavedPerInvocation: number;
  totals: OptimizationTotals;
  score: ScoreDelta;
  optimizers: AppliedOptimizerInfo[];
  files: FileOptimization[];
  remainingRecommendations: RemainingRecommendation[];
  guarantee: {
    noLossOfFunction: boolean;
    method: string;
    invariantsChecked: string[];
  };
  /**
   * Experimental (non-normative) cache/output-shaping posture, present only when
   * run with experimental mode. ADVISORY — these are never auto-applied (they
   * require human judgement and would change behavior), so they fall outside the
   * lossless guarantee. Shown so users can see the wider token impact.
   */
  experimental?: ExperimentalReport;
  /** Sibling `.orig` backups written, when --backup is set. */
  backups: string[];
  notes: string[];
}

export interface OptimizeOptions {
  repoPath: string;
  /** Reuse a prior `cates-analyzer --format json` report instead of re-analyzing. */
  report?: AnalysisResult;
  tokenizer?: TokenizerId;
  dryRun?: boolean;
  backup?: boolean;
  /** Whitelist of optimizer ids to run (defaults to all default-on optimizers). */
  only?: string[];
  /** Optimizer ids to skip. */
  skip?: string[];
  maxFiles?: number;
  maxDepth?: number;
  suppressions?: Suppression[];
  /** Surface experimental (non-normative) cache/output-shaping token impact (advisory). */
  experimental?: boolean;
}
