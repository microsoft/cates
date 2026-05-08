import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { Severity, Suppression } from './types.js';

export interface CatesPolicy {
  minScore?: number;
  requireLevel?: 1 | 2 | 3;
  failOn?: Severity[];
  maxAlwaysLoadedTokens?: number;
  assumedDailyInvocations?: number;
  assumedModelCostPer1kTokens?: number;
  suppressions?: Suppression[];
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
  const parsed = policyPath.endsWith('.json') ? JSON.parse(content) : parseYaml(content);
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
    assumedDailyInvocations: asNumber(input['assumedDailyInvocations']),
    assumedModelCostPer1kTokens: asNumber(input['assumedModelCostPer1kTokens']),
    suppressions: Array.isArray(input['suppressions'])
      ? input['suppressions'].filter(isSuppression)
      : undefined,
  };
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
