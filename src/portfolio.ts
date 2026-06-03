// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { analyze } from './analyzers/index.js';
import { evaluateConformance } from './conformance.js';
import type { AnalysisResult } from './types.js';

export interface PortfolioRepoResult {
  path: string;
  score: number;
  grade: string;
  level: number;
  findings: number;
  critical: number;
  alwaysLoadedTokens: number;
  tokenSavingsPercentage: number;
}

export interface PortfolioResult {
  rootPath: string;
  repos: PortfolioRepoResult[];
  totals: {
    repos: number;
    findings: number;
    critical: number;
    projectedTokenSavingsPercentage: number;
  };
}

export async function scanPortfolio(rootPath: string): Promise<PortfolioResult> {
  const root = resolve(rootPath);
  const entries = await readdir(root, { withFileTypes: true });
  const dirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
    .map(e => join(root, e.name));

  const repos: PortfolioRepoResult[] = [];
  for (const dir of dirs) {
    const result: AnalysisResult = await analyze({ repoPath: dir });
    if (result.discovery.files.length === 0) continue;
    const conformance = evaluateConformance(result);
    repos.push({
      path: dir,
      score: result.score.overall,
      grade: result.score.grade,
      level: conformance.level,
      findings: result.findings.length,
      critical: result.score.criticalCount,
      alwaysLoadedTokens: result.discovery.alwaysLoadedTokens,
      tokenSavingsPercentage: result.savings.projectedPercentage,
    });
  }

  return {
    rootPath: root,
    repos,
    totals: {
      repos: repos.length,
      findings: repos.reduce((sum, r) => sum + r.findings, 0),
      critical: repos.reduce((sum, r) => sum + r.critical, 0),
      projectedTokenSavingsPercentage: average(repos.map(repo => repo.tokenSavingsPercentage)),
    },
  };
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
