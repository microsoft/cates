// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import type { CopilotCheck } from './types.js';

const definitions: Array<Omit<CopilotCheck, 'stability'>> = [
  { id: 'GHCP001', title: 'Structured configuration syntax', dimension: 'completeness', severity: 'high',
    summary: 'Parse JSON/JSONC/YAML/frontmatter as the relevant surface expects; reject non-object configuration.',
    remediation: 'Repair syntax and metadata types. Comments/trailing commas are accepted only on documented JSONC surfaces.' },
  { id: 'GHCP002', title: 'Instruction applicability', dimension: 'conflict-reachability', severity: 'medium',
    summary: 'Check instruction bodies, applyTo and excludeAgent metadata without claiming model compliance.',
    remediation: 'Use a nonempty applyTo glob for path instructions and a supported excludeAgent value. Verify loaded references in the chosen client.' },
  { id: 'GHCP003', title: 'Canonical locations and compatibility', dimension: 'conflict-reachability', severity: 'medium',
    summary: 'Identify legacy or misplaced configuration and target-specific properties that may be ignored.',
    remediation: 'Move configuration to documented locations or retain it deliberately for the client that consumes it.' },
  { id: 'GHCP004', title: 'Custom agent contract', dimension: 'completeness', severity: 'high',
    summary: 'Validate required description, tool-list and target types, invocation controls, and the 30,000-character body limit.',
    remediation: 'Use YAML frontmatter with a nonempty description. Keep tools as a string/list; an empty list is valid and disables tools.' },
  { id: 'GHCP005', title: 'Tool access breadth', dimension: 'security', severity: 'medium',
    summary: 'Identify unrestricted tool inheritance, wildcard access and broad skill preapproval as review signals, not proof of exploitation.',
    remediation: 'Choose the smallest useful tool set. Tool availability is not a security boundary; verify runtime permissions separately.' },
  { id: 'GHCP006', title: 'Skill discovery contract', dimension: 'completeness', severity: 'high',
    summary: 'Check exact SKILL.md naming, directory/name agreement, required name/description and nonempty body.',
    remediation: 'Put a named SKILL.md in an immediate skill subdirectory; keep metadata concise and resource loading on demand.' },
  { id: 'GHCP007', title: 'Hook configuration', dimension: 'harness-quality', severity: 'high',
    summary: 'Validate hook envelopes, events, entries, command/exec/HTTP/prompt forms and inline hooks without executing them.',
    remediation: 'Fix the event/handler shape and verify it using a harmless test in every target runtime.' },
  { id: 'GHCP008', title: 'Hook execution assumptions', dimension: 'harness-quality', severity: 'medium',
    summary: 'Flag cloud-incompatible commands/events and interactive or fetch-and-execute hooks.',
    remediation: 'Use supported noninteractive handlers, bounded execution, and a tested enforcement event; do not rely on a hook that never fires.' },
  { id: 'GHCP009', title: 'MCP server contract', dimension: 'completeness', severity: 'high',
    summary: 'Validate supported server maps, local/remote transports, command/URL, arguments and tool-list types.',
    remediation: 'Use command plus args for local servers or an HTTP(S) URL for remote servers; verify authentication and tool discovery at runtime.' },
  { id: 'GHCP010', title: 'Execution, transport and credential hygiene', dimension: 'security', severity: 'medium',
    summary: 'Review server transport, embedded URL credentials, shell operators, package launchers and literal credential-like fields in configuration.',
    remediation: 'Use HTTPS outside loopback, secret references, simple executable/args pairs and exact reviewed package versions.' },
  { id: 'GHCP011', title: 'Settings and approval hygiene', dimension: 'security', severity: 'medium',
    summary: 'Check selected setting types, disabled hooks and broad approvals; inventory local overrides without treating them as effective policy.',
    remediation: 'Review shared versus local settings, preserve approval boundaries, and confirm organization/user/environment overrides.' },
  { id: 'GHCP012', title: 'Cloud setup workflow contract', dimension: 'harness-quality', severity: 'high',
    summary: 'Validate the documented setup job, supported keys, steps, timeout and broad permissions.',
    remediation: 'Use the canonical workflow and copilot-setup-steps job with only necessary permissions; verify an actual setup run.' },
  { id: 'GHCP013', title: 'Integration configuration', dimension: 'harness-quality', severity: 'medium',
    summary: 'Validate repository LSP fields and basic plugin/marketplace manifest shape; extension source is inventoried, not executed or certified.',
    remediation: 'Check manifests, install only reviewed integrations, and verify loading/runtime diagnostics separately.' },
  { id: 'GHCP014', title: 'Definition collisions', dimension: 'conflict-reachability', severity: 'medium',
    summary: 'Identify duplicate skill names and agent filename identities that can shadow one another.',
    remediation: 'Remove accidental duplicates or document precedence. Source presence does not prove which definition is active.' },
  { id: 'GHCP015', title: 'Sensitive and unsafe content', dimension: 'security', severity: 'high',
    summary: 'Reuse existing secret, injection, unsafe-command and autonomy-bypass detectors on newly discovered Copilot files.',
    remediation: 'Remove exposed credentials and unsafe grants; review dynamic inputs and verification bypasses. Pattern matches are not a security certification.' },
];

export const COPILOT_CHECKS: CopilotCheck[] = definitions.map(check => ({ ...check, stability: 'experimental' }));

export function getCopilotCheck(id: string): CopilotCheck | undefined {
  return COPILOT_CHECKS.find(check => check.id === id.toUpperCase());
}
