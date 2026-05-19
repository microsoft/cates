/**
 * CATES Configuration Analyzer
 *
 * Analyzes coding-agent configuration files for:
 * - Token efficiency (minimize waste per invocation)
 * - Security (no leaks, no injection vectors, no overly permissive instructions)
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
export { evaluateConformance, evaluateGates } from './conformance.js';
export { RULE_CATALOG, getRule } from './rules/catalog.js';
export type { AnalysisResult, Finding, Score, AnalyzerOptions } from './types.js';
