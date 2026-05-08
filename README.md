# CATES Configuration Analyzer

> Score coding-agent configurations for **token efficiency**, **security**, and **CATES conformance** — zero LLM calls required.

This is the reference implementation for the **Coding Agent Token Economics Standard (CATES)**. It is vendor-neutral and analyzes common coding-agent configuration surfaces, including instructions, prompt libraries, MCP configs, setup steps, hooks, and editor settings.

---

## 🚀 Quick Start

```bash
# Analyze current directory
npx cates-analyzer .

# Analyze a specific repo
npx cates-analyzer /path/to/repo

# JSON output for CI
npx cates-analyzer . --format json

# SARIF output for code scanning systems
npx cates-analyzer . --format sarif

# Review a GitHub repository, branch folder, file, or pull request
npx cates-analyzer review https://github.com/OWNER/REPO
npx cates-analyzer review https://github.com/OWNER/REPO/tree/main/path/to/folder
npx cates-analyzer review https://github.com/OWNER/REPO/pull/123
```

When running from this source checkout before publishing/installing the package, use one of these forms:

```bash
npm run --silent review -- https://github.com/OWNER/REPO
npm run --silent cates -- review https://github.com/OWNER/REPO
npx tsx src/cli/index.ts review https://github.com/OWNER/REPO
```

Do not run `tsc review ...` or `npm run typecheck -- review ...`; those commands invoke the TypeScript compiler and it will treat `review` and the URL as files to compile.

## 📊 What It Scores

| Dimension | Weight | What It Checks |
|-----------|--------|----------------|
| **Security** | 25% | Secrets, prompt injection vectors, overly permissive grants, system prompt leakage |
| **Token Efficiency** | 25% | Redundancy, verbose examples, generic filler, forced verbosity, negative constraint spam |
| **Specificity** | 15% | Vague vs actionable instructions, project-specific context, concrete patterns |
| **Completeness** | 15% | Coverage of testing, error handling, style, architecture, security, scope, output |
| **Conflict & Reachability** | 10% | Contradictory instructions and precedence conflicts |
| **Harness Quality** | 10% | Scope limits, failure handling, output constraints, verification steps |

## 🔐 Security Design

This tool is hardened against adversarial configs:

- **Sandboxed reads** — `realpath()` verification prevents symlink escapes
- **Size/depth/count limits** — no DoS via deep trees or huge files
- **Binary detection** — skips non-text files
- **No execution** — never runs or evaluates discovered content
- **Secret redaction** — findings never expose full secrets
- **No network calls** — purely local analysis (zero data exfiltration risk)

## ⚡ Token Efficiency (Dogfooding)

This tool practices what it preaches:

- **Zero LLM calls** for core scoring — pure heuristic-based analysis
- **Real tokenizer** (`cl100k_base` via `js-tiktoken`) for accurate cost modeling
- **Config precedence awareness** — knows which files are always-loaded vs conditional
- **Savings projections** with conservative direct-token savings, projected retry/tool-call savings, and monthly/annualized cost impact

## 📁 Files It Discovers

| File Pattern | Type | Loading Scope |
|-------------|------|---------------|
| `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `QWEN.md`, `.ai/instructions.md`, `.github/copilot-instructions.md` | Root instructions | Always-loaded |
| Nested `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `QWEN.md` | Scoped instructions | Conditional |
| `.github/prompts/*.md`, `.ai/prompts/*.md`, `.claude/commands/*.md`, `.gemini/commands/*.md` | Prompt/command files | On-demand |
| `agents/*`, `.github/agents/*`, `.ai/agents/*`, `.claude/agents/*`, `.gemini/agents/*` | Agent definitions | Conditional |
| `.cursorrules`, `.cursor/rules/*.mdc`, `.windsurfrules`, `.windsurf/rules/*`, `.clinerules`, `.cline/rules/*`, `.roo/rules/*`, `.ai/rules/*` | Rule files | Always/conditional |
| MCP configs (`mcp.json`, `.mcp.json`, `.vscode/mcp.json`, `.claude/mcp.json`, `.gemini/mcp.json`, `.ai/mcp.json`) | Tool/server configs | Conditional |
| `.vscode/settings.json`, `.cursor/settings.json`, `.claude/settings*.json`, `.gemini/settings.json`, `.aider.conf.yml`, `.aiderignore` | Editor/CLI settings | Conditional |
| Setup and hook configs (`.ai/agent-setup.yml`, `.github/copilot-setup-steps.yml`, `.pre-commit-config.yaml`, `.claude/hooks/*`, `.ai/hooks/*`) | Agent environment/harness | Environmental |

## 🛠 CLI Options

```
Usage:
  cates-analyzer analyze [options] [path]
  cates-analyzer review [options] <source>
  cates-analyzer conformance [options] [path]
  cates-analyzer rules [options]
  cates-analyzer explain <ruleId>
  cates-analyzer portfolio [options] [path]

Common analyze options:
  -f, --format <format>       pretty, json, sarif
  --policy <path>             .cates.yml/.json policy file
  --min-score <n>             quality gate
  --require-level <n>         require CATES Level 1, 2, or 3
  --fail-on <list>            e.g. critical,high
  --max-always-loaded <n>     token budget gate
  --files <list>              comma-separated relative files to analyze
  --individual                score each --files entry separately
  --fix / --fix-dry-run       safe mechanical fixes
```

`review` accepts local folders and GitHub URLs. For private repositories, authenticate with `gh auth login` and use `review`; CATES uses local GitHub CLI credentials instead of asking for tokens.

## 🏗 Architecture

```
src/
├── cli/index.ts              # Commander.js CLI entry point
├── analyzers/
│   ├── index.ts              # Orchestrator (parallel analyzer execution)
│   ├── discovery.ts          # Secure file enumeration + tokenization
│   ├── token-efficiency.ts   # Waste pattern detection
│   ├── security.ts           # Secret/injection/permission analysis
│   ├── specificity.ts        # Vagueness and project-context checks
│   ├── completeness.ts       # Topic coverage analysis
│   └── conflicts.ts          # Contradiction detection + harness quality
├── rules/
│   └── catalog.ts            # Machine-readable CATES rule catalog
├── scoring/
│   ├── calculator.ts         # Weighted multi-dimension scoring
│   ├── recommendations.ts    # Prioritized action generation
│   └── report.ts             # Pretty/JSON/SARIF formatters
├── conformance.ts            # Level/gate evaluation
├── policy.ts                 # .cates.yml loading
├── autofix.ts                # Safe fix/dry-run support
├── portfolio.ts              # Multi-repo scanning
├── utils/
│   └── tokenizer.ts          # cl100k_base tokenizer + cost modeling
├── types.ts                  # Zod-validated type definitions
└── index.ts                  # Library entry point
```

## 🧪 Development

```bash
npm install
npm run typecheck     # TypeScript validation
npm test              # Vitest test suite
npm run test:coverage # Coverage report
npx tsx src/cli/index.ts ./fixtures/bad   # Test against bad config
npx tsx src/cli/index.ts ./fixtures/good  # Test against good config
```

## 📋 Rule Reference

This is an abbreviated reference. The complete machine-readable catalog is available with:

```bash
cates-analyzer rules --format json
cates-analyzer explain TE004
```

| Rule | Dimension | Severity | Description |
|------|-----------|----------|-------------|
| SEC001 | Security | Critical | Secrets/credentials in config |
| SEC002 | Security | High | Prompt injection vectors |
| SEC003 | Security | High | Overly permissive grants |
| SEC004 | Security | Medium | Missing prompt protection |
| SEC005 | Security | High | System prompt leakage |
| SEC006 | Security | High | Unsafe command patterns |
| TE001 | Token Efficiency | Medium | Always-loaded config >1,500 tokens |
| TE002 | Token Efficiency | Medium | Verbose code examples (>200 tokens) |
| TE003 | Token Efficiency | Low | Generic filler (platform defaults) |
| TE004 | Token Efficiency | High | Forced verbosity patterns |
| TE005 | Token Efficiency | Medium | Negative constraint spam |
| TE006 | Token Efficiency | High | Cross-file duplication |
| TE007 | Token Efficiency | Medium | Duplicated instructions within a file |
| SPC001 | Specificity | Medium | Vague/unactionable instructions |
| SPC002 | Specificity | Medium | No project-specific context |
| SPC003 | Specificity | Low | No architecture documentation |
| SPC004 | Specificity | Low | Long abstract blocks without examples |
| CMP001 | Completeness | High | No configuration found |
| CMP002 | Completeness | Medium | Missing essential topics |
| CMP003 | Completeness | Low | Single oversized config file |
| CNF001 | Conflicts | High | Contradictory instructions |
| CNF002 | Harness | Medium | Missing harness elements |

## License

MIT
