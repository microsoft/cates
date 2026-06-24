// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import type { OptimizationResult } from './types.js';

export type OptimizationReportFormat = 'markdown' | 'json';

export function renderOptimizationReport(
  result: OptimizationResult,
  format: OptimizationReportFormat,
): string {
  return format === 'json' ? JSON.stringify(result, null, 2) : toMarkdown(result);
}

function n(value: number): string {
  return value.toLocaleString('en-US');
}

function signed(value: number): string {
  return value > 0 ? `+${n(value)}` : n(value);
}

function reduction(before: number, after: number): string {
  const saved = before - after;
  const pct = before > 0 ? Math.round((saved / before) * 1000) / 10 : 0;
  return `−${n(saved)} (−${pct}%)`;
}

function toMarkdown(r: OptimizationResult): string {
  const lines: string[] = [];
  const mode = r.dryRun ? 'Dry run (no files written)' : 'Applied';

  lines.push('# CATES Optimization Report');
  lines.push('');
  lines.push(`**Repository:** \`${r.repoPath}\``);
  lines.push(`**Generated:** ${r.timestamp} · **Tokenizer:** ${r.tokenizer} · **Mode:** ${mode}`);
  lines.push('');

  const headline = r.totals.activeTokensSaved > 0
    ? `## Result: ${r.efficiencyGainPct}% more token-efficient (−${n(r.totals.activeTokensSaved)} tokens) — guaranteed no loss of function`
    : '## Result: already optimal — no lossless token savings available';
  lines.push(headline);
  lines.push('');

  // Headline table
  lines.push('| Metric | Before | After | Improvement |');
  lines.push('| --- | ---: | ---: | ---: |');
  lines.push(`| Active config tokens | ${n(r.totals.activeTokensBefore)} | ${n(r.totals.activeTokensAfter)} | ${reduction(r.totals.activeTokensBefore, r.totals.activeTokensAfter)} |`);
  lines.push(`| Always-loaded tokens (per invocation) | ${n(r.totals.alwaysLoadedTokensBefore)} | ${n(r.totals.alwaysLoadedTokensAfter)} | ${reduction(r.totals.alwaysLoadedTokensBefore, r.totals.alwaysLoadedTokensAfter)} |`);
  lines.push(`| CATES score | ${r.score.overallBefore} (${r.score.gradeBefore}) | ${r.score.overallAfter} (${r.score.gradeAfter}) | ${signed(r.score.overallAfter - r.score.overallBefore)} |`);
  lines.push(`| Token-efficiency findings | ${r.score.tokenEfficiencyFindingsBefore} | ${r.score.tokenEfficiencyFindingsAfter} | ${signed(r.score.tokenEfficiencyFindingsAfter - r.score.tokenEfficiencyFindingsBefore)} |`);
  lines.push(`| Total findings | ${r.score.totalFindingsBefore} | ${r.score.totalFindingsAfter} | ${signed(r.score.totalFindingsAfter - r.score.totalFindingsBefore)} |`);
  lines.push(`| Files changed | — | — | ${r.totals.filesChanged} of ${r.totals.filesScanned} |`);
  lines.push('');

  if (r.estimatedTokensSavedPerInvocation > 0) {
    lines.push(`> Always-loaded context is paid on **every** agent invocation, so the ${n(r.estimatedTokensSavedPerInvocation)} tokens removed there are saved on every single request going forward (${r.totals.alwaysLoadedReductionPct}% lighter).`);
    lines.push('');
  }

  // Guarantee
  lines.push(`## ${r.guarantee.noLossOfFunction ? '✅' : '⚠️'} No loss of function`);
  lines.push('');
  lines.push(r.guarantee.method);
  if (r.guarantee.invariantsChecked.length > 0) {
    lines.push('');
    lines.push('Invariants verified:');
    for (const inv of r.guarantee.invariantsChecked) lines.push(`- ${inv}`);
  }
  lines.push('');

  // Optimizers applied
  const applied = r.optimizers.filter(o => o.filesTouched > 0);
  if (applied.length > 0) {
    lines.push('## Optimizations applied');
    lines.push('');
    lines.push('| Optimizer | Rules | Files | Tokens saved | Safety |');
    lines.push('| --- | --- | ---: | ---: | --- |');
    for (const o of applied) {
      lines.push(`| ${o.title} | ${o.ruleIds.join(', ') || '—'} | ${o.filesTouched} | ${n(o.tokensSaved)} | ${o.safety} |`);
    }
    lines.push('');
  }

  // Files changed
  const changed = r.files.filter(f => f.changed && f.functionPreserved);
  if (changed.length > 0) {
    lines.push('## Files changed');
    lines.push('');
    for (const f of changed) {
      lines.push(`### \`${f.relativePath}\``);
      lines.push(`*${f.scope} · ${f.type}* — ${reduction(f.tokensBefore, f.tokensAfter)} tokens (${n(f.tokensBefore)} → ${n(f.tokensAfter)})`);
      for (const c of f.changes) {
        const where = c.line !== undefined ? ` _(line ${c.line})_` : '';
        lines.push(`- ${c.description}${where}`);
      }
      lines.push('');
    }
  }

  // Reverted files (should be none)
  const reverted = r.files.filter(f => !f.functionPreserved);
  if (reverted.length > 0) {
    lines.push('## Reverted (safety net triggered)');
    lines.push('');
    for (const f of reverted) {
      lines.push(`- \`${f.relativePath}\` — ${f.reverted ?? 'meaningful content would have changed'} (left untouched)`);
    }
    lines.push('');
  }

  // Remaining opportunities
  if (r.remainingRecommendations.length > 0) {
    lines.push('## Remaining opportunities (need human review)');
    lines.push('');
    lines.push('These were **not** auto-applied because doing so safely needs human judgement:');
    lines.push('');
    for (const rec of r.remainingRecommendations) {
      const save = rec.tokenSavings > 0 ? ` · ~${n(rec.tokenSavings)} tokens` : '';
      const rules = rec.ruleIds.length > 0 ? ` [${rec.ruleIds.join(', ')}]` : '';
      lines.push(`- **${rec.title}**${rules}${save} · effort: ${rec.effort}`);
      lines.push(`  - ${rec.reason}`);
    }
    lines.push('');
  }

  if (r.backups.length > 0) {
    lines.push('## Backups');
    lines.push('');
    for (const b of r.backups) lines.push(`- \`${b}\``);
    lines.push('');
  }

  if (r.experimental) {
    const xp = r.experimental;
    lines.push('## 🧪 Experimental opportunities (advisory — NOT auto-applied)');
    lines.push('');
    lines.push('These cache/output-shaping smells fall **outside the lossless guarantee** (fixing them changes behavior), so the optimizer never touches them. Shown so you can see the wider token impact.');
    lines.push('');
    for (const dim of xp.dimensions) {
      lines.push(`- **${dim.dimension}** — ${dim.findings.length} finding(s), ~${n(dim.estimatedTokenImpact)} est. tokens`);
    }
    lines.push(`- **Estimated total token impact (advisory):** ~${n(xp.estimatedTokenImpact)} tokens`);
    if (xp.findings.length > 0) {
      lines.push('');
      lines.push('| Rule | Severity | File | Token class | Finding |');
      lines.push('| --- | --- | --- | --- | --- |');
      for (const f of xp.findings) {
        const where = `${f.file}${f.line ? ':' + f.line : ''}`;
        lines.push(`| ${f.ruleId} | ${f.severity} | \`${where}\` | ${f.tokenClass ?? '—'} | ${f.message.replace(/\|/g, '\\|')} |`);
      }
    }
    lines.push('');
    lines.push(`> ${xp.note}`);
    lines.push('');
  }

  if (r.notes.length > 0) {
    lines.push('## Notes');
    lines.push('');
    for (const note of r.notes) lines.push(`- ${note}`);
    lines.push('');
  }

  return lines.join('\n').trimEnd() + '\n';
}
