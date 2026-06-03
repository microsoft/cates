// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import { getEncoding } from 'js-tiktoken';
import { countTokens as countClaudeTokens } from '@anthropic-ai/tokenizer';
import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Tokenizer registry.
 *
 * Different model families tokenize differently, so the same text yields a
 * different token count depending on which model will receive it. cates
 * tracks one canonical tokenizer for scoring (so percentages stay
 * comparable across runs) and can additionally report counts across other
 * tokenizers for visibility.
 *
 * Supported tokenizers:
 *
 *   - openai-cl100k   GPT-3.5, GPT-4, GPT-4 Turbo. Default for back-compat.
 *   - openai-o200k    GPT-4o, GPT-4o-mini, o1, o3, o4 series.
 *   - anthropic-claude Claude (BPE). Exact for Claude 2; approximation for
 *                     Claude 3+ since Anthropic's public tokenizer hasn't
 *                     been updated. Anthropic recommends count_tokens API
 *                     for precise Claude 3+ counts.
 *   - approx          Cheap character-based heuristic (chars / 3.7).
 *                     Useful when offline / no native deps wanted.
 */

export type TokenizerId =
  | 'openai-cl100k'
  | 'openai-o200k'
  | 'anthropic-claude'
  | 'approx';

export interface TokenizerInfo {
  id: TokenizerId;
  displayName: string;
  models: string[];
  notes?: string;
}

export const TOKENIZERS: TokenizerInfo[] = [
  {
    id: 'openai-cl100k',
    displayName: 'OpenAI cl100k_base',
    models: ['gpt-3.5-turbo', 'gpt-4', 'gpt-4-turbo'],
  },
  {
    id: 'openai-o200k',
    displayName: 'OpenAI o200k_base',
    models: ['gpt-4o', 'gpt-4o-mini', 'o1', 'o3', 'o4'],
  },
  {
    id: 'anthropic-claude',
    displayName: 'Anthropic Claude (BPE)',
    models: ['claude-2', 'claude-3-haiku', 'claude-3-sonnet', 'claude-3-opus', 'claude-3.5-sonnet', 'claude-4'],
    notes: 'Exact for Claude 2; approximation for Claude 3+ (no public exact tokenizer; use Anthropic count_tokens API for precision).',
  },
  {
    id: 'approx',
    displayName: 'Character heuristic (chars / 3.7)',
    models: [],
    notes: 'Coarse offline fallback; no native data tables loaded.',
  },
];

const TOKENIZER_IDS = new Set<TokenizerId>(TOKENIZERS.map(t => t.id));

export function isTokenizerId(value: string): value is TokenizerId {
  return TOKENIZER_IDS.has(value as TokenizerId);
}

export function listTokenizers(): TokenizerInfo[] {
  return [...TOKENIZERS];
}

// Cache encoders so we pay the table-load cost once per process.
const tiktokenCache = new Map<string, ReturnType<typeof getEncoding>>();

function tiktoken(name: 'cl100k_base' | 'o200k_base'): ReturnType<typeof getEncoding> {
  let enc = tiktokenCache.get(name);
  if (!enc) {
    enc = getEncoding(name);
    tiktokenCache.set(name, enc);
  }
  return enc;
}

const DEFAULT_TOKENIZER: TokenizerId = (() => {
  const fromEnv = process.env.CATES_TOKENIZER;
  if (fromEnv && isTokenizerId(fromEnv)) return fromEnv;
  return 'openai-cl100k';
})();

export function getDefaultTokenizer(): TokenizerId {
  return DEFAULT_TOKENIZER;
}

function countWith(tokenizer: TokenizerId, text: string): number {
  switch (tokenizer) {
    case 'openai-cl100k':
      return tiktoken('cl100k_base').encode(text).length;
    case 'openai-o200k':
      return tiktoken('o200k_base').encode(text).length;
    case 'anthropic-claude':
      return countClaudeTokens(text);
    case 'approx':
      return Math.ceil(text.length / 3.7);
  }
}

// Per-analyze() context: lets us scope a chosen tokenizer for the duration
// of an analyze() call without threading it through every helper function.
const tokenizerContext = new AsyncLocalStorage<{ tokenizer: TokenizerId }>();

/**
 * Run `fn` with `tokenizer` as the active default for any nested
 * countTokens(text) call that does not pass an explicit tokenizer.
 *
 * Concurrent analyze() invocations each see their own context.
 */
export function withTokenizer<T>(tokenizer: TokenizerId, fn: () => T): T {
  return tokenizerContext.run({ tokenizer }, fn);
}

/**
 * Count tokens with the named tokenizer.
 *
 * Resolution order when no tokenizer is passed:
 *   1. The tokenizer scoped by withTokenizer() (if any).
 *   2. CATES_TOKENIZER env var (if set to a known id).
 *   3. openai-cl100k (back-compat default).
 */
export function countTokens(text: string, tokenizer?: TokenizerId): number {
  const tok = tokenizer ?? tokenizerContext.getStore()?.tokenizer ?? DEFAULT_TOKENIZER;
  return countWith(tok, text);
}

/**
 * Count tokens across multiple tokenizers in one call, e.g. to show
 * side-by-side comparisons in reports.
 */
export function countTokensAcross(
  text: string,
  tokenizers: TokenizerId[],
): Record<TokenizerId, number> {
  const out = {} as Record<TokenizerId, number>;
  for (const id of tokenizers) {
    out[id] = countWith(id, text);
  }
  return out;
}
