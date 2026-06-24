// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { Dimension, Severity, Suppression } from './types.js';

export interface RuleOverride {
  enabled?: boolean;
  severity?: Severity;
}

export type RuleConfigMap = Record<string, RuleOverride>;
export type DimensionConfigMap = Partial<Record<Dimension, RuleOverride>>;

export interface CatesPolicy {
  minScore?: number;
  requireLevel?: 1 | 2 | 3;
  failOn?: Severity[];
  maxAlwaysLoadedTokens?: number;
  suppressions?: Suppression[];
  rules?: RuleConfigMap;
  dimensions?: DimensionConfigMap;
  /** Opt in to experimental (non-normative) cache/output-shaping analysis. */
  experimental?: boolean;
}

export const DEFAULT_POLICY: Required<Pick<CatesPolicy, 'minScore' | 'requireLevel' | 'failOn' | 'maxAlwaysLoadedTokens'>> = {
  minScore: 0,
  requireLevel: 1,
  failOn: ['critical'],
  maxAlwaysLoadedTokens: 1500,
};

export async function loadPolicy(repoPath: string, explicitPath?: string): Promise<CatesPolicy> {
  const candidates = explicitPath
    ? [explicitPath]
    : ['.cates.yml', '.cates.yaml', '.cates.json'].map(name => join(repoPath, name));

  const policyPath = candidates.find(path => existsSync(path));
  if (!policyPath) return {};

  const content = await readFile(policyPath, 'utf-8');
  let parsed: unknown;
  try {
    parsed = policyPath.endsWith('.json') ? JSON.parse(content) : parseYaml(content);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse CATES policy file ${policyPath}: ${reason}`);
  }
  return normalizePolicy(parsed ?? {});
}

function normalizePolicy(value: unknown): CatesPolicy {
  if (!value || typeof value !== 'object') return {};
  const input = value as Record<string, unknown>;
  return {
    minScore: asNumber(input['minScore']),
    requireLevel: asLevel(input['requireLevel']),
    failOn: Array.isArray(input['failOn']) ? input['failOn'].filter(isSeverity) : undefined,
    maxAlwaysLoadedTokens: asNumber(input['maxAlwaysLoadedTokens']),
    suppressions: Array.isArray(input['suppressions'])
      ? input['suppressions'].filter(isSuppression)
      : undefined,
    rules: parseRuleMap(input['rules']),
    dimensions: parseDimensionMap(input['dimensions']),
    experimental: typeof input['experimental'] === 'boolean' ? input['experimental'] : undefined,
  };
}

function parseRuleMap(value: unknown): RuleConfigMap | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const out: RuleConfigMap = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const override = parseOverride(raw);
    if (override) out[key.toUpperCase()] = override;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseDimensionMap(value: unknown): DimensionConfigMap | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const out: DimensionConfigMap = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!isDimension(key)) continue;
    const override = parseOverride(raw);
    if (override) out[key] = override;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseOverride(value: unknown): RuleOverride | undefined {
  // Shorthand: off / false / "disabled" disables; on / true / "enabled" enables.
  if (value === false || value === 'off' || value === 'disabled' || value === 'disable') {
    return { enabled: false };
  }
  if (value === true || value === 'on' || value === 'enabled' || value === 'enable') {
    return { enabled: true };
  }
  // Shorthand: severity string downgrades/upgrades severity.
  if (typeof value === 'string' && isSeverity(value)) {
    return { severity: value };
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const override: RuleOverride = {};
    if (typeof obj['enabled'] === 'boolean') override.enabled = obj['enabled'];
    if (typeof obj['severity'] === 'string' && isSeverity(obj['severity'])) {
      override.severity = obj['severity'];
    }
    return Object.keys(override).length > 0 ? override : undefined;
  }
  return undefined;
}

function isDimension(value: string): value is Dimension {
  return (
    value === 'token-efficiency' ||
    value === 'security' ||
    value === 'specificity' ||
    value === 'completeness' ||
    value === 'conflict-reachability' ||
    value === 'harness-quality'
  );
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asLevel(value: unknown): 1 | 2 | 3 | undefined {
  return value === 1 || value === 2 || value === 3 ? value : undefined;
}

function isSeverity(value: unknown): value is Severity {
  return value === 'critical' || value === 'high' || value === 'medium' || value === 'low' || value === 'info';
}

function isSuppression(value: unknown): value is NonNullable<CatesPolicy['suppressions']>[number] {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item['ruleId'] === 'string'
    && item['ruleId'].trim().length > 0
    && typeof item['reason'] === 'string'
    && item['reason'].trim().length > 0
    && (item['file'] === undefined || typeof item['file'] === 'string')
    && (item['expires'] === undefined || typeof item['expires'] === 'string')
    && (item['owner'] === undefined || typeof item['owner'] === 'string');
}
