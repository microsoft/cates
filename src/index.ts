// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * CATES Configuration Analyzer
 *
 * Analyzes coding-agent configuration files for:
 * - Token efficiency (heuristic configuration-token opportunities)
 * - Security (detectable static patterns, not proof of effective protection)
 * - Quality (specificity, completeness, conflict-free)
 *
 * Core design principles:
 * 1. Zero LLM calls for deterministic scoring (dogfooding token efficiency)
 * 2. Sandboxed file reads with adversarial hardening
 * 3. Real tokenizer-based context measurement (js-tiktoken)
 * 4. Config precedence awareness (which files are always-loaded vs conditional)
 */

export { analyze } from './analyzers/index.js';
export { analyzeInMemory } from './analyze-in-memory.js';
export type { AnalyzeInMemoryFile, AnalyzeInMemoryOptions } from './analyze-in-memory.js';
export { createReport } from './scoring/report.js';
export { RuntimeEvidenceSchema, summarizeRuntimeEvidence, assessmentSummary } from './assurance.js';
export type { RuntimeEvidence, RuntimeEvidenceSummary } from './assurance.js';
export { evaluateConformance, evaluateGates } from './conformance.js';
export { RULE_CATALOG, getRule } from './rules/catalog.js';
export { ANALYZER_VERSION } from './version.js';
export type { AnalysisResult, Finding, Score, AnalyzerOptions } from './types.js';
export { COPILOT_CHECKS, getCopilotCheck } from './copilot/catalog.js';
export { formatCopilot } from './copilot/report.js';
export type { CopilotReport, CopilotFinding, CopilotCheck, CopilotSurface } from './copilot/types.js';
export type { CopilotTarget, DiscoveryDiagnostic } from './types.js';

// Experimental, separately invoked runtime accounting; never part of analyze().
export { analyzeEconomics, formatEconomics, EconomicsInputSchema, ECONOMICS_LIMITS } from './economics/index.js';
export type { EconomicsInput, EconomicsReport, RequestEconomics } from './economics/index.js';

// Optimizer: a separate, deliberately-invoked tool that rewrites primitives for
// source-token reduction with structural text checks, not behavioral guarantees.
export { optimize } from './optimizer/index.js';
export { OPTIMIZERS, selectOptimizers, meaningfulSignature } from './optimizer/optimizers.js';
export { renderOptimizationReport } from './optimizer/report.js';
export type { OptimizationReportFormat } from './optimizer/report.js';
export type { OptimizationResult, OptimizeOptions } from './optimizer/types.js';
