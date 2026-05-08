#!/usr/bin/env node

import { program } from 'commander';
import { resolve } from 'node:path';
import { analyze } from '../analyzers/index.js';
import { createReport } from '../scoring/report.js';
import { loadPolicy, type CatesPolicy } from '../policy.js';
import { evaluateConformance, evaluateGates } from '../conformance.js';
import { applySafeFixes } from '../autofix.js';
import { getRule, RULE_CATALOG, rulesAsJson } from '../rules/catalog.js';
import { scanPortfolio } from '../portfolio.js';
import { resolveReviewSource } from '../sources.js';
import type { AnalysisResult, Severity } from '../types.js';

program
  .name('cates-analyzer')
  .description('Analyze coding agent configurations for token efficiency, security, and CATES conformance')
  .version('1.0.0');

program
  .command('analyze', { isDefault: true })
  .description('Analyze one repository')
  .argument('[path]', 'Path to repository root', '.')
  .option('-f, --format <format>', 'Output format: pretty, json, sarif', 'pretty')
  .option('--policy <path>', 'Path to .cates.yml/.json policy file')
  .option('--invocations <n>', 'Assumed daily invocations for cost modeling')
  .option('--cost <n>', 'Cost per 1k tokens (USD) for cost modeling')
  .option('--max-files <n>', 'Maximum config files to analyze', '50')
  .option('--max-depth <n>', 'Maximum directory traversal depth', '5')
  .option('--files <list>', 'Comma-separated relative file paths to analyze instead of auto-discovery')
  .option('--individual', 'Analyze each --files entry separately')
  .option('--no-evidence', 'Omit evidence snippets from output')
  .option('--min-score <n>', 'Fail if score is below this value')
  .option('--require-level <n>', 'Fail unless CATES conformance level is at least 1, 2, or 3')
  .option('--fail-on <list>', 'Comma-separated severities that fail the run (e.g. critical,high)')
  .option('--max-always-loaded <n>', 'Fail if always-loaded tokens exceed this value')
  .option('--fix', 'Apply safe automatic fixes')
  .option('--fix-dry-run', 'Show safe automatic fixes without writing files')
  .action(async (path: string, opts) => runAnalyze(path, opts));

program
  .command('review')
  .description('Review a local folder or GitHub URL against CATES')
  .argument('<source>', 'Local folder or GitHub URL (repo, tree, blob, or pull request)')
  .option('-f, --format <format>', 'Output format: pretty, json, sarif', 'pretty')
  .option('--policy <path>', 'Path to .cates.yml/.json policy file')
  .option('--invocations <n>', 'Assumed daily invocations for cost modeling')
  .option('--cost <n>', 'Cost per 1k tokens (USD) for cost modeling')
  .option('--max-files <n>', 'Maximum config files to analyze', '50')
  .option('--max-depth <n>', 'Maximum directory traversal depth', '5')
  .option('--files <list>', 'Comma-separated relative file paths to analyze instead of auto-discovery')
  .option('--individual', 'Analyze each --files entry separately')
  .option('--no-evidence', 'Omit evidence snippets from output')
  .option('--min-score <n>', 'Fail if score is below this value')
  .option('--require-level <n>', 'Fail unless CATES conformance level is at least 1, 2, or 3')
  .option('--fail-on <list>', 'Comma-separated severities that fail the run (e.g. critical,high)')
  .option('--max-always-loaded <n>', 'Fail if always-loaded tokens exceed this value')
  .option('--keep-worktree', 'Keep temporary clone after reviewing GitHub sources')
  .option('--no-gh', 'Use git directly instead of gh for GitHub sources')
  .action(async (source: string, opts) => runReview(source, opts));

program
  .command('conformance')
  .description('Evaluate CATES conformance level for one repository')
  .argument('[path]', 'Path to repository root', '.')
  .option('-f, --format <format>', 'Output format: pretty or json', 'pretty')
  .option('--policy <path>', 'Path to .cates.yml/.json policy file')
  .option('--require-level <n>', 'Required CATES level', '1')
  .action(async (path: string, opts) => {
    const repoPath = resolve(path);
    const policy = await loadPolicy(repoPath, opts.policy);
    const result = await analyze({ repoPath });
    const conformance = evaluateConformance(result, { ...policy, requireLevel: parseLevel(opts.requireLevel) });
    if (opts.format === 'json') {
      process.stdout.write(JSON.stringify({ repoPath, conformance }, null, 2) + '\n');
    } else {
      process.stdout.write(formatConformance(conformance) + '\n');
    }
    process.exit(conformance.passed ? 0 : 1);
  });

program
  .command('rules')
  .description('Print the machine-readable CATES rule catalog')
  .option('-f, --format <format>', 'Output format: json or pretty', 'json')
  .action((opts) => {
    if (opts.format === 'pretty') {
      for (const rule of RULE_CATALOG) {
        process.stdout.write(`${rule.id} ${rule.title} [${rule.severity}/${rule.dimension}]\n  ${rule.summary}\n`);
      }
    } else {
      process.stdout.write(rulesAsJson() + '\n');
    }
  });

program
  .command('explain')
  .description('Explain a CATES rule')
  .argument('<ruleId>', 'Rule ID, e.g. TE004')
  .action((ruleId: string) => {
    const rule = getRule(ruleId.toUpperCase());
    if (!rule) {
      console.error(`Unknown CATES rule: ${ruleId}`);
      process.exit(1);
    }
    process.stdout.write(`${rule.id} — ${rule.title}\n\nDimension: ${rule.dimension}\nSeverity: ${rule.severity}\nCATES section: ${rule.catesSection}\n\n${rule.summary}\n\nDetection: ${rule.detection}\n\nRemediation: ${rule.remediation}\n`);
  });

program
  .command('portfolio')
  .description('Scan child repositories under a directory')
  .argument('[path]', 'Directory containing repositories', '.')
  .option('-f, --format <format>', 'Output format: pretty or json', 'pretty')
  .action(async (path: string, opts) => {
    const portfolio = await scanPortfolio(path);
    if (opts.format === 'json') {
      process.stdout.write(JSON.stringify(portfolio, null, 2) + '\n');
    } else {
      process.stdout.write(formatPortfolio(portfolio) + '\n');
    }
  });

async function runAnalyze(path: string, opts: Record<string, unknown>): Promise<void> {
  const repoPath = resolve(path);
  try {
    const exitCode = await executeAnalyze(repoPath, opts);
    if (exitCode !== 0) process.exit(exitCode);
  } catch (err) {
    console.error('Error:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

async function executeAnalyze(repoPath: string, opts: Record<string, unknown>, displayPath?: string): Promise<number> {
  const policy = await loadPolicy(repoPath, stringOpt(opts.policy));
  const includeFiles = fileListOpt(opts.files);
  const format = formatOpt(opts.format);

  if (opts.individual) {
    if (includeFiles.length === 0) throw new Error('--individual requires --files');
    if (format === 'sarif') throw new Error('--individual is only supported with pretty or json output');
    if (opts.fix || opts.fixDryRun) throw new Error('--individual cannot be combined with --fix or --fix-dry-run');

    const results: AnalysisResult[] = [];
    let exitCode = 0;
    for (const includeFile of includeFiles) {
      const result = await analyze(buildAnalyzeOptions(repoPath, opts, policy, [includeFile]));
      results.push(withDisplayPath(result, displayPathFor(repoPath, displayPath, includeFile)));
      exitCode ||= evaluateResultGates(result, policy, opts);
    }

    if (format === 'json') {
      process.stdout.write(JSON.stringify(results, null, 2) + '\n');
    } else {
      process.stdout.write(results.map(result => createReport(result, format)).join('\n') + '\n');
    }
    return exitCode;
  }

  const result = await analyze(buildAnalyzeOptions(repoPath, opts, policy, includeFiles));

  if (opts.fix || opts.fixDryRun) {
    const fixResult = await applySafeFixes(result, Boolean(opts.fixDryRun));
    process.stdout.write(JSON.stringify(fixResult, null, 2) + '\n');
    return 0;
  }

  const reportResult = displayPath ? { ...result, repoPath: displayPath } : result;
  process.stdout.write(createReport(reportResult, format) + '\n');

  return evaluateResultGates(result, policy, opts);
}

function buildAnalyzeOptions(
  repoPath: string,
  opts: Record<string, unknown>,
  policy: CatesPolicy,
  includeFiles: string[],
): Parameters<typeof analyze>[0] {
  return {
    repoPath,
    outputFormat: formatOpt(opts.format),
    includeEvidence: opts.evidence !== false,
    assumedDailyInvocations: numberOpt(opts.invocations) ?? policy.assumedDailyInvocations ?? 50,
    assumedModelCostPer1kTokens: numberOpt(opts.cost) ?? policy.assumedModelCostPer1kTokens ?? 0.01,
    maxFiles: numberOpt(opts.maxFiles) ?? 50,
    maxDepth: numberOpt(opts.maxDepth) ?? 5,
    includeFiles: includeFiles.length > 0 ? includeFiles : undefined,
  };
}

function evaluateResultGates(result: AnalysisResult, policy: CatesPolicy, opts: Record<string, unknown>): number {
  const gatePolicy: CatesPolicy = {
    minScore: numberOpt(opts.minScore),
    requireLevel: parseLevelOpt(opts.requireLevel),
    failOn: severityList(opts.failOn),
    maxAlwaysLoadedTokens: numberOpt(opts.maxAlwaysLoaded),
  };
  const gates = evaluateGates(result, policy, gatePolicy);
  if (!gates.passed) {
    for (const failure of gates.failures) console.error(`CATES gate failed: ${failure}`);
    return 1;
  }
  return 0;
}

function withDisplayPath(result: AnalysisResult, repoPath: string): AnalysisResult {
  return { ...result, repoPath };
}

function displayPathFor(repoPath: string, displayPath: string | undefined, includeFile: string): string {
  return `${displayPath ?? repoPath}:${includeFile}`;
}

async function runReview(source: string, opts: Record<string, unknown>): Promise<void> {
  try {
    const resolved = await resolveReviewSource(source, {
      keepWorktree: Boolean(opts.keepWorktree),
      preferGh: opts.gh !== false,
    });
    try {
      const exitCode = await executeAnalyze(resolved.analyzePath, opts, resolved.displayName);
      if (exitCode !== 0) process.exit(exitCode);
    } finally {
      await resolved.cleanup?.();
    }
  } catch (err) {
    console.error('Error:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

function formatConformance(conformance: ReturnType<typeof evaluateConformance>): string {
  const lines = [`${conformance.label}`, `Passed required level: ${conformance.passed ? 'yes' : 'no'}`];
  if (conformance.failures.length) lines.push('', 'Failures:', ...conformance.failures.map(f => `- ${f}`));
  if (conformance.nextLevelActions.length) lines.push('', 'Next actions:', ...conformance.nextLevelActions.map(a => `- ${a}`));
  return lines.join('\n');
}

function formatPortfolio(portfolio: Awaited<ReturnType<typeof scanPortfolio>>): string {
  const lines = [
    `CATES Portfolio: ${portfolio.rootPath}`,
    `Repositories: ${portfolio.totals.repos}`,
    `Findings: ${portfolio.totals.findings} (${portfolio.totals.critical} critical)`,
    `Estimated monthly waste: ${portfolio.totals.estimatedMonthlyTokenWaste.toLocaleString()} tokens / $${portfolio.totals.estimatedMonthlyCostWaste.toFixed(2)}`,
    '',
  ];
  for (const repo of portfolio.repos.sort((a, b) => a.score - b.score)) {
    lines.push(`${repo.score}/100 ${repo.grade} L${repo.level} ${repo.path}`);
  }
  return lines.join('\n');
}

function numberOpt(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stringOpt(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function fileListOpt(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map(file => file.trim())
    .filter(file => file.length > 0);
}

function formatOpt(value: unknown): 'pretty' | 'json' | 'sarif' {
  return value === 'json' || value === 'sarif' ? value : 'pretty';
}

function parseLevel(value: unknown): 1 | 2 | 3 {
  const parsed = Number(value);
  if (parsed === 1 || parsed === 2 || parsed === 3) return parsed;
  return 1;
}

function parseLevelOpt(value: unknown): 1 | 2 | 3 | undefined {
  return value === undefined ? undefined : parseLevel(value);
}

function severityList(value: unknown): Severity[] | undefined {
  if (typeof value !== 'string') return undefined;
  const severities = value.split(',').map(v => v.trim()).filter(isSeverity);
  return severities.length > 0 ? severities : undefined;
}

function isSeverity(value: string): value is Severity {
  return value === 'critical' || value === 'high' || value === 'medium' || value === 'low' || value === 'info';
}

program.parse();
