#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { program } from 'commander';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { optimize } from './index.js';
import { OPTIMIZERS } from './optimizers.js';
import { renderOptimizationReport, type OptimizationReportFormat } from './report.js';
import { loadPolicy } from '../policy.js';
import { isTokenizerId, listTokenizers, type TokenizerId } from '../utils/tokenizer.js';
import type { AnalysisResult } from '../types.js';

/** Thrown for user input mistakes (bad flag/value) so the CLI can exit with 2. */
class UsageError extends Error {}

/**
 * `cates-optimize` — a SEPARATE, deliberately-invoked tool (not part of the
 * `cates-analyzer` flow). It consumes a CATES analysis and rewrites the Copilot
 * primitives to be as token-efficient as possible while guaranteeing no loss of
 * function, then prints a report of what it achieved.
 */

program
  .name('cates-optimize')
  .description(
    'Apply lossless token-efficiency optimizations to coding-agent primitives ' +
    '(instructions, prompts, chat modes, agents, skills, rules) and report the gain. ' +
    'Guarantees no loss of function. Separate from cates-analyzer — run it deliberately.',
  )
  .version('1.0.0')
  .argument('[path]', 'Path to repository root', '.')
  .option('-f, --format <format>', 'Report format: markdown or json', 'markdown')
  .option('--report <file>', 'Reuse a prior `cates-analyzer --format json` report as the baseline')
  .option('--dry-run', 'Show what would change without writing any files')
  .option('--backup', 'Write a sibling <file>.orig backup before changing each file')
  .option('--only <list>', 'Comma-separated optimizer ids to run (default: all)')
  .option('--skip <list>', 'Comma-separated optimizer ids to skip')
  .option('--experimental', 'Also surface experimental (non-normative) cache/output-shaping token impact (advisory; never auto-applied)')
  .option('--tokenizer <name>', 'Canonical tokenizer: openai-cl100k, openai-o200k, anthropic-claude, approx')
  .option('--policy <path>', 'Path to .cates.yml/.json policy file (for suppressions)')
  .option('--max-files <n>', 'Maximum config files to analyze', '50')
  .option('--max-depth <n>', 'Maximum directory traversal depth', '5')
  .option('--list-optimizers', 'List available optimizers and exit')
  .addHelpText('after', `
Exit codes:
  0  Optimization completed (or dry run / listing) successfully
  1  Runtime error (unreadable repo, invalid report file)
  2  Usage error (bad flag/optimizer id/tokenizer)

Examples:
  $ cates-optimize .                              # optimize current repo, write changes
  $ cates-optimize . --dry-run                    # preview the gain, write nothing
  $ cates-analyzer . --format json > r.json
  $ cates-optimize --report r.json --backup       # reuse a report, keep .orig backups
  $ cates-optimize . --only dedupe-lines,whitespace
  $ cates-optimize . --experimental             # also show cache/output-shaping token impact
  $ cates-optimize --list-optimizers
`);

program.exitOverride((err) => {
  if (err.code === 'commander.helpDisplayed' || err.code === 'commander.version' || err.code === 'commander.help') {
    process.exit(0);
  }
  process.exit(2);
});

program.action(async (path: string, opts: Record<string, unknown>) => {
  try {
    if (opts.listOptimizers) {
      for (const o of OPTIMIZERS) {
        process.stdout.write(`${o.id}  [${o.ruleIds.join(', ') || 'general'}] (${o.safety}${o.defaultOn ? ', default' : ''})\n    ${o.description}\n`);
      }
      process.exit(0);
    }

    const format = parseFormat(opts.format);
    const tokenizer = parseTokenizer(opts.tokenizer);
    const report = await loadReport(opts.report);
    const repoPath = report && isDefaultPath(path) ? report.repoPath : resolve(path);
    const policy = await loadPolicy(repoPath, strOpt(opts.policy));

    const result = await optimize({
      repoPath,
      ...(report ? { report } : {}),
      ...(tokenizer ? { tokenizer } : {}),
      dryRun: Boolean(opts.dryRun),
      backup: Boolean(opts.backup),
      experimental: Boolean(opts.experimental) || policy.experimental === true || process.env.CATES_EXPERIMENTAL === '1' || process.env.CATES_EXPERIMENTAL === 'true',
      ...(listOpt(opts.only) ? { only: listOpt(opts.only) } : {}),
      ...(listOpt(opts.skip) ? { skip: listOpt(opts.skip) } : {}),
      suppressions: policy.suppressions ?? [],
      maxFiles: numOpt(opts.maxFiles, '--max-files') ?? 50,
      maxDepth: numOpt(opts.maxDepth, '--max-depth') ?? 5,
    });

    process.stdout.write(renderOptimizationReport(result, format) + (format === 'json' ? '\n' : ''));
    process.exit(0);
  } catch (err) {
    console.error('Error:', err instanceof Error ? err.message : err);
    const usage = err instanceof UsageError || (err instanceof Error && /^Unknown optimizer/.test(err.message));
    process.exit(usage ? 2 : 1);
  }
});

program.parse();

function isDefaultPath(path: string): boolean {
  return path === '.' || path === undefined;
}

function parseFormat(value: unknown): OptimizationReportFormat {
  const fmt = typeof value === 'string' ? value : 'markdown';
  if (fmt === 'markdown' || fmt === 'json') return fmt;
  throw new UsageError('--format must be one of: markdown, json.');
}

function parseTokenizer(value: unknown): TokenizerId | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !isTokenizerId(value)) {
    throw new UsageError(`--tokenizer must be one of: ${listTokenizers().map(t => t.id).join(', ')}.`);
  }
  return value;
}

function listOpt(value: unknown): string[] | undefined {
  if (typeof value !== 'string') return undefined;
  const items = value.split(',').map(v => v.trim()).filter(v => v.length > 0);
  return items.length > 0 ? items : undefined;
}

function strOpt(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function numOpt(value: unknown, name: string): number | undefined {
  if (typeof value !== 'string') return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new UsageError(`${name} must be a non-negative integer.`);
  return parsed;
}

async function loadReport(value: unknown): Promise<AnalysisResult | undefined> {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  let raw: string;
  try {
    raw = await readFile(resolve(value), 'utf-8');
  } catch {
    throw new Error(`Could not read report file: ${value}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new UsageError(`Report file is not valid JSON: ${value}`);
  }
  if (Array.isArray(parsed)) {
    throw new UsageError('Report file looks like an --individual array; pass a single-repo report instead.');
  }
  const candidate = parsed as Partial<AnalysisResult>;
  if (!candidate || typeof candidate !== 'object' || !candidate.discovery || !candidate.score) {
    throw new UsageError(`Report file is not a CATES analysis report: ${value}`);
  }
  return parsed as AnalysisResult;
}
