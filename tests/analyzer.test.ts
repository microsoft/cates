import { describe, it, expect } from 'vitest';
import { analyze } from '../src/analyzers/index.js';
import { parseGitHubLink } from '../src/sources.js';
import { resolve } from 'node:path';

const FIXTURES = resolve(import.meta.dirname, '../fixtures');

describe('CATES Analyzer', () => {
  describe('Bad config fixture', () => {
    it('detects secrets in config', async () => {
      const result = await analyze({ repoPath: resolve(FIXTURES, 'bad') });
      const secretFindings = result.findings.filter(f => f.ruleId === 'SEC001');
      expect(secretFindings.length).toBeGreaterThan(0);
      expect(secretFindings[0]!.severity).toBe('critical');
    });

    it('detects overly permissive instructions', async () => {
      const result = await analyze({ repoPath: resolve(FIXTURES, 'bad') });
      const permissive = result.findings.filter(f => f.ruleId === 'SEC003');
      expect(permissive.length).toBeGreaterThan(0);
    });

    it('detects system prompt leakage risk', async () => {
      const result = await analyze({ repoPath: resolve(FIXTURES, 'bad') });
      const leakage = result.findings.filter(f => f.ruleId === 'SEC005');
      expect(leakage.length).toBeGreaterThan(0);
    });

    it('detects generic filler instructions', async () => {
      const result = await analyze({ repoPath: resolve(FIXTURES, 'bad') });
      const filler = result.findings.filter(f => f.ruleId === 'TE003');
      expect(filler.length).toBeGreaterThan(0);
    });

    it('detects forced verbosity', async () => {
      const result = await analyze({ repoPath: resolve(FIXTURES, 'bad') });
      const verbosity = result.findings.filter(f => f.ruleId === 'TE004');
      expect(verbosity.length).toBeGreaterThan(0);
    });

    it('detects negative constraint spam', async () => {
      const result = await analyze({ repoPath: resolve(FIXTURES, 'bad') });
      const negatives = result.findings.filter(f => f.ruleId === 'TE005');
      expect(negatives.length).toBeGreaterThan(0);
    });

    it('detects verbose code examples', async () => {
      const result = await analyze({ repoPath: resolve(FIXTURES, 'bad') });
      const verbose = result.findings.filter(f => f.ruleId === 'TE002');
      expect(verbose.length).toBeGreaterThan(0);
    });

    it('produces a low overall score', async () => {
      const result = await analyze({ repoPath: resolve(FIXTURES, 'bad') });
      expect(result.score.overall).toBeLessThan(60);
      expect(result.score.criticalCount).toBeGreaterThan(0);
    });

    it('generates actionable recommendations', async () => {
      const result = await analyze({ repoPath: resolve(FIXTURES, 'bad') });
      expect(result.recommendations.length).toBeGreaterThan(3);
      // Recommendations should be sorted by priority
      for (let i = 1; i < result.recommendations.length; i++) {
        expect(result.recommendations[i]!.priority).toBeGreaterThanOrEqual(
          result.recommendations[i - 1]!.priority
        );
      }
    });
  });

  describe('Good config fixture', () => {
    it('scores well overall', async () => {
      const result = await analyze({ repoPath: resolve(FIXTURES, 'good') });
      expect(result.score.overall).toBeGreaterThan(70);
      expect(result.score.criticalCount).toBe(0);
    });

    it('has no security critical findings', async () => {
      const result = await analyze({ repoPath: resolve(FIXTURES, 'good') });
      const critical = result.findings.filter(f => f.severity === 'critical');
      expect(critical.length).toBe(0);
    });

    it('detects prompt protection is present', async () => {
      const result = await analyze({ repoPath: resolve(FIXTURES, 'good') });
      const leakageWarnings = result.findings.filter(f => f.ruleId === 'SEC004');
      expect(leakageWarnings.length).toBe(0);
    });

    it('recognizes project-specific context', async () => {
      const result = await analyze({ repoPath: resolve(FIXTURES, 'good') });
      const genericWarnings = result.findings.filter(f => f.ruleId === 'SPC002');
      expect(genericWarnings.length).toBe(0);
    });
  });

  describe('Discovery', () => {
    it('correctly identifies file types and scopes', async () => {
      const result = await analyze({ repoPath: resolve(FIXTURES, 'good') });
      const rootInstructions = result.discovery.files.find(
        f => f.type === 'root-instructions'
      );
      expect(rootInstructions).toBeDefined();
      expect(rootInstructions!.scope).toBe('always-loaded');
      expect(rootInstructions!.tokenCount).toBeGreaterThan(0);
    });

    it('counts tokens accurately', async () => {
      const result = await analyze({ repoPath: resolve(FIXTURES, 'good') });
      expect(result.discovery.totalTokens).toBeGreaterThan(100);
      expect(result.discovery.alwaysLoadedTokens).toBeGreaterThan(0);
    });

    it('limits discovery to explicitly included files', async () => {
      const result = await analyze({
        repoPath: resolve(FIXTURES, 'ecosystem'),
        includeFiles: ['agents/migration.md'],
      });

      expect(result.discovery.files).toHaveLength(1);
      expect(result.discovery.files[0]!.relativePath).toBe('agents/migration.md');
      expect(result.discovery.files[0]!.type).toBe('agent-definition');
    });
  });

  describe('Full config fixture (all components)', () => {
    it('discovers all 7 config files', async () => {
      const result = await analyze({ repoPath: resolve(FIXTURES, 'full') });
      expect(result.discovery.files.length).toBe(7);
    });

    it('detects MCP servers without descriptions', async () => {
      const result = await analyze({ repoPath: resolve(FIXTURES, 'full') });
      const mcpFindings = result.findings.filter(f => f.ruleId === 'MCP004');
      expect(mcpFindings.length).toBeGreaterThan(0);
    });

    it('detects prompt without variable placeholders', async () => {
      const result = await analyze({ repoPath: resolve(FIXTURES, 'full') });
      const prmFindings = result.findings.filter(f => f.ruleId === 'PRM004');
      expect(prmFindings.length).toBeGreaterThan(0);
    });

    it('detects missing system prompt protection in setup steps', async () => {
      const result = await analyze({ repoPath: resolve(FIXTURES, 'full') });
      const sec004 = result.findings.filter(f => f.ruleId === 'SEC004');
      expect(sec004.length).toBeGreaterThan(0);
    });

    it('produces a reasonable score (B range)', async () => {
      const result = await analyze({ repoPath: resolve(FIXTURES, 'full') });
      expect(result.score.overall).toBeGreaterThanOrEqual(60);
      expect(result.score.overall).toBeLessThanOrEqual(95);
      expect(result.score.grade).toBe('B');
    });

    it('includes component-specific config types in discovery', async () => {
      const result = await analyze({ repoPath: resolve(FIXTURES, 'full') });
      const types = result.discovery.files.map(f => f.type);
      expect(types).toContain('root-instructions');
      expect(types).toContain('prompt-file');
      expect(types).toContain('setup-steps');
      expect(types).toContain('mcp-config');
      expect(types).toContain('hooks-config');
      expect(types).toContain('editor-config');
    });
  });

  describe('Ecosystem config fixture', () => {
    it('discovers Claude, Cursor, Windsurf, Aider, Gemini, MCP, and generic .ai configs', async () => {
      const result = await analyze({ repoPath: resolve(FIXTURES, 'ecosystem') });
      const paths = result.discovery.files.map(f => f.relativePath);
      const types = result.discovery.files.map(f => f.type);

      expect(paths).toContain('CLAUDE.md');
      expect(paths).toContain('.claude/settings.json');
      expect(paths).toContain('.claude/commands/review.md');
      expect(paths).toContain('.claude/agents/security.md');
      expect(paths).toContain('agents/migration.md');
      expect(paths).toContain('.cursor/rules/typescript.mdc');
      expect(paths).toContain('.windsurfrules');
      expect(paths).toContain('.aider.conf.yml');
      expect(paths).toContain('GEMINI.md');
      expect(paths).toContain('.mcp.json');
      expect(paths).toContain('.ai/rules/security.md');
      expect(paths).toContain('.ai/agent-setup.yml');

      expect(types).toContain('root-instructions');
      expect(types).toContain('editor-config');
      expect(types).toContain('prompt-file');
      expect(types).toContain('agent-definition');
      expect(types).toContain('rules-config');
      expect(types).toContain('mcp-config');
      expect(types).toContain('setup-steps');
    });
  });

  describe('Output formats', () => {
    it('produces valid JSON output', async () => {
      const result = await analyze({ repoPath: resolve(FIXTURES, 'bad') });
      const { createReport } = await import('../src/scoring/report.js');
      const json = createReport(result, 'json');
      expect(() => JSON.parse(json)).not.toThrow();
      expect(JSON.parse(json).score).toHaveProperty('estimatedTokenSavingsPercentage');
      expect(JSON.parse(json).savings).toHaveProperty('projectedAnnualTokens');
    });

    it('produces valid SARIF output', async () => {
      const result = await analyze({ repoPath: resolve(FIXTURES, 'bad') });
      const { createReport } = await import('../src/scoring/report.js');
      const sarif = createReport(result, 'sarif');
      const parsed = JSON.parse(sarif);
      expect(parsed.version).toBe('2.1.0');
      expect(parsed.runs[0].tool.driver.name).toBe('cates-analyzer');
      expect(parsed.runs[0].results.length).toBeGreaterThan(0);
    });

    it('produces pretty output without crashing', async () => {
      const result = await analyze({ repoPath: resolve(FIXTURES, 'good') });
      const { createReport } = await import('../src/scoring/report.js');
      const pretty = createReport(result, 'pretty');
      expect(pretty).toContain('Overall Score');
      expect(pretty).toContain('Dimension Scores');
      expect(pretty).toContain('Potential Token Savings');
      expect(pretty).toContain('Annualized');
    });
  });

  describe('Review sources', () => {
    it('parses GitHub repository URLs', () => {
      expect(parseGitHubLink('https://github.com/example/repo')).toEqual({
        owner: 'example',
        repo: 'repo',
      });
    });

    it('parses GitHub folder URLs', () => {
      expect(parseGitHubLink('https://github.com/example/repo/tree/main/.github/prompts')).toEqual({
        owner: 'example',
        repo: 'repo',
        ref: 'main',
        subpath: '.github/prompts',
        fileMode: false,
      });
    });

    it('parses GitHub file URLs as file-mode targets', () => {
      expect(parseGitHubLink('https://github.com/example/repo/blob/main/.github/copilot-instructions.md')).toEqual({
        owner: 'example',
        repo: 'repo',
        ref: 'main',
        subpath: '.github/copilot-instructions.md',
        fileMode: true,
      });
    });

    it('parses GitHub pull request URLs', () => {
      expect(parseGitHubLink('https://github.com/example/repo/pull/123')).toEqual({
        owner: 'example',
        repo: 'repo',
        pullNumber: 123,
      });
    });
  });
});
