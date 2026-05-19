import { describe, it, expect } from 'vitest';
import { analyzeInMemory } from '../src/analyze-in-memory.js';

/**
 * Targeted coverage for the prompt / MCP / hooks / setup / editor analyzers
 * in src/analyzers/components.ts. Each test feeds the minimal synthetic
 * content needed to trigger a specific rule.
 */

async function findingsFor(files: Array<{ path: string; content: string }>) {
  const result = await analyzeInMemory({ files });
  return result.findings;
}

describe('analyzers/components — prompts (PRM*)', () => {
  it('PRM001 fires when a prompt has no purpose header/frontmatter and is > 50 tokens', async () => {
    const content = Array.from({ length: 30 }, () => 'do a thing in the codebase').join(' ');
    const findings = await findingsFor([{ path: '.github/prompts/foo.md', content }]);
    expect(findings.some(f => f.ruleId === 'PRM001')).toBe(true);
  });

  it('PRM002 fires for oversized prompt files (> 1000 tokens)', async () => {
    const content = ('word '.repeat(5000));
    const findings = await findingsFor([{ path: '.github/prompts/big.md', content }]);
    expect(findings.some(f => f.ruleId === 'PRM002')).toBe(true);
  });

  it('PRM003 fires for prompts with too many hardcoded source paths', async () => {
    const content =
      '# Prompt\nsrc/a.ts\nsrc/b.ts\nsrc/c.ts\nsrc/d.ts\nsrc/e.ts\nsrc/f.ts\nsrc/g.ts\n';
    const findings = await findingsFor([{ path: '.github/prompts/paths.md', content }]);
    expect(findings.some(f => f.ruleId === 'PRM003')).toBe(true);
  });

  it('PRM005 fires when prompt library has > 15 prompts', async () => {
    const files = Array.from({ length: 16 }, (_, i) => ({
      path: `.github/prompts/p${i}.md`,
      content: `# Prompt ${i}\nDo something useful here.`,
    }));
    const findings = await findingsFor(files);
    expect(findings.some(f => f.ruleId === 'PRM005')).toBe(true);
  });
});

describe('analyzers/components — MCP (MCP*)', () => {
  it('MCP001 fires for invalid JSON', async () => {
    const findings = await findingsFor([{ path: '.mcp.json', content: '{ "servers": { broken,, }' }]);
    expect(findings.some(f => f.ruleId === 'MCP001')).toBe(true);
  });

  it('MCP002 fires for secrets in MCP config', async () => {
    const findings = await findingsFor([
      {
        path: '.mcp.json',
        content: JSON.stringify({
          mcpServers: {
            db: { command: 'node', args: [], env: { API_KEY: 'sk-test1234567890abcdef1234567890abcdef' } },
          },
        }),
      },
    ]);
    expect(findings.some(f => f.ruleId === 'MCP002')).toBe(true);
  });

  it('MCP003 fires for plain http:// non-localhost endpoints', async () => {
    const findings = await findingsFor([
      {
        path: '.mcp.json',
        content: JSON.stringify({
          mcpServers: { remote: { url: 'http://example.com/mcp' } },
        }),
      },
    ]);
    expect(findings.some(f => f.ruleId === 'MCP003')).toBe(true);
  });

  it('MCP004 fires when servers lack descriptions', async () => {
    const findings = await findingsFor([
      {
        path: '.mcp.json',
        content: JSON.stringify({
          mcpServers: { db: { command: 'node', args: ['db.js'] } },
        }),
      },
    ]);
    expect(findings.some(f => f.ruleId === 'MCP004')).toBe(true);
  });

  it('MCP005 fires for shell operators in MCP commands', async () => {
    const findings = await findingsFor([
      {
        path: '.mcp.json',
        content: JSON.stringify({
          mcpServers: {
            unsafe: { command: 'npx | bash', args: [], description: 'd' },
          },
        }),
      },
    ]);
    expect(findings.some(f => f.ruleId === 'MCP005')).toBe(true);
  });
});

describe('analyzers/components — setup (STP*)', () => {
  it('STP001 fires for curl-pipe-shell setup patterns', async () => {
    const findings = await findingsFor([
      {
        path: '.github/copilot-setup-steps.yml',
        content: 'steps:\n  - run: curl -fsSL https://example.com/install.sh | bash\n',
      },
    ]);
    expect(findings.some(f => f.ruleId === 'STP001')).toBe(true);
  });

  it('STP002 fires when install runs without caching', async () => {
    const findings = await findingsFor([
      {
        path: '.github/copilot-setup-steps.yml',
        content: 'steps:\n  - run: npm install\n',
      },
    ]);
    expect(findings.some(f => f.ruleId === 'STP002')).toBe(true);
  });

  it('STP004 fires when no test command is configured', async () => {
    const findings = await findingsFor([
      {
        path: '.github/copilot-setup-steps.yml',
        content: 'steps:\n  - run: npm install\n  - run: npm run build\n',
      },
    ]);
    expect(findings.some(f => f.ruleId === 'STP004')).toBe(true);
  });
});

describe('analyzers/components — hooks (HK*)', () => {
  it('HK001 fires for interactive prompts in hooks', async () => {
    const findings = await findingsFor([
      {
        path: '.pre-commit-config.yaml',
        content:
          'repos:\n  - repo: local\n    hooks:\n      - id: confirm\n        entry: bash -c "read -p \'continue?\' yn"\n        language: system\n',
      },
    ]);
    expect(findings.some(f => f.ruleId === 'HK001')).toBe(true);
  });
});

describe('analyzers/components — editor (EDC*)', () => {
  it('EDC001 fires for invalid editor settings JSON', async () => {
    const findings = await findingsFor([
      {
        path: '.vscode/settings.json',
        content: '{ "github.copilot.enable": { "plaintext": true,, } }',
      },
    ]);
    expect(findings.some(f => f.ruleId === 'EDC001')).toBe(true);
  });
});
