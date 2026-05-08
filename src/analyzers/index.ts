import type { AnalyzerOptions, AnalysisResult, Finding } from '../types.js';
import { AnalyzerOptionsSchema } from '../types.js';
import { discoverFiles } from './discovery.js';
import { analyzeTokenEfficiency } from './token-efficiency.js';
import { analyzeSecurity } from './security.js';
import { analyzeSpecificity } from './specificity.js';
import { analyzeCompleteness } from './completeness.js';
import { analyzeConflicts } from './conflicts.js';
import { analyzePrompts, analyzeMcp, analyzeSetupSteps, analyzeHooks, analyzeEditorConfig } from './components.js';
import { calculateScore } from '../scoring/calculator.js';
import { generateRecommendations } from '../scoring/recommendations.js';
import { calculateSavings } from '../scoring/savings.js';

/**
 * Main analysis orchestrator.
 * Discovers files, runs all analyzers, computes scores, generates recommendations.
 */
export async function analyze(rawOptions: Partial<AnalyzerOptions> & { repoPath: string }): Promise<AnalysisResult> {
  const options = AnalyzerOptionsSchema.parse(rawOptions);

  // Phase 1: Discovery (secure file enumeration)
  const discovery = await discoverFiles(options);

  const activeFiles = discovery.files
    .filter(f => f.isActive)
    .map(f => ({ path: f.path, relativePath: f.relativePath }));

  // Phase 2: Run all analyzers in parallel (no LLM calls — pure heuristics)
  const [
    tokenFindings,
    securityFindings,
    specificityFindings,
    completenessFindings,
    conflictFindings,
    promptFindings,
    mcpFindings,
    setupFindings,
    hookFindings,
    editorFindings,
  ] = await Promise.all([
    analyzeTokenEfficiency(activeFiles, options),
    analyzeSecurity(activeFiles, options),
    analyzeSpecificity(activeFiles, options),
    analyzeCompleteness(activeFiles, options),
    analyzeConflicts(activeFiles, options),
    analyzePrompts(activeFiles, options),
    analyzeMcp(activeFiles, options),
    analyzeSetupSteps(activeFiles, options),
    analyzeHooks(activeFiles, options),
    analyzeEditorConfig(activeFiles, options),
  ]);

  const budgetFindings: Finding[] = [];
  if (discovery.alwaysLoadedTokens > 1500) {
    budgetFindings.push({
      ruleId: 'TE001',
      dimension: 'token-efficiency',
      severity: 'medium',
      confidence: 'certain',
      message: `Always-loaded configuration is ${discovery.alwaysLoadedTokens.toLocaleString()} tokens, exceeding the 1,500-token CATES budget.`,
      file: '(always-loaded configuration set)',
      suggestion: 'Move context-specific guidance to conditional agent files or on-demand prompt files so it is only loaded when relevant.',
      tokenImpact: discovery.alwaysLoadedTokens - 1500,
    });
  }

  const allFindings: Finding[] = [
    ...budgetFindings,
    ...tokenFindings,
    ...securityFindings,
    ...specificityFindings,
    ...completenessFindings,
    ...conflictFindings,
    ...promptFindings,
    ...mcpFindings,
    ...setupFindings,
    ...hookFindings,
    ...editorFindings,
  ];

  // Phase 3: Score
  const score = calculateScore(allFindings, discovery, options);

  // Phase 4: Recommendations (prioritized, actionable)
  const recommendations = generateRecommendations(allFindings, discovery, options);
  const savings = calculateSavings(score, discovery, recommendations, options);

  return {
    repoPath: options.repoPath,
    timestamp: new Date().toISOString(),
    discovery,
    score,
    savings,
    findings: allFindings,
    recommendations,
  };
}
