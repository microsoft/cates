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

## [1.2.0](https://github.com/microsoft/cates/compare/cates-analyzer-v1.1.0...cates-analyzer-v1.2.0) (2026-06-02)


### Features

* **core:** add analyzeInMemory() entry point for in-memory analysis ([44e9341](https://github.com/microsoft/cates/commit/44e93415be68ca4c1f8d748eec6400a96e0f0845))
* **policy:** configurable rule and dimension toggles ([38f26fe](https://github.com/microsoft/cates/commit/38f26fe904a8288fa2b3fb7326ec466aceb971d1))
* **service:** Azure Functions wrapper, SWA deploy, rule-toggle drawer ([03f7129](https://github.com/microsoft/cates/commit/03f7129de481ca1d0ea9df360c9bea5ad6c89c08))
* **service:** HTTP service with paste / scan / rules endpoints ([2648e5a](https://github.com/microsoft/cates/commit/2648e5ae6528c39286433be5c85382adbc457044))
* **service:** SPA frontend, ACA Bicep, Dockerfile + README ([a7293a1](https://github.com/microsoft/cates/commit/a7293a1aae746fb857932343adc0acaebf91ce18))


### Bug Fixes

* **deps:** bump brace-expansion to 5.0.6 (GHSA dependabot alert) ([b3847f7](https://github.com/microsoft/cates/commit/b3847f75b195ebba09d95a92cbe425d22f36766d))
* **security:** close TOCTOU race and disambiguate regex precedence (CodeQL) ([6f230ae](https://github.com/microsoft/cates/commit/6f230ae18e3f09bbedf90cc79aa198f7a4383089))
* **security:** validate GitHub URL components against argv injection (CWE-88) ([be9907f](https://github.com/microsoft/cates/commit/be9907fafd9e2edb54ef831a8aa0bce54e5a0d74))
* **security:** wrap policy parse errors and enable CodeQL scanning ([7237d12](https://github.com/microsoft/cates/commit/7237d12141a3a28de2fe2e03ac56896084a47bbe))
* **service:** move inline script to app.js so CSP doesn't block clicks ([7c5c74a](https://github.com/microsoft/cates/commit/7c5c74aa5858996fae4c397797c7ff63771fb0b0))


### Documentation

* add Microsoft Open Source compliance baseline ([95cba17](https://github.com/microsoft/cates/commit/95cba1741b2127f3501e135f93b133d5051f99c6))
* **readme:** add complete 42-rule reference grouped by dimension ([c721ea0](https://github.com/microsoft/cates/commit/c721ea029657d510a6fd7124d6449bb87247e5ce))
* **readme:** install in quick start, toggle docs, what's next, features ([15011ba](https://github.com/microsoft/cates/commit/15011ba29a0d1ea43de8ec91bf72c70a3f7a69cb))


### Code Refactoring

* **deploy:** make service deployable to ACA or App Service, no auto-deploy ([c558860](https://github.com/microsoft/cates/commit/c5588604902d5acd4d3aad8eb5d575b273695e9b))

## [1.1.0](https://github.com/microsoft/cates/compare/cates-analyzer-v1.0.0...cates-analyzer-v1.1.0) (2026-06-02)


### Features

* **core:** add analyzeInMemory() entry point for in-memory analysis ([44e9341](https://github.com/microsoft/cates/commit/44e93415be68ca4c1f8d748eec6400a96e0f0845))
* **policy:** configurable rule and dimension toggles ([38f26fe](https://github.com/microsoft/cates/commit/38f26fe904a8288fa2b3fb7326ec466aceb971d1))
* **service:** Azure Functions wrapper, SWA deploy, rule-toggle drawer ([03f7129](https://github.com/microsoft/cates/commit/03f7129de481ca1d0ea9df360c9bea5ad6c89c08))
* **service:** HTTP service with paste / scan / rules endpoints ([2648e5a](https://github.com/microsoft/cates/commit/2648e5ae6528c39286433be5c85382adbc457044))
* **service:** SPA frontend, ACA Bicep, Dockerfile + README ([a7293a1](https://github.com/microsoft/cates/commit/a7293a1aae746fb857932343adc0acaebf91ce18))


### Bug Fixes

* **deps:** bump brace-expansion to 5.0.6 (GHSA dependabot alert) ([b3847f7](https://github.com/microsoft/cates/commit/b3847f75b195ebba09d95a92cbe425d22f36766d))
* **security:** close TOCTOU race and disambiguate regex precedence (CodeQL) ([6f230ae](https://github.com/microsoft/cates/commit/6f230ae18e3f09bbedf90cc79aa198f7a4383089))
* **security:** validate GitHub URL components against argv injection (CWE-88) ([be9907f](https://github.com/microsoft/cates/commit/be9907fafd9e2edb54ef831a8aa0bce54e5a0d74))
* **security:** wrap policy parse errors and enable CodeQL scanning ([7237d12](https://github.com/microsoft/cates/commit/7237d12141a3a28de2fe2e03ac56896084a47bbe))
* **service:** move inline script to app.js so CSP doesn't block clicks ([7c5c74a](https://github.com/microsoft/cates/commit/7c5c74aa5858996fae4c397797c7ff63771fb0b0))


### Documentation

* add Microsoft Open Source compliance baseline ([95cba17](https://github.com/microsoft/cates/commit/95cba1741b2127f3501e135f93b133d5051f99c6))
* **readme:** add complete 42-rule reference grouped by dimension ([c721ea0](https://github.com/microsoft/cates/commit/c721ea029657d510a6fd7124d6449bb87247e5ce))
* **readme:** install in quick start, toggle docs, what's next, features ([15011ba](https://github.com/microsoft/cates/commit/15011ba29a0d1ea43de8ec91bf72c70a3f7a69cb))


### Code Refactoring

* **deploy:** make service deployable to ACA or App Service, no auto-deploy ([c558860](https://github.com/microsoft/cates/commit/c5588604902d5acd4d3aad8eb5d575b273695e9b))

## [1.0.0] - 2026-05-05

Initial release of the `cates-analyzer` CLI and the CATES v1.0.0-draft
standard.

### Features

- Static analyzer for coding-agent configuration surfaces (instructions,
  prompt files, MCP configs, hooks, editor settings).
- Scoring across token efficiency, security, and CATES conformance — with
  zero LLM calls.
- Per-family tokenizer support (OpenAI cl100k / o200k, Claude, approximate
  fallback).
- File-scoped analysis and savings projections.
- Demo scan mode and token-only metrics.
- `review` subcommand for GitHub repos, branch folders, files, and pull
  requests.
- Output formats: human-readable text, JSON, SARIF.
- Docker image (non-root Alpine) and Helm chart for AKS / Kubernetes
  (CronJob / Job, Workload Identity, NetworkPolicies, persistent reports
  volume, ConfigMap-mounted `.cates.yml`).
