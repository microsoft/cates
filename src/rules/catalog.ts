// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import type { Dimension, Severity } from '../types.js';

export interface RuleMetadata {
  id: string;
  title: string;
  dimension: Dimension;
  severity: Severity;
  summary: string;
  detection: string;
  remediation: string;
  catesSection: string;
  autofix?: boolean;
}

export const RULE_CATALOG: RuleMetadata[] = [
  { id: 'TE001', title: 'Excessive Always-Loaded Token Count', dimension: 'token-efficiency', severity: 'medium', summary: 'Always-loaded configuration exceeds 1,500 tokens.', detection: 'Sum active always-loaded config tokens and flag totals above 1,500.', remediation: 'Move context-specific guidance to conditional agent files or on-demand prompt files.', catesSection: '9.2', autofix: false },
  { id: 'TE002', title: 'Excessive Inline Code Examples', dimension: 'token-efficiency', severity: 'medium', summary: 'Inline code block exceeds 200 tokens.', detection: 'Find fenced code blocks over 200 cl100k_base tokens.', remediation: 'Move examples to referenced files or prompt-library entries.', catesSection: '9.2', autofix: false },
  { id: 'TE003', title: 'Generic Filler Instructions', dimension: 'token-efficiency', severity: 'low', summary: 'Instruction restates model-default behavior or vague best-practice language.', detection: 'Match known generic filler phrases.', remediation: 'Remove filler or replace with project-specific instructions.', catesSection: '9.2', autofix: false },
  { id: 'TE004', title: 'Forced Verbosity', dimension: 'token-efficiency', severity: 'high', summary: 'Instructions require verbose output for every response.', detection: 'Match unconditional verbosity patterns.', remediation: 'Make verbosity conditional by task complexity.', catesSection: '9.2', autofix: false },
  { id: 'TE005', title: 'Negative Constraint Spam', dimension: 'token-efficiency', severity: 'medium', summary: 'More than 60% of bullet instructions are negative constraints.', detection: 'Compare negative bullet count to total bullet count.', remediation: 'Rewrite as positive preferred behaviors.', catesSection: '9.2', autofix: false },
  { id: 'TE006', title: 'Cross-File Duplication', dimension: 'token-efficiency', severity: 'high', summary: 'Near-duplicate blocks appear across multiple config files.', detection: 'Compare normalized multi-line paragraphs across files.', remediation: 'Keep shared guidance in one precedence-appropriate location.', catesSection: '9.2', autofix: false },
  { id: 'TE007', title: 'Within-File Duplicate Instructions', dimension: 'token-efficiency', severity: 'medium', summary: 'Same normalized instruction appears more than once in one file.', detection: 'Find repeated normalized lines or paragraphs.', remediation: 'Remove duplicated instructions.', catesSection: '9.2', autofix: true },

  { id: 'SEC001', title: 'Hardcoded Secrets', dimension: 'security', severity: 'critical', summary: 'Credential-like value appears in configuration.', detection: 'Match known API key, token, password, private key, and connection string patterns.', remediation: 'Remove immediately and use environment variables or secret managers.', catesSection: '9.3', autofix: false },
  { id: 'SEC002', title: 'Injection Vectors', dimension: 'security', severity: 'high', summary: 'Configuration includes variable interpolation that may become instructions.', detection: 'Match template interpolation and prompt-injection payload patterns.', remediation: 'Use structured tool inputs and validated schemas.', catesSection: '9.3', autofix: false },
  { id: 'SEC003', title: 'Overly Permissive Scope', dimension: 'security', severity: 'high', summary: 'Instructions grant broad file, command, or tool access.', detection: 'Match unrestricted action/file/tool patterns.', remediation: 'Define explicit scoped permissions.', catesSection: '9.3', autofix: false },
  { id: 'SEC004', title: 'Missing Prompt Protection', dimension: 'security', severity: 'medium', summary: 'Instruction-bearing config lacks anti-extraction directive.', detection: 'Flag files over 200 chars without reveal/share/disclose protection language.', remediation: 'Add a prompt-protection directive.', catesSection: '9.3', autofix: true },
  { id: 'SEC005', title: 'System Prompt Leakage Risk', dimension: 'security', severity: 'high', summary: 'Instructions create a path for disclosing system instructions.', detection: 'Match conditional or explicit instruction disclosure language.', remediation: 'Remove disclosure paths and make protection unconditional.', catesSection: '9.3', autofix: false },
  { id: 'SEC006', title: 'Unsafe Execution Patterns', dimension: 'security', severity: 'high', summary: 'Config includes unsafe commands or verification bypasses.', detection: 'Match curl-pipe-shell, eval, destructive filesystem, chmod 777, no-verify, or disabled TLS patterns.', remediation: 'Remove unsafe patterns or label them as prohibited with safe alternatives.', catesSection: '9.3', autofix: false },

  { id: 'SPC001', title: 'Vague Language', dimension: 'specificity', severity: 'medium', summary: 'Instruction uses subjective or undefined language.', detection: 'Match vague phrases such as best practices, appropriate, robust, or common sense.', remediation: 'Replace with concrete criteria and examples.', catesSection: '9.4', autofix: false },
  { id: 'SPC002', title: 'Missing Project Context', dimension: 'specificity', severity: 'medium', summary: 'Large config lacks concrete project references.', detection: 'Flag files over 500 tokens with no file paths, directories, or technology/config references.', remediation: 'Reference real directories, config files, and stack details.', catesSection: '9.4', autofix: false },
  { id: 'SPC003', title: 'Missing Architecture Structure', dimension: 'specificity', severity: 'low', summary: 'Config lacks architecture or module structure guidance.', detection: 'Flag files over 300 tokens with no architecture/module/service references.', remediation: 'Add a short project layout section.', catesSection: '9.4', autofix: false },
  { id: 'SPC004', title: 'Long Abstract Instruction Block', dimension: 'specificity', severity: 'low', summary: 'Long bullet block lacks concrete anchors.', detection: 'Find eight or more consecutive abstract bullets.', remediation: 'Add examples, file references, or decision criteria.', catesSection: '9.4', autofix: false },

  { id: 'CMP001', title: 'No Configuration Content', dimension: 'completeness', severity: 'high', summary: 'No coding-agent configuration was found.', detection: 'No active config content after discovery.', remediation: 'Create root instructions with stack, conventions, testing, and scope.', catesSection: '9.5', autofix: false },
  { id: 'CMP002', title: 'Missing Essential Topics', dimension: 'completeness', severity: 'medium', summary: 'Configuration omits key topics like tests, errors, style, architecture, security, scope, or output.', detection: 'Search combined config for essential topic coverage.', remediation: 'Add concise sections for missing topics.', catesSection: '9.5', autofix: false },
  { id: 'CMP003', title: 'Monolithic Configuration File', dimension: 'completeness', severity: 'low', summary: 'Only one config file exists and it exceeds 200 lines.', detection: 'Count config files and line count.', remediation: 'Split universal guidance from scoped or on-demand guidance.', catesSection: '9.5', autofix: false },

  { id: 'CNF001', title: 'Contradictory Instructions', dimension: 'conflict-reachability', severity: 'high', summary: 'Loaded instructions conflict.', detection: 'Match known contradictory instruction pairs.', remediation: 'Resolve contradiction or scope conflicting guidance conditionally.', catesSection: '9.6', autofix: false },
  { id: 'CNF002', title: 'Missing Harness Element', dimension: 'harness-quality', severity: 'medium', summary: 'Configuration lacks important agent guardrails.', detection: 'Check for scope limits, failure handling, output constraints, prohibited actions, and verification.', remediation: 'Add concise guardrails for missing harness elements.', catesSection: '9.6', autofix: false },

  { id: 'PRM001', title: 'Missing Prompt Purpose Header', dimension: 'specificity', severity: 'low', summary: 'Prompt lacks clear purpose/trigger metadata.', detection: 'Flag prompt files over 50 tokens without heading or purpose markers.', remediation: 'Add frontmatter or a purpose heading.', catesSection: 'Annex B', autofix: true },
  { id: 'PRM002', title: 'Oversized Prompt File', dimension: 'token-efficiency', severity: 'medium', summary: 'Prompt exceeds 1,000 tokens.', detection: 'Token-count prompt files.', remediation: 'Split into smaller prompts or referenced files.', catesSection: 'Annex B', autofix: false },
  { id: 'PRM003', title: 'Excessive Hardcoded File Paths', dimension: 'specificity', severity: 'low', summary: 'Prompt references more than five concrete source paths.', detection: 'Count source path references.', remediation: 'Use directory references or placeholders.', catesSection: 'Annex B', autofix: false },
  { id: 'PRM004', title: 'No Variables in Large Prompt', dimension: 'completeness', severity: 'low', summary: 'Large prompt lacks placeholders.', detection: 'Flag prompts over 200 tokens without variable markers.', remediation: 'Add placeholders for reusable inputs.', catesSection: 'Annex B', autofix: false },
  { id: 'PRM005', title: 'Prompt Library Sprawl', dimension: 'completeness', severity: 'low', summary: 'Prompt library has more than 15 prompts.', detection: 'Count prompt files.', remediation: 'Add index, grouping, or merge overlapping prompts.', catesSection: 'Annex B', autofix: false },

  { id: 'MCP001', title: 'Invalid MCP Config Syntax', dimension: 'completeness', severity: 'medium', summary: 'MCP config cannot be parsed.', detection: 'Parse MCP JSON/YAML.', remediation: 'Fix syntax and validate before commit.', catesSection: 'Annex C', autofix: false },
  { id: 'MCP002', title: 'Secrets in MCP Configuration', dimension: 'security', severity: 'critical', summary: 'MCP config contains hardcoded credentials.', detection: 'Match secret patterns in parsed MCP config.', remediation: 'Use env vars or secret-manager bindings.', catesSection: 'Annex C', autofix: false },
  { id: 'MCP003', title: 'Insecure MCP Endpoint', dimension: 'security', severity: 'high', summary: 'MCP config references non-localhost HTTP.', detection: 'Find http:// endpoints outside localhost.', remediation: 'Use HTTPS for remote endpoints.', catesSection: 'Annex C', autofix: false },
  { id: 'MCP004', title: 'Missing MCP Server Descriptions', dimension: 'specificity', severity: 'low', summary: 'MCP servers/tools lack descriptions.', detection: 'Check server/tool objects for description fields.', remediation: 'Add when-to-use descriptions.', catesSection: 'Annex C', autofix: false },
  { id: 'MCP005', title: 'Shell Operators in MCP Command', dimension: 'security', severity: 'high', summary: 'MCP stdio command contains shell operators.', detection: 'Match shell operators in command strings.', remediation: 'Use command plus args array or reviewed wrapper script.', catesSection: 'Annex C', autofix: false },

  { id: 'STP001', title: 'Pipe-to-Shell Setup Pattern', dimension: 'security', severity: 'high', summary: 'Setup steps pipe curl to shell.', detection: 'Match curl piped to sh/bash.', remediation: 'Pin versions and verify downloads.', catesSection: 'Annex D', autofix: false },
  { id: 'STP002', title: 'Missing Dependency Caching', dimension: 'token-efficiency', severity: 'low', summary: 'Setup installs dependencies without caching.', detection: 'Install step exists without cache indicators.', remediation: 'Add package-manager cache restore/save.', catesSection: 'Annex D', autofix: false },
  { id: 'STP003', title: 'Broad Setup Permissions', dimension: 'security', severity: 'medium', summary: 'Setup grants broad permissions.', detection: 'Find broad write permissions beyond normal content changes.', remediation: 'Reduce permissions to least privilege.', catesSection: 'Annex D', autofix: false },
  { id: 'STP004', title: 'Missing Test Framework Setup', dimension: 'completeness', severity: 'medium', summary: 'Setup lacks test runner or test command.', detection: 'Search setup for test runner patterns.', remediation: 'Ensure agent can run tests.', catesSection: 'Annex D', autofix: false },
  { id: 'STP005', title: 'Missing Linter Setup', dimension: 'completeness', severity: 'low', summary: 'Setup lacks lint/static-analysis command.', detection: 'Search setup for lint/format/static-check patterns.', remediation: 'Expose lint/static-analysis command.', catesSection: 'Annex D', autofix: false },

  { id: 'HK001', title: 'Interactive Hook', dimension: 'conflict-reachability', severity: 'medium', summary: 'Hook may block automated agent workflows.', detection: 'Match interactive/prompt/confirm patterns.', remediation: 'Make hooks non-interactive.', catesSection: 'Annex E', autofix: false },
  { id: 'HK002', title: 'Heavy Hook Operation', dimension: 'token-efficiency', severity: 'low', summary: 'Hook includes heavyweight work.', detection: 'Match container/build-image patterns.', remediation: 'Move heavyweight checks to CI.', catesSection: 'Annex E', autofix: false },
  { id: 'HK003', title: 'Outdated Hook Version', dimension: 'security', severity: 'low', summary: 'Hook is pinned to very old major version.', detection: 'Flag v0.x/v1.x hook revisions.', remediation: 'Update to current stable versions.', catesSection: 'Annex E', autofix: false },
  { id: 'EDC001', title: 'Invalid Editor Settings Syntax', dimension: 'completeness', severity: 'low', summary: 'Editor config with AI settings cannot be parsed.', detection: 'Parse relevant settings file.', remediation: 'Fix JSON/JSONC/YAML syntax.', catesSection: 'Annex F', autofix: false },
  { id: 'EDC002', title: 'AI Assistance Disabled Broadly', dimension: 'completeness', severity: 'low', summary: 'AI assistance disabled for many contexts.', detection: 'Count disabled language/context settings.', remediation: 'Confirm disabled contexts are intentional.', catesSection: 'Annex F', autofix: false },
];

export function getRule(id: string): RuleMetadata | undefined {
  return RULE_CATALOG.find(rule => rule.id === id);
}

export function rulesAsJson(): string {
  return JSON.stringify(RULE_CATALOG, null, 2);
}
