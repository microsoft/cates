// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import type { AnalyzerOptions, AnalysisResult, AnalyzerFile, Finding } from '../types.js';
import { AnalyzerOptionsSchema } from '../types.js';
import { withTokenizer, getDefaultTokenizer } from '../utils/tokenizer.js';
import { discoverFiles } from './discovery.js';
import { analyzeTokenEfficiency } from './token-efficiency.js';
import { analyzeSecurity } from './security.js';
import { analyzeSpecificity } from './specificity.js';
import { analyzeCompleteness } from './completeness.js';
import { analyzeConflicts } from './conflicts.js';
import { analyzePrompts, analyzeMcp, analyzeSetupSteps, analyzeHooks, analyzeEditorConfig } from './components.js';
import { analyzeAgents } from './agents.js';
import { analyzeCommands } from './commands.js';
import { analyzeExperimental, type ExperimentalInput } from './experimental.js';
import { calculateScore } from '../scoring/calculator.js';
import { generateRecommendations } from '../scoring/recommendations.js';
import { calculateSavings } from '../scoring/savings.js';
import { applySuppressions } from '../suppressions.js';
import { applyRuleConfig } from '../rule-config.js';

/**
 * Main analysis orchestrator.
 * Discovers files (read from disk exactly once), runs all analyzers in
 * parallel on the in-memory content cache, computes scores, generates
 * recommendations.
 */
export async function analyze(rawOptions: Partial<AnalyzerOptions> & { repoPath: string }): Promise<AnalysisResult> {
  const options = AnalyzerOptionsSchema.parse(rawOptions);
  const tokenizer = options.tokenizer ?? getDefaultTokenizer();
  return withTokenizer(tokenizer, () => analyzeWithContext(options));
}

async function analyzeWithContext(options: AnalyzerOptions): Promise<AnalysisResult> {
  // Phase 1: Discovery (secure file enumeration + single read of every file)
  const { result: discovery, contents } = await discoverFiles(options);

  const activeFiles: AnalyzerFile[] = discovery.files
    .filter(f => f.isActive)
    .map(f => ({
      path: f.path,
      relativePath: f.relativePath,
      content: contents.get(f.path) ?? '',
    }));

  // Phase 2: Run all analyzers in parallel against the in-memory content
  // cache — no LLM calls, no second pass against the filesystem.
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
    agentFindings,
    commandFindings,
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
    analyzeAgents(activeFiles, options),
    analyzeCommands(activeFiles, options),
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

  const rawFindings: Finding[] = [
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
    ...agentFindings,
    ...commandFindings,
  ];
  // Apply rule/dimension toggles BEFORE suppressions so disabled rules never
  // contribute to scoring, gating, or counts.
  const ruleConfigResult = applyRuleConfig(rawFindings, {
    rules: options.rules,
    dimensions: options.dimensions,
  });
  const suppressionResult = applySuppressions(ruleConfigResult.findings, options.suppressions);

  // Phase 3: Score
  const score = calculateScore(suppressionResult.findings, discovery);

  // Phase 4: Recommendations (prioritized, actionable)
  const recommendations = generateRecommendations(suppressionResult.findings, discovery);
  const savings = calculateSavings(score, discovery, recommendations);

  // Phase 5 (opt-in): Experimental cache/output-shaping. Strictly isolated —
  // produced only when enabled, written to a separate channel, zero score impact.
  let experimental: AnalysisResult['experimental'];
  if (options.experimental) {
    const experimentalInput: ExperimentalInput[] = discovery.files
      .filter(f => f.isActive)
      .map(f => ({
        relativePath: f.relativePath,
        content: contents.get(f.path) ?? '',
        scope: f.scope,
        type: f.type,
      }));
    experimental = analyzeExperimental(experimentalInput, options);
  }

  return {
    repoPath: options.repoPath,
    timestamp: new Date().toISOString(),
    discovery,
    score,
    savings,
    findings: suppressionResult.findings,
    suppressedFindings: suppressionResult.suppressedFindings,
    suppressionSummary: suppressionResult.summary,
    recommendations,
    disabledFindings: ruleConfigResult.disabledFindings,
    disabledRuleIds: ruleConfigResult.disabledRuleIds,
    disabledDimensions: ruleConfigResult.disabledDimensions,
    ...(experimental ? { experimental } : {}),
  };
}
