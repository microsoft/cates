// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import type { CopilotReport } from './types.js';

export function formatCopilot(report: CopilotReport): string {
  const lines = [
    '',
    '  Copilot hygiene - EXPERIMENTAL, NOT scored; excluded from stable CI gates',
    `     Target: ${report.target} | Scope: ${report.scope} | Inventory: ${report.completeness}`,
    `     ${report.findings.length} advisory finding(s), ${report.disabledFindings.length} disabled, ${report.suppressedFindings.length} suppressed`,
    '',
  ];
  for (const row of report.coverage) lines.push(`     ${row.surface.padEnd(14)} ${row.files} candidate(s), ${row.checked} checked${row.status === 'not-detected' ? ' (optional; not detected)' : ''}`);
  for (const issue of report.diagnostics) lines.push(`     NOT ASSESSED [${issue.reason}] ${issue.path}: ${issue.message}`);
  const ranks = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  for (const finding of [...report.findings].sort((a, b) => ranks[a.severity] - ranks[b.severity])) {
    lines.push('', `     [${finding.ruleId}/${finding.severity}/${finding.basis}] ${finding.file}${finding.line ? `:${finding.line}` : ''}`);
    lines.push(`       ${finding.message}`, `       ${finding.suggestion}`);
  }
  lines.push('', '     Manual verification still required:');
  for (const check of report.manualChecks) lines.push(`       ${check.title}: ${check.verification}`);
  lines.push('', `     ${report.note}`, '');
  return lines.join('\n');
}
