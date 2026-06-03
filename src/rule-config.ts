// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import type { Dimension, Finding, Severity } from './types.js';

export interface RuleConfigEntry {
  enabled?: boolean;
  severity?: Severity;
}

export interface RuleConfigInput {
  rules?: Record<string, RuleConfigEntry>;
  dimensions?: Partial<Record<Dimension, RuleConfigEntry>>;
}

export interface RuleConfigResult {
  findings: Finding[];
  disabledFindings: Finding[];
  disabledRuleIds: string[];
  disabledDimensions: Dimension[];
}

/**
 * Apply rule and dimension toggles from policy to the raw finding set.
 *
 * Precedence (most specific wins):
 *   1. rules[<ruleId>] override
 *   2. dimensions[<dimension>] override
 *
 * Disabled findings are returned separately so callers can still report what
 * was filtered (and why) without scoring against them.
 */
export function applyRuleConfig(findings: Finding[], config: RuleConfigInput): RuleConfigResult {
  const rules = normalizeKeys(config.rules);
  const dimensions = config.dimensions ?? {};

  const disabledRuleIds = new Set<string>();
  const disabledDimensions = new Set<Dimension>();

  for (const [id, entry] of Object.entries(rules)) {
    if (entry.enabled === false) disabledRuleIds.add(id);
  }
  for (const [dim, entry] of Object.entries(dimensions) as Array<[Dimension, RuleConfigEntry]>) {
    if (entry?.enabled === false) disabledDimensions.add(dim);
  }

  const kept: Finding[] = [];
  const dropped: Finding[] = [];

  for (const finding of findings) {
    const ruleId = finding.ruleId.toUpperCase();
    const ruleOverride = rules[ruleId];
    const dimOverride = dimensions[finding.dimension];

    const ruleEnabled = ruleOverride?.enabled;
    const dimEnabled = dimOverride?.enabled;

    // Rule-level disable beats dimension-level enable; rule-level enable beats
    // dimension-level disable (most specific wins).
    let enabled = true;
    if (dimEnabled === false) enabled = false;
    if (ruleEnabled === false) enabled = false;
    if (ruleEnabled === true) enabled = true;

    if (!enabled) {
      dropped.push(finding);
      continue;
    }

    const severity =
      ruleOverride?.severity ??
      dimOverride?.severity ??
      finding.severity;

    kept.push(severity === finding.severity ? finding : { ...finding, severity });
  }

  return {
    findings: kept,
    disabledFindings: dropped,
    disabledRuleIds: [...disabledRuleIds],
    disabledDimensions: [...disabledDimensions],
  };
}

function normalizeKeys(
  input: Record<string, RuleConfigEntry> | undefined,
): Record<string, RuleConfigEntry> {
  if (!input) return {};
  const out: Record<string, RuleConfigEntry> = {};
  for (const [key, value] of Object.entries(input)) {
    out[key.toUpperCase()] = value;
  }
  return out;
}
