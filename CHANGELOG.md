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
