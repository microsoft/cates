// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import { parse, printParseErrorCode, type ParseError } from 'jsonc-parser';
import { parseDocument } from 'yaml';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseJsonConfig(content: string, jsonc = false): Record<string, unknown> {
  const errors: ParseError[] = [];
  const value: unknown = parse(content.replace(/^\uFEFF/, ''), errors, {
    disallowComments: !jsonc,
    allowTrailingComma: jsonc,
  });
  if (errors.length) {
    throw new Error(`${printParseErrorCode(errors[0]!.error)} at offset ${errors[0]!.offset}`);
  }
  if (!isRecord(value)) throw new Error('Configuration must be an object');
  return value;
}

export function parseYamlConfig(content: string): Record<string, unknown> {
  const document = parseDocument(content, { uniqueKeys: true });
  if (document.errors.length) throw new Error(document.errors[0]!.message);
  const value: unknown = document.toJS({ maxAliasCount: 50 });
  if (!isRecord(value)) throw new Error('Configuration must be a mapping');
  return value;
}

export function parseFrontmatter(content: string): { metadata: Record<string, unknown>; body: string; present: boolean } {
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (!/^---[ \t]*\n/.test(normalized)) return { metadata: {}, body: normalized, present: false };
  const match = normalized.match(/^---[ \t]*\n([\s\S]*?)^---[ \t]*(?:\n|$)/m);
  if (!match) throw new Error('Unterminated YAML frontmatter');
  return {
    metadata: match[1]!.trim() ? parseYamlConfig(match[1]!) : {},
    body: normalized.slice(match[0].length),
    present: true,
  };
}
