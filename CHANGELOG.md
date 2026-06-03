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
