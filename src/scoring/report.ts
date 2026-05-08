import type { AnalysisResult } from '../types.js';

/**
 * Format analysis results for different output targets.
 */

export function createReport(result: AnalysisResult, format: 'pretty' | 'json' | 'sarif'): string {
  switch (format) {
    case 'json':
      return JSON.stringify(result, null, 2);
    case 'sarif':
      return toSarif(result);
    case 'pretty':
    default:
      return toPretty(result);
  }
}

function toPretty(result: AnalysisResult): string {
  const lines: string[] = [];
  const { score, discovery, findings, recommendations } = result;

  // Header
  lines.push('');
  lines.push('╔══════════════════════════════════════════════════════════════╗');
  lines.push('║        CATES CONFIGURATION ANALYZER                         ║');
  lines.push('╚══════════════════════════════════════════════════════════════╝');
  lines.push('');

  // Overall Score
  const gradeEmoji = score.grade === 'A+' || score.grade === 'A' ? '🏆' : score.grade === 'B' ? '✅' : score.grade === 'C' ? '⚠️' : '🚨';
  lines.push(`  ${gradeEmoji} Overall Score: ${score.overall}/100 (Grade: ${score.grade})`);
  lines.push('');

  // Discovery Summary
  lines.push('  📁 Files Discovered:');
  lines.push(`     ${discovery.files.length} config file(s) found`);
  lines.push(`     ${discovery.totalTokens.toLocaleString()} total tokens in active configs`);
  lines.push(`     ${discovery.alwaysLoadedTokens.toLocaleString()} tokens always-loaded (per invocation cost)`);
  if (discovery.conditionalTokens > 0) {
    lines.push(`     ${discovery.conditionalTokens.toLocaleString()} tokens conditional`);
  }
  if (discovery.deadFileTokens > 0) {
    lines.push(`     ${discovery.deadFileTokens.toLocaleString()} tokens in dead/unreachable files`);
  }
  lines.push('');

  // Dimension Scores
  lines.push('  📊 Dimension Scores:');
  for (const dim of score.dimensions) {
    const bar = progressBar(dim.score);
    const icon = dim.score >= 85 ? '●' : dim.score >= 60 ? '◐' : '○';
    lines.push(`     ${icon} ${padRight(dim.dimension, 22)} ${bar} ${dim.score}/100`);
  }
  lines.push('');

  // Token savings impact
  if (discovery.totalTokens > 0) {
   lines.push('  💰 Potential Token Savings:');
   lines.push(`     Conservative: ~${result.savings.conservativeTokensPerInvocation.toLocaleString()} tokens/invocation (${formatPercent(result.savings.conservativePercentage)} of analyzed tokens)`);
   lines.push(`     Projected:    ~${result.savings.projectedTokensPerInvocation.toLocaleString()} tokens/invocation (${formatPercent(result.savings.projectedPercentage)} equivalent)`);
   lines.push(`     Monthly:      ${result.savings.projectedMonthlyTokens.toLocaleString()} tokens | ~$${result.savings.projectedMonthlyCost.toFixed(2)}`);
   lines.push(`     Annualized:   ${result.savings.projectedAnnualTokens.toLocaleString()} tokens | ~$${result.savings.projectedAnnualCost.toFixed(2)}`);
   lines.push('');
  }

  // Findings Summary
  if (findings.length > 0) {
    lines.push(`  🔍 Findings: ${findings.length} total`);
    const bySeverity = groupBy(findings, f => f.severity);
    const severityOrder = ['critical', 'high', 'medium', 'low', 'info'];
    const icons: Record<string, string> = { critical: '🔴', high: '🟠', medium: '🟡', low: '🔵', info: 'ℹ️' };
    for (const sev of severityOrder) {
      const count = bySeverity[sev]?.length ?? 0;
      if (count > 0) {
        lines.push(`     ${icons[sev]} ${sev}: ${count}`);
      }
    }
    lines.push('');

    // Top findings detail
    const topFindings = findings
      .sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
      .slice(0, 10);

    lines.push('  📋 Top Findings:');
    for (const f of topFindings) {
      const icon = icons[f.severity] ?? '•';
      lines.push(`     ${icon} [${f.ruleId}] ${f.message}`);
      lines.push(`       └─ ${f.file}${f.line ? ':' + f.line : ''}`);
      if (f.suggestion) {
        lines.push(`       💡 ${f.suggestion}`);
      }
      lines.push('');
    }
  }

  // Recommendations
  if (recommendations.length > 0) {
    lines.push('  🎯 Recommendations (by priority):');
    lines.push('');
    for (const rec of recommendations.slice(0, 5)) {
      lines.push(`     ${rec.priority}. ${rec.title}`);
      lines.push(`        ${rec.description}`);
      if (rec.tokenSavings > 0) {
        const savingsLabel = rec.tokenSavingsKind === 'projected' ? 'Projected savings' : 'Savings';
        lines.push(`        ${savingsLabel}: ~${rec.tokenSavings} tokens/invocation (${formatPercent(rec.tokenSavingsPercentage ?? 0)} equivalent) | ~$${rec.costSavings.toFixed(2)}/month`);
      }
      lines.push(`        Effort: ${rec.effort}`);
      if (rec.before && rec.after) {
        lines.push(`        Before: ${rec.before.split('\n')[0]}`);
        lines.push(`        After:  ${rec.after.split('\n')[0]}`);
      }
      lines.push('');
    }
  }

  lines.push('─'.repeat(62));
  lines.push(`  Analyzed: ${result.repoPath}`);
  lines.push(`  Timestamp: ${result.timestamp}`);
  lines.push('');

  return lines.join('\n');
}

function toSarif(result: AnalysisResult): string {
  const sarif = {
    $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: {
        driver: {
              name: 'cates-analyzer',
          version: '1.0.0',
          rules: [...new Set(result.findings.map(f => f.ruleId))].map(id => {
            const finding = result.findings.find(f => f.ruleId === id)!;
            return {
              id,
              shortDescription: { text: finding.message },
              defaultConfiguration: { level: sarifLevel(finding.severity) },
            };
          }),
        },
      },
      results: result.findings.map(f => ({
        ruleId: f.ruleId,
        level: sarifLevel(f.severity),
        message: { text: f.message + (f.suggestion ? `\n💡 ${f.suggestion}` : '') },
        locations: [{
          physicalLocation: {
            artifactLocation: { uri: f.file },
            region: f.line ? { startLine: f.line } : undefined,
          },
        }],
      })),
    }],
  };

  return JSON.stringify(sarif, null, 2);
}

function sarifLevel(severity: string): string {
  switch (severity) {
    case 'critical':
    case 'high': return 'error';
    case 'medium': return 'warning';
    default: return 'note';
  }
}

function progressBar(value: number, width = 20): string {
  const filled = Math.round((value / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function padRight(str: string, len: number): string {
  return str + ' '.repeat(Math.max(0, len - str.length));
}

function severityRank(severity: string): number {
  const ranks: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  return ranks[severity] ?? 5;
}

function groupBy<T>(arr: T[], fn: (item: T) => string): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const item of arr) {
    const key = fn(item);
    (result[key] ??= []).push(item);
  }
  return result;
}
