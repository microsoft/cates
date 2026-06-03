// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import { readFile } from 'node:fs/promises';
import { analyze } from './analyzers/index.js';
import { evaluateConformance } from './conformance.js';
import { DEFAULT_DEMO_REPOSITORIES, type DemoCategory, type DemoRepository } from './demo-repos.js';
import { resolveReviewSource } from './sources.js';
import type { AnalysisResult, Severity } from './types.js';

export interface DemoScanOptions {
  reposFile?: string;
  categories?: DemoCategory[];
  limit?: number;
  maxFiles?: number;
  maxDepth?: number;
  concurrency?: number;
  continueOnError?: boolean;
}

export interface DemoRepoResult {
  category: DemoCategory | 'custom';
  source: string;
  repoPath: string;
  score: number;
  grade: string;
  conformanceLevel: number;
  configFiles: number;
  totalTokens: number;
  alwaysLoadedTokens: number;
  projectedReductionPercentage: number;
  findingsPerThousandTokens: number;
  findings: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  topRules: Array<{ ruleId: string; count: number }>;
  error?: string;
}

export interface DemoScanResult {
  generatedAt: string;
  reposRequested: number;
  reposScanned: number;
  reposFailed: number;
  categories: Record<string, DemoCategorySummary>;
  totals: {
    findings: number;
    critical: number;
    high: number;
    configFiles: number;
    totalTokens: number;
    averageScore: number;
    averageProjectedReductionPercentage: number;
    averageFindingsPerThousandTokens: number;
  };
  topRules: Array<{ ruleId: string; count: number }>;
  repos: DemoRepoResult[];
}

export interface DemoCategorySummary {
  repos: number;
  failed: number;
  averageScore: number;
  averageProjectedReductionPercentage: number;
  averageFindingsPerThousandTokens: number;
  findings: number;
  critical: number;
  high: number;
}

export async function scanDemo(options: DemoScanOptions = {}): Promise<DemoScanResult> {
  const repositories = await getDemoRepositories(options);
  const repos = options.limit !== undefined ? repositories.slice(0, options.limit) : repositories;
  const results = await scanRepositories(repos, options);

  return summarizeDemoScan(repos.length, results);
}

async function scanRepositories(repos: DemoRepository[], options: DemoScanOptions): Promise<DemoRepoResult[]> {
  const concurrency = Math.min(Math.max(options.concurrency ?? 4, 1), 8);
  const results: DemoRepoResult[] = new Array(repos.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < repos.length) {
      const index = nextIndex++;
      const repository = repos[index]!;
      results[index] = await scanRepository(repository, options);
      if (results[index].error && options.continueOnError === false) {
        throw new Error(results[index].error);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, repos.length) }, () => worker()));
  return results;
}

async function scanRepository(repository: DemoRepository, options: DemoScanOptions): Promise<DemoRepoResult> {
  try {
    const resolved = await resolveReviewSource(repository.url, {
      preferGh: false,
    });
    try {
      const analysis = await analyze({
        repoPath: resolved.analyzePath,
        maxFiles: options.maxFiles ?? 50,
        maxDepth: options.maxDepth ?? 5,
      });
      return toDemoRepoResult(repository, resolved.displayName, analysis);
    } finally {
      await resolved.cleanup?.();
    }
  } catch (error) {
    return toFailureResult(repository, error);
  }
}

export async function getDemoRepositories(options: Pick<DemoScanOptions, 'reposFile' | 'categories'> = {}): Promise<DemoRepository[]> {
  const repositories = options.reposFile
    ? await readRepositoriesFile(options.reposFile)
    : DEFAULT_DEMO_REPOSITORIES;
  if (!options.categories?.length) return repositories;
  const allowed = new Set(options.categories);
  return repositories.filter(repository => allowed.has(repository.category));
}

async function readRepositoriesFile(path: string): Promise<DemoRepository[]> {
  const content = await readFile(path, 'utf-8');
  const repositories: DemoRepository[] = [];
  for (const [index, rawLine] of content.split('\n').entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const [categoryOrUrl = '', maybeUrl] = line.split(/\s+/);
    const category = maybeUrl ? categoryOrUrl : 'custom';
    const url = maybeUrl ?? categoryOrUrl;
    const parsed = parseGitHubUrl(url);
    if (!parsed) {
      throw new Error(`Invalid repository URL on line ${index + 1}: ${rawLine}`);
    }
    repositories.push({ category, owner: parsed.owner, repo: parsed.repo, url });
  }
  return repositories;
}

function toDemoRepoResult(repository: DemoRepository, repoPath: string, analysis: AnalysisResult): DemoRepoResult {
  const counts = severityCounts(analysis);
  const conformance = evaluateConformance(analysis);
  return {
    category: repository.category,
    source: repository.url,
    repoPath,
    score: analysis.score.overall,
    grade: analysis.score.grade,
    conformanceLevel: conformance.level,
    configFiles: analysis.discovery.files.length,
    totalTokens: analysis.discovery.totalTokens,
    alwaysLoadedTokens: analysis.discovery.alwaysLoadedTokens,
    projectedReductionPercentage: analysis.savings.projectedPercentage,
    findingsPerThousandTokens: analysis.score.findingsPerThousandTokens,
    findings: analysis.findings.length,
    critical: counts.critical,
    high: counts.high,
    medium: counts.medium,
    low: counts.low,
    topRules: topRules(analysis.findings.map(finding => finding.ruleId), 5),
  };
}

function toFailureResult(repository: DemoRepository, error: unknown): DemoRepoResult {
  return {
    category: repository.category,
    source: repository.url,
    repoPath: `${repository.owner}/${repository.repo}`,
    score: 0,
    grade: 'F',
    conformanceLevel: 0,
    configFiles: 0,
    totalTokens: 0,
    alwaysLoadedTokens: 0,
    projectedReductionPercentage: 0,
    findingsPerThousandTokens: 0,
    findings: 0,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    topRules: [],
    error: error instanceof Error ? error.message : String(error),
  };
}

function summarizeDemoScan(reposRequested: number, repos: DemoRepoResult[]): DemoScanResult {
  const scanned = repos.filter(repo => !repo.error);
  const categories: Record<string, DemoCategorySummary> = {};
  for (const category of [...new Set(repos.map(repo => repo.category))].sort()) {
    const categoryRepos = repos.filter(repo => repo.category === category);
    const categoryScanned = categoryRepos.filter(repo => !repo.error);
    categories[category] = {
      repos: categoryScanned.length,
      failed: categoryRepos.length - categoryScanned.length,
      averageScore: average(categoryScanned.map(repo => repo.score)),
      averageProjectedReductionPercentage: average(categoryScanned.map(repo => repo.projectedReductionPercentage)),
      averageFindingsPerThousandTokens: average(categoryScanned.map(repo => repo.findingsPerThousandTokens)),
      findings: sum(categoryScanned.map(repo => repo.findings)),
      critical: sum(categoryScanned.map(repo => repo.critical)),
      high: sum(categoryScanned.map(repo => repo.high)),
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    reposRequested,
    reposScanned: scanned.length,
    reposFailed: repos.length - scanned.length,
    categories,
    totals: {
      findings: sum(scanned.map(repo => repo.findings)),
      critical: sum(scanned.map(repo => repo.critical)),
      high: sum(scanned.map(repo => repo.high)),
      configFiles: sum(scanned.map(repo => repo.configFiles)),
      totalTokens: sum(scanned.map(repo => repo.totalTokens)),
      averageScore: average(scanned.map(repo => repo.score)),
      averageProjectedReductionPercentage: average(scanned.map(repo => repo.projectedReductionPercentage)),
      averageFindingsPerThousandTokens: average(scanned.map(repo => repo.findingsPerThousandTokens)),
    },
    topRules: topRules(scanned.flatMap(repo => repo.topRules.flatMap(rule => Array(rule.count).fill(rule.ruleId))), 10),
    repos,
  };
}

function severityCounts(analysis: AnalysisResult): Record<Severity, number> {
  return {
    critical: analysis.findings.filter(finding => finding.severity === 'critical').length,
    high: analysis.findings.filter(finding => finding.severity === 'high').length,
    medium: analysis.findings.filter(finding => finding.severity === 'medium').length,
    low: analysis.findings.filter(finding => finding.severity === 'low').length,
    info: analysis.findings.filter(finding => finding.severity === 'info').length,
  };
}

function topRules(ruleIds: string[], limit: number): Array<{ ruleId: string; count: number }> {
  const counts = new Map<string, number>();
  for (const ruleId of ruleIds) counts.set(ruleId, (counts.get(ruleId) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([ruleId, count]) => ({ ruleId, count }));
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round((sum(values) / values.length) * 10) / 10;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function parseGitHubUrl(url: string | undefined): { owner: string; repo: string } | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'github.com') return undefined;
    const [owner, repo] = parsed.pathname.split('/').filter(Boolean);
    if (!owner || !repo) return undefined;
    return { owner, repo: repo.replace(/\.git$/, '') };
  } catch {
    const [owner, repo] = url.split('/').filter(Boolean);
    if (!owner || !repo) return undefined;
    return { owner, repo: repo.replace(/\.git$/, '') };
  }
}
