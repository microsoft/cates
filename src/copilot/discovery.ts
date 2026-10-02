// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import type { FileClassification } from '../analyzers/discovery.js';
import type { CopilotSurface } from './types.js';

const PATTERNS: Array<{ pattern: RegExp; surface: CopilotSurface; type: FileClassification['type'] }> = [
  { pattern: /^(?:\.github\/copilot-instructions\.md|\.github\/instructions\/.+\.md)$/i, surface: 'instructions', type: 'path-instructions' },
  { pattern: /^\.github\/(?:agents|chatmodes)\/.+\.(?:md|ya?ml)$/i, surface: 'agents', type: 'agent-definition' },
  { pattern: /^\.claude\/agents\/.+\.md$/i, surface: 'agents', type: 'agent-definition' },
  { pattern: /^\.(?:github|claude|agents)\/skills\/(?:[^/]+\/)?skill\.md$/i, surface: 'skills', type: 'skill-definition' },
  { pattern: /^\.github\/prompts\/.+\.md$/i, surface: 'prompts', type: 'prompt-file' },
  { pattern: /^\.github\/hooks\/[^/]+\.json$/i, surface: 'hooks', type: 'hooks-config' },
  { pattern: /^(?:(?:.+\/)?\.mcp\.json|\.github\/mcp\.json|\.vscode\/mcp\.json|mcp\.json)$/i, surface: 'mcp', type: 'mcp-config' },
  { pattern: /^(?:\.github\/copilot|\.claude|\.vscode)\/settings(?:\.local)?\.json$/i, surface: 'settings', type: 'editor-config' },
  { pattern: /^\.github\/(?:workflows\/)?copilot-(?:setup-steps|code-review)\.ya?ml$/i, surface: 'setup', type: 'setup-steps' },
  { pattern: /^\.github\/lsp\.json$/i, surface: 'lsp', type: 'extension-config' },
  { pattern: /^(?:(?:plugins\/.+\/)?(?:plugin\.json|\.github\/plugin\/(?:plugin|marketplace)\.json|\.claude-plugin\/(?:plugin|marketplace)\.json))$/i, surface: 'plugins', type: 'extension-config' },
  { pattern: /^\.github\/extensions\/.+\.(?:[cm]?[jt]s|json)$/i, surface: 'extensions', type: 'extension-config' },
  { pattern: /^(?:.+\/)?(?:AGENTS|CLAUDE|GEMINI|REVIEW)\.md$/, surface: 'instructions', type: 'path-instructions' },
];

export const COPILOT_SURFACES: CopilotSurface[] = ['instructions', 'agents', 'skills', 'prompts', 'hooks', 'mcp', 'settings', 'setup', 'lsp', 'plugins', 'extensions'];

export function copilotSurface(path: string): CopilotSurface | undefined {
  return PATTERNS.find(entry => entry.pattern.test(path))?.surface;
}

export function classifyCopilotFile(path: string): FileClassification | undefined {
  const match = PATTERNS.find(entry => entry.pattern.test(path));
  return match ? { type: match.type, scope: match.surface === 'skills' || match.surface === 'prompts' ? 'on-demand' : 'unknown' } : undefined;
}
