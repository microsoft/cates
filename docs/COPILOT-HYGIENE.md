# GitHub Copilot hygiene profile

**Status: experimental, non-scoring. Documentation snapshot: October 2, 2026.**

This profile extends the existing CATES scan with GitHub Copilot configuration
checks. It does not replace the vendor-neutral standard, create a new conformance
level, collect usage, execute integrations, or prove monetary savings.

The stable 49-rule, six-dimension scoring model and its gates remain separate.
Enabling this profile does not change the stable findings, score, recommendations,
or gates for the same input and options. Parser, source-selection, and resource
protection fixes described below also improve the default scan independently.

## Run it end to end

```bash
# Source checkout
npm run build
node dist/cli/index.js . --copilot

# Installed CLI: optional target defaults to all
cates-analyzer . --copilot
cates-analyzer . --copilot cli --format json
cates-analyzer review https://github.com/OWNER/REPO --copilot cloud-agent
cates-analyzer . --copilot code-review
cates-analyzer . --copilot vscode

# Catalog, explanation, and explicit policy opt-out
cates-analyzer rules --copilot
cates-analyzer explain GHCP007
cates-analyzer . --no-copilot
```

Targets are `all`, `cli`, `cloud-agent`, `code-review`, and `vscode`. A target
selects relevant compatibility checks; it does **not** simulate a client,
filter the inventory to its effective configuration, or attest that a file loads.
VS Code Local and Agent Host sessions can differ even inside the same IDE.

Configure `.cates.yml`:

```yaml
copilot: all
rules:
  GHCP005: low
suppressions:
  - ruleId: GHCP008
    file: .github/hooks/local-only.json
    reason: Reviewed; this hook intentionally targets interactive CLI sessions.
    owner: developer-experience
    expires: "2026-12-31"
```

The existing rule/dimension overrides and dated, reason-bearing suppressions
apply to profile findings. Disabled and suppressed findings remain visible in
the separate report. They do not enter the stable score. `--no-copilot` overrides
an enabled policy. `--experimental` independently controls cache/output advice;
neither option implicitly enables the other.

Library:

```js
import { analyze, analyzeInMemory } from 'cates-analyzer';

const repository = await analyze({ repoPath: '.', copilot: 'all' });
const supplied = await analyzeInMemory({
  copilot: 'cli',
  files: [{
    path: '.github/agents/reviewer.agent.md',
    content: '---\ndescription: Review changes without editing\ntools: []\n---\nCheck correctness and report evidence.\n',
  }],
});
console.log(repository.copilot.coverage, supplied.copilot.findings);
```

HTTP: both `/api/analyze` and `/api/scan` accept
`"policy": { "copilot": "all" }`. HTTP overrides use the existing long form, for
example `"rules": { "GHCP005": { "severity": "low" } }`. Suppressions and
`experimental: true` are also accepted. `/api/rules` returns `copilotChecks`
separately from the unchanged `rules` catalog.

In the hosted UI, choose a **Copilot hygiene profile** before Paste or Scan.
Selecting a Copilot-specific primitive enables the profile if it was off.
The result separates the stable score, advisory findings, coverage, skipped
files, and external verification. Rule toggles and exported `.cates.yml` retain
the profile choice. No active core-scan files is shown as **not assessed**, not
as a successful assessment.

## Coverage matrix

These are candidate locations checked by this implementation, not a promise
that every Copilot surface consumes every file.

| Surface | Candidate locations | Static assessment |
| --- | --- | --- |
| Instructions | `.github/copilot-instructions.md`, `.github/instructions/**/*.md`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `REVIEW.md` | Body, frontmatter syntax, instruction suffix, `applyTo`, `excludeAgent`; nested conventional instruction names are inventoried |
| Agents | `.github/agents/**/*.{md,yml,yaml}`, `.claude/agents/**/*.md`, legacy `.github/chatmodes/` | Required CLI/cloud description, metadata types, tools, invocation controls, body limit, legacy locations, client-specific metadata |
| Skills | `.github/skills/`, `.claude/skills/`, `.agents/skills/` | Immediate skill directory, exact `SKILL.md`, name/directory agreement, description, body, tool-preapproval review |
| Prompts | `.github/prompts/**/*.md` | `.prompt.md` suffix, selected header types, tool-list type, session/client compatibility note |
| Hooks | `.github/hooks/*.json`; inline hooks in recognized settings and legacy manifests | Envelope/version, known events and aliases, handler arrays, matcher groups, command/exec/HTTP/prompt shapes, cloud portability |
| MCP | `.mcp.json` including nested candidates, `.github/mcp.json`, `.vscode/mcp.json`, plugin-convention root `mcp.json` | Wrapped/bare maps, local/remote transport, command/URL, arguments/tools, per-server execution and pinning signals |
| Settings | `.github/copilot/settings{,.local}.json`, `.claude/settings{,.local}.json`, `.vscode/settings.json` | JSONC, selected type checks, disabled hooks, broad approval signals, inline hooks, local-override visibility |
| Setup | `.github/workflows/copilot-setup-steps.yml`, `.github/workflows/copilot-code-review.yml` | YAML, canonical location, shared `copilot-setup-steps` job contract, steps, supported job keys, timeout, permission review |
| LSP | `.github/lsp.json` | Server map, command, arguments and extension/language mapping |
| Plugins | Root or `plugins/**/plugin.json`, `.github/plugin/{plugin,marketplace}.json`, `.claude-plugin/{plugin,marketplace}.json` | Basic portable/legacy manifest shape; inline legacy hooks/MCP/LSP |
| Extensions | `.github/extensions/**/*.{js,ts,mjs,cjs,mts,cts,json}` | Inventory and applicable existing content signals only; never loaded or executed |

The nested plugin convention is recognized under `plugins/`. This is **not**
complete plugin dependency discovery: configured component paths, executable
resources, marketplace contents, and namespace-specific resources are not
followed. Skill scripts and linked documents are likewise not traversed.
Personal directories are never scanned implicitly.

Optional files are not mandatory. A repository does not need MCP servers,
skills, plugins, hooks, or a setup workflow merely to obtain a clean report.
Missing integrations are shown as **not detected**, not as defects.

### Check catalog

| ID | What it checks |
| --- | --- |
| GHCP001 | Structured syntax and object/mapping roots |
| GHCP002 | Instruction applicability, exclusions and empty instruction bodies |
| GHCP003 | Canonical locations and client/session compatibility |
| GHCP004 | Custom-agent metadata, invocation controls and body constraints |
| GHCP005 | Tool breadth and skill preapproval review |
| GHCP006 | Skill discovery contract |
| GHCP007 | Hook envelope/event/handler configuration |
| GHCP008 | Hook execution assumptions and cloud compatibility |
| GHCP009 | MCP server shape and transport contract |
| GHCP010 | Execution, transport and credential hygiene |
| GHCP011 | Selected settings and approval hygiene |
| GHCP012 | Cloud/code-review setup workflow contract |
| GHCP013 | LSP and basic plugin/marketplace configuration |
| GHCP014 | Duplicate skill names and agent filename identities |
| GHCP015 | Existing secret, injection, unsafe-command and autonomy-bypass signals on additional files |

Each finding carries `stability: "experimental"` and a `basis`:
`documented` means grounded in the referenced configuration contract;
`heuristic` means a review signal, not proof of incorrect behavior or exploitation.
Neither is an empirically calibrated precision score.

Important distinctions:

* `tools: []` is valid and disables agent tools. Omitting tools or requesting
  `*` can intentionally inherit broad access; review it rather than auto-fixing it.
* CLI/cloud agents require description metadata. VS Code can omit the header and
  supports model-priority arrays; cloud/CLI configuration documents a single model.
* Tool names can come from extensions/MCP. Unknown identifiers are not rejected
  using a closed built-in-tool list. Availability is not an enforceable permission
  boundary.
* Hook support depends on client and session mode. Cloud does not run
  PowerShell-only or `exec`-only handlers. A prompt hook is not universal enforcement.
* A valid URL does not prove reachability, authentication, or allowlist approval.
  Loopback HTTP is distinguished from lookalike hosts such as `localhost.evil`.
* Pinning advice examines the launched package, not an unrelated later argument
  containing a version. It recognizes selected exact version formats; it does
  not resolve package-manager semantics, registries, hashes, or attestations.
* Setup needs only permissions actually required by its steps. Checkout generally
  needs `contents: read`; Copilot receives a separate operation token.
* Secrets and parser diagnostics do not echo credential values into profile
  findings. Pattern scanning is not a replacement for a dedicated secret scanner.

## Honest boundaries and resource limits

The stable scan and Copilot inventory have independent candidate budgets, so
new profile files cannot displace files used by the stable score. Existing file
contents/token counts are reused where possible.

Default bounds are 50 candidate files, depth 5, and 100,000 bytes per file.
`--max-files`, `--max-depth`, and the library's `maxFileSize` control those
bounds. Common generated/vendor directories (`node_modules`, `.git`, `dist`,
`build`, `vendor`, `__pycache__`) remain outside automatic discovery.

Discovery reports file/depth limits, unreadable paths, binary candidates,
oversized files, skipped symlinks, and unparseable instruction scope. Symlinks
are not followed during automatic traversal. Explicit selections are checked
against the real repository boundary.

BPE tokenization of very long unbroken strings can be disproportionately
expensive. Files containing more than 4,096 consecutive non-whitespace
characters are excluded from BPE-based core analysis with a
`tokenization-limit` diagnostic. Their text remains available to the profile's
structural checks, with `tokens: null`. Split embedded data, or explicitly use
`--tokenizer approx` without BPE comparisons to inspect them approximately.
No approximate value is silently substituted for a canonical BPE count.

`result.copilot` reports:

* `scope`: repository, selected files, selected directory, or supplied files.
* `completeness`: `complete-within-scope` or `partial`.
* Per-file status: `checked`, `inventory-only`, or `not-analyzed`.
* Coverage counts, diagnostics, findings, disabled/suppressed findings, and
  the required manual-verification checklist.

**Checked means a check ran, not that it passed. Complete-within-scope means
inventory completeness within these conventions and exclusions, not full
Copilot coverage, effective loading, security certification, or runtime success.**
Malformed configuration can have a complete inventory and high-severity findings.
An empty core scan's historical numeric score is not a coverage claim.

GitHub file URLs select the requested file, not its siblings. Folder URLs
retain repository-relative paths while restricting traversal to the selected
directory. This preserves `.github/...` classification. Supplied files are
not treated as an entire real repository, and unrecognized supplied paths are
explicitly marked unassessed. The HTTP service validates UTF-8 byte limits
and rejects duplicate normalized paths before writing temporary inputs.

## Reporting, gates, fixes and economics

Pretty and JSON reports expose the complete separate profile. SARIF keeps
advice in `runs[0].properties.copilot`, **not** code-scanning `results`, so
experimental hygiene does not accidentally become a stable alert or gate.
Discovery limitations also appear in SARIF run properties.

The optimizer and safe-fix commands do not auto-apply profile recommendations.
Tool permissions, hook behavior, agent metadata and setup changes require review.
Portfolio, demo and conformance workflows retain their stable scope; use
`analyze`/`review` for this profile.

Static token counts describe source size, not tokens actually loaded, cached,
generated or billed. The separate [economics assessment](TOKEN-ECONOMICS.md)
measures supplied workflow usage, retries, accepted outcomes and costs. A
configuration improvement is a hypothesis until representative task evaluation
and before/after economics support it.

## External verification remains mandatory

The report always marks these areas **not assessed**:

| Area | Evidence to obtain |
| --- | --- |
| Organization/enterprise controls | Feature/model policies; feature-specific content-exclusion support; data handling, retention, public-code matching and audit settings |
| Effective configuration and trust | User/organization instructions, managed settings, environment/CLI overrides, custom search locations, tool sets, trust, saved approvals and sandboxing |
| Runtime integrations | Actual loading, installed versions/binaries, authentication, tool availability, hook outputs/timeouts and harmless representative execution |
| Plugin/skill resource closure | Referenced code/resources, custom component paths, namespace contents, provenance, installation and updates |
| Cloud/code-review deployment | Branch availability, setup logs, secret scopes, runner isolation, firewall, review settings and fallback setup |
| Quality and economics | Build/test/lint outcomes, accepted-task evaluation, retries, latency and normalized usage/cost records |

Future graduation requires versioned client fixtures, runtime compatibility
evidence, measured false positives/negatives, reviewable migrations, and an
explicit scoring/governance decision. This profile must not silently graduate
into scored requirements as client documentation changes.

## Primary references

Checked October 2, 2026. These are mutable documentation pages, not a claim
that all installed client versions implement the same features.

* [Instruction support](https://docs.github.com/en/copilot/reference/custom-instructions-support)
* [Repository instructions](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions)
* [Custom-agent configuration](https://docs.github.com/en/copilot/reference/custom-agents-configuration)
* [VS Code agents](https://code.visualstudio.com/docs/agent-customization/custom-agents)
* [Agent skills](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills)
* [Hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference)
* [MCP configuration](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers)
* [CLI configuration scopes](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference)
* [LSP configuration](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/add-lsp-servers)
* [Plugin reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference)
* [Cloud setup](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/customize-the-agent-environment)
* [Code-review environment](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/request-a-code-review/use-code-review#customizing-copilot-code-reviews-environment)
* [VS Code prompt files](https://code.visualstudio.com/docs/agent-customization/prompt-files)
* [VS Code approvals](https://code.visualstudio.com/docs/agents/run/approvals)
