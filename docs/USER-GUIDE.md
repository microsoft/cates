# CATES: the illustrated user guide

**Start with a configuration scan. Add Copilot advice when you need it. Bring
usage records when you want actual cost accounting.** These are different
questions, not three scores to add together.

![Three CATES paths: stable configuration scoring, optional experimental static advice, and separate usage accounting.](images/feature-map.png)

## Choose your task

| I want to... | Start here |
| --- | --- |
| See CATES work in a few minutes | [First run](#first-run) |
| Understand a score and decide what to fix | [Read the report](#read-the-report) |
| Check a local repo, GitHub URL, file, folder or PR | [Choose the input](#choose-the-input) |
| Check Copilot instructions, agents, skills, hooks and tools | [Copilot hygiene](#copilot-hygiene) |
| Explore cache and output-efficiency ideas | [Experimental static advice](#experimental-static-advice) |
| Calculate the cost of an accepted task | [Token economics](#token-economics) |
| Preview or apply mechanical fixes | [Fix and optimize](#fix-and-optimize) |
| Set policy, suppress findings, or fail CI | [Policy and CI](#policy-and-ci) |
| Save reports or compare tokenizers | [Reports and tokenizers](#reports-and-tokenizers) |
| Review several repositories | [Portfolio and demo scans](#portfolio-and-demo-scans) |
| Use buttons instead of a terminal | [Browser walkthrough](#browser-walkthrough) |
| Integrate the engine into another tool | [HTTP API](#http-api) or [JavaScript library](#javascript-library) |
| Run in a container or on a schedule | [Docker and Helm](#docker-and-helm) |
| Look up a flag or troubleshoot | [Command reference](#command-reference) and [Troubleshooting](#troubleshooting) |

## First run

**Prerequisites:** Git, Node.js 22.12 or newer, and npm 10 or newer. No model
subscription, provider API key, or LLM call is needed. Installing dependencies
needs network access; the subsequent local scan does not.

```bash
git clone https://github.com/microsoft/cates.git
cd cates
npm ci
npm run build
node dist/cli/index.js examples/quickstart
```

Already in a checkout? Start at `npm ci`. All commands in this guide run from
the **CATES checkout root**, unless stated otherwise. The source-checkout path
does not depend on npm or GHCR release availability.

The [sample input](../examples/quickstart/.github/copilot-instructions.md) is a
fictional TypeScript API configuration with one deliberately repeated test
instruction. CATES reports that duplication as `TE007`, along with any other
findings. Nothing in the sample is executed.

![Actual CLI scan of the quick-start example, showing the score, discovered configuration, token counts and six dimension scores.](images/cli-scan.png)

*This is real, excerpted output. Values can change with rules, policy and
tokenizer selection; the example is not a promise of a findings-free scan.*

Next, replace the example path with your repository:

```bash
node dist/cli/index.js /path/to/your-repo
```

If you have installed the package, `cates-analyzer` replaces
`node dist/cli/index.js`, and `cates-optimize` replaces
`node dist/optimizer/cli.js`. The rest of the arguments stay the same.

## Read the report

![Cropped browser result overview for the sample: score and finding counts, always-loaded tokens and dimension details.](images/browser-report.png)

Read a report in this order:

1. **Scope and omissions.** Confirm that the intended files were actually checked.
   Read discovery diagnostics before trusting a score.
2. **Findings.** Inspect critical/high findings first, then the relevant file,
   rule, evidence and suggested action. A high overall score can coexist with
   important findings.
3. **Always-loaded tokens.** This is the measured size of configuration classified
   as always loaded, not a complete runtime prompt or a vendor bill.
4. **Dimension scores.** Use these to locate weak areas, not to prove safety.
5. **Recommendations and estimates.** Treat static token-impact and retry-savings
   projections as prioritization aids, not measured economic gains.

| Stable dimension | Weight | Main question |
| --- | --- | --- |
| Security | 25% | Are there suspicious secrets, permissions or unsafe instructions? |
| Token efficiency | 25% | Is configuration redundant or unnecessarily verbose? |
| Specificity | 15% | Are instructions actionable and project-specific? |
| Completeness | 15% | Are important engineering topics covered? |
| Conflict and reachability | 10% | Do instructions conflict or obstruct unattended work? |
| Harness quality | 10% | Are scope, verification, output and failure handling defined? |

The stable catalog contains **49 rules**. Inspect the explanation rather than
guessing from the identifier:

```bash
node dist/cli/index.js explain TE007
node dist/cli/index.js rules --format pretty
```

Static detections can need human interpretation. Disabling or suppressing a
finding changes the report; it does not remove the underlying risk.

## Choose the input

### Local repository

```bash
node dist/cli/index.js /path/to/your-repo
node dist/cli/index.js review /path/to/your-repo --format json
```

Local scanning discovers recognized configuration files, not every source-code
file. Surfaces include root and nested agent instructions, path instructions,
prompt/command files, agents, editor rules, MCP, settings, hooks and setup
configuration. Common ecosystems include Copilot, Claude, Cursor, Gemini,
Windsurf, Cline, Roo and generic `.ai` configuration.

### GitHub repository, folder, file or pull request

Replace `OWNER`, `REPO`, `main`, and the path/PR number with your actual target:

```bash
node dist/cli/index.js review https://github.com/OWNER/REPO
node dist/cli/index.js review https://github.com/OWNER/REPO/tree/main/.github
node dist/cli/index.js review https://github.com/OWNER/REPO/blob/main/AGENTS.md
node dist/cli/index.js review https://github.com/OWNER/REPO/pull/123
```

An `https://github.com/...` URL also works in place of the path in the default
analyze command. GitHub review needs network access and Git.

- A **file URL** selects that exact file, not its siblings.
- A **folder URL** scans that subtree while keeping repository-relative paths.
- A **PR URL** checks out the PR and scans its configuration; it is not a
  changed-lines-only review.
- Clones are temporary and removed by default. `--keep-worktree` retains one for
  debugging, which also retains the downloaded content.
- Use `gh auth login` for private repositories, or scan an existing local clone.
  `review --no-gh` selects Git instead of the GitHub CLI.

Prefer a local clone for sensitive material. GitHub Enterprise hosts and
`--changed-only` are not implemented. See [review workflows](REVIEW-WORKFLOWS.md)
for the source-resolution and private-repository details.

### Select individual configuration files

```bash
node dist/cli/index.js /path/to/your-repo --files 'AGENTS.md,.mcp.json'
node dist/cli/index.js /path/to/your-repo \
  --files 'AGENTS.md,.mcp.json' --individual --format json
```

Paths are relative to the selected repository. `--individual` returns a separate
result per file, so JSON is an **array**, not a single analysis result. It cannot
be combined with SARIF or autofix. The comma-separated CLI flag is not suitable
for a filename containing a comma; use an exact GitHub file URL or the
supplied-file library/API interface instead.

### Bound the scan

Defaults are `--max-files 50` and `--max-depth 5`. Increase deliberately when
the report says the intended scope was not fully assessed:

```bash
node dist/cli/index.js /path/to/your-repo --max-files 100 --max-depth 8
```

Unreadable, oversized, binary, symlinked and resource-limited inputs are not
equivalent to passing inputs. Copilot coverage exposes omissions explicitly;
unknown token counts remain distinct from zero.

## Copilot hygiene

Use this when the question is **"Is my GitHub Copilot configuration well
formed and appropriate for its target?"**

```bash
node dist/cli/index.js /path/to/your-repo --copilot
node dist/cli/index.js /path/to/your-repo --copilot cli
node dist/cli/index.js /path/to/your-repo --copilot vscode
node dist/cli/index.js /path/to/your-repo --copilot cloud-agent
node dist/cli/index.js /path/to/your-repo --copilot code-review
```

`--copilot` means all targets. `--no-copilot` overrides an enabled policy.
The profile is **experimental, opt-in and non-scoring**. It adds a separate
`result.copilot` report without changing stable scores, conformance or CI gates.

| Configuration family | Typical candidate |
| --- | --- |
| Instructions | `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md`, `AGENTS.md` |
| Agents | `.github/agents/*.agent.md` |
| Skills | `.github/skills/review/SKILL.md` |
| Prompts | `.github/prompts/review.prompt.md` |
| Hooks | `.github/hooks/*.json` |
| MCP | `.mcp.json`, `.vscode/mcp.json` |
| Settings | `.github/copilot/settings.json`, `.vscode/settings.json` |
| Setup workflows | `.github/workflows/copilot-setup-steps.yml`, `copilot-code-review.yml` |
| LSP | `.github/lsp.json` |
| Plugins | `plugin.json` and recognized plugin/marketplace manifests |
| Extensions | `.github/extensions/` |

There are **15 advisory checks**, `GHCP001` through `GHCP015`. They cover
syntax, locations, metadata, tool breadth, hook execution assumptions, MCP
transport/credentials, settings, setup contracts, collisions and existing
security signals on additional surfaces. Discovery is broader than the short
example-path list above.

![Copilot report for an intentionally invalid skill: separate advisory findings, an eleven-family coverage table, and unassessed runtime checks.](images/copilot-report.png)

*Screenshot input: `SKILL.md` contains `name: wrong-name`, no description, and
the body "Review the changes." It is deliberately invalid.*

**Checked means examined, not passed.** `complete-within-scope` describes the
bounded inventory. It does not certify organization policy, installed tools,
activation, authentication, executable dependencies or runtime behavior.
These remain visible manual checks.

```bash
node dist/cli/index.js rules --copilot --format pretty
node dist/cli/index.js explain GHCP006
```

The [Copilot hygiene reference](COPILOT-HYGIENE.md) documents all checks,
target differences, discovery patterns, coverage states and limitations.

## Experimental static advice

Use this for **cache/output design ideas** before you have production usage data:

```bash
node dist/cli/index.js /path/to/your-repo --experimental
node dist/cli/index.js /path/to/your-repo --experimental-only
node dist/cli/index.js /path/to/your-repo --copilot --experimental
```

Five cache-shaping checks (`CS001`-`CS005`) and five output-shaping checks
(`OS001`-`OS005`) examine patterns such as volatile prefixes, unconstrained
output and full-file rewrite mandates. They live in `result.experimental`.
`--experimental-only` changes the displayed section, not the underlying stable
gate semantics.

These checks have zero scoring weight and no conformance effect. A static
pattern does not establish a cache hit, current provider price, actual runtime
output size, or proven savings. Enable them in policy with `experimental: true`
or in the environment with `CATES_EXPERIMENTAL=1`.

See [cache and output shaping](EXPERIMENTAL-CACHE-OUTPUT-DIMENSIONS.md).

## Token economics

Use this when you have **usage, prices/charges, task outcomes and other costs**.
It is a separate assessment, not another configuration score.

```bash
node dist/cli/index.js economics examples/economics.json
node dist/cli/index.js economics examples/economics.json --format json
```

![Actual output from the synthetic ledger: model cost USD 0.01308, total cost USD 0.53808, one accepted task, and separate non-model costs.](images/economics.png)

The [worked ledger](../examples/economics.json) is explicitly synthetic:

| Reading | Meaning in this example |
| --- | --- |
| Model cost: **USD 0.01308** | Estimated model usage across all four captured requests |
| Total cost: **USD 0.53808** | Model usage plus supplied tools, compute, human review and adjustments |
| Accepted tasks: **1 of 2 terminal tasks** | The denominator is accepted delivery, not merely successful API calls |
| Cost per accepted task: **USD 0.53808** | Includes captured work that did not produce an accepted task |

For your data, replace the example ledger, keep `schemaVersion: 1`, and normalize
to its contract. CATES accounts for input, cache reads/writes, output and
reasoning subsets; retries and failed/cancelled requests; parent/child work;
model/purpose attribution; recorded latency; reported versus estimated charges;
and tool, compute, storage, network, human-review and adjustment costs.

**Do not add token subsets twice:** cached input is part of input and reasoning
is part of output. Parent records must contain exclusive request usage, not
already-totaled child usage. Missing coverage stays unknown, not zero.

There is no automatic telemetry collector, invoice importer, price fetcher,
currency conversion, causal ROI claim or runtime economics browser dashboard.
Use the [complete ledger contract](TOKEN-ECONOMICS.md), not a vendor response
copied directly into the input. The same calculation is available through
`analyzeEconomics()` and `POST /api/economics`.

## Fix and optimize

### Start with a preview

The dedicated optimizer **writes by default**, so first run:

```bash
node dist/optimizer/cli.js examples/quickstart \
  --dry-run --only dedupe-lines,whitespace
```

![Actual optimizer dry-run table: the duplicated sample line can reduce active tokens from 238 to 228 and findings from four to three; nothing has been written.](images/optimizer-preview.png)

The table compares the existing input with a proposed rewrite. The sample
contains a duplicate on purpose; your repository may have no mechanical
savings. A token reduction is not a measured dollar reduction.

| Optimizer | Behavior |
| --- | --- |
| `dedupe-lines` | Removes later exact duplicate instruction lines |
| `dedupe-blocks` | Removes later identical multi-line blocks |
| `whitespace` | Removes trailing whitespace and excessive blank lines, preserving code fences |
| `remove-filler` | Removes recognized standalone platform-default filler |

The tool verifies meaningful-instruction-set equality and code-block byte
identity, then re-scores the candidate. Its "lossless" wording refers to those
implementation checks; it is **not proof of unchanged agent behavior**.
Review the diff and run your own checks. `--skip remove-filler` excludes the
filler assumption.

### Apply deliberately to your repository

```bash
node dist/optimizer/cli.js /path/to/your-repo --dry-run
node dist/optimizer/cli.js /path/to/your-repo --backup
```

Start from a clean worktree. `--backup` writes sibling `.orig` files; do not
accidentally commit backups containing private material. Other options:

```bash
node dist/optimizer/cli.js --list-optimizers
node dist/optimizer/cli.js /path/to/your-repo --dry-run --skip remove-filler
node dist/optimizer/cli.js /path/to/your-repo --dry-run --format json
node dist/optimizer/cli.js /path/to/your-repo --dry-run --experimental
```

`--experimental` only adds advisory opportunities; it does not apply cache/output
advice or Copilot findings. Secret removal, restructuring, re-scoping and
semantic rewriting remain human work.

### Analyzer autofix is a different entry point

```bash
node dist/cli/index.js /path/to/your-repo --fix-dry-run
node dist/cli/index.js /path/to/your-repo --fix
```

This runs the analyzer's supported rule-specific fixes, which can include adding
guidance. It is not identical to the dedicated optimizer. Both commands return
a fix report; review it and perform a fresh scan after applying.

To reuse a single-repository analysis with the dedicated optimizer:

```bash
node dist/cli/index.js /path/to/your-repo --format json > report.json
node dist/optimizer/cli.js --report report.json --dry-run
```

Keep the report and repository aligned. An `--individual` JSON array is not a
valid optimizer baseline.

## Policy and CI

Put `.cates.yml`, `.cates.yaml` or `.cates.json` at the **target repository root**.
Use `--policy /path/to/policy.yml` to select another file.

```yaml
minScore: 80
requireLevel: 1
failOn: [critical]
maxAlwaysLoadedTokens: 1500
copilot: all
experimental: true
rules:
  TE004: low
  GHCP005: { enabled: true, severity: low }
suppressions:
  - ruleId: TE007
    file: .github/copilot-instructions.md
    reason: Repetition is intentional for this reviewed example
    owner: platform-team
```

To expire a temporary suppression, add an `expires` date in `YYYY-MM-DD` format.
Choose a real review deadline; expired suppressions are reported.

YAML/file policy supports `off`, `on`, severity shorthand and the long form
`{ enabled, severity }`. Entire dimensions can be configured under `dimensions`.
Rule overrides take precedence over dimension overrides. Only disable checks
after understanding the coverage you are giving up.

```bash
node dist/cli/index.js /path/to/your-repo \
  --min-score 80 --fail-on critical,high --max-always-loaded 1500
node dist/cli/index.js conformance /path/to/your-repo --require-level 2
```

| Conformance level | Main conditions; see the full reference for all requirements |
| --- | --- |
| 1 | Score at least 40, configuration present, no critical findings/hardcoded secrets |
| 2 | Level 1 plus score at least 70, no critical/high findings, at most 1,500 always-loaded tokens, prompt protection and no instruction contradictions |
| 3 | Level 2 plus score at least 90, at most 800 always-loaded tokens, only low/info findings, prompt purposes and MCP descriptions |

CLI gate values override file policy. Copilot and cache/output advice do not
participate in these gates. Thresholds are static configuration requirements,
not evidence of runtime safety or financial performance.

Use the same built CLI in CI and retain a report:

```bash
node dist/cli/index.js /path/to/your-repo \
  --format sarif --min-score 80 --fail-on critical > cates.sarif
```

Upload SARIF through your code-scanning integration; CATES produces the file but
does not upload it. Send JSON to your own report consumer. Preserve the command's
exit status rather than masking it with a successful pipeline.

Exit code `0` means the command completed and requested gates passed. `1` can
mean a failed gate **or a runtime/command error**; inspect stderr. `2` is used
for CLI usage validation and invalid economics input. Some subcommands report
validation failures as `1`, so a nonzero status alone is not a findings count.

See [conformance](CONFORMANCE.md) and [governance](GOVERNANCE-PLAYBOOK.md).

## Reports and tokenizers

```bash
node dist/cli/index.js examples/quickstart --format json > report.json
node dist/cli/index.js examples/quickstart --format sarif > report.sarif
node dist/cli/index.js examples/quickstart --quiet
```

`pretty` is the default human report. JSON preserves the analysis structure,
including separate experimental/profile channels. In SARIF, Copilot advice is
in `runs[0].properties.copilot`, **not** native SARIF alerts.

**Evidence-filtering limitation:** `--no-evidence` requests fewer snippets, but
the current implementation does not honor it consistently across all checks;
for example, `TE007` can still include evidence. Do not use it as a redaction
boundary. Review and sanitize report paths, messages and snippets before sharing.

```bash
node dist/cli/index.js tokenizers
node dist/cli/index.js examples/quickstart --tokenizer openai-o200k
node dist/cli/index.js examples/quickstart \
  --compare-tokenizers openai-cl100k,openai-o200k,anthropic-claude,approx
```

The canonical tokenizer determines scored token counts. Comparison tokenizers
add counts, not multiple scores. Available IDs are `openai-cl100k` (default),
`openai-o200k`, `anthropic-claude` and `approx`.

The Anthropic tokenizer is a legacy tokenizer and an approximation for later
models; `approx` is a character heuristic. No choice turns static configuration
into exact provider-billed usage. Use `CATES_TOKENIZER` for an environment default
and `tokenizers --format json` for the catalog.

## Portfolio and demo scans

**Portfolio** scans immediate child directories on disk:

```bash
node dist/cli/index.js portfolio fixtures
node dist/cli/index.js portfolio /path/to/repos --format json
```

It skips children without discovered configuration and summarizes scores,
conformance, findings and static estimates. It does not clone repositories or
combine runtime economics. It uses its own default scan path, not all the
`analyze` flags; run individual analyses for Copilot or custom policies.

**Demo** scans a supplied list of GitHub repositories. Create `repos.txt`:

```text
docs https://github.com/microsoft/cates
```

```bash
node dist/cli/index.js demo --repos-file repos.txt \
  --category docs --limit 1 --concurrency 1 --format json
```

The category is your label, not a fixed taxonomy. Concurrency is 1-8 (default 4);
`--fail-fast` stops on a repository failure. The default repository list is
empty, so **supply `--repos-file`**. `analyze --demo` is an alternate entry point.
Use repository URLs for this batch workflow; use `review` for precise file,
folder and PR selection.

Demo mode uses Git directly, not the `gh` preference used by `review`; private
batch scans need working Git authentication. A successful batch command is not
proof that every repository succeeded: inspect `reposFailed` and per-repo errors.
Portfolio/demo percentage fields remain static estimates, not organization-wide
savings measurements.

## Browser walkthrough

After the initial checkout and dependency installation:

```bash
npm run build:service
npm run service:start
```

Leave that terminal running and open **`http://localhost:8080`**.

![The actual local browser interface: Copilot profile selector, rule drawer, file-kind dropdown, content editor and Score it button.](images/browser-start.png)

1. Choose **Paste** and the correct file kind. The synthetic path affects which
   checks run; arbitrary Markdown is not interchangeable with a skill or MCP file.
2. Paste the [quick-start instructions](../examples/quickstart/.github/copilot-instructions.md)
   and click **Score it**.
3. Read the score, dimensions and findings. A paste is a supplied-file
   assessment, not an inspection of the rest of your repository.
4. For Copilot-specific advice, select the appropriate profile. Choosing some
   Copilot-specific paste kinds automatically enables the all-target profile.
5. Open **Rule & dimension toggles**, change the checks you need, and click
   **Score it** again. Changing a toggle does **not** automatically rescan.
6. Use **Show .cates.yml** or **Copy .cates.yml** to reuse the policy on disk.
   **Reset to defaults** clears toggles and turns the Copilot profile off.

![Actual exported YAML after choosing the CLI profile and disabling TE007 in the browser drawer.](images/policy-export.png)

The drawer provides enable/disable controls, not a severity editor. Edit
severity in the exported policy or use the API's long-form overrides. The
static cache/output toggle and runtime economics have no dedicated UI control;
use CLI, policy or API for those paths.

**Scan a repo** accepts a GitHub repository/folder/file/PR URL. The service uses
its host's credentials; your browser's GitHub login does not authenticate a
private clone. Prefer the local CLI for private code unless the service operator
has configured an approved trust boundary.

## HTTP API

With the service running, use a second terminal:

```bash
curl --fail-with-body http://localhost:8080/api/healthz
curl --fail-with-body http://localhost:8080/api/rules
curl --fail-with-body http://localhost:8080/api/analyze \
  -H 'content-type: application/json' \
  --data '{"files":[{"path":".github/copilot-instructions.md","content":"Use TypeScript. Run tests."}],"policy":{"copilot":"all"}}'
curl --fail-with-body http://localhost:8080/api/economics \
  -H 'content-type: application/json' --data-binary @examples/economics.json
```

| Endpoint | Request/result |
| --- | --- |
| `POST /api/analyze` | `{ files: [{path, content}], policy?, tokenizer? }` to `AnalysisResult` |
| `POST /api/scan` | `{ url, policy?, tokenizer? }` to `AnalysisResult`; GitHub only |
| `POST /api/economics` | Normalized ledger to the separate `EconomicsReport` |
| `GET /api/rules` | Rules, separate Copilot checks and live input limits |
| `GET /api/healthz` | Liveness |
| `GET /api/readyz` | Readiness, including shutdown state |

HTTP policy accepts rule/dimension **objects**, not YAML shorthand:

```json
{
  "copilot": "vscode",
  "experimental": true,
  "rules": { "TE004": { "severity": "low" } }
}
```

Threshold policy fields are accepted, but HTTP returns reports rather than
enforcing CLI exit-code gates. Evaluate gates in the caller. Analyze inputs are
limited to 50 files, 100,000 UTF-8 bytes per file and 1,000,000 total content bytes;
the server also limits JSON bodies. There is a 60 requests/minute per-IP rate
limit. Economics has its own bounded schema; see `ECONOMICS_LIMITS` and the
[ledger reference](TOKEN-ECONOMICS.md).

The service has no built-in authentication or tenant isolation. Do not expose
it as a public multi-tenant endpoint without your own access controls. Supplied
files and clones use temporary disk storage that is cleaned up; this is not a
RAM-only service. The application does not log submitted content or collect
telemetry, but it can log request metadata, and hosting infrastructure has its
own controls.

`PORT` changes the listener (default 8080). Operator settings include
`CATES_MAX_CONCURRENT_SCANS`, `CATES_SHUTDOWN_GRACE_MS`, `CATES_QUIET` and
`TRUST_PROXY`; configure proxy trust to match the actual deployment.

## JavaScript library

The public entry point is ESM. This example runs directly from the checkout:

```bash
node --input-type=module <<'JS'
import { analyze, createReport, evaluateGates } from './dist/index.js';

const result = await analyze({
  repoPath: 'examples/quickstart',
  copilot: 'all',
  experimental: true,
});
console.log(createReport(result, 'json'));
const gates = evaluateGates(result, { minScore: 80, failOn: ['critical'] });
if (!gates.passed) {
  console.error(gates.failures);
  process.exitCode = 1;
}
JS
```

After package installation, import from `cates-analyzer` instead. CommonJS
callers can use dynamic `import()`.

| Export | Purpose |
| --- | --- |
| `analyze()` | Analyze files in a repository |
| `analyzeInMemory()` | Analyze supplied relative paths and contents |
| `createReport()` | Produce pretty, JSON or SARIF output |
| `evaluateConformance()`, `evaluateGates()` | Explicitly evaluate policy in an integration |
| `RULE_CATALOG`, `getRule()` | Inspect stable/cache-output rule metadata |
| `COPILOT_CHECKS`, `getCopilotCheck()`, `formatCopilot()` | Inspect/render Copilot advice |
| `analyzeEconomics()`, `formatEconomics()` | Separate usage accounting |
| `EconomicsInputSchema`, `ECONOMICS_LIMITS` | Validate and bound accounting inputs |
| `optimize()`, `OPTIMIZERS`, `selectOptimizers()` | Run/select dedicated optimizations |
| `meaningfulSignature()`, `renderOptimizationReport()` | Optimizer invariant/report utilities |
| `ANALYZER_VERSION` and exported types | Version and typed integration contracts |

Library `analyze()` does not automatically load a `.cates.yml` or fail your
process. Supply options explicitly and invoke the evaluators you need.
Use `dryRun: true` when calling `optimize()` to preview changes.

## Docker and Helm

### Build and run the local image

Docker is optional. This command does not require a published GHCR image:

```bash
docker build -t cates-analyzer .
docker run --rm --read-only --tmpfs /tmp \
  -v "$PWD/examples/quickstart:/work:ro" cates-analyzer .
```

The image runs as a non-root user; the read-only filesystem here comes from the
explicit flag. Remote reviews need network access and writable temporary space.
For an approved private-repo workflow, forward an existing token with
`-e GH_TOKEN`, never by embedding its value in the command.

To run the service rather than the default CLI entry point:

```bash
docker run --rm --read-only --tmpfs /tmp -p 127.0.0.1:8080:8080 \
  --entrypoint /sbin/tini cates-analyzer \
  -- node /app/dist-service/service/server.js
```

### Run a scheduled or one-shot cluster job

The [Helm chart](../deploy/helm/cates/README.md) supports `CronJob` (default) and
`Job` modes, schedules, resources, security contexts, a mounted policy/repository
manifest, existing Secrets, identity annotations, optional network policy and
a reports volume.

Use an image accessible to your cluster and **set target arguments explicitly**.
The default demo arguments have no repository manifest and are not a useful
scan. The chart is a batch runner, not a browser/API service deployment.

Workload-identity annotations alone do not mint a GitHub token; a separate
approved exchange integration is required. A reports PVC alone does not capture
stdout, and CATES has no `--output` flag. Arrange log collection or an explicit
writer in your deployment. See the chart guide for truthful runnable patterns.

## Command reference

| Command | Key controls |
| --- | --- |
| `analyze [path]` (default) | `--format`, `--quiet`, `--policy`, `--files`, `--individual`, `--no-evidence`, `--max-files`, `--max-depth` |
| `analyze` / `review` | `--min-score`, `--require-level`, `--fail-on`, `--max-always-loaded`, `--tokenizer`, `--compare-tokenizers`, `--copilot`, `--no-copilot`, `--experimental`, `--experimental-only` |
| `analyze` only | `--fix`, `--fix-dry-run`; `--demo` with demo controls |
| `review <source>` | `--keep-worktree`, `--no-gh`; no dedicated optimizer/autofix pass |
| `economics <file>` | `--format pretty\|json` |
| `conformance [path]` | `--require-level`, `--policy`, `--format pretty\|json` |
| `rules` | `--copilot`, `--format pretty\|json` |
| `explain <ruleId>` | Stable, cache/output or Copilot rule explanation |
| `tokenizers` | `--format pretty\|json` |
| `portfolio [path]` | `--format pretty\|json` |
| `demo` | `--repos-file`, `--category`, `--limit`, `--concurrency`, `--fail-fast`, `--max-files`, `--max-depth`, `--format pretty\|json` |
| `completion [shell]` | `bash` or `zsh`; prints a script to stdout |
| Dedicated optimizer | `--dry-run`, `--backup`, `--only`, `--skip`, `--report`, `--experimental`, `--tokenizer`, `--policy`, `--max-files`, `--max-depth`, `--list-optimizers`, `--format markdown\|json` |

Get the installed build's exact help/version:

```bash
node dist/cli/index.js --help
node dist/cli/index.js analyze --help
node dist/cli/index.js --version
node dist/optimizer/cli.js --help
node dist/cli/index.js completion bash
node dist/cli/index.js completion zsh
```

The Node commands work from a checkout; completion scripts target installed
command names. Shell/environment examples use Bash/Zsh syntax; adapt environment
assignment and quoting for PowerShell.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| `cates-analyzer: command not found` | Use `node dist/cli/index.js` from the built checkout; no global install is assumed |
| `Cannot find module .../dist/...` | Run `npm ci` and `npm run build` from the CATES checkout |
| TypeScript treats a URL as an input file | Use the analyzer, not `tsc review` or `npm run typecheck -- review` |
| `No active core-scan files` | Check the input path/type and coverage; a skill-only paste can have Copilot findings without a core score |
| An A/A+ report still has findings | The score is weighted, not a statement that every rule passed |
| No Copilot advice appears | Enable `--copilot` or the browser selector and inspect recognized paths/coverage |
| Advice does not change the score | Expected: both experimental channels are non-scoring |
| A GitHub URL fails | Check access, ref/path, Git/gh authentication and connectivity; try a local clone |
| A batch scanned zero repositories | Supply `demo --repos-file`, or point `portfolio` at a directory containing configured child directories |
| HTTP returns `400`, `413` or `429` | Read the response: invalid input, request size or rate limits may apply |
| YAML shorthand fails over HTTP | Use `{ "enabled": false }` / `{ "severity": "low" }` objects |
| Evidence remains with `--no-evidence` | Some checks do not consistently honor the option; sanitize reports explicitly before sharing |
| Changes to UI toggles have no immediate result | Click **Score it** or **Scan** again |
| Optimizer makes no changes | There may be no eligible mechanical changes; inspect remaining manual opportunities |
| Economics returns unknown cost | Supply missing usage/rate/coverage data; do not substitute zero |
| The synthetic example looks like a real quote | It is a scenario, not current vendor pricing or an invoice |

For rule details use the [catalog](RULE-CATALOG.md). For maintainer-only features
including release safeguards, branch protection, fuzzing decisions and badge
status, use [maintainer setup](MAINTAINER-SETUP.md). These documents do not claim
that a prepared configuration is already active.

### About the pictures

Screenshots come from the real built CLI and local service using committed
sample inputs. Terminal images are excerpts, with local paths normalized.
The feature diagram is available as [SVG](images/feature-map.svg) and editable
[Excalidraw source](images/feature-map.excalidraw). They are documentation
illustrations, not additional product dashboards.

To regenerate, install Python Playwright, Pillow and Chromium in your documentation
environment. The image template requires Arial and Menlo; the generator checks
the fonts actually rendered and stops on substitution. Build both entry points,
start the local service, and run:

```bash
python3 scripts/generate-guide-images.py --base-url http://127.0.0.1:8080
```
