// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import { basename, dirname } from 'node:path';
import type { AnalyzerOptions, Severity } from '../types.js';
import { discoverFiles, type DiscoveryOutput } from '../analyzers/discovery.js';
import { analyzeSecurity } from '../analyzers/security.js';
import { applyRuleConfig } from '../rule-config.js';
import { applySuppressions } from '../suppressions.js';
import { isRecord, parseFrontmatter, parseJsonConfig, parseYamlConfig } from '../utils/config-parser.js';
import { getCopilotCheck } from './catalog.js';
import { classifyCopilotFile, copilotSurface, COPILOT_SURFACES } from './discovery.js';
import type { CopilotFinding, CopilotReport } from './types.js';

type Emit = (id: string, message: string, basis?: CopilotFinding['basis'], severity?: Severity) => void;
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');
const tools = (value: unknown): boolean => typeof value === 'string' || strings(value);
const toolNames = (value: unknown): string[] => typeof value === 'string' ? value.split(',').map(s => s.trim()) : strings(value) ? value : [];
const HOOK_EVENTS = new Set([
  'agentStop', 'errorOccurred', 'notification', 'permissionRequest', 'postToolUse', 'postToolUseFailure',
  'preCompact', 'preToolUse', 'sessionEnd', 'sessionStart', 'subagentStart', 'subagentStop',
  'userPromptSubmitted', 'userPromptTransformed',
]);
const EVENT_ALIASES: Record<string, string> = { Stop: 'agentStop', UserPromptSubmit: 'userPromptSubmitted', PermissionRequest: 'permissionRequest' };

export async function analyzeCopilot(options: AnalyzerOptions, coreDiscovery?: DiscoveryOutput): Promise<CopilotReport> {
  const { result: discovery, contents } = await discoverFiles(options, classifyCopilotFile, coreDiscovery);
  const corePaths = new Set(coreDiscovery?.result.files.filter(file => file.isActive).map(file => file.relativePath));
  const findings: CopilotFinding[] = [];
  const identities = new Map<string, string>();
  const target = options.copilot ?? 'all';
  const cloud = target === 'all' || target === 'cloud-agent';
  const files: CopilotReport['files'] = [];

  for (const file of discovery.files) {
    const surface = copilotSurface(file.relativePath);
    const available = contents.has(file.path);
    const status = !available || !surface ? 'not-analyzed' : surface === 'extensions' ? 'inventory-only' : 'checked';
    files.push({ path: file.relativePath, surface: surface ?? 'unrecognized', status, tokens: file.isActive ? file.tokenCount : null });
    if (!available || !surface || surface === 'extensions') continue;
    const content = contents.get(file.path)!;
    const emit: Emit = (id, message, basis = 'documented', severity) => {
      const check = getCopilotCheck(id)!;
      findings.push({
        ruleId: id, dimension: check.dimension, severity: severity ?? check.severity,
        confidence: basis === 'documented' ? 'high' : 'medium', basis, stability: 'experimental',
        file: file.relativePath, message, suggestion: check.remediation,
      });
    };
    const identity = (kind: string, name: string): void => {
      const key = `${kind}:${name}`;
      const prior = identities.get(key);
      if (prior) emit('GHCP014', `${kind} identity "${name}" is also defined in ${prior}; verify client-specific precedence.`, 'heuristic');
      else identities.set(key, file.relativePath);
    };
    let parsed: { kind: 'markdown'; value: ReturnType<typeof parseFrontmatter> } | { kind: 'structured'; value: Record<string, unknown> };
    try {
      parsed = ['instructions', 'agents', 'skills', 'prompts'].includes(surface)
        ? { kind: 'markdown', value: parseFrontmatter(content) }
        : { kind: 'structured', value: surface === 'setup' ? parseYamlConfig(content) : parseJsonConfig(content, surface === 'settings' || file.relativePath === '.vscode/mcp.json') };
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      emit('GHCP001', `Configuration could not be parsed: ${safeParseMessage(error.message)}`);
      continue;
    }
      if (parsed.kind === 'markdown') {
        const { metadata, body, present } = parsed.value;
        if (!body.trim()) emit(surface === 'skills' ? 'GHCP006' : surface === 'agents' ? 'GHCP004' : 'GHCP002', 'Instruction body is empty.');
        if (surface === 'instructions') checkInstructions(file.relativePath, metadata, target, emit);
        if (surface === 'agents') {
          if (!present && target !== 'vscode') emit('GHCP004', 'Copilot CLI/cloud agents need YAML frontmatter; VS Code Local agents can omit it.');
          checkAgent(metadata, body, target, emit);
          identity('Agent filename', basename(file.relativePath).replace(/(?:\.agent)?\.md$/i, ''));
          if (/\/chatmodes\/|\.ya?ml$/i.test(file.relativePath)) emit('GHCP003', 'Legacy chat-mode/YAML candidate: current Copilot custom agents use Markdown profiles in .github/agents/.');
        }
        if (surface === 'skills') {
          checkSkill(file.relativePath, metadata, emit);
          if (nonempty(metadata.name)) identity('Skill name', metadata.name);
        }
        if (surface === 'prompts') {
          if (!file.relativePath.endsWith('.prompt.md')) emit('GHCP003', 'VS Code prompt files use the .prompt.md suffix.');
          checkOptionalTypes(metadata, { description: 'string', name: 'string', agent: 'string' }, 'GHCP001', emit);
          if (metadata.tools !== undefined && !tools(metadata.tools)) emit('GHCP001', 'Prompt tools must be a string or string array.');
          emit('GHCP003', 'Prompt-file support depends on the client/session type; VS Code Local agents and Agent Host sessions differ. Do not assume cloud/CLI loading.', 'documented', 'info');
        }
        checkLiteralSecrets(metadata, emit);
      } else if (surface === 'setup') {
        checkSetup(file.relativePath, parsed.value, emit);
      } else {
        const config = parsed.value;
        if (surface === 'hooks') {
          if (target !== 'vscode' && config.version !== 1) emit('GHCP007', 'Repository Copilot hook files require version: 1.');
          checkHooks(config.hooks, cloud, emit);
        }
        if (surface === 'mcp') {
          checkMcp(config, emit, file.relativePath === '.vscode/mcp.json');
          if (file.relativePath === 'mcp.json') emit('GHCP003', 'Root mcp.json is a plugin convention, not the CLI project .mcp.json file. Confirm the plugin is installed, or use .mcp.json/.github/mcp.json.', 'documented', 'info');
        }
        if (surface === 'settings') checkSettings(file.relativePath, config, cloud, emit);
        if (surface === 'lsp') checkLsp(config, emit);
        if (surface === 'plugins') checkPlugin(file.relativePath, config, cloud, emit);
        checkLiteralSecrets(config, emit);
      }
  }

  const additionalFiles = discovery.files.filter(file => contents.has(file.path) && !corePaths.has(file.relativePath))
    .map(file => ({ path: file.path, relativePath: file.relativePath, content: contents.get(file.path)! }));
  const security = await analyzeSecurity(additionalFiles, options);
  for (const finding of security.filter(finding => ['SEC001', 'SEC002', 'SEC003', 'SEC006', 'SEC007'].includes(finding.ruleId))) {
    findings.push({
      ruleId: 'GHCP015', dimension: 'security', severity: finding.severity, confidence: finding.confidence,
      file: finding.file, line: finding.line, stability: 'experimental', basis: 'heuristic',
      message: `${finding.ruleId}: ${finding.message.replace(/ This will be sent to the LLM on every invocation\./, '')}`,
      suggestion: finding.suggestion,
    });
  }
  const configured = applyRuleConfig(findings, options);
  const suppressed = applySuppressions(configured.findings, options.suppressions);
  const diagnostics = discovery.diagnostics ?? [];
  return {
    profile: 'copilot', stability: 'experimental', target, documentationSnapshot: '2026-10-02',
    scope: options.includeFiles?.length ? 'selected-files' : options.scanSubpath ? 'selected-directory' : 'repository',
    completeness: diagnostics.length || files.some(file => file.status === 'not-analyzed') ? 'partial' : 'complete-within-scope',
    diagnostics, files,
    coverage: COPILOT_SURFACES.map(surface => {
      const matching = files.filter(file => file.surface === surface);
      return { surface, files: matching.length, checked: matching.filter(file => file.status === 'checked').length, status: matching.length ? 'present' : 'not-detected' };
    }),
    findings: suppressed.findings, disabledFindings: configured.disabledFindings,
    suppressedFindings: suppressed.suppressedFindings, suppressionSummary: suppressed.summary,
    manualChecks: [
      { id: 'organization-policy', title: 'Organization and enterprise controls', status: 'not-assessed', verification: 'Verify enabled Copilot features/models, content exclusions and their feature-specific limits, data handling, public-code matching, retention, audit logs, and policy enforcement in the administrative UI.' },
      { id: 'effective-configuration', title: 'Effective configuration and trust', status: 'not-assessed', verification: 'Check personal/organization instructions, managed policies, user settings, local overrides, environment/CLI flags, workspace trust, saved approvals, sandboxing, and which files the actual client loads. Home directories are never scanned implicitly.' },
      { id: 'runtime-integrations', title: 'MCP, LSP, hooks, skills and extensions at runtime', status: 'not-assessed', verification: 'Verify installation, versions, authentication, required binaries, tool availability, hook outputs/timeouts, network allowlists and harmless end-to-end execution. Source presence is not proof of activation or isolation.' },
      { id: 'plugin-resources', title: 'Plugin and skill resource closure', status: 'not-assessed', verification: 'Review referenced scripts, resources, custom component paths, namespaces, marketplace sources and update provenance. This scan does not traverse manifest references or certify executable code.' },
      { id: 'cloud-environment', title: 'Cloud agent and code-review deployment', status: 'not-assessed', verification: 'Verify workflow availability on the required branch, successful setup logs, secrets scope, runner isolation/firewall, code-review settings and fallback setup. Local YAML does not prove the deployed environment.' },
      { id: 'quality-and-economics', title: 'Accepted outcomes and actual cost', status: 'not-assessed', verification: 'Run representative build/test/lint/review tasks and record acceptance, retries, latency and usage. Use the separate economics ledger for monetary accounting; configuration token counts are not billed usage.' },
    ],
    note: 'Experimental static hygiene, not scored and excluded from stable conformance/CI gates. A complete-within-scope inventory is not a certification. Optional surfaces need not exist. File tokens describe source size, not what a client loads or bills. Target-specific notes do not simulate runtime precedence.',
  };
}

function checkOptionalTypes(config: Record<string, unknown>, expected: Record<string, 'string' | 'boolean' | 'number' | 'object'>, id: string, emit: Emit): void {
  for (const [key, type] of Object.entries(expected)) {
    if (config[key] === undefined) continue;
    if (type === 'object' ? !isRecord(config[key]) : typeof config[key] !== type) emit(id, `${key} must be a ${type}.`);
  }
}

function checkInstructions(path: string, metadata: Record<string, unknown>, target: string, emit: Emit): void {
  if (!path.startsWith('.github/instructions/')) return;
  if (!path.endsWith('.instructions.md')) emit('GHCP003', 'Path-specific instructions must use the .instructions.md suffix.');
  if (!nonempty(metadata.applyTo) && !(target === 'vscode' && nonempty(metadata.description))) {
    emit('GHCP002', 'No nonempty applyTo glob: path-specific loading is not established. VS Code can also select instructions semantically using description.');
  }
  if (metadata.excludeAgent !== undefined && !['code-review', 'cloud-agent'].includes(String(metadata.excludeAgent))) emit('GHCP002', 'excludeAgent must be "code-review" or "cloud-agent".');
  if (metadata.excludeAgent === target) emit('GHCP002', `Instructions explicitly exclude the selected ${target} target. Confirm this is intentional.`, 'documented', 'info');
}

function checkAgent(metadata: Record<string, unknown>, body: string, target: string, emit: Emit): void {
  const vscode = target === 'vscode' || metadata.target === 'vscode';
  if (!nonempty(metadata.description) && (!vscode || metadata.description !== undefined)) emit('GHCP004', 'Copilot CLI/cloud agent description is required and must be a nonempty string; VS Code can omit it.');
  if (body.length > 30_000) emit('GHCP004', `Agent body is ${body.length} characters; the documented maximum is 30,000.`);
  checkOptionalTypes(metadata, { name: 'string', 'disable-model-invocation': 'boolean', 'user-invocable': 'boolean', 'mcp-servers': 'object', metadata: 'object' }, 'GHCP004', emit);
  if (metadata.model !== undefined && typeof metadata.model !== 'string') {
    if (!strings(metadata.model)) emit('GHCP004', 'Agent model must be a string or a VS Code model-priority array.');
    else if (!vscode) emit('GHCP003', 'Model-priority arrays are supported by VS Code; CLI/cloud profiles document a single model string.');
  }
  if (metadata.target !== undefined && !['vscode', 'github-copilot'].includes(String(metadata.target))) emit('GHCP004', 'Agent target must be "vscode" or "github-copilot".');
  if (metadata.tools !== undefined && !tools(metadata.tools)) emit('GHCP004', 'Agent tools must be a comma-separated string or string array. tools: [] is valid.');
  if (metadata.tools === undefined || toolNames(metadata.tools).includes('*')) emit('GHCP005', 'Agent inherits all tools or requests wildcard access. This may be intentional; review the task-specific capability set.', 'heuristic');
  if (metadata['user-invocable'] === false && metadata['disable-model-invocation'] === true) emit('GHCP004', 'Both user invocation and model invocation are disabled; confirm how this agent should be reached.', 'heuristic', 'medium');
  if (metadata.infer !== undefined) emit('GHCP003', 'infer is retired; use user-invocable and disable-model-invocation.');
  if (isRecord(metadata.metadata) && !Object.values(metadata.metadata).every(value => typeof value === 'string')) emit('GHCP004', 'Agent metadata values must be strings.');
  if ((target === 'cloud-agent' || target === 'all') && (metadata.handoffs !== undefined || metadata['argument-hint'] !== undefined)) emit('GHCP003', 'Cloud agents ignore IDE handoffs/argument-hint metadata; retain it only with that compatibility assumption.', 'documented', 'info');
  if (target === 'vscode' && metadata['mcp-servers'] !== undefined) emit('GHCP003', 'Agent mcp-servers is not used by IDE agents; configure MCP in the editor separately.');
  if (isRecord(metadata['mcp-servers'])) checkMcp({ mcpServers: metadata['mcp-servers'] }, emit);
}

function checkSkill(path: string, metadata: Record<string, unknown>, emit: Emit): void {
  if (basename(path) !== 'SKILL.md' || path.split('/').length !== 4) emit('GHCP006', 'Use an exact SKILL.md filename inside one immediate skill subdirectory.');
  if (!nonempty(metadata.name) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(metadata.name)) emit('GHCP006', 'Skill name must be a nonempty lowercase, hyphen-separated identifier.');
  else if (metadata.name !== basename(dirname(path))) emit('GHCP006', 'Skill name must match its containing directory.');
  if (!nonempty(metadata.description)) emit('GHCP006', 'Skill description is required for discovery.');
  if (metadata['allowed-tools'] !== undefined && !tools(metadata['allowed-tools'])) emit('GHCP006', 'allowed-tools must be a string or string array.');
  if (toolNames(metadata['allowed-tools']).some(name => /^(?:\*|bash|shell|powershell|execute)(?:$|[:(])/i.test(name))) emit('GHCP005', 'Skill allowed-tools may preapprove shell execution or wildcard access; review this explicitly.', 'heuristic');
}

function checkHooks(value: unknown, cloud: boolean, emit: Emit): void {
  if (!isRecord(value)) { emit('GHCP007', 'hooks must be an object mapping events to handler arrays.'); return; }
  for (const [event, entries] of Object.entries(value)) {
    const normalized = EVENT_ALIASES[event] ?? event.charAt(0).toLowerCase() + event.slice(1);
    if (!HOOK_EVENTS.has(normalized)) emit('GHCP007', `Unknown hook event "${event}" in this documentation snapshot; verify client/version support.`, 'documented', 'medium');
    if (!Array.isArray(entries)) { emit('GHCP007', `Hook event "${event}" must contain an array.`); continue; }
    if (cloud && ['notification', 'permissionRequest'].includes(normalized)) emit('GHCP008', `${event} does not provide reliable cloud-agent enforcement; test preToolUse where blocking is required.`);
    for (const entry of entries) {
      if (!isRecord(entry)) { emit('GHCP007', `Handler in ${event} must be an object.`); continue; }
      // VS Code/Claude-compatible matcher groups wrap leaf handlers.
      if (Array.isArray(entry.hooks)) {
        for (const child of entry.hooks) checkHookHandler(child, normalized, cloud, emit);
      } else checkHookHandler(entry, normalized, cloud, emit);
    }
  }
}

function checkHookHandler(value: unknown, event: string, cloud: boolean, emit: Emit): void {
  if (!isRecord(value)) { emit('GHCP007', `Handler in ${event} must be an object.`); return; }
  const type = value.type ?? 'command';
  checkOptionalTypes(value, { timeoutSec: 'number', timeout: 'number', cwd: 'string', env: 'object' }, 'GHCP007', emit);
  if (type === 'command') {
    checkOptionalTypes(value, { bash: 'string', powershell: 'string', command: 'string', exec: 'string' }, 'GHCP007', emit);
    const commands = [value.bash, value.powershell, value.command].filter(nonempty);
    if (!commands.length && !nonempty(value.exec)) emit('GHCP007', 'Command hook needs bash, powershell, command, or exec.');
    if (value.exec !== undefined && [value.bash, value.powershell, value.command].some(command => command !== undefined)) emit('GHCP007', 'exec cannot be combined with shell command fields.');
    if (value.args !== undefined && !strings(value.args)) emit('GHCP007', 'Hook args must be a string array.');
    if (cloud && !nonempty(value.bash) && !nonempty(value.command)) emit('GHCP008', 'Cloud agents do not run PowerShell-only or exec-only hooks.');
    if (commands.some(command => /\bread\s+-p\b|\bRead-Host\b|(?:curl|wget).*\|\s*(?:ba)?sh\b/i.test(command))) emit('GHCP008', 'Hook contains interactive input or a fetch-and-execute pipeline; review reproducibility and unattended behavior.', 'heuristic');
  } else if (type === 'http') {
    checkUrl(value.url, 'GHCP007', emit, event === 'preToolUse' || event === 'permissionRequest');
    checkOptionalTypes(value, { headers: 'object' }, 'GHCP007', emit);
    if (value.allowedEnvVars !== undefined && !strings(value.allowedEnvVars)) emit('GHCP007', 'HTTP hook allowedEnvVars must be a string array.');
  } else if (type === 'prompt') {
    if (!nonempty(value.prompt) || event !== 'sessionStart') emit('GHCP007', 'Prompt hooks need nonempty prompt text and are supported only on sessionStart.');
    emit('GHCP008', 'Prompt hooks have session-mode-specific behavior; do not rely on them as a universal enforcement mechanism.', 'documented', 'info');
  } else emit('GHCP007', `Unsupported hook type "${String(type)}".`);
}

function checkMcp(config: Record<string, unknown>, emit: Emit, vscode = false): void {
  const map: unknown = vscode ? config.servers : config.mcpServers ?? config.servers ?? config;
  if (!isRecord(map)) { emit('GHCP009', 'MCP servers must be an object keyed by server name.'); return; }
  for (const [name, value] of Object.entries(map)) {
    if (name === '$schema' || name === 'inputs') continue;
    if (!isRecord(value)) { emit('GHCP009', `MCP server "${name}" must be an object.`); continue; }
    const type = value.type;
    if (type !== undefined && !['local', 'stdio', 'http', 'sse', 'streamable-http'].includes(String(type))) emit('GHCP009', `MCP server "${name}" has an unsupported transport type.`);
    const remote = ['http', 'sse', 'streamable-http'].includes(String(type)) || (type === undefined && value.url !== undefined);
    if (remote) checkUrl(value.url, 'GHCP010', emit);
    else if (!nonempty(value.command)) emit('GHCP009', `Local MCP server "${name}" requires a nonempty command.`);
    if (value.args !== undefined && !strings(value.args)) emit('GHCP009', `MCP server "${name}" args must be a string array.`);
    if (value.tools !== undefined && !strings(value.tools)) emit('GHCP009', `MCP server "${name}" tools must be a string array; [] is valid.`);
    checkOptionalTypes(value, { env: 'object', headers: 'object', cwd: 'string', timeout: 'number' }, 'GHCP009', emit);
    if (nonempty(value.command)) {
      if (/\||&&|;|\$\(|`/.test(value.command)) emit('GHCP010', `MCP server "${name}" command contains shell syntax. Direct-process transports do not interpret it as an argument array.`, 'heuristic');
      checkPackagePin(name, value.command, strings(value.args) ? value.args : [], emit);
    }
  }
}

function checkPackagePin(name: string, command: string, args: string[], emit: Emit): void {
  const launcher = command.replace(/\\/g, '/').split('/').at(-1)?.replace(/\.(?:cmd|exe)$/i, '').toLowerCase();
  if (!launcher || !['npx', 'uvx', 'bunx', 'pnpm', 'yarn', 'npm'].includes(launcher)) return;
  if (['pnpm', 'yarn', 'npm'].includes(launcher) && !args.some(arg => arg === 'dlx' || arg === 'exec')) return;
  const packageFlag = args.find(arg => /^(?:--package|--from)=/.test(arg));
  const separateFlag = args.findIndex(arg => ['--package', '--from', '-p'].includes(arg));
  const candidate = packageFlag?.slice(packageFlag.indexOf('=') + 1)
    ?? (separateFlag >= 0 ? args[separateFlag + 1] : undefined)
    ?? args.find(arg => !arg.startsWith('-') && !['dlx', 'exec'].includes(arg));
  if (!candidate || /^[./\\]/.test(candidate)) return;
  const pinned = launcher === 'uvx'
    ? /==\d+(?:\.\d+)+(?:[a-z0-9.+-]*)$/i.test(candidate)
    : /@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(candidate);
  if (!pinned) emit('GHCP010', `MCP server "${name}" uses ${launcher} without a recognized exact package version. Later version-looking arguments do not pin the launched package.`, 'heuristic');
}

function checkUrl(value: unknown, id: string, emit: Emit, requireHttps = false): void {
  if (!nonempty(value)) { emit(id, 'Remote configuration requires a nonempty URL.'); return; }
  if (/\$\{/.test(value)) { emit(id, 'URL contains a runtime placeholder; transport and interpolation behavior need runtime verification.', 'heuristic', 'info'); return; }
  let url: URL;
  try { url = new URL(value); }
  catch { emit(id, 'Remote URL is invalid.'); return; }
  if (!['https:', 'http:'].includes(url.protocol)) emit(id, 'Remote transport requires an HTTP(S) URL.');
  const loopback = url.hostname === 'localhost' || url.hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
  if (url.protocol === 'http:' && (requireHttps || !loopback)) emit(id, 'Unencrypted remote endpoint: use HTTPS.', 'documented', 'high');
  if (url.protocol === 'http:' && loopback && id === 'GHCP007' && !requireHttps) emit(id, 'Loopback HTTP hooks require explicit runtime opt-in; verify it is enabled deliberately.', 'documented', 'info');
  if (url.username || url.password) emit(id, 'URL contains embedded credentials; use supported secret references instead.', 'heuristic', 'high');
}

function checkSettings(path: string, config: Record<string, unknown>, cloud: boolean, emit: Emit): void {
  checkOptionalTypes(config, { disableAllHooks: 'boolean', enabledPlugins: 'object', extraKnownMarketplaces: 'object', permissions: 'object', 'chat.tools.global.autoApprove': 'boolean' }, 'GHCP011', emit);
  if (config.disableAllHooks === true) emit('GHCP011', 'Hooks are explicitly disabled in this settings source. Verify whether later configuration overrides it.', 'documented');
  if (config['chat.tools.global.autoApprove'] === true) emit('GHCP011', 'Global tool auto-approval is enabled; verify the intended trust boundary.', 'heuristic', 'high');
  if (isRecord(config.permissions)) {
    if (config.permissions.allow !== undefined && !strings(config.permissions.allow)) emit('GHCP011', 'permissions.allow must be a string array.');
    if (toolNames(config.permissions.allow).some(value => /^(?:\*|(?:Bash|Shell|Execute|Write|Edit)(?:\(\s*\*\s*\))?)$/i.test(value))) emit('GHCP011', 'Permission allowlist includes unrestricted shell/write/all-tools entries; constrain approvals to reviewed operations.', 'heuristic', 'high');
  }
  if (config.hooks !== undefined) checkHooks(config.hooks, cloud, emit);
  if (path === '.vscode/settings.local.json') emit('GHCP003', 'VS Code workspace settings use .vscode/settings.json, not settings.local.json.');
  else if (path.endsWith('settings.local.json')) emit('GHCP011', 'Local settings override shared repository configuration. Keep personal overrides out of version control; this scan does not establish git tracking or ignore state.', 'documented', 'info');
}

function checkSetup(path: string, config: Record<string, unknown>, emit: Emit): void {
  if (!path.startsWith('.github/workflows/')) emit('GHCP003', 'Copilot setup workflows must be inside .github/workflows/.');
  if (!path.endsWith('.yml')) emit('GHCP003', 'Use the documented .yml filename for Copilot setup workflow discovery.');
  if (!isRecord(config.jobs) || Object.keys(config.jobs).length !== 1 || !isRecord(config.jobs['copilot-setup-steps'])) {
    emit('GHCP012', 'Setup requires exactly one job named copilot-setup-steps.');
    return;
  }
  const job = config.jobs['copilot-setup-steps'];
  const allowed = new Set(['steps', 'permissions', 'runs-on', 'services', 'snapshot', 'timeout-minutes']);
  for (const key of Object.keys(job)) if (!allowed.has(key)) emit('GHCP012', `Setup job setting "${key}" is not in the supported set and may be ignored.`, 'documented', 'medium');
  if (job['runs-on'] === undefined) emit('GHCP012', 'Setup job requires runs-on.');
  const timeout = job['timeout-minutes'];
  if (timeout !== undefined && (typeof timeout !== 'number' || !Number.isFinite(timeout) || timeout <= 0 || timeout > 59)) emit('GHCP012', 'Setup timeout-minutes must be positive and at most 59.');
  if (!Array.isArray(job.steps) || job.steps.length === 0) emit('GHCP012', 'Setup job needs a nonempty steps array.');
  else for (const step of job.steps) {
    if (!isRecord(step) || (nonempty(step.run) === nonempty(step.uses))) emit('GHCP012', 'Each setup step must define exactly one nonempty run or uses.');
    if (isRecord(step) && nonempty(step.run) && /(?:curl|wget).*\|\s*(?:ba)?sh\b/.test(step.run)) emit('GHCP012', 'Setup downloads and immediately executes a script; verify source integrity and reproducibility.', 'heuristic', 'medium');
  }
  const permissions = job.permissions ?? config.permissions;
  if (permissions === 'write-all' || (isRecord(permissions) && Object.values(permissions).includes('write'))) emit('GHCP012', 'Setup grants write permissions. Confirm each is needed; checkout generally needs only contents:read and the agent receives a separate operation token.', 'heuristic', 'medium');
}

function checkLsp(config: Record<string, unknown>, emit: Emit): void {
  if (!isRecord(config.lspServers)) { emit('GHCP013', 'LSP configuration requires an lspServers object.'); return; }
  for (const [name, entry] of Object.entries(config.lspServers)) {
    if (!/^[a-z0-9_-]+$/i.test(name)) emit('GHCP013', 'LSP server names use letters, digits, underscores and hyphens.');
    if (!isRecord(entry)) { emit('GHCP013', `LSP server "${name}" must be an object.`); continue; }
    if (!nonempty(entry.command)) emit('GHCP013', `LSP server "${name}" requires command.`);
    if (!isRecord(entry.fileExtensions) || !Object.keys(entry.fileExtensions).length || !Object.entries(entry.fileExtensions).every(([key, value]) => key.startsWith('.') && nonempty(value))) emit('GHCP013', `LSP server "${name}" needs a nonempty fileExtensions map of .extension to language ID.`);
    if (entry.args !== undefined && !strings(entry.args)) emit('GHCP013', `LSP server "${name}" args must be a string array.`);
  }
}

function checkPlugin(path: string, config: Record<string, unknown>, cloud: boolean, emit: Emit): void {
  if (!nonempty(config.name)) emit('GHCP013', 'Plugin/marketplace manifest requires a nonempty name.');
  if (path.endsWith('marketplace.json')) {
    if (!Array.isArray(config.plugins)) emit('GHCP013', 'Marketplace manifest requires a plugins array.');
    return;
  }
  const portable = typeof config.$schema === 'string' && config.$schema.includes('agent-plugins.org');
  if (portable) {
    if (!/^https:\/\/agent-plugins\.org\/schemas\/1\.[01]\.0\/plugin\.schema\.json$/.test(String(config.$schema))) emit('GHCP013', 'Unrecognized Agent Plugins schema version in this snapshot; verify compatibility.');
    if (nonempty(config.name) && (config.name.length > 64 || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(config.name) || /--|\.\./.test(config.name))) emit('GHCP013', 'Agent Plugins name must meet the portable lowercase identifier constraints.');
    const allowed = new Set(['$schema', 'name', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords', 'extensions']);
    for (const key of Object.keys(config)) if (!allowed.has(key)) emit('GHCP013', `Portable plugin field "${key}" is unsupported; component path overrides belong to the legacy format.`);
  } else {
    if (config.hooks !== undefined && isRecord(config.hooks)) checkHooks(config.hooks.hooks ?? config.hooks, cloud, emit);
    if (isRecord(config.mcpServers)) checkMcp({ mcpServers: config.mcpServers }, emit);
    if (isRecord(config.lspServers)) checkLsp(config.lspServers.lspServers === undefined ? { lspServers: config.lspServers } : config.lspServers, emit);
  }
  checkOptionalTypes(config, { version: 'string', description: 'string' }, 'GHCP013', emit);
}

function checkLiteralSecrets(config: Record<string, unknown>, emit: Emit): void {
  const pending: unknown[] = [config];
  const visited = new Set<object>();
  while (pending.length) {
    const current = pending.pop();
    if ((!isRecord(current) && !Array.isArray(current)) || visited.has(current)) continue;
    visited.add(current);
    for (const [key, value] of Object.entries(current)) {
      if (/^(?:api[_-]?key|access[_-]?token|token|password|secret|authorization)$/i.test(key) && typeof value === 'string' && value.length >= 8 && !/\$\{|<[^>]+>|\b(?:example|placeholder|REPLACE|YOUR_)/i.test(value)) {
        emit('GHCP010', 'A credential-named field contains a literal value. Verify it is not a secret; values are deliberately omitted from this finding.', 'heuristic', 'high');
      }
      if (value !== null && typeof value === 'object') pending.push(value);
    }
  }
}

function safeParseMessage(message: string): string {
  const location = message.match(/at (?:offset \d+|line \d+, column \d+)/)?.[0];
  return `Invalid syntax, unterminated frontmatter, or non-object root${location ? ` (${location})` : ''}. Source text is omitted.`;
}
