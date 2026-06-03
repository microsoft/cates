#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

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
import type { DemoCategory } from '../demo-repos.js';
import { scanDemo, type DemoScanResult } from '../demo.js';
import { isTokenizerId, listTokenizers, type TokenizerId } from '../utils/tokenizer.js';
import type { AnalysisResult, Severity } from '../types.js';

program
  .name('cates-analyzer')
  .description('Analyze coding agent configurations for token efficiency, security, and CATES conformance')
  .version('1.0.0')
  .addHelpText('after', `
Exit codes:
  0  Analysis succeeded and all CI gates passed
  1  CATES gate failure (min-score, require-level, fail-on, max-always-loaded, or conformance level)
  2  Usage error (invalid flag, missing argument, parse failure)

Examples:
  $ cates-analyzer .                                        # analyze current dir
  $ cates-analyzer ../my-repo --format json                 # JSON output
  $ cates-analyzer https://github.com/OWNER/REPO            # GitHub repo (auto-detected)
  $ cates-analyzer https://github.com/OWNER/REPO/pull/123   # pull request
  $ cates-analyzer demo --repos-file repos.txt --limit 10   # custom demo set
  $ cates-analyzer completion bash                          # shell completion
`);

program.exitOverride((err) => {
  // Map commander's usage errors to exit code 2 instead of the default 1
  // so users (and CI) can distinguish "you typed it wrong" from "your config
  // failed a CATES gate". `commander.helpDisplayed` and `commander.version`
  // are normal terminations and should still exit 0.
  if (err.code === 'commander.helpDisplayed' || err.code === 'commander.version' || err.code === 'commander.help') {
    process.exit(0);
  }
  process.exit(2);
});

program
  .command('demo')
  .description('Run a demo scan against repositories listed in a custom repo file')
  .option('-f, --format <format>', 'Output format: pretty or json', 'pretty')
  .option('--repos-file <path>', 'Text file of repositories to scan; one repository URL per line, optionally prefixed by category')
  .option('--category <list>', 'Comma-separated custom categories from --repos-file')
  .option('--limit <n>', 'Scan only the first N repositories')
  .option('--concurrency <n>', 'Number of repositories to scan in parallel (1-8)', '4')
  .option('--max-files <n>', 'Maximum config files to analyze per repository', '50')
  .option('--max-depth <n>', 'Maximum directory traversal depth per repository', '5')
  .option('--fail-fast', 'Stop on the first repository scan failure')
  .action(async (opts) => runDemoCommand(opts));

program
  .command('analyze', { isDefault: true })
  .description('Analyze one repository')
  .argument('[path]', 'Path to repository root', '.')
  .option('-f, --format <format>', 'Output format: pretty, json, sarif', 'pretty')
  .option('-q, --quiet', 'Suppress pretty-format headers; print only the data section')
  .option('--demo', 'Run demo scan instead of analyzing a path')
  .option('--repos-file <path>', 'Demo mode: text file of repositories to scan')
  .option('--category <list>', 'Demo mode: comma-separated custom categories from --repos-file')
  .option('--limit <n>', 'Demo mode: scan only the first N repositories')
  .option('--concurrency <n>', 'Demo mode: number of repositories to scan in parallel (1-8)', '4')
  .option('--policy <path>', 'Path to .cates.yml/.json policy file')
  .option('--max-files <n>', 'Maximum config files to analyze', '50')
  .option('--max-depth <n>', 'Maximum directory traversal depth', '5')
  .option('--files <list>', 'Comma-separated relative file paths to analyze instead of auto-discovery')
  .option('--individual', 'Analyze each --files entry separately')
  .option('--no-evidence', 'Omit evidence snippets from output')
  .option('--min-score <n>', 'Fail if score is below this value')
  .option('--require-level <n>', 'Fail unless CATES conformance level is at least 1, 2, or 3')
  .option('--fail-on <list>', 'Comma-separated severities that fail the run (e.g. critical,high)')
  .option('--max-always-loaded <n>', 'Fail if always-loaded tokens exceed this value')
  .option('--tokenizer <name>', 'Canonical tokenizer: openai-cl100k, openai-o200k, anthropic-claude, approx')
  .option('--compare-tokenizers <list>', 'Comma-separated tokenizers to report side-by-side (e.g. openai-cl100k,anthropic-claude)')
  .option('--fix', 'Apply safe automatic fixes')
  .option('--fix-dry-run', 'Show safe automatic fixes without writing files')
  .action(async (path: string, opts) => runAnalyze(path, opts));

program
  .command('review')
  .description('Review a local folder or GitHub URL against CATES')
  .argument('<source>', 'Local folder or GitHub URL (repo, tree, blob, or pull request)')
  .option('-f, --format <format>', 'Output format: pretty, json, sarif', 'pretty')
  .option('--policy <path>', 'Path to .cates.yml/.json policy file')
  .option('--max-files <n>', 'Maximum config files to analyze', '50')
  .option('--max-depth <n>', 'Maximum directory traversal depth', '5')
  .option('--files <list>', 'Comma-separated relative file paths to analyze instead of auto-discovery')
  .option('--individual', 'Analyze each --files entry separately')
  .option('--no-evidence', 'Omit evidence snippets from output')
  .option('--min-score <n>', 'Fail if score is below this value')
  .option('--require-level <n>', 'Fail unless CATES conformance level is at least 1, 2, or 3')
  .option('--fail-on <list>', 'Comma-separated severities that fail the run (e.g. critical,high)')
  .option('--max-always-loaded <n>', 'Fail if always-loaded tokens exceed this value')
  .option('--tokenizer <name>', 'Canonical tokenizer: openai-cl100k, openai-o200k, anthropic-claude, approx')
  .option('--compare-tokenizers <list>', 'Comma-separated tokenizers to report side-by-side')
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
    try {
      const repoPath = resolve(path);
      const format = formatOpt(opts.format, ['pretty', 'json']);
      const policy = await loadPolicy(repoPath, stringOpt(opts.policy));
      const result = await analyze({
        repoPath,
        suppressions: policy.suppressions ?? [],
        rules: policy.rules ?? {},
        dimensions: policy.dimensions ?? {},
      });
      const conformance = evaluateConformance(result, { ...policy, requireLevel: parseLevel(opts.requireLevel) });
      if (format === 'json') {
        process.stdout.write(JSON.stringify({ repoPath, conformance }, null, 2) + '\n');
      } else {
        process.stdout.write(formatConformance(conformance) + '\n');
      }
      process.exit(conformance.passed ? 0 : 1);
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command('rules')
  .description('Print the machine-readable CATES rule catalog')
  .option('-f, --format <format>', 'Output format: json or pretty', 'json')
  .action((opts) => {
    try {
      const format = formatOpt(opts.format, ['json', 'pretty']);
      if (format === 'pretty') {
        for (const rule of RULE_CATALOG) {
          process.stdout.write(`${rule.id} ${rule.title} [${rule.severity}/${rule.dimension}]\n  ${rule.summary}\n`);
        }
      } else {
        process.stdout.write(rulesAsJson() + '\n');
      }
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
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
  .command('tokenizers')
  .description('List supported tokenizers')
  .option('-f, --format <format>', 'Output format: pretty or json', 'pretty')
  .action((opts) => {
    try {
      const format = formatOpt(opts.format, ['pretty', 'json']);
      const all = listTokenizers();
      if (format === 'json') {
        process.stdout.write(JSON.stringify(all, null, 2) + '\n');
      } else {
        for (const t of all) {
          process.stdout.write(`${t.id}  ${t.displayName}\n`);
          if (t.models.length) process.stdout.write(`    models: ${t.models.join(', ')}\n`);
          if (t.notes) process.stdout.write(`    note:   ${t.notes}\n`);
        }
      }
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command('portfolio')
  .description('Scan child repositories under a directory')
  .argument('[path]', 'Directory containing repositories', '.')
  .option('-f, --format <format>', 'Output format: pretty or json', 'pretty')
  .action(async (path: string, opts) => {
    try {
      const format = formatOpt(opts.format, ['pretty', 'json']);
      const portfolio = await scanPortfolio(path);
      if (format === 'json') {
        process.stdout.write(JSON.stringify(portfolio, null, 2) + '\n');
      } else {
        process.stdout.write(formatPortfolio(portfolio) + '\n');
      }
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

async function runAnalyze(path: string, opts: Record<string, unknown>): Promise<void> {
  if (opts.demo) {
    await runDemoCommand(opts);
    return;
  }
  // Auto-dispatch GitHub URLs (and other URL-style sources) to the review
  // pipeline so users don't have to remember which subcommand to use.
  if (looksLikeUrl(path)) {
    await runReview(path, opts);
    return;
  }
  const repoPath = resolve(path);
  try {
    const exitCode = await executeAnalyze(repoPath, opts);
    if (exitCode !== 0) process.exit(exitCode);
  } catch (err) {
    console.error('Error:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

async function runDemoCommand(opts: Record<string, unknown>): Promise<void> {
  try {
    const format = formatOpt(opts.format, ['pretty', 'json']);
    const result = await scanDemo({
      reposFile: stringOpt(opts.reposFile),
      categories: categoryList(opts.category),
      limit: numberOpt(opts.limit, '--limit', { min: 1, integer: true }),
      concurrency: numberOpt(opts.concurrency, '--concurrency', { min: 1, max: 8, integer: true }) ?? 4,
      maxFiles: numberOpt(opts.maxFiles, '--max-files', { min: 1, integer: true }) ?? 50,
      maxDepth: numberOpt(opts.maxDepth, '--max-depth', { min: 0, integer: true }) ?? 5,
      continueOnError: !opts.failFast,
    });
    if (format === 'json') {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else {
      process.stdout.write(formatDemo(result) + '\n');
    }
  } catch (err) {
    console.error('Error:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

async function executeAnalyze(repoPath: string, opts: Record<string, unknown>, displayPath?: string): Promise<number> {
  const policy = await loadPolicy(repoPath, stringOpt(opts.policy));
  const includeFiles = fileListOpt(opts.files);
  const format = formatOpt(opts.format, ['pretty', 'json', 'sarif']);

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
  const reportText = createReport(reportResult, format);
  process.stdout.write((opts.quiet ? stripPrettyBanner(reportText) : reportText) + '\n');

  return evaluateResultGates(result, policy, opts);
}

function stripPrettyBanner(text: string): string {
  // Drop the opening ASCII-art banner block when --quiet is set so output is
  // ready for piping/diffing while still containing all data sections.
  return text.replace(/^\n*╔[\s\S]*?╝\n+/, '');
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
    maxFiles: numberOpt(opts.maxFiles, '--max-files', { min: 1, integer: true }) ?? 50,
    maxDepth: numberOpt(opts.maxDepth, '--max-depth', { min: 0, integer: true }) ?? 5,
    includeFiles: includeFiles.length > 0 ? includeFiles : undefined,
    tokenizer: tokenizerOpt(opts.tokenizer),
    compareTokenizers: tokenizerListOpt(opts.compareTokenizers),
    suppressions: policy.suppressions ?? [],
    rules: policy.rules ?? {},
    dimensions: policy.dimensions ?? {},
  };
}

function evaluateResultGates(result: AnalysisResult, policy: CatesPolicy, opts: Record<string, unknown>): number {
  const gatePolicy: CatesPolicy = {
    minScore: numberOpt(opts.minScore, '--min-score', { min: 0, max: 100 }),
    requireLevel: parseLevelOpt(opts.requireLevel),
    failOn: severityList(opts.failOn),
    maxAlwaysLoadedTokens: numberOpt(opts.maxAlwaysLoaded, '--max-always-loaded', { min: 0, integer: true }),
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
    `Token reduction opportunity: ${portfolio.totals.projectedTokenSavingsPercentage.toFixed(1)}%`,
    '',
  ];
  for (const repo of portfolio.repos.sort((a, b) => a.score - b.score)) {
    lines.push(`${repo.score}/100 ${repo.grade} L${repo.level} ${repo.path}`);
  }
  return lines.join('\n');
}

function formatDemo(result: DemoScanResult): string {
  const lines = [
    'CATES Demo Scan',
    `Repositories: ${result.reposScanned}/${result.reposRequested} scanned (${result.reposFailed} failed)`,
    `Average score: ${result.totals.averageScore}/100`,
    `Token reduction opportunity: ${result.totals.averageProjectedReductionPercentage.toFixed(1)}%`,
    `Finding density: ${result.totals.averageFindingsPerThousandTokens.toFixed(1)} findings per 1K analyzed tokens`,
    `Findings: ${result.totals.findings} total (${result.totals.critical} critical, ${result.totals.high} high)`,
    `Config footprint: ${result.totals.configFiles} files / ${result.totals.totalTokens.toLocaleString()} tokens`,
    '',
    'Categories:',
  ];
  for (const [category, summary] of Object.entries(result.categories)) {
    lines.push(`  ${category}: ${summary.repos} scanned, avg ${summary.averageScore}/100, ${summary.averageProjectedReductionPercentage.toFixed(1)}% reduction, ${summary.averageFindingsPerThousandTokens.toFixed(1)} findings/1K tokens`);
  }
  if (result.topRules.length > 0) {
    lines.push('', 'Top rules:', ...result.topRules.map(rule => `  ${rule.ruleId}: ${rule.count}`));
  }
  const weakest = [...result.repos]
    .filter(repo => !repo.error)
    .sort((a, b) => a.score - b.score)
    .slice(0, 10);
  if (weakest.length > 0) {
    lines.push('', 'Lowest-scoring repositories:');
    for (const repo of weakest) {
      lines.push(`  ${repo.score}/100 ${repo.grade} ${repo.repoPath} (${repo.projectedReductionPercentage.toFixed(1)}% reduction, ${repo.findings} findings)`);
    }
  }
  const failed = result.repos.filter(repo => repo.error);
  if (failed.length > 0) {
    lines.push('', 'Scan failures:', ...failed.slice(0, 10).map(repo => `  ${repo.repoPath}: ${repo.error}`));
    if (failed.length > 10) lines.push(`  ... ${failed.length - 10} more`);
  }
  return lines.join('\n');
}

function numberOpt(
  value: unknown,
  name: string,
  constraints: { min?: number; max?: number; integer?: boolean } = {},
): number | undefined {
  if (typeof value !== 'string') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a number.`);
  if (constraints.integer && !Number.isInteger(parsed)) throw new Error(`${name} must be an integer.`);
  if (constraints.min !== undefined && parsed < constraints.min) throw new Error(`${name} must be at least ${constraints.min}.`);
  if (constraints.max !== undefined && parsed > constraints.max) throw new Error(`${name} must be at most ${constraints.max}.`);
  return parsed;
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

function formatOpt<T extends readonly ('pretty' | 'json' | 'sarif')[]>(
  value: unknown,
  allowed: T = ['pretty', 'json', 'sarif'] as unknown as T,
): T[number] {
  const format = typeof value === 'string' ? value : 'pretty';
  if (allowed.includes(format as T[number])) return format as T[number];
  throw new Error(`--format must be one of: ${allowed.join(', ')}.`);
}

function parseLevel(value: unknown): 1 | 2 | 3 {
  const parsed = Number(value);
  if (parsed === 1 || parsed === 2 || parsed === 3) return parsed;
  throw new Error('--require-level must be 1, 2, or 3.');
}

function parseLevelOpt(value: unknown): 1 | 2 | 3 | undefined {
  return value === undefined ? undefined : parseLevel(value);
}

function severityList(value: unknown): Severity[] | undefined {
  if (typeof value !== 'string') return undefined;
  const values = value.split(',').map(v => v.trim()).filter(v => v.length > 0);
  const invalid = values.filter(v => !isSeverity(v));
  if (invalid.length > 0) {
    throw new Error(`--fail-on contains invalid severities: ${invalid.join(', ')}. Allowed: critical, high, medium, low, info.`);
  }
  const severities = values.filter(isSeverity);
  return severities.length > 0 ? severities : undefined;
}

function categoryList(value: unknown): DemoCategory[] | undefined {
  if (typeof value !== 'string') return undefined;
  return value.split(',').map(v => v.trim()).filter(v => v.length > 0);
}

function isSeverity(value: string): value is Severity {
  return value === 'critical' || value === 'high' || value === 'medium' || value === 'low' || value === 'info';
}

function tokenizerOpt(value: unknown): TokenizerId | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') {
    throw new Error('--tokenizer must be a string.');
  }
  if (!isTokenizerId(value)) {
    throw new Error(`--tokenizer must be one of: ${listTokenizers().map(t => t.id).join(', ')}.`);
  }
  return value;
}

function tokenizerListOpt(value: unknown): TokenizerId[] | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) return undefined;
  const values = value.split(',').map(v => v.trim()).filter(v => v.length > 0);
  const invalid = values.filter(v => !isTokenizerId(v));
  if (invalid.length > 0) {
    throw new Error(`--compare-tokenizers contains invalid entries: ${invalid.join(', ')}. Allowed: ${listTokenizers().map(t => t.id).join(', ')}.`);
  }
  return values.filter(isTokenizerId);
}

program
  .command('completion')
  .description('Print a shell completion script (bash or zsh)')
  .argument('[shell]', 'Shell to generate completion for: bash or zsh', 'bash')
  .action((shell: string) => {
    const target = shell.toLowerCase();
    if (target !== 'bash' && target !== 'zsh') {
      console.error(`Unsupported shell: ${shell}. Use 'bash' or 'zsh'.`);
      process.exit(2);
    }
    process.stdout.write(buildCompletionScript(target));
  });

program.parse();

function buildCompletionScript(shell: 'bash' | 'zsh'): string {
  const subcommands = ['analyze', 'review', 'demo', 'portfolio', 'conformance', 'rules', 'explain', 'tokenizers', 'completion', 'help'];
  const flags = [
    '--format', '--quiet', '--policy', '--max-files', '--max-depth', '--files', '--individual',
    '--no-evidence', '--min-score', '--require-level', '--fail-on', '--max-always-loaded',
    '--tokenizer', '--compare-tokenizers', '--fix', '--fix-dry-run', '--demo', '--repos-file',
    '--category', '--limit', '--concurrency', '--keep-worktree', '--no-gh', '--fail-fast',
    '--help', '--version',
  ];

  if (shell === 'bash') {
    return `# cates-analyzer bash completion. Install with:
#   cates-analyzer completion bash > /usr/local/etc/bash_completion.d/cates-analyzer
# or eval directly in ~/.bashrc:
#   eval "$(cates-analyzer completion bash)"
_cates_analyzer() {
  local cur prev words cword
  _init_completion || return
  local subcommands="${subcommands.join(' ')}"
  local flags="${flags.join(' ')}"
  if [[ $cword -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "$subcommands" -- "$cur") )
    return
  fi
  if [[ "$cur" == -* ]]; then
    COMPREPLY=( $(compgen -W "$flags" -- "$cur") )
    return
  fi
  COMPREPLY=( $(compgen -f -- "$cur") )
}
complete -F _cates_analyzer cates-analyzer
`;
  }

  return `# cates-analyzer zsh completion. Install with:
#   cates-analyzer completion zsh > "\${fpath[1]}/_cates-analyzer"
# or eval in ~/.zshrc:
#   eval "$(cates-analyzer completion zsh)"
#compdef cates-analyzer
_cates_analyzer() {
  local -a subcommands flags
  subcommands=(${subcommands.map(c => `'${c}'`).join(' ')})
  flags=(${flags.map(f => `'${f}'`).join(' ')})
  if (( CURRENT == 2 )); then
    _describe -t commands 'cates-analyzer subcommand' subcommands
    return
  fi
  if [[ "$words[CURRENT]" == -* ]]; then
    _describe -t flags 'flag' flags
    return
  fi
  _files
}
compdef _cates_analyzer cates-analyzer
`;
}
