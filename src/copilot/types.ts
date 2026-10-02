// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import type { CopilotTarget, Dimension, DiscoveryDiagnostic, Finding, Severity, SuppressionSummary } from '../types.js';

export type CopilotSurface = 'instructions' | 'agents' | 'skills' | 'prompts' | 'hooks' | 'mcp' | 'settings' | 'setup' | 'lsp' | 'plugins' | 'extensions';
export interface CopilotFinding extends Finding {
  stability: 'experimental';
  basis: 'documented' | 'heuristic';
}

export interface CopilotCheck {
  id: string;
  title: string;
  dimension: Dimension;
  severity: Severity;
  summary: string;
  remediation: string;
  stability: 'experimental';
}

export interface CopilotReport {
  profile: 'copilot';
  stability: 'experimental';
  target: CopilotTarget;
  documentationSnapshot: string;
  scope: 'repository' | 'selected-files' | 'selected-directory' | 'supplied-files';
  completeness: 'complete-within-scope' | 'partial';
  diagnostics: DiscoveryDiagnostic[];
  files: Array<{
    path: string;
    surface: CopilotSurface | 'unrecognized';
    status: 'checked' | 'inventory-only' | 'not-analyzed';
    tokens: number | null;
  }>;
  coverage: Array<{ surface: CopilotSurface; files: number; checked: number; status: 'present' | 'not-detected' }>;
  findings: CopilotFinding[];
  disabledFindings: CopilotFinding[];
  suppressedFindings: CopilotFinding[];
  suppressionSummary: SuppressionSummary;
  manualChecks: Array<{ id: string; title: string; status: 'not-assessed'; verification: string }>;
  note: string;
}
