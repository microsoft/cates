// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import type { AnalysisResult, Severity } from './types.js';
import type { CatesPolicy } from './policy.js';

export interface ConformanceResult {
  level: 0 | 1 | 2 | 3;
  label: string;
  passed: boolean;
  failures: string[];
  nextLevelActions: string[];
}

export interface GateResult {
  passed: boolean;
  failures: string[];
}

export function evaluateConformance(result: AnalysisResult, policy: CatesPolicy = {}): ConformanceResult {
  const level1 = level1Failures(result);
  const level2 = [...level1, ...level2Failures(result)];
  const level3 = [...level2, ...level3Failures(result)];
  const level: 0 | 1 | 2 | 3 = level1.length > 0 ? 0 : level2.length > 0 ? 1 : level3.length > 0 ? 2 : 3;
  const required = policy.requireLevel ?? 1;
  const failures = required === 1 ? level1 : required === 2 ? level2 : level3;

  return {
    level,
    label: level === 0 ? 'Not conformant' : `CATES Level ${level}`,
    passed: level >= required,
    failures,
    nextLevelActions: nextActions(result, level),
  };
}

export function evaluateGates(result: AnalysisResult, policy: CatesPolicy = {}, cli: CatesPolicy = {}): GateResult {
  const merged: CatesPolicy = { ...policy, ...removeUndefined(cli) };
  const failures: string[] = [];

  if (merged.minScore !== undefined && result.score.overall < merged.minScore) {
    failures.push(`Score ${result.score.overall} is below required minimum ${merged.minScore}.`);
  }
  if (merged.maxAlwaysLoadedTokens !== undefined && result.discovery.alwaysLoadedTokens > merged.maxAlwaysLoadedTokens) {
    failures.push(`Always-loaded tokens ${result.discovery.alwaysLoadedTokens} exceed maximum ${merged.maxAlwaysLoadedTokens}.`);
  }
  if (merged.failOn?.length) {
    const severities = new Set<Severity>(merged.failOn);
    const count = result.findings.filter(f => severities.has(f.severity)).length;
    if (count > 0) failures.push(`${count} finding(s) matched fail-on severities: ${merged.failOn.join(', ')}.`);
  }
  if (merged.requireLevel !== undefined) {
    const conf = evaluateConformance(result, { requireLevel: merged.requireLevel });
    if (!conf.passed) failures.push(...conf.failures.map(f => `Level ${merged.requireLevel}: ${f}`));
  }

  return { passed: failures.length === 0, failures };
}

function level1Failures(result: AnalysisResult): string[] {
  const failures: string[] = [];
  if (result.score.criticalCount > 0) failures.push('Critical findings must be resolved.');
  if (result.findings.some(f => f.ruleId === 'SEC001')) failures.push('Hardcoded secrets must be removed.');
  if (result.score.overall < 40) failures.push('Overall score must be at least 40.');
  if (result.discovery.files.length === 0) failures.push('At least one coding-agent configuration file must be measured.');
  return failures;
}

function level2Failures(result: AnalysisResult): string[] {
  const failures: string[] = [];
  if (result.findings.some(f => f.severity === 'critical' || f.severity === 'high')) failures.push('Critical and high findings must be resolved.');
  if (result.score.overall < 70) failures.push('Overall score must be at least 70.');
  if (result.discovery.alwaysLoadedTokens > 1500) failures.push('Always-loaded tokens must be at or below 1,500.');
  if (result.findings.some(f => f.ruleId === 'SEC004')) failures.push('Prompt protection must be present in instruction-bearing configs.');
  if (result.findings.some(f => f.ruleId === 'CNF001')) failures.push('Contradictory instructions must be resolved.');
  return failures;
}

function level3Failures(result: AnalysisResult): string[] {
  const failures: string[] = [];
  if (result.findings.some(f => f.severity !== 'low' && f.severity !== 'info')) failures.push('No findings above low severity may remain.');
  if (result.score.overall < 90) failures.push('Overall score must be at least 90.');
  if (result.discovery.alwaysLoadedTokens > 800) failures.push('Always-loaded tokens must be at or below 800.');
  if (result.findings.some(f => f.ruleId === 'MCP004')) failures.push('All MCP servers/tools must have descriptions.');
  if (result.findings.some(f => f.ruleId === 'PRM001')) failures.push('All prompt files must have purpose headers.');
  return failures;
}

function nextActions(result: AnalysisResult, level: 0 | 1 | 2 | 3): string[] {
  if (level === 3) return ['Maintain Level 3 by keeping CI gates enabled.'];
  const targetFailures = level === 0 ? level1Failures(result) : level === 1 ? level2Failures(result) : level3Failures(result);
  return targetFailures.slice(0, 5);
}

function removeUndefined(policy: CatesPolicy): CatesPolicy {
  return Object.fromEntries(Object.entries(policy).filter(([, value]) => value !== undefined)) as CatesPolicy;
}
