// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import { readFile, writeFile, access } from 'node:fs/promises';
import { analyze } from '../analyzers/index.js';
import { analyzeInMemory } from '../analyze-in-memory.js';
import {
  countTokens,
  getDefaultTokenizer,
  withTokenizer,
  type TokenizerId,
} from '../utils/tokenizer.js';
import type { AnalysisResult, DiscoveredFile, Recommendation } from '../types.js';
import { selectOptimizers, meaningfulSignature, isProseFile } from './optimizers.js';
import type {
  AppliedOptimizerInfo,
  FileOptimization,
  OptimizationResult,
  OptimizeOptions,
  OptimizerChangeRecord,
  RemainingRecommendation,
} from './types.js';

/**
 * Optimize the Copilot primitives in a repository for token efficiency while
 * guaranteeing no loss of function.
 *
 * Pipeline:
 *   1. Establish a baseline by running the CATES analyzer (or reusing a report).
 *   2. Apply only lossless optimizers to each active primitive file.
 *   3. Verify the meaningful-instruction signature is unchanged per file; revert
 *      any file that would lose content (defence in depth — should never fire).
 *   4. Re-score with the SAME analyzer engine (analyzeInMemory) for exact parity.
 *   5. Write changes (unless dry-run) and return an achievement report.
 */
export async function optimize(opts: OptimizeOptions): Promise<OptimizationResult> {
  const workingTokenizer: TokenizerId =
    opts.tokenizer ?? (opts.report?.discovery.tokenizer as TokenizerId | undefined) ?? getDefaultTokenizer();
  const suppressions = opts.suppressions ?? [];
  const maxFiles = opts.maxFiles ?? 50;
  const maxDepth = opts.maxDepth ?? 5;
  const notes: string[] = [];

  // 1. Baseline ("before"). Reuse the supplied report only when its tokenizer
  //    matches (and it carries experimental data if we need it); otherwise
  //    re-analyze so before/after numbers are comparable.
  const wantExperimental = opts.experimental === true;
  let before = opts.report;
  if (before && before.discovery.tokenizer === workingTokenizer && (!wantExperimental || before.experimental)) {
    notes.push('Reused the provided CATES report as the baseline.');
  } else {
    if (before) notes.push('Re-analyzed for a tokenizer-consistent baseline (report tokenizer differed).');
    before = await analyze({ repoPath: opts.repoPath, tokenizer: workingTokenizer, suppressions, maxFiles, maxDepth, experimental: wantExperimental });
  }

  const activeFiles = before.discovery.files.filter(f => f.isActive);
  const optimizers = selectOptimizers(opts.only, opts.skip);

  if (activeFiles.length === 0) {
    notes.push('No active coding-agent configuration files were found to optimize.');
    return emptyResult(opts, before, workingTokenizer, optimizers, notes);
  }

  // 2 + 3. Apply optimizers per file with the in-context tokenizer so per-file
  //         token counts match the analyzer's discovery counts exactly.
  const optimizerStats = new Map<string, { files: Set<string>; tokens: number }>();
  for (const o of optimizers) optimizerStats.set(o.id, { files: new Set(), tokens: 0 });

  const fileResults: FileOptimization[] = [];
  const editedByRelative = new Map<string, string>(); // relativePath -> optimized content
  const originalByRelative = new Map<string, string>();
  const backups: string[] = [];
  let structuredSkipped = 0;

  // Per-file token counts were already computed by the baseline analysis and
  // discovered-file lookups are needed in the write loop; index them once so the
  // hot path never does an O(files) scan or a redundant baseline re-tokenization.
  const beforeTokenByRel = new Map(activeFiles.map(f => [f.relativePath, f.tokenCount] as const));
  const discoveredByRel = new Map(activeFiles.map(f => [f.relativePath, f] as const));

  await withTokenizer(workingTokenizer, async () => {
    for (const file of activeFiles) {
      let original: string;
      try {
        original = await readFile(file.path, 'utf-8');
      } catch {
        notes.push(`Skipped ${file.relativePath}: could not be read (it may have moved since analysis).`);
        continue;
      }
      // Always keep the original so the file is included (unchanged) in the
      // post-optimization re-score, even when it isn't a candidate for editing.
      originalByRelative.set(file.relativePath, original);

      // Only prose primitives are optimized; structured configs (JSON/YAML/shell)
      // are never modified, to keep the no-loss-of-function guarantee airtight.
      if (!isProseFile(file.relativePath)) {
        structuredSkipped++;
        continue;
      }

      let current = original;
      const changes: OptimizerChangeRecord[] = [];
      const localStats = new Map<string, number>(); // optimizerId -> tokens removed
      // Seed from the baseline count (already in workingTokenizer); only the
      // CHANGED output of each optimizer is re-tokenized, and that count is
      // carried into the next step — so a file costs one BPE encode per
      // optimizer that actually edits it, not 2N+2.
      const tokensBefore = beforeTokenByRel.get(file.relativePath) ?? countTokens(original);
      let currentTokens = tokensBefore;
      for (const optimizer of optimizers) {
        const stepBefore = current;
        const { content: next, edits } = optimizer.apply(stepBefore);
        if (edits.length === 0 || next === stepBefore) continue;
        const nextTokens = countTokens(next);
        const removed = Math.max(0, currentTokens - nextTokens);
        current = next;
        currentTokens = nextTokens;
        for (const edit of edits) {
          changes.push({
            optimizerId: optimizer.id,
            ruleIds: optimizer.ruleIds,
            description: edit.description,
            ...(edit.line !== undefined ? { line: edit.line } : {}),
          });
        }
        localStats.set(optimizer.id, (localStats.get(optimizer.id) ?? 0) + removed);
      }

      if (current === original) continue;
      const tokensAfter = currentTokens;
      // Lossless but no token win (e.g. only a trailing-newline tweak) — leave the
      // file alone rather than create pointless churn in the user's diff.
      if (tokensBefore - tokensAfter <= 0) continue;

      // Defence in depth: never write a file that would drop meaningful content.
      const preserved = meaningfulSignature(original) === meaningfulSignature(current);
      if (!preserved) {
        notes.push(`Reverted ${file.relativePath}: optimization would have changed meaningful content.`);
        fileResults.push(buildFileResult(file, original, original, tokensBefore, tokensBefore, [], false,
          'meaningful-instruction signature changed'));
        continue;
      }

      for (const [id, tokens] of localStats) {
        const stat = optimizerStats.get(id)!;
        stat.files.add(file.relativePath);
        stat.tokens += tokens;
      }
      editedByRelative.set(file.relativePath, current);
      fileResults.push(buildFileResult(file, original, current, tokensBefore, tokensAfter, changes, true));
    }
  });

  if (structuredSkipped > 0) {
    notes.push(`Left ${structuredSkipped} structured config file(s) (JSON/YAML/shell) untouched — only prose instruction primitives are optimized.`);
  }

  // 4. Re-score with the same analyzer engine for exact before/after parity.
  //    Skip the whole re-analysis when nothing changed — the baseline already is
  //    the "after" state, so an already-optimal repo costs zero extra work here.
  let after = before;
  if (editedByRelative.size > 0) {
    const memFiles = activeFiles
      .filter(f => originalByRelative.has(f.relativePath))
      .map(f => ({
        path: f.relativePath,
        content: editedByRelative.get(f.relativePath) ?? originalByRelative.get(f.relativePath)!,
      }));
    after = await analyzeInMemory({ files: memFiles, tokenizer: workingTokenizer, suppressions, maxFiles, maxDepth, experimental: wantExperimental });
  }

  // 5. Write to disk unless this is a dry run.
  const keptFiles = fileResults.filter(f => f.changed && f.functionPreserved);
  if (!opts.dryRun) {
    for (const fileResult of keptFiles) {
      const discovered = discoveredByRel.get(fileResult.relativePath)!;
      if (opts.backup) {
        const backupPath = `${discovered.path}.orig`;
        if (!(await exists(backupPath))) {
          await writeFile(backupPath, originalByRelative.get(fileResult.relativePath)!, 'utf-8');
          backups.push(`${fileResult.relativePath}.orig`);
        }
      }
      await writeFile(discovered.path, editedByRelative.get(fileResult.relativePath)!, 'utf-8');
    }
  } else {
    notes.push('Dry run: no files were written.');
  }

  return assembleResult({
    opts, before, after, workingTokenizer, optimizers, optimizerStats,
    fileResults, activeCount: activeFiles.length, backups, notes,
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildFileResult(
  file: DiscoveredFile,
  original: string,
  optimized: string,
  tokensBefore: number,
  tokensAfter: number,
  changes: OptimizerChangeRecord[],
  preserved: boolean,
  reverted?: string,
): FileOptimization {
  return {
    relativePath: file.relativePath,
    type: file.type,
    scope: file.scope,
    changed: optimized !== original,
    tokensBefore,
    tokensAfter,
    tokensSaved: Math.max(0, tokensBefore - tokensAfter),
    bytesBefore: Buffer.byteLength(original, 'utf-8'),
    bytesAfter: Buffer.byteLength(optimized, 'utf-8'),
    changes,
    functionPreserved: preserved,
    ...(reverted ? { reverted } : {}),
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function pct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

function tokenEfficiencyFindings(result: AnalysisResult): number {
  return result.findings.filter(f => f.dimension === 'token-efficiency').length;
}

function remainingRecommendation(rec: Recommendation): RemainingRecommendation {
  let reason: string;
  if (rec.safety === 'manual') {
    reason = 'Security/critical change — must be reviewed and applied by a human.';
  } else if (rec.effort === 'moderate' || rec.effort === 'significant') {
    reason = 'Requires restructuring or rewriting content, which falls outside the lossless guarantee.';
  } else {
    reason = 'Requires human judgement to preserve intent (e.g. rescoping or rephrasing).';
  }
  return {
    title: rec.title,
    ruleIds: rec.ruleIds,
    files: rec.files,
    tokenSavings: rec.tokenSavings,
    effort: rec.effort,
    safety: rec.safety,
    reason,
  };
}

interface AssembleArgs {
  opts: OptimizeOptions;
  before: AnalysisResult;
  after: AnalysisResult;
  workingTokenizer: TokenizerId;
  optimizers: ReturnType<typeof selectOptimizers>;
  optimizerStats: Map<string, { files: Set<string>; tokens: number }>;
  fileResults: FileOptimization[];
  activeCount: number;
  backups: string[];
  notes: string[];
}

function assembleResult(args: AssembleArgs): OptimizationResult {
  const { before, after, workingTokenizer, optimizers, optimizerStats, fileResults, activeCount, backups, notes } = args;

  const activeTokensBefore = before.discovery.totalTokens;
  const activeTokensAfter = after.discovery.totalTokens;
  const activeTokensSaved = Math.max(0, activeTokensBefore - activeTokensAfter);
  const alwaysBefore = before.discovery.alwaysLoadedTokens;
  const alwaysAfter = after.discovery.alwaysLoadedTokens;
  const alwaysSaved = Math.max(0, alwaysBefore - alwaysAfter);
  const changedFiles = fileResults.filter(f => f.changed && f.functionPreserved);

  const optimizerInfos: AppliedOptimizerInfo[] = optimizers.map(o => {
    const stat = optimizerStats.get(o.id)!;
    return {
      id: o.id,
      title: o.title,
      ruleIds: o.ruleIds,
      safety: o.safety,
      description: o.description,
      filesTouched: stat.files.size,
      tokensSaved: stat.tokens,
    };
  });

  const reverted = fileResults.filter(f => !f.functionPreserved).length;

  return {
    repoPath: before.repoPath,
    timestamp: new Date().toISOString(),
    tokenizer: workingTokenizer,
    dryRun: Boolean(args.opts.dryRun),
    efficiencyGainPct: pct(activeTokensSaved, activeTokensBefore),
    estimatedTokensSavedPerInvocation: alwaysSaved,
    totals: {
      activeTokensBefore,
      activeTokensAfter,
      activeTokensSaved,
      activeReductionPct: pct(activeTokensSaved, activeTokensBefore),
      alwaysLoadedTokensBefore: alwaysBefore,
      alwaysLoadedTokensAfter: alwaysAfter,
      alwaysLoadedTokensSaved: alwaysSaved,
      alwaysLoadedReductionPct: pct(alwaysSaved, alwaysBefore),
      filesScanned: activeCount,
      filesChanged: changedFiles.length,
    },
    score: {
      overallBefore: before.score.overall,
      overallAfter: after.score.overall,
      gradeBefore: before.score.grade,
      gradeAfter: after.score.grade,
      totalFindingsBefore: before.findings.length,
      totalFindingsAfter: after.findings.length,
      tokenEfficiencyFindingsBefore: tokenEfficiencyFindings(before),
      tokenEfficiencyFindingsAfter: tokenEfficiencyFindings(after),
    },
    optimizers: optimizerInfos,
    files: fileResults,
    remainingRecommendations: after.recommendations.map(remainingRecommendation),
    guarantee: {
      noLossOfFunction: reverted === 0,
      method:
        'Only lossless transforms (blank-line/whitespace hygiene, exact duplicate removal, platform-default filler removal). ' +
        'Each file is verified to keep an identical set of meaningful instructions and byte-identical code blocks, then re-scored with the same CATES engine.',
      invariantsChecked: [
        'meaningful-instruction-set equality (per file)',
        'code-block byte identity (per file)',
        'analyzer re-score parity (analyzeInMemory)',
      ],
    },
    ...(after.experimental ?? before.experimental ? { experimental: after.experimental ?? before.experimental } : {}),
    backups,
    notes,
  };
}

function emptyResult(
  opts: OptimizeOptions,
  before: AnalysisResult,
  workingTokenizer: TokenizerId,
  optimizers: ReturnType<typeof selectOptimizers>,
  notes: string[],
): OptimizationResult {
  return {
    repoPath: before.repoPath,
    timestamp: new Date().toISOString(),
    tokenizer: workingTokenizer,
    dryRun: Boolean(opts.dryRun),
    efficiencyGainPct: 0,
    estimatedTokensSavedPerInvocation: 0,
    totals: {
      activeTokensBefore: before.discovery.totalTokens,
      activeTokensAfter: before.discovery.totalTokens,
      activeTokensSaved: 0,
      activeReductionPct: 0,
      alwaysLoadedTokensBefore: before.discovery.alwaysLoadedTokens,
      alwaysLoadedTokensAfter: before.discovery.alwaysLoadedTokens,
      alwaysLoadedTokensSaved: 0,
      alwaysLoadedReductionPct: 0,
      filesScanned: 0,
      filesChanged: 0,
    },
    score: {
      overallBefore: before.score.overall,
      overallAfter: before.score.overall,
      gradeBefore: before.score.grade,
      gradeAfter: before.score.grade,
      totalFindingsBefore: before.findings.length,
      totalFindingsAfter: before.findings.length,
      tokenEfficiencyFindingsBefore: tokenEfficiencyFindings(before),
      tokenEfficiencyFindingsAfter: tokenEfficiencyFindings(before),
    },
    optimizers: optimizers.map(o => ({
      id: o.id,
      title: o.title,
      ruleIds: o.ruleIds,
      safety: o.safety,
      description: o.description,
      filesTouched: 0,
      tokensSaved: 0,
    })),
    files: [],
    remainingRecommendations: before.recommendations.map(remainingRecommendation),
    guarantee: {
      noLossOfFunction: true,
      method: 'No files were changed.',
      invariantsChecked: [],
    },
    ...(before.experimental ? { experimental: before.experimental } : {}),
    backups: [],
    notes,
  };
}

export type { OptimizationResult, OptimizeOptions } from './types.js';
