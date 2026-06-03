// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import type { AnalysisResult } from '../types.js';
import { getRule } from '../rules/catalog.js';

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

  lines.push('  ✨ Executive Summary:');
  lines.push(`     Top risk: ${topRisk(findings)}`);
  lines.push(`     Biggest token reduction: ${topSavings(recommendations)}`);
  lines.push(`     First fix: ${firstFix(recommendations)}`);
  if (result.suppressionSummary.suppressedFindings > 0 || result.suppressionSummary.expired > 0) {
    lines.push(`     Suppressions: ${result.suppressionSummary.suppressedFindings} finding(s) hidden, ${result.suppressionSummary.expired} expired`);
  }
  lines.push('');

  // Discovery Summary
  lines.push('  📁 Files Discovered:');
  lines.push(`     ${discovery.files.length} config file(s) found`);
  lines.push(`     ${discovery.totalTokens.toLocaleString()} total tokens in active configs${discovery.tokenizer ? ` (${discovery.tokenizer})` : ''}`);
  lines.push(`     ${discovery.alwaysLoadedTokens.toLocaleString()} tokens always-loaded`);
  if (discovery.conditionalTokens > 0) {
    lines.push(`     ${discovery.conditionalTokens.toLocaleString()} tokens conditional`);
  }
  if (discovery.deadFileTokens > 0) {
    lines.push(`     ${discovery.deadFileTokens.toLocaleString()} tokens in dead/unreachable files`);
  }
  if (discovery.totalTokensByTokenizer && Object.keys(discovery.totalTokensByTokenizer).length > 1) {
    lines.push('');
    lines.push('  🔢 Tokenizer Comparison (active configs):');
    const base = discovery.tokenizer ?? Object.keys(discovery.totalTokensByTokenizer)[0]!;
    const baseCount = discovery.totalTokensByTokenizer[base] || 1;
    for (const [id, count] of Object.entries(discovery.totalTokensByTokenizer)) {
      const delta = id === base ? '(baseline)' : `${((count / baseCount - 1) * 100).toFixed(1)}% vs ${base}`;
      lines.push(`     ${padRight(id, 22)} ${count.toLocaleString().padStart(10)} tokens   ${delta}`);
    }
  }
  lines.push('');

  lines.push('  🧭 Coverage Matrix:');
  for (const row of coverageRows(result)) {
    lines.push(`     ${row.present ? '✓' : '·'} ${padRight(row.label, 18)} ${row.detail}`);
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
   lines.push('  📉 Token Reduction Opportunity:');
   lines.push(`     Direct:       ${formatPercent(result.savings.conservativePercentage)} of analyzed tokens (~${result.savings.conservativeTokensPerInvocation.toLocaleString()} tokens/invocation)`);
   lines.push(`     Projected:    ${formatPercent(result.savings.projectedPercentage)} equivalent (~${result.savings.projectedTokensPerInvocation.toLocaleString()} tokens/invocation)`);
   lines.push(`     Signal:       ${score.findingsPerThousandTokens.toFixed(1)} findings per 1K analyzed tokens`);
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
      if (f.evidence) {
        lines.push(`       Evidence: ${formatEvidence(f.evidence)}`);
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
      if (rec.ruleIds.length > 0) {
        lines.push(`        Rules: ${rec.ruleIds.join(', ')} | Safety: ${rec.safety}${rec.autofixable ? ' | Autofix available' : ''}`);
      }
      if (rec.files.length > 0) {
        lines.push(`        Files: ${rec.files.slice(0, 3).join(', ')}${rec.files.length > 3 ? ` (+${rec.files.length - 3} more)` : ''}`);
      }
      if (rec.tokenSavings > 0) {
        const savingsLabel = rec.tokenSavingsKind === 'projected' ? 'Projected reduction' : 'Token reduction';
        lines.push(`        ${savingsLabel}: ~${rec.tokenSavings} tokens/invocation (${formatPercent(rec.tokenSavingsPercentage ?? 0)} equivalent)`);
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
            const rule = getRule(id);
            return {
              id,
              name: rule?.title ?? id,
              shortDescription: { text: rule?.summary ?? finding.message },
              fullDescription: { text: rule?.detection ?? finding.message },
              help: { text: rule?.remediation ?? finding.suggestion ?? finding.message },
              defaultConfiguration: { level: sarifLevel(finding.severity) },
            };
          }),
        },
      },
      results: result.findings.map(f => ({
        ruleId: f.ruleId,
        level: sarifLevel(f.severity),
        message: { text: f.message + (f.suggestion ? `\n💡 ${f.suggestion}` : '') },
        properties: {
          dimension: f.dimension,
          confidence: f.confidence,
          tokenImpact: f.tokenImpact,
        },
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

function topRisk(findings: AnalysisResult['findings']): string {
  const top = [...findings].sort((a, b) => severityRank(a.severity) - severityRank(b.severity))[0];
  return top ? `[${top.ruleId}] ${top.message}` : 'No active findings';
}

function topSavings(recommendations: AnalysisResult['recommendations']): string {
  const top = [...recommendations].sort((a, b) => b.tokenSavings - a.tokenSavings)[0];
  return top && top.tokenSavings > 0
    ? `${top.title} (~${top.tokenSavings.toLocaleString()} tokens/invocation)`
    : 'No material token waste detected';
}

function firstFix(recommendations: AnalysisResult['recommendations']): string {
  return recommendations[0]?.title ?? 'No remediation needed';
}

function coverageRows(result: AnalysisResult): Array<{ label: string; present: boolean; detail: string }> {
  const files = result.discovery.files;
  const hasPath = (pattern: RegExp) => files.some(file => pattern.test(file.relativePath));
  const countType = (type: string) => files.filter(file => file.type === type).length;
  return [
    { label: 'Copilot', present: hasPath(/^\.github\/copilot|^\.github\/prompts|^\.github\/copilot-instructions\.md$/), detail: `${files.filter(file => file.relativePath.startsWith('.github/')).length} GitHub config file(s)` },
    { label: 'Claude', present: hasPath(/(?:^|\/)\.claude\/|(?:^|\/)CLAUDE\.md$/i), detail: `${files.filter(file => /\.claude\//i.test(file.relativePath) || /CLAUDE\.md$/i.test(file.relativePath)).length} Claude file(s)` },
    { label: 'Cursor', present: hasPath(/(?:^|\/)\.cursor\/|(?:^|\/)\.cursorrules$/i), detail: `${files.filter(file => /\.cursor\//i.test(file.relativePath) || /\.cursorrules$/i.test(file.relativePath)).length} Cursor file(s)` },
    { label: 'Gemini', present: hasPath(/(?:^|\/)\.gemini\/|(?:^|\/)GEMINI\.md$/i), detail: `${files.filter(file => /\.gemini\//i.test(file.relativePath) || /GEMINI\.md$/i.test(file.relativePath)).length} Gemini file(s)` },
    { label: 'MCP', present: countType('mcp-config') > 0, detail: `${countType('mcp-config')} MCP config(s)` },
    { label: 'Hooks', present: countType('hooks-config') > 0, detail: `${countType('hooks-config')} hook config(s)` },
    { label: 'Setup', present: countType('setup-steps') > 0, detail: `${countType('setup-steps')} setup config(s)` },
    { label: 'Prompts', present: countType('prompt-file') > 0, detail: `${countType('prompt-file')} prompt file(s)` },
  ];
}

function formatEvidence(evidence: string): string {
  return evidence.replace(/\s+/g, ' ').slice(0, 120);
}
