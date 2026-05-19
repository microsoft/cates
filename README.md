# CATES Configuration Analyzer

> Score coding-agent configurations for **token efficiency**, **security**, and **CATES conformance** — zero LLM calls required.

This is the reference implementation for the **Coding Agent Token Economics Standard (CATES)**. It is vendor-neutral and analyzes common coding-agent configuration surfaces, including instructions, prompt libraries, MCP configs, setup steps, hooks, and editor settings.

---

## 🚀 Quick Start

### Install

CATES is distributed as an npm package and a Docker image. Pick one:

```bash
# 1) Run it once with npx (nothing to install)
npx cates-analyzer .

# 2) Install globally (recommended for repeat use)
npm install -g cates-analyzer
cates-analyzer .

# 3) Add it as a dev dependency in a project
npm install --save-dev cates-analyzer
npx cates-analyzer .

# 4) Run it in Docker (no Node.js required locally)
docker run --rm -v "$PWD:/work" ghcr.io/msfttoler/cates:latest .
```

Requires Node.js **>= 20** for the npm install paths. The Docker image
ships its own runtime plus `git` and `gh`.

### Use it

```bash
# Analyze current directory
cates-analyzer .

# Analyze a specific repo
cates-analyzer /path/to/repo

# JSON output for CI
cates-analyzer . --format json

# SARIF output for code scanning systems
cates-analyzer . --format sarif

# Review a GitHub repository, branch folder, file, or pull request
cates-analyzer review https://github.com/OWNER/REPO
cates-analyzer review https://github.com/OWNER/REPO/tree/main/path/to/folder
cates-analyzer review https://github.com/OWNER/REPO/pull/123
```

When running from this source checkout before publishing/installing the package, use one of these forms:

```bash
npm run --silent review -- https://github.com/OWNER/REPO
npm run --silent cates -- review https://github.com/OWNER/REPO
npx tsx src/cli/index.ts review https://github.com/OWNER/REPO
```

Do not run `tsc review ...` or `npm run typecheck -- review ...`; those commands invoke the TypeScript compiler and it will treat `review` and the URL as files to compile.

## 🐳 Docker

A small, non-root Alpine image is the easiest way to get a consistent
toolchain across Windows, macOS, and Linux (plus the right `git` and `gh`
versions baked in).

```bash
# Build locally
docker build -t cates-analyzer .

# Analyze the current directory (bind-mount it as /work)
docker run --rm -v "$PWD:/work" cates-analyzer .

# Review a public repo
docker run --rm cates-analyzer review https://github.com/OWNER/REPO

# Review a private repo (token never written to disk)
docker run --rm -e GH_TOKEN cates-analyzer review https://github.com/OWNER/REPO

# JSON to stdout, piped into your tooling
docker run --rm -v "$PWD:/work" cates-analyzer . --format json > report.json
```

Windows PowerShell users substitute `${PWD}` for `$PWD`.

The image runs as a non-root user, uses a read-only root filesystem, and
ships with `tini` as PID 1 so it behaves cleanly under Kubernetes/ACA.

## ☸️ Kubernetes / AKS (Helm chart)

The chart in [`deploy/helm/cates`](deploy/helm/cates/README.md) deploys
CATES as a `CronJob` (default) or one-shot `Job`. It supports AKS
Workload Identity, NetworkPolicies, a persistent reports volume, and a
ConfigMap-mounted `.cates.yml` policy.

```bash
helm install cates ./deploy/helm/cates \
  -n cates --create-namespace \
  --set image.tag=1.0.0 \
  --set githubToken.value=$GH_TOKEN \
  --set-json 'args=["demo","--limit","25","--format","json"]'
```

See [`deploy/helm/cates/README.md`](deploy/helm/cates/README.md) for
production values, Workload Identity setup, and PVC-backed reports.

## ☁️ Azure Container Apps

For a server-less, no-cluster deployment, run CATES as an **ACA Job**:

```bash
az deployment group create \
  -g rg-cates \
  -f deploy/aca/cates-job.bicep \
  -p image=ghcr.io/msfttoler/cates:1.0.0 githubToken=$GH_TOKEN
```

Schedule, manual, and event-triggered modes are all supported. Full
walkthrough in [`deploy/aca/README.md`](deploy/aca/README.md).

## 🌐 CATES Service (hosted UI + HTTP API)

Don't want to install the CLI? Use the **CATES Service** — a hosted
companion that lets you score a primitive in two ways:

1. **Paste** an instruction file, prompt, MCP config, agent definition,
   or `.cursorrules` directly into the browser.
2. **Scan a GitHub URL** — repo, folder, file, or pull request.

Behind the scenes the service runs the exact same analyzer as the CLI
(`analyze()` / `analyzeInMemory()`), so a score from the service is
identical to a score from `cates-analyzer` on the same bytes. There are
**no LLM calls**, **no telemetry**, and **no content logging** —
submitted text is analyzed in-process and discarded; repos fetched via
"Scan" are cloned shallowly into a temp directory that is removed as soon
as the score is returned.

### HTTP API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/analyze` | In-memory analysis. Body: `{ files: [{path, content}], policy?, tokenizer? }`. |
| `POST` | `/api/scan` | GitHub-URL analysis. Body: `{ url, policy?, tokenizer? }`. |
| `GET`  | `/api/rules` | Full `RULE_CATALOG` plus service limits, for UIs and tooling. |
| `GET`  | `/api/healthz` | Liveness probe. |
| `GET`  | `/api/readyz` | Readiness probe. |

All endpoints accept and return JSON. The `AnalysisResult` shape returned
by the analyze and scan endpoints is **the same** type the CLI emits with
`--format json` — every existing report consumer (dashboard, CI gates,
SARIF converter) works unchanged.

### Service limits (per request)

| Limit | Value |
| --- | --- |
| Max files per request | 50 |
| Max bytes per file | 100 KB |
| Max total payload | 1 MB |
| Per-IP rate limit | 60 requests / minute |

Limits are exposed live at `GET /api/rules` so UIs and CI integrations can
display them or pre-validate.

### Configuration parity

Every toggle and policy field from
[`⚙️ Configuring CATES`](#%EF%B8%8F-configuring-cates) is accepted in the
`policy` field of the request body:

```json
{
  "files": [
    { "path": ".github/copilot-instructions.md", "content": "..." }
  ],
  "policy": {
    "dimensions": { "security": { "enabled": false } },
    "rules": { "TE004": { "severity": "low" } }
  }
}
```

### Running the service locally

```bash
# Build and run (Node 20+)
npm install
npm run build:service
npm run service:start         # listens on :8080

# Or in watch mode while developing
npm run service:dev
```

Open `http://localhost:8080`.

### Running the service in Docker

The same image powers both the CLI and the service. Override `CMD` to
launch the service:

```bash
docker build -t cates .
docker run --rm -p 8080:8080 cates \
  node /app/dist-service/service/server.js
```

### Deploying the service to Azure Container Apps

A sibling Bicep template deploys the service as an always-on Container
App with scale-to-zero, TLS, and liveness/readiness probes wired to the
service's health endpoints:

```bash
az group create -n rg-cates -l eastus2
az deployment group create -g rg-cates \
  -f deploy/aca/cates-service.bicep \
  -p image=ghcr.io/msfttoler/cates:latest
```

The deployment outputs an HTTPS FQDN you can browse immediately.

### Deploying the service to Azure Static Web Apps (public demo)

For a serverless, zero-cost-when-idle public demo, deploy to **Azure
Static Web Apps** + **Azure Functions**:

```bash
az staticwebapp create -g rg-cates -n swa-cates -l eastus2 --sku Free \
  --source https://github.com/msfttoler/cates --branch main \
  --login-with-github
```

Add the deployment token as the GitHub Actions secret
`AZURE_STATIC_WEB_APPS_API_TOKEN` and the bundled
[`swa-deploy.yml`](.github/workflows/swa-deploy.yml) workflow ships the
SPA + Functions on every push to `main`. Full walkthrough in
[`deploy/swa/README.md`](deploy/swa/README.md).

> **Note:** `/api/scan` returns `501` on the SWA target because the
> Functions runtime doesn't ship `git`. Use ACA (above) for repo
> scanning, or wait for the Phase 2 `isomorphic-git` rewrite.

### Rule &amp; dimension toggles in the UI

The hosted UI ships with a **toggle drawer** at the top of the page that
fetches `GET /api/rules` and lets you:

- Disable any individual rule (single-click on the rule pill)
- Disable an entire dimension (click the dimension button — e.g.
  "security" if you're a GHAS customer)
- Override severity per rule
- Export the current state as `.cates.yml` for committing to your repo

Every toggle is sent in the `policy` field of the next request, so the
score updates immediately and the result includes `disabledRuleIds` /
`disabledDimensions` for auditability.

### Privacy & threat model

| Concern | Mitigation |
| --- | --- |
| Pasted content exfiltration | No persistence, no telemetry, no content logging. The access log records `method/path/status/durationMs` only. |
| Cross-site framing / SEO indexing | Strict CSP, `frame-ancestors 'none'`, `X-Frame-Options: SAMEORIGIN`, `X-Robots-Tag: noindex, nofollow` set on every response. |
| Argv-injection via `/api/scan` URLs | URLs flow through the same `parseGitHubLink` guards used by the CLI; refs starting with `-`, traversal segments, and shell metacharacters all return `HTTP 400`. |
| DoS via giant payloads | Hard per-file + per-request byte caps + JSON body limit, all enforced *before* the analyzer runs. |
| DoS via repo cloning | Shallow clones with depth=1, temp dir is removed in a `finally` block even if scoring throws. |
| Auth / multi-tenant data | None in v1 — the service is stateless and anonymous. OAuth, persisted reports, and org dashboards are on the Phase 3 roadmap; see [`VERSIONING.md`](./VERSIONING.md) and the session plan. |

## ✨ Features at a Glance

| Capability | What you get |
|---|---|
| **Zero-LLM static analysis** | Deterministic, fast, no API keys, no data exfiltration |
| **42 rules** across 6 dimensions | Token efficiency, security, specificity, completeness, conflict/reachability, harness quality |
| **Per-family tokenizers** | OpenAI `cl100k`, OpenAI `o200k`, Anthropic Claude, or an offline approximation — pick one or compare side-by-side |
| **Multi-surface discovery** | Instructions, prompt libraries, MCP configs, hooks, setup steps, editor settings |
| **Configurable** | Toggle any rule or whole dimension on/off, override severities, suppress with reasons + expirations |
| **Multiple output formats** | Human-readable text, JSON, **SARIF** for GitHub Advanced Security and other scanners |
| **CI-ready gates** | `--min-score`, `--require-level`, `--fail-on`, `--max-always-loaded` |
| **Conformance levels** | Score against CATES Level 1, 2, or 3 |
| **GitHub-native review** | `cates-analyzer review <url>` for repos, branches, folders, files, or PRs (uses local `gh` credentials) |
| **Hosted service + HTTP API** | Paste / scan / programmatic access via the [CATES Service](#-cates-service-hosted-ui--http-api) — same engine, no install |
| **Portfolio scanning** | Roll up many repos into one report |
| **Demo mode** | 100-repo built-in manifest (Microsoft, GitHub, Anthropic, broader OSS) |
| **Safe autofix** | `--fix` / `--fix-dry-run` for mechanical, reviewable changes |
| **Token economics** | Per-finding token impact + conservative and projected savings estimates |
| **Hardened runtime** | Sandboxed reads, argv-injection guards, size/depth limits, binary detection, no network calls in analyze mode |
| **Multiple ship targets** | npm CLI, Docker image, Helm chart for AKS, Bicep templates for Azure Container Apps (CLI Job + Service App) |

## ⚙️ Configuring CATES

CATES is policy-driven. Drop a `.cates.yml`, `.cates.yaml`, or `.cates.json`
at your repo root (or pass `--policy <path>`) and you can:

- Set CI quality gates (`minScore`, `requireLevel`, `failOn`,
  `maxAlwaysLoadedTokens`)
- **Toggle any individual rule on/off**
- **Toggle an entire dimension on/off** (e.g. skip all security rules
  because your org already uses GitHub Advanced Security)
- **Override the severity** of any rule or dimension
- Suppress specific findings (with required reasons and optional
  expirations)

Both YAML and JSON are accepted. A minimal annotated example:

```yaml
# .cates.yml — full schema
minScore: 80
requireLevel: 1
failOn: [critical]
maxAlwaysLoadedTokens: 1500

# ─── Whole-dimension toggles ─────────────────────────────────────────
# Disable an entire category of rules in one line. Useful when another
# tool already covers it (e.g., GHAS for secret scanning / code scanning).
dimensions:
  security: off              # skip CATES SEC* and security-tagged MCP/STP rules
  # token-efficiency: off
  # specificity: off
  # completeness: off
  # conflict-reachability: off
  # harness-quality: off

# ─── Per-rule toggles & severity overrides ───────────────────────────
# Most specific wins: rules[<id>] > dimensions[<dim>] > built-in defaults.
# Shorthand:  off | on | <severity>   (critical|high|medium|low|info)
# Long form:  { enabled: true|false, severity: <severity> }
rules:
  SEC001: off                # disable a single rule
  TE004: low                 # downgrade Forced Verbosity from high to low
  MCP002: on                 # re-enable one rule even though `security: off`
  CMP002: { severity: high } # long form

# ─── Suppressions (for documented false positives / accepted risk) ───
suppressions:
  - ruleId: SEC004
    file: .github/copilot-instructions.md
    reason: Covered by organization-level prompt protection
    owner: @platform-team
    expires: 2026-12-31
```

The same shape works as JSON:

```json
{
  "minScore": 80,
  "dimensions": { "security": "off" },
  "rules": { "SEC001": "off", "TE004": "low" }
}
```

> **Tip — GHAS users:** set `dimensions.security: off` and let GitHub
> Advanced Security own secret scanning and code scanning. CATES will
> still score token efficiency, specificity, completeness, conflicts, and
> harness quality, and any individual security rule you want to keep
> (e.g. `MCP002`, `SEC005`) can be re-enabled with `rules.<ID>: on`.

Disabled rules and dimensions are reported in the JSON output under
`disabledFindings`, `disabledRuleIds`, and `disabledDimensions` so you
can audit exactly what was filtered.

## 🧭 So... What's Next?

Once you have a report, here's how to drive the score up:

### 1. Triage in this order

1. **Critical findings first** — almost always `SEC001` (hardcoded secrets)
   or `MCP002` (secrets in MCP config). Rotate the credential, then remove
   it from history and move it behind an env var / secret manager.
2. **High-severity security & token waste** — `SEC003` (overly permissive
   scope), `SEC005` (system-prompt leakage), `TE004` (forced verbosity),
   `TE006` (cross-file duplication).
3. **Token budget breach** — if `TE001` fires, your always-loaded config
   is over the 1,500-token budget. Move conditional or rarely-used
   guidance into scoped instruction files or on-demand prompt files.
4. **Specificity & completeness** — replace vague language (`SPC001`) with
   concrete file paths, commands, and decision criteria; add the missing
   essential topics flagged by `CMP002`.

### 2. Use the built-in helpers

```bash
# Explain any rule, including the CATES section it maps to and how to fix it
cates-analyzer explain SEC003
cates-analyzer explain TE004

# Apply mechanical, reviewable fixes (only rules marked autofix-safe)
cates-analyzer . --fix-dry-run     # preview
cates-analyzer . --fix             # apply

# Re-run with a stricter gate to confirm the fix
cates-analyzer . --min-score 85 --fail-on critical,high
```

### 3. Adopt the configuration loop

- Commit a `.cates.yml` so the policy is reviewed like code.
- If a rule is genuinely not applicable (e.g. you use GHAS), **disable
  it** in `.cates.yml` rather than ignoring it everywhere.
- If a finding is a known false positive, **suppress it** with a reason
  and (ideally) an `expires` date — the suppression report tells you
  when those expire.
- Wire CATES into CI with `--format sarif` and upload to GitHub code
  scanning, or `--format json` and feed it into your own dashboards.

### 4. Refactor toward the CATES recommendations

Every report contains a `recommendations` block, prioritized and
estimated in tokens saved per invocation. Start at priority 1 and work
down — each item lists the affected files, the safety classification,
and whether it's autofixable.

### 5. Track progress over time

```bash
# Compare scores across runs by saving JSON reports per commit
cates-analyzer . --format json > reports/$(git rev-parse --short HEAD).json
```

For multi-repo views use `cates-analyzer portfolio <path>` or the demo
manifest (`cates-analyzer demo --limit 25`).



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
- **Strict CLI validation** — invalid formats, gates, severities, and limits fail loudly
- **Auditable suppressions** — `.cates.yml` suppressions require reasons and support expiration dates

## ⚡ Token Efficiency (Dogfooding)

This tool practices what it preaches:

- **Zero LLM calls** for core scoring — pure heuristic-based analysis
- **Real tokenizers per model family**:
  - `openai-cl100k` (default) — GPT-3.5, GPT-4, GPT-4 Turbo
  - `openai-o200k` — GPT-4o, o1, o3, o4 series
  - `anthropic-claude` — Claude (BPE; exact for Claude 2, approximation for Claude 3+)
  - `approx` — offline character heuristic
- **Config precedence awareness** — knows which files are always-loaded vs conditional
- **Token reduction projections** with conservative direct-token reduction and projected retry/tool-call reduction percentages

Pick one for scoring with `--tokenizer`, or compare side-by-side with `--compare-tokenizers`:

```bash
cates-analyzer . --tokenizer anthropic-claude
cates-analyzer . --compare-tokenizers openai-cl100k,openai-o200k,anthropic-claude
cates-analyzer tokenizers                # list supported tokenizers
```

The default tokenizer can also be set via `CATES_TOKENIZER=anthropic-claude`.

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
  cates-analyzer demo [options]
  cates-analyzer tokenizers [options]

Common analyze options:
  -f, --format <format>       pretty, json, sarif
  --policy <path>             .cates.yml/.json policy file
  --min-score <n>             quality gate
  --require-level <n>         require CATES Level 1, 2, or 3
  --fail-on <list>            e.g. critical,high
  --max-always-loaded <n>     token budget gate
  --tokenizer <name>          openai-cl100k (default), openai-o200k, anthropic-claude, approx
  --compare-tokenizers <list> side-by-side counts, e.g. openai-cl100k,anthropic-claude
  --files <list>              comma-separated relative files to analyze
  --individual                score each --files entry separately
  --fix / --fix-dry-run       safe mechanical fixes
```

`review` accepts local folders and GitHub URLs. For private repositories, authenticate with `gh auth login` and use `review`; CATES uses local GitHub CLI credentials instead of asking for tokens.

`demo` scans a built-in 100-repository manifest: 25 Microsoft, 25 GitHub, 25 Claude/Anthropic ecosystem, and 25 broader open-source repositories. Override it with `--repos-file repos.txt`, where each non-comment line is either a GitHub URL or `<category> <GitHub URL>`.

You can also run demo mode through the default command with `cates-analyzer --demo`.

Policy suppressions can be used for documented false positives or temporary accepted risk:

```yaml
suppressions:
  - ruleId: SEC004
    file: .github/copilot-instructions.md
    reason: Covered by organization-level prompt protection
    expires: 2026-12-31
```

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
│   └── tokenizer.ts          # cl100k_base tokenizer + context measurement
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

## 📋 Complete Rule Reference

All **42 rules** in the analyzer's catalog, grouped by dimension and sorted
by severity. The same data is available programmatically:

```bash
cates-analyzer rules --format json     # full machine-readable catalog
cates-analyzer explain SEC003          # full detail + remediation for one rule
```

Use the [`⚙️ Configuring CATES`](#%EF%B8%8F-configuring-cates) section to
turn any rule on/off or override its severity in `.cates.yml`.

> **Legend:** Severity follows CATES §9. **Autofix ✅** means
> `cates-analyzer . --fix` can apply a safe, mechanical change for this
> rule; `—` means the fix is manual.

### 🔐 Security (12 rules)

| Rule | Title | Severity | CATES § | Autofix |
|---|---|---|---|---|
| MCP002 | Secrets in MCP Configuration | Critical | Annex C | — |
| SEC001 | Hardcoded Secrets | Critical | 9.3 | — |
| MCP003 | Insecure MCP Endpoint | High | Annex C | — |
| MCP005 | Shell Operators in MCP Command | High | Annex C | — |
| SEC002 | Injection Vectors | High | 9.3 | — |
| SEC003 | Overly Permissive Scope | High | 9.3 | — |
| SEC005 | System Prompt Leakage Risk | High | 9.3 | — |
| SEC006 | Unsafe Execution Patterns | High | 9.3 | — |
| STP001 | Pipe-to-Shell Setup Pattern | High | Annex D | — |
| SEC004 | Missing Prompt Protection | Medium | 9.3 | ✅ |
| STP003 | Broad Setup Permissions | Medium | Annex D | — |
| HK003 | Outdated Hook Version | Low | Annex E | — |

### ⚡ Token Efficiency (10 rules)

| Rule | Title | Severity | CATES § | Autofix |
|---|---|---|---|---|
| TE004 | Forced Verbosity | High | 9.2 | — |
| TE006 | Cross-File Duplication | High | 9.2 | — |
| PRM002 | Oversized Prompt File | Medium | Annex B | — |
| TE001 | Excessive Always-Loaded Token Count | Medium | 9.2 | — |
| TE002 | Excessive Inline Code Examples | Medium | 9.2 | — |
| TE005 | Negative Constraint Spam | Medium | 9.2 | — |
| TE007 | Within-File Duplicate Instructions | Medium | 9.2 | ✅ |
| HK002 | Heavy Hook Operation | Low | Annex E | — |
| STP002 | Missing Dependency Caching | Low | Annex D | — |
| TE003 | Generic Filler Instructions | Low | 9.2 | — |

### 🎯 Specificity (7 rules)

| Rule | Title | Severity | CATES § | Autofix |
|---|---|---|---|---|
| SPC001 | Vague Language | Medium | 9.4 | — |
| SPC002 | Missing Project Context | Medium | 9.4 | — |
| MCP004 | Missing MCP Server Descriptions | Low | Annex C | — |
| PRM001 | Missing Prompt Purpose Header | Low | Annex B | ✅ |
| PRM003 | Excessive Hardcoded File Paths | Low | Annex B | — |
| SPC003 | Missing Architecture Structure | Low | 9.4 | — |
| SPC004 | Long Abstract Instruction Block | Low | 9.4 | — |

### 📚 Completeness (10 rules)

| Rule | Title | Severity | CATES § | Autofix |
|---|---|---|---|---|
| CMP001 | No Configuration Content | High | 9.5 | — |
| CMP002 | Missing Essential Topics | Medium | 9.5 | — |
| MCP001 | Invalid MCP Config Syntax | Medium | Annex C | — |
| STP004 | Missing Test Framework Setup | Medium | Annex D | — |
| CMP003 | Monolithic Configuration File | Low | 9.5 | — |
| EDC001 | Invalid Editor Settings Syntax | Low | Annex F | — |
| EDC002 | AI Assistance Disabled Broadly | Low | Annex F | — |
| PRM004 | No Variables in Large Prompt | Low | Annex B | — |
| PRM005 | Prompt Library Sprawl | Low | Annex B | — |
| STP005 | Missing Linter Setup | Low | Annex D | — |

### ⚔️ Conflict & Reachability (2 rules)

| Rule | Title | Severity | CATES § | Autofix |
|---|---|---|---|---|
| CNF001 | Contradictory Instructions | High | 9.6 | — |
| HK001 | Interactive Hook | Medium | Annex E | — |

### 🛡️ Harness Quality (1 rule)

| Rule | Title | Severity | CATES § | Autofix |
|---|---|---|---|---|
| CNF002 | Missing Harness Element | Medium | 9.6 | — |

### Rule ID prefixes

| Prefix | Surface |
|---|---|
| `SEC` | Core security checks across all configuration |
| `TE`  | Token-efficiency / waste pattern checks |
| `SPC` | Specificity / actionability checks |
| `CMP` | Completeness / topic-coverage checks |
| `CNF` | Conflict & reachability checks |
| `PRM` | Prompt-file checks (CATES Annex B) |
| `MCP` | MCP configuration checks (CATES Annex C) |
| `STP` | Setup-step checks (CATES Annex D) |
| `HK`  | Hook checks (CATES Annex E) |
| `EDC` | Editor configuration checks (CATES Annex F) |



## 🔖 Versioning & Releases

This package follows [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).
Releases are automated by
[release-please](https://github.com/googleapis/release-please) from
[Conventional Commits](https://www.conventionalcommits.org/) on `main`:

- `feat:` → MINOR bump
- `fix:` / `perf:` → PATCH bump
- `feat!:` or `BREAKING CHANGE:` → MAJOR bump

The full policy (including how the CATES standard document is versioned
separately from the analyzer) is in [`VERSIONING.md`](./VERSIONING.md), and
all releases are recorded in [`CHANGELOG.md`](./CHANGELOG.md).

## License

MIT. See [LICENSE](LICENSE).
