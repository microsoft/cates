# Changelog

All notable changes to the `cates-analyzer` package will be documented in
this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases are automated via
[release-please](https://github.com/googleapis/release-please) based on
[Conventional Commits](https://www.conventionalcommits.org/). See
[`VERSIONING.md`](./VERSIONING.md) for the full policy.

> Note: The **CATES standard** (`CATES-v1.0.md`) is versioned independently
> from this analyzer package. Changes to the standard document do not
> automatically produce a new analyzer release.

## Unreleased

### Features

* **copilot (experimental):** add an integrated, opt-in hygiene profile with 15
  checks across 11 configuration families. Wire CLI/review, library, policy,
  HTTP, catalogs, pretty/JSON/SARIF metadata and the hosted UI. Keep profile
  findings outside stable scores/gates; expose coverage and external checks.
* **economics (experimental):** add separate normalized-ledger accounting via
  `cates-analyzer economics`, `analyzeEconomics`, and `POST /api/economics`.
  Account for disjoint input/cache/output classes, reasoning subsets, all
  attempts and child calls, explicit rate provenance, reported charges,
  non-model costs, outcome denominators, and elapsed latency. Missing data
  remains unknown. Default scan rules, scores, output schemas, and gates are
  unchanged.
* **experimental:** add opt-in, non-normative cache-shaping (`CS001`–`CS005`) and
  output-shaping (`OS001`–`OS005`) dimensions behind `--experimental` /
  `--experimental-only` / `CATES_EXPERIMENTAL=1` / `experimental: true` in
  `.cates.yml`. These are **OFF by default, carry zero scoring weight, and are
  excluded from conformance and CI gates** — `score.overall` and conformance are
  byte-identical with the flag on or off. Findings live in a separate
  `result.experimental` channel and are **SemVer-exempt**.
* **optimizer:** `cates-optimize --experimental` surfaces the estimated
  cache/output token impact as advisory opportunities (never auto-applied, so the
  no-loss-of-function guarantee is preserved).

### Build System

* Bind npm and container publishing to matching stable release tags and
  lockfile versions. Use OIDC-only automatic npm publication, with an explicit
  manual bootstrap step and tag-bound recovery workflows.
* Add tested main-branch protection configuration for administrator activation
  and fixed-seed input-boundary mutation coverage in normal CI.
* Require Node.js 22.12 or newer and use Node.js 24 for release and container
  builds.
* Upgrade stable direct dependencies, including Chalk 6, TypeScript 7, and
  Vitest 5.
* Pin GitHub Actions to current full-length commit SHAs.
* Publish multi-architecture GHCR images with provenance and an SBOM on release
  tags.
* Keep CLI and SARIF version metadata synchronized with `package.json`.
* Preserve both executable entry points during npm publication and declare
  public registry and repository provenance metadata.

### Bug Fixes

* Parse JSONC without corrupting URLs or string contents; accept valid trailing
  commas, inspect local settings, and parse instruction scope as YAML.
* Preserve repository-relative classification for GitHub folder URLs and select
  exact files for file URLs. Correct the hosted setup-workflow paste location.
* Surface discovery omissions and bound reads/BPE work on pathological text.
  Keep unknown token counts distinct from measured zero in the Copilot report.
* Normalize in-memory paths, reject duplicate/unsafe inputs, enforce UTF-8 byte
  limits, and avoid temporary-path leakage in service responses.
* Correct setup permission advice: checkout normally needs `contents:read`, not
  a standing write grant for the agent.

### Documentation

* Document administrator/release activation, artifact acceptance, the managed
  fuzzing risk decision, and the actual unregistered Best Practices badge status.
* Add the Copilot hygiene usage/coverage contract, dated primary references,
  target-specific limitations, check catalog, and graduation requirements.
* Add CATES Annex L and the comprehensive end-to-end economics contract,
  lifecycle coverage matrix, synthetic ledger, normalization guidance,
  uncertainty model, and graduation protocol.
* Clarify that stable rules and deterministic detection do not establish
  empirical precision or economic benefit; remove unsupported universal price,
  confidence-band, and behavior-preservation claims. Experimental static
  messages now express uncertainty without changing detections or weights.
* Synchronize Helm release metadata and current test and coverage figures.

## 1.2.0 (2026-06-02)


### Features

* **core:** add analyzeInMemory() entry point for in-memory analysis
* **policy:** configurable rule and dimension toggles
* **service:** HTTP service with paste / scan / rules endpoints
* **service:** SPA frontend, Dockerfile, and README


### Bug Fixes

* **deps:** bump brace-expansion to 5.0.6
* **security:** close TOCTOU race and disambiguate regex precedence
* **security:** validate repository URL components against argv injection
* **security:** wrap policy parse errors and enable static scanning
* **service:** move inline script to app.js so CSP doesn't block clicks


### Documentation

* **readme:** add complete 42-rule reference grouped by dimension
* **readme:** install in quick start, toggle docs, what's next, features


### Code Refactoring

* **deploy:** make service deployable from the same container artifact

## [1.0.0] - 2026-05-05

Initial release of the `cates-analyzer` CLI and the CATES v1.0.0-draft
standard.

### Features

- Static analyzer for coding-agent configuration surfaces (instructions,
  prompt files, MCP configs, hooks, editor settings).
- Scoring across token efficiency, security, and CATES conformance — with
  zero LLM calls.
- Per-family tokenizer support and approximate fallback.
- File-scoped analysis and savings projections.
- Demo scan mode and token-only metrics.
- `review` subcommand for repository URLs, branch folders, files, and pull
  requests.
- Output formats: human-readable text, JSON, SARIF.
- Docker image and Helm chart.
