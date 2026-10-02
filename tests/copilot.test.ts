// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { stringify } from 'yaml';
import request from 'supertest';
import { analyzeInMemory, type AnalyzeInMemoryOptions } from '../src/analyze-in-memory.js';
import { analyze } from '../src/analyzers/index.js';
import { COPILOT_CHECKS, getCopilotCheck } from '../src/copilot/catalog.js';
import { createReport } from '../src/scoring/report.js';
import { evaluateConformance, evaluateGates } from '../src/conformance.js';
import { parseFrontmatter, parseJsonConfig, parseYamlConfig } from '../src/utils/config-parser.js';
import { loadPolicy } from '../src/policy.js';
import { handleAnalyze, handleRules } from '../service/api/handlers.js';
import { createServer } from '../service/server.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function repository(files: Array<{ path: string; content: string }>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cates-copilot-test-'));
  roots.push(root);
  for (const file of files) {
    await mkdir(dirname(join(root, file.path)), { recursive: true });
    await writeFile(join(root, file.path), file.content);
  }
  return root;
}
const md = (metadata: unknown, body = 'Use the repository build and tests.'): string => `---\n${stringify(metadata)}---\n${body}\n`;
const agent = '.github/agents/reviewer.agent.md';
const skill = '.github/skills/review/SKILL.md';
const hooks = '.github/hooks/checks.json';
const mcp = '.github/mcp.json';
const settings = '.github/copilot/settings.json';
const setup = '.github/workflows/copilot-setup-steps.yml';
const workflow = { jobs: { 'copilot-setup-steps': { 'runs-on': 'ubuntu-latest', steps: [{ run: 'npm ci' }], permissions: { contents: 'read' } } } };
async function profile(path: string, content: string, options: Omit<AnalyzeInMemoryOptions, 'files'> = {}) {
  const result = await analyzeInMemory({ files: [{ path, content }], copilot: 'all', ...options });
  expect(result.copilot).toBeDefined();
  return result.copilot!;
}
const jsonProfile = (path: string, value: unknown, options?: Omit<AnalyzeInMemoryOptions, 'files'>) => profile(path, JSON.stringify(value), options);

describe('Copilot parsing and stable parser corrections', () => {
  it('preserves URLs, escaped quotes and comment-like strings in JSONC', () => {
    const content = '{ // comment\n "url": "https://host/path/*keep*/", "quoted": "a\\\"//b", /* c */ "list": [1,],\n}';
    expect(parseJsonConfig(content, true)).toEqual({ url: 'https://host/path/*keep*/', quoted: 'a"//b', list: [1] });
  });
  it.each(['{broken}', '[]', 'null', '', '{"x":1,}', '{"x":1}//no', '{"x":', '{"x":1} garbage'])('rejects invalid strict JSON/object input: %s', input => {
    expect(() => parseJsonConfig(input)).toThrow();
  });
  it('supports BOM and CRLF frontmatter and rejects malformed mappings', () => {
    expect(parseFrontmatter('\uFEFF---\r\ndescription: review\r\ntools: []\r\n---\r\nBody')).toEqual({ metadata: { description: 'review', tools: [] }, body: 'Body', present: true });
    expect(parseFrontmatter('Body').present).toBe(false);
    expect(parseFrontmatter('---\n\n---\nBody').metadata).toEqual({});
    expect(() => parseFrontmatter('---\na: 1')).toThrow(/Unterminated/);
    expect(() => parseYamlConfig('a: 1\na: 2')).toThrow();
    expect(() => parseYamlConfig('- list')).toThrow();
  });
  it('does not flag valid URL-containing editor settings or VS Code MCP JSONC', async () => {
    const result = await analyzeInMemory({ files: [
      { path: '.vscode/settings.json', content: '{ "github.copilot.enable": {"*": true}, "source": "https://github.com/path", }' },
      { path: '.vscode/mcp.json', content: '{ // comment\n "servers": { "api": {"url": "https://api.invalid/mcp"} }, }' },
    ] });
    expect(result.findings.some(f => ['EDC001', 'MCP001'].includes(f.ruleId))).toBe(false);
  });
  it('checks settings.local.json with the existing permission rules', async () => {
    const result = await analyzeInMemory({ files: [{ path: '.claude/settings.local.json', content: '{"permissions":{"allow":["Bash(*)"]}}' }] });
    expect(result.findings.some(f => f.ruleId === 'EDC003')).toBe(true);
  });
});

describe('Copilot discovery, scope and score isolation', () => {
  const files = [
    { path: '.github/copilot-instructions.md', content: 'Build with npm ci. Test with npm test.' },
    { path: agent, content: md({ description: 'Review only', tools: [] }) },
    { path: '.claude/agents/alternative.md', content: md({ description: 'Alternate review', tools: [] }) },
    { path: skill, content: md({ name: 'review', description: 'Review changes' }) },
    { path: '.claude/skills/check/SKILL.md', content: md({ name: 'check', description: 'Check changes' }) },
    { path: '.agents/skills/test/SKILL.md', content: md({ name: 'test', description: 'Test changes' }) },
    { path: '.github/prompts/check.prompt.md', content: md({ description: 'Check changes' }) },
    { path: hooks, content: '{"version":1,"hooks":{"sessionStart":[{"command":"echo ready"}]}}' },
    { path: mcp, content: '{"catalog":{"command":"node","args":["server.js"],"tools":[]}}' },
    { path: 'packages/service/.mcp.json', content: '{"mcpServers":{}}' },
    { path: settings, content: '{// shared settings\n"disableAllHooks":false,}' },
    { path: setup, content: stringify(workflow) },
    { path: '.github/workflows/copilot-code-review.yml', content: stringify(workflow) },
    { path: '.github/lsp.json', content: '{"lspServers":{"ts":{"command":"typescript-language-server","fileExtensions":{".ts":"typescript"}}}}' },
    { path: 'plugin.json', content: '{"name":"review","$schema":"https://agent-plugins.org/schemas/1.0.0/plugin.schema.json"}' },
    { path: '.github/extensions/no-execution.mjs', content: 'throw new Error("CATES MUST NOT EXECUTE THIS");' },
    { path: 'packages/service/REVIEW.md', content: 'Review changes to the service.' },
  ];
  it('inventories all eleven surface families without executing integrations', async () => {
    const result = await analyzeInMemory({ files, copilot: 'all' });
    const report = result.copilot!;
    expect(report.coverage).toHaveLength(11);
    expect(report.coverage.every(row => row.status === 'present')).toBe(true);
    expect(report.files.find(file => file.surface === 'extensions')?.status).toBe('inventory-only');
    expect(report.files.find(file => file.path === skill)?.tokens).toBeGreaterThan(0);
    expect(report.findings.filter(f => ['critical', 'high'].includes(f.severity))).toEqual([]);
    expect(report.manualChecks.every(check => check.status === 'not-assessed')).toBe(true);
    expect(JSON.stringify(result)).not.toContain('cates-mem-');
  });
  it('leaves stable scores, findings, gates and conformance unchanged', async () => {
    const baseline = await analyzeInMemory({ files });
    const enabled = await analyzeInMemory({ files, copilot: 'all', experimental: true });
    expect(baseline.copilot).toBeUndefined();
    expect(enabled.score).toEqual(baseline.score);
    expect(enabled.findings).toEqual(baseline.findings);
    expect(enabled.discovery).toEqual(baseline.discovery);
    expect(evaluateGates(enabled, {})).toEqual(evaluateGates(baseline, {}));
    expect(evaluateConformance(enabled)).toEqual(evaluateConformance(baseline));
    expect(enabled.experimental).toBeDefined();
  });
  it('keeps deep-directory selections repository-relative', async () => {
    const root = await repository(files);
    const result = await analyze({ repoPath: root, scanSubpath: '.github/skills', copilot: 'cli' });
    expect(result.copilot?.scope).toBe('selected-directory');
    expect(result.copilot?.files.map(file => file.path)).toEqual([skill]);
    expect(result.copilot?.findings).toEqual([]);
    await expect(analyze({ repoPath: root, scanSubpath: '..', copilot: 'cli' })).rejects.toThrow(/boundary/);
    await expect(analyze({ repoPath: root, scanSubpath: skill })).rejects.toThrow(/directory/);
  });
  it('limits exact file selections without losing canonical path classification', async () => {
    const root = await repository(files);
    const result = await analyze({ repoPath: root, includeFiles: [skill], copilot: 'cli' });
    expect(result.copilot?.scope).toBe('selected-files');
    expect(result.copilot?.files.map(file => file.path)).toEqual([skill]);
    expect(result.discovery.files[0]?.type).toBe('unknown');
  });
  it('surfaces limits and unknown supplied paths instead of calling them clean', async () => {
    const depth = await analyzeInMemory({ files, copilot: 'all', maxDepth: 0 });
    expect(depth.copilot?.completeness).toBe('partial');
    expect(depth.copilot?.diagnostics.some(d => d.reason === 'max-depth')).toBe(true);
    expect(depth.copilot?.files.some(file => file.status === 'not-analyzed')).toBe(true);
    const count = await analyzeInMemory({ files, copilot: 'all', maxFiles: 1 });
    expect(count.copilot?.diagnostics.some(d => d.reason === 'max-files')).toBe(true);
    const unknown = await profile('notes.txt', 'unknown configuration');
    expect(unknown.files[0]).toMatchObject({ surface: 'unrecognized', status: 'not-analyzed', tokens: null });
    expect(unknown.completeness).toBe('partial');
  });
  it('reports oversized and binary candidates', async () => {
    const oversized = await profile(skill, md({ name: 'review', description: 'Review' }), { maxFileSize: 20 });
    expect(oversized.diagnostics[0]?.reason).toBe('oversized');
    expect(oversized.files[0]?.tokens).toBeNull();
    const binary = await profile(hooks, '\0binary');
    expect(binary.diagnostics[0]?.reason).toBe('binary');
  });
  it('bounds pathological BPE spans without hiding structural validation or inventing token counts', async () => {
    const report = await profile(agent, md({ description: 'Review', tools: [] }, 'x'.repeat(30_001)));
    expect(report.diagnostics.some(diagnostic => diagnostic.reason === 'tokenization-limit')).toBe(true);
    expect(report.files[0]).toMatchObject({ tokens: null, status: 'checked' });
    expect(report.completeness).toBe('partial');
    expect(report.findings.some(finding => finding.ruleId === 'GHCP004')).toBe(true);
    const approximate = await profile(hooks, '{"version":1,"hooks":{},"data":"' + 'x'.repeat(5000) + '"}', { tokenizer: 'approx' });
    expect(approximate.diagnostics).toEqual([]);
    expect(approximate.files[0]?.tokens).toBeGreaterThan(0);
    const comparison = await profile(hooks, '{"data":"' + 'x'.repeat(5000) + '"}', { tokenizer: 'approx', compareTokenizers: ['openai-cl100k'] });
    expect(comparison.diagnostics.some(diagnostic => diagnostic.reason === 'tokenization-limit')).toBe(true);
  });
  it('parses instruction scope from YAML comments and reports malformed applicability', async () => {
    const path = '.github/instructions/all.instructions.md';
    const result = await analyzeInMemory({ files: [{ path, content: '---\napplyTo: "**" # all paths\n---\nUse tests.' }] });
    expect(result.discovery.files[0]?.scope).toBe('always-loaded');
    const invalid = await analyzeInMemory({ files: [{ path, content: '---\napplyTo: [\n---\nUse tests.' }] });
    expect(invalid.discovery.files[0]?.scope).toBe('unknown');
    expect(invalid.discovery.diagnostics?.some(diagnostic => diagnostic.reason === 'scope-error')).toBe(true);
  });
  it('does not follow symlinks automatically', async () => {
    const root = await repository([{ path: hooks, content: '{"version":1,"hooks":{}}' }]);
    await symlink(join(root, '.github/hooks'), join(root, 'linked-hooks'));
    const result = await analyze({ repoPath: root, copilot: 'all' });
    expect(result.copilot?.diagnostics.some(d => d.reason === 'symlink')).toBe(true);
  });
  it('supports tokenizer comparisons without adding profile tokens to core totals', async () => {
    const root = await repository(files);
    const result = await analyze({ repoPath: root, copilot: 'all', compareTokenizers: ['approx'] });
    expect(result.discovery.totalTokensByTokenizer?.approx).toBeGreaterThan(0);
    expect(result.copilot?.files.length).toBe(files.length);
  });
});

describe('Copilot documented contracts and advice', () => {
  it.each([
    ['missing description', { name: 'reviewer' }, 'GHCP004'],
    ['invalid tools', { description: 'Review', tools: 4 }, 'GHCP004'],
    ['wildcard tools', { description: 'Review', tools: ['*'] }, 'GHCP005'],
    ['retired infer', { description: 'Review', infer: true, tools: [] }, 'GHCP003'],
    ['invalid target', { description: 'Review', target: 'unknown', tools: [] }, 'GHCP004'],
    ['invalid boolean', { description: 'Review', 'user-invocable': 'yes', tools: [] }, 'GHCP004'],
    ['unreachable', { description: 'Review', 'user-invocable': false, 'disable-model-invocation': true, tools: [] }, 'GHCP004'],
    ['metadata values', { description: 'Review', metadata: { number: 1 }, tools: [] }, 'GHCP004'],
    ['cloud handoffs', { description: 'Review', handoffs: [], tools: [] }, 'GHCP003'],
  ])('checks agent %s', async (_name, metadata, id) => {
    expect((await profile(agent, md(metadata))).findings.some(f => f.ruleId === id)).toBe(true);
  });
  it('accepts empty and namespaced tool sets and rejects oversized bodies', async () => {
    for (const tools of [[], ['read', 'custom/tool'], 'read, custom/tool']) {
      expect((await profile(agent, md({ description: 'Review', tools }))).findings).toEqual([]);
    }
    const big = await profile(agent, md({ description: 'Review', tools: [] }, 'x'.repeat(30_001)));
    expect(big.findings.some(f => f.message.includes('30,000'))).toBe(true);
    expect((await profile(agent, '# A heading is not metadata')).findings.some(f => f.ruleId === 'GHCP004')).toBe(true);
    expect((await profile('.github/chatmodes/review.chatmode.md', md({ description: 'Review', tools: [] }))).findings.some(f => f.ruleId === 'GHCP003')).toBe(true);
  });
  it('checks inline MCP while distinguishing IDE incompatibility', async () => {
    const report = await profile(agent, md({ description: 'Review', tools: [], 'mcp-servers': { api: { command: 'node' } } }), { copilot: 'vscode' });
    expect(report.findings.some(f => f.ruleId === 'GHCP003')).toBe(true);
    expect(report.findings.some(f => f.ruleId === 'GHCP009')).toBe(false);
  });
  it('accepts optional VS Code headers and model-priority arrays', async () => {
    expect((await profile(agent, 'Review the changes.', { copilot: 'vscode' })).findings.some(f => f.ruleId === 'GHCP004')).toBe(false);
    expect((await profile(agent, md({ target: 'vscode', tools: [], model: ['model-a', 'model-b'] }))).findings).toEqual([]);
    expect((await profile(agent, md({ description: 'Review', tools: [], model: ['model-a'] }))).findings.some(f => f.ruleId === 'GHCP003')).toBe(true);
    expect((await profile(agent, md({ description: 'Review', tools: [], model: 42 }))).findings.some(f => f.ruleId === 'GHCP004')).toBe(true);
    expect((await jsonProfile('.vscode/settings.local.json', {})).findings.some(f => f.ruleId === 'GHCP003')).toBe(true);
  });
  it('checks path instruction scope, exclusion and semantic IDE selection', async () => {
    const path = '.github/instructions/src.instructions.md';
    expect((await profile(path, md({ applyTo: '**/*.ts', excludeAgent: 'cloud-agent' }), { copilot: 'cloud-agent' })).findings.some(f => f.message.includes('explicitly exclude'))).toBe(true);
    expect((await profile(path, md({ applyTo: 42, excludeAgent: 'nobody' }))).findings.filter(f => f.ruleId === 'GHCP002')).toHaveLength(2);
    expect((await profile(path, md({ description: 'Use for TypeScript' }), { copilot: 'vscode' })).findings).toEqual([]);
    expect((await profile('.github/instructions/src.md', md({ applyTo: '**' }))).findings.some(f => f.ruleId === 'GHCP003')).toBe(true);
  });
  it.each([
    ['missing description', { name: 'review' }, skill],
    ['bad identifier', { name: 'Review', description: 'Review' }, skill],
    ['mismatched directory', { name: 'different', description: 'Review' }, skill],
    ['wrong case filename', { name: 'review', description: 'Review' }, '.github/skills/review/skill.md'],
    ['missing subdirectory', { name: 'review', description: 'Review' }, '.github/skills/SKILL.md'],
    ['invalid tools', { name: 'review', description: 'Review', 'allowed-tools': 4 }, skill],
  ])('checks skill %s', async (_name, metadata, path) => {
    expect((await profile(path, md(metadata))).findings.some(f => f.ruleId === 'GHCP006')).toBe(true);
  });
  it('identifies skill preapproval and empty bodies', async () => {
    expect((await profile(skill, md({ name: 'review', description: 'Review', 'allowed-tools': 'Bash(npm test)' }))).findings.some(f => f.ruleId === 'GHCP005')).toBe(true);
    expect((await profile(skill, md({ name: 'review', description: 'Review' }, ''))).findings.some(f => f.ruleId === 'GHCP006')).toBe(true);
  });
  it('checks prompt metadata without rejecting extension tool identifiers', async () => {
    const report = await profile('.github/prompts/review.md', md({ tools: {}, agent: 1 }));
    expect(report.findings.some(f => f.ruleId === 'GHCP001')).toBe(true);
    expect(report.findings.some(f => f.ruleId === 'GHCP003')).toBe(true);
  });
  it('reports definition collisions across supported skill roots and agent suffixes', async () => {
    const result = await analyzeInMemory({ copilot: 'all', files: [
      { path: skill, content: md({ name: 'review', description: 'Review' }) },
      { path: '.agents/skills/review/SKILL.md', content: md({ name: 'review', description: 'Review' }) },
      { path: agent, content: md({ description: 'Review', tools: [] }) },
      { path: '.github/agents/reviewer.md', content: md({ description: 'Review', tools: [] }) },
    ] });
    expect(result.copilot?.findings.filter(f => f.ruleId === 'GHCP014')).toHaveLength(2);
  });
});

describe('Copilot integration contracts', () => {
  it.each([
    ['missing envelope', { hooks: {} }],
    ['invalid events object', { version: 1, hooks: [] }],
    ['unknown event', { version: 1, hooks: { NotAnEvent: [] } }],
    ['empty event', { version: 1, hooks: { '': [] } }],
    ['invalid handler list', { version: 1, hooks: { sessionStart: {} } }],
    ['invalid handler', { version: 1, hooks: { sessionStart: [null] } }],
    ['missing command', { version: 1, hooks: { sessionStart: [{}] } }],
    ['mixed exec', { version: 1, hooks: { sessionStart: [{ exec: 'node', command: 'node' }] } }],
    ['invalid args', { version: 1, hooks: { sessionStart: [{ exec: 'node', args: [1] }] } }],
    ['invalid type', { version: 1, hooks: { sessionStart: [{ type: 'other' }] } }],
    ['invalid prompt', { version: 1, hooks: { preToolUse: [{ type: 'prompt', prompt: '' }] } }],
    ['invalid HTTP variables', { version: 1, hooks: { sessionStart: [{ type: 'http', url: 'https://hooks.invalid', allowedEnvVars: 1 }] } }],
    ['invalid group child', { version: 1, hooks: { SessionStart: [{ matcher: '*', hooks: [null] }] } }],
  ])('checks hook %s', async (_name, value) => {
    expect((await jsonProfile(hooks, value)).findings.some(f => f.ruleId === 'GHCP007')).toBe(true);
  });
  it('accepts command defaults, exec, PascalCase aliases and prompt hooks', async () => {
    const report = await jsonProfile(hooks, { version: 1, hooks: {
      SessionStart: [{ hooks: [{ command: 'echo ready' }, { type: 'prompt', prompt: 'Review repository scope.' }] }],
      Stop: [{ exec: 'node', args: ['check.js'] }],
      UserPromptSubmit: [{ bash: 'echo ready', powershell: 'Write-Output ready', env: { MODE: 'check' }, timeoutSec: 15 }],
    } }, { copilot: 'cli' });
    expect(report.findings.filter(f => f.ruleId === 'GHCP007')).toEqual([]);
  });
  it('distinguishes cloud compatibility from local syntax', async () => {
    const value = { version: 1, hooks: { notification: [{ powershell: 'Read-Host' }], permissionRequest: [{ exec: 'node' }] } };
    expect((await jsonProfile(hooks, value, { copilot: 'cloud-agent' })).findings.filter(f => f.ruleId === 'GHCP008').length).toBeGreaterThan(2);
    const local = await jsonProfile(hooks, { version: 1, hooks: { postToolUse: [{ exec: 'node' }] } }, { copilot: 'cli' });
    expect(local.findings).toEqual([]);
  });
  it.each([
    ['http://localhost.evil.invalid', 'high'],
    ['http://127.0.0.1', 'info'],
    ['http://[::1]', 'info'],
    ['${env:HOOK_URL}', 'info'],
    ['https://user:password@hooks.invalid', 'high'],
    ['not a URL', undefined],
    ['file:///tmp/check', undefined],
    ['', undefined],
  ])('checks HTTP hook endpoint %s', async (url, severity) => {
    const report = await jsonProfile(hooks, { version: 1, hooks: { sessionStart: [{ type: 'http', url }] } });
    expect(report.findings.some(f => f.ruleId === 'GHCP007' && (!severity || f.severity === severity))).toBe(true);
  });
  it('requires HTTPS for permission/pre-tool HTTP decisions even on loopback', async () => {
    const report = await jsonProfile(hooks, { version: 1, hooks: { preToolUse: [{ type: 'http', url: 'http://localhost/check' }] } });
    expect(report.findings.some(f => f.severity === 'high')).toBe(true);
  });
  it.each([
    { mcpServers: [] },
    { mcpServers: { wrong: null } },
    { mcpServers: { missing: {} } },
    { mcpServers: { args: { command: 'node', args: 'wrong' } } },
    { mcpServers: { tools: { command: 'node', tools: [1] } } },
    { mcpServers: { type: { type: 'other', command: 'node' } } },
  ])('checks MCP structural errors %j', async value => {
    expect((await jsonProfile(mcp, value)).findings.some(f => f.ruleId === 'GHCP009')).toBe(true);
  });
  it('supports bare maps, VS Code servers and remote transports', async () => {
    for (const value of [
      { api: { command: 'node', args: ['server.js'], tools: [] } },
      { mcpServers: { api: { type: 'stdio', command: 'node' }, remote: { type: 'http', url: 'https://api.invalid' } } },
    ]) expect((await jsonProfile(mcp, value)).findings).toEqual([]);
    expect((await profile('.vscode/mcp.json', '{// comment\n"servers":{},}')).findings).toEqual([]);
    expect((await jsonProfile('mcp.json', { mcpServers: {} })).findings.some(f => f.ruleId === 'GHCP003')).toBe(true);
  });
  it('checks every command, exact launched package versions and all launcher families', async () => {
    const value = { mcpServers: {
      valid: { command: 'npx', args: ['-y', '@org/server@1.2.3'] },
      unrelatedVersion: { command: 'npx', args: ['server@latest', 'other@1.2.3'] },
      shell: { command: 'node && echo unsafe' },
      uvPinned: { command: 'uvx', args: ['server==1.2.3'] },
      uvFloating: { command: 'uvx', args: ['--from', 'server', 'entry'] },
      yarn: { command: 'yarn', args: ['dlx', 'server'] },
      pnpm: { command: '/bin/pnpm', args: ['dlx', 'server@2'] },
      npm: { command: 'npm', args: ['exec', '--package=server@1.2.3', 'server'] },
      npxPath: { command: 'npx', args: ['./local.js'] },
      regularNpm: { command: 'npm', args: ['run', 'server'] },
    } };
    const report = await jsonProfile(mcp, value);
    expect(report.findings.filter(f => f.ruleId === 'GHCP010')).toHaveLength(5);
  });
  it('checks settings, local overrides and inline hooks without requiring hook version', async () => {
    const report = await jsonProfile('.github/copilot/settings.local.json', {
      disableAllHooks: true, 'chat.tools.global.autoApprove': true,
      permissions: { allow: ['Bash(*)', '*'] }, hooks: { sessionStart: [{ command: 'echo ready' }] },
    });
    expect(report.findings.filter(f => f.ruleId === 'GHCP011')).toHaveLength(4);
    expect(report.findings.some(f => f.ruleId === 'GHCP007')).toBe(false);
    expect((await jsonProfile(settings, { permissions: { allow: 1 }, disableAllHooks: 'yes' })).findings.filter(f => f.ruleId === 'GHCP011')).toHaveLength(2);
  });
  it('validates both setup workflow filenames with the shared job contract', async () => {
    for (const path of [setup, '.github/workflows/copilot-code-review.yml']) {
      expect((await profile(path, stringify(workflow))).findings).toEqual([]);
      expect((await profile(path, 'jobs: {}')).findings.some(f => f.ruleId === 'GHCP012')).toBe(true);
    }
    expect((await profile('.github/copilot-setup-steps.yaml', 'jobs: {}')).findings.filter(f => f.ruleId === 'GHCP003')).toHaveLength(2);
  });
  it('checks setup timeouts, ignored properties, run/uses and minimal permissions', async () => {
    const report = await profile(setup, stringify({ jobs: { 'copilot-setup-steps': {
      'timeout-minutes': 60, needs: 'other', permissions: 'write-all',
      steps: [{ run: 'echo x', uses: 'action@v1' }, { run: 'curl https://install.invalid | bash' }, null],
    } } }));
    expect(report.findings.filter(f => f.ruleId === 'GHCP012').length).toBeGreaterThanOrEqual(6);
    const missing = await profile(setup, stringify({ jobs: { 'copilot-setup-steps': { 'runs-on': 'ubuntu-latest', steps: [] } } }));
    expect(missing.findings.some(f => f.message.includes('steps array'))).toBe(true);
  });
  it('checks LSP server shape and file extensions', async () => {
    expect((await jsonProfile('.github/lsp.json', {})).findings.some(f => f.ruleId === 'GHCP013')).toBe(true);
    const report = await jsonProfile('.github/lsp.json', { lspServers: { 'bad name': {}, null: null, args: { command: 'lsp', args: 'bad', fileExtensions: { ts: 42 } } } });
    expect(report.findings.filter(f => f.ruleId === 'GHCP013').length).toBeGreaterThan(3);
  });
  it('checks portable, legacy inline, and marketplace manifests', async () => {
    const portable = await jsonProfile('plugin.json', { name: 'Bad--Name', $schema: 'https://agent-plugins.org/schemas/2.0.0/plugin.schema.json', skills: './skills' });
    expect(portable.findings.filter(f => f.ruleId === 'GHCP013')).toHaveLength(3);
    const legacy = await jsonProfile('.github/plugin/plugin.json', {
      hooks: { hooks: { sessionStart: [{ command: 'echo ready' }] } },
      mcpServers: { api: { command: 'node' } },
      lspServers: { server: { command: 'lsp', fileExtensions: { '.ts': 'typescript' } } },
    });
    expect(legacy.findings).toHaveLength(1);
    expect((await jsonProfile('.github/plugin/marketplace.json', { name: 'market', plugins: [] })).findings).toEqual([]);
    expect((await jsonProfile('.claude-plugin/marketplace.json', { name: 'market' })).findings.some(f => f.ruleId === 'GHCP013')).toBe(true);
  });
  it('redacts sensitive diagnostics and runs established content checks on new surfaces', async () => {
    const secret = 'sk-' + 'q'.repeat(30);
    const report = await jsonProfile(mcp, { mcpServers: { api: { command: 'node', env: { API_KEY: secret } } } });
    expect(report.findings.some(f => f.ruleId === 'GHCP015')).toBe(true);
    expect(report.findings.some(f => f.ruleId === 'GHCP010')).toBe(true);
    expect(JSON.stringify(report)).not.toContain(secret);
    const malformed = await profile(agent, `---\ndescription: [${secret}\n---\nBody`);
    expect(malformed.findings.some(f => f.ruleId === 'GHCP001')).toBe(true);
    expect(JSON.stringify(malformed)).not.toContain(secret);
    const placeholder = await jsonProfile(mcp, { api: { command: 'node', env: { API_KEY: '${env:API_KEY}' } } });
    expect(placeholder.findings).toEqual([]);
  });
});

describe('Copilot policy, API, CLI and reports', () => {
  it('supports rule/dimension controls and auditable suppressions without stable gate effects', async () => {
    const report = await profile(agent, md({}), {
      dimensions: { completeness: { enabled: false } },
      rules: { GHCP004: { enabled: true, severity: 'low' }, GHCP005: { enabled: false } },
      suppressions: [{ ruleId: 'GHCP004', reason: 'Approved experiment', file: '.github/agents/**' }],
    });
    expect(report.findings).toEqual([]);
    expect(report.disabledFindings.map(f => f.ruleId)).toContain('GHCP005');
    expect(report.suppressedFindings[0]?.severity).toBe('low');
    expect(report.suppressionSummary.suppressedFindings).toBeGreaterThan(0);
  });
  it('keeps the additional catalog separate and explains its identifiers', () => {
    expect(COPILOT_CHECKS).toHaveLength(15);
    expect(new Set(COPILOT_CHECKS.map(check => check.id)).size).toBe(15);
    expect(getCopilotCheck('ghcp001')?.stability).toBe('experimental');
    expect(getCopilotCheck('unknown')).toBeUndefined();
    const response = handleRules();
    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.body.rules.filter(rule => rule.stability !== 'experimental')).toHaveLength(49);
      expect(response.body.copilotChecks).toEqual(COPILOT_CHECKS);
    }
  });
  it('accepts profile, suppression and experimental options over HTTP', async () => {
    const response = await request(createServer()).post('/api/analyze').send({
      files: [{ path: agent, content: md({ description: 'Review', tools: ['*'] }) }],
      policy: { copilot: 'cli', experimental: true, suppressions: [{ ruleId: 'GHCP005', reason: 'Intentional' }] },
    });
    expect(response.status).toBe(200);
    expect(response.body.copilot.target).toBe('cli');
    expect(response.body.copilot.suppressedFindings).toHaveLength(1);
    expect(response.body.experimental).toBeDefined();
  });
  it.each(['/absolute', '../outside', 'C:\\outside', 'a//b', './a', 'a\nb', '\\outside'])('rejects invalid API paths with 400: %s', async path => {
    expect((await handleAnalyze({ files: [{ path, content: 'x' }] })).status).toBe(400);
  });
  it('rejects duplicate paths, invalid targets and UTF-8 byte overflows', async () => {
    expect((await handleAnalyze({ files: [{ path: 'a.md', content: '1' }, { path: 'a.md', content: '2' }] })).status).toBe(400);
    expect((await handleAnalyze({ files: [{ path: skill, content: 'x' }], policy: { copilot: 'invalid' } })).status).toBe(400);
    expect((await handleAnalyze({ files: [{ path: 'a.md', content: '🙂'.repeat(25_001) }] })).status).toBe(400);
    expect((await handleAnalyze({ files: Array.from({ length: 11 }, (_, index) => ({ path: `${index}.md`, content: 'é'.repeat(49_000) })) })).status).toBe(400);
    await expect(analyzeInMemory({ files: [{ path: 'a/b.md', content: '1' }, { path: 'a\\b.md', content: '2' }] })).rejects.toThrow(/Duplicate/);
  });
  it('renders advice in pretty/JSON and SARIF metadata but never as SARIF alerts', async () => {
    const result = await analyzeInMemory({ files: [{ path: agent, content: md({}) }], copilot: 'all', maxDepth: 1 });
    expect(createReport(result, 'pretty')).toContain('NOT ASSESSED');
    expect(createReport(result, 'pretty')).toContain('Manual verification still required');
    const sarif = JSON.parse(createReport(result, 'sarif'));
    expect(sarif.runs[0].properties.copilot.profile).toBe('copilot');
    expect(sarif.runs[0].results.every((finding: { ruleId: string }) => !finding.ruleId.startsWith('GHCP'))).toBe(true);
    const full = await analyzeInMemory({ files: [{ path: agent, content: md({}) }], copilot: 'all' });
    expect(createReport(full, 'pretty')).toContain('GHCP004');
    expect(JSON.parse(createReport(full, 'json')).copilot.findings.length).toBeGreaterThan(0);
  });
  it('exposes the profile through CLI flags, policy, catalog and completion', async () => {
    const root = await repository([{ path: agent, content: md({ description: 'Review', tools: [] }) }]);
    const cli = (...args: string[]) => execFileSync(process.execPath, ['--import', 'tsx', resolve('src/cli/index.ts'), ...args], { encoding: 'utf8' });
    expect(JSON.parse(cli(root, '--format', 'json')).copilot).toBeUndefined();
    expect(JSON.parse(cli(root, '--copilot', '--format', 'json')).copilot.target).toBe('all');
    expect(JSON.parse(cli('review', root, '--copilot', 'cli', '--format', 'json')).copilot.target).toBe('cli');
    await writeFile(join(root, '.cates.yml'), 'copilot: vscode\n');
    expect((await loadPolicy(root)).copilot).toBe('vscode');
    expect(JSON.parse(cli(root, '--format', 'json')).copilot.target).toBe('vscode');
    expect(JSON.parse(cli(root, '--no-copilot', '--format', 'json')).copilot).toBeUndefined();
    expect(JSON.parse(cli('rules', '--copilot'))).toHaveLength(15);
    expect(cli('explain', 'GHCP006')).toContain('Skill discovery contract');
    expect(cli('completion', 'bash')).toContain('--copilot');
    await writeFile(join(root, '.cates.yml'), 'copilot: bad-target\n');
    await expect(loadPolicy(root)).rejects.toThrow();
  });
});
