# Versioning Policy

This repository ships two artifacts that are versioned **independently**:

| Artifact | Version source | Versioning scheme |
| --- | --- | --- |
| `cates-analyzer` npm package + Docker image + Helm chart appVersion | `package.json` / git tags (`vX.Y.Z`) | [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html) |
| CATES standard document (`CATES-v1.0.md`) | Header of the spec document | Standalone `MAJOR.MINOR.PATCH[-status]` |

A new revision of the standard does not automatically produce a new
analyzer release, and vice versa. When the analyzer adds support for a new
version of the standard, that's a `feat:` on the analyzer side.

---

## SemVer for `cates-analyzer`

Given a version `MAJOR.MINOR.PATCH`:

- **MAJOR** — incompatible changes to:
  - CLI flags, subcommands, or exit codes (removal / breaking rename)
  - JSON or SARIF output schemas in ways that break existing consumers
  - The programmatic API exported from `dist/index.js`
  - Default rule behavior that would cause a previously passing repo to
    fail with no config change
- **MINOR** — backward-compatible functionality:
  - New CLI flags / subcommands / output fields
  - New rules that are off by default, or new opt-in rule severities
  - New output formats
  - Tokenizer additions
- **PATCH** — backward-compatible fixes:
  - Bug fixes in scoring / parsing / rendering
  - Documentation-only changes shipped with the package
  - Internal refactors with no observable behavior change

### Pre-1.0 vs post-1.0

The package is already at `1.0.0`, so the stability guarantees above apply.
Breaking changes require a `MAJOR` bump and a migration note in
`CHANGELOG.md`.

---

## Conventional Commits

Releases are automated by
[release-please](https://github.com/googleapis/release-please). The commit
message **prefix** drives the next version:

| Commit prefix | Bumps | Appears in CHANGELOG |
| --- | --- | --- |
| `feat:` | MINOR | ✅ Features |
| `fix:` | PATCH | ✅ Bug Fixes |
| `perf:` | PATCH | ✅ Performance Improvements |
| `revert:` | PATCH | ✅ Reverts |
| `docs:` | — | ✅ Documentation |
| `refactor:` | — | ✅ Code Refactoring |
| `build:` / `ci:` / `chore:` / `test:` / `style:` | — | hidden |

A commit that contains `BREAKING CHANGE:` in its body, or uses the `!`
shorthand (e.g. `feat!: drop --legacy-format`), triggers a **MAJOR** bump.

### Examples

```text
feat(cli): add --baseline flag to compare against previous report
fix(tokenizer): handle empty input without throwing
feat(rules)!: change default severity of MCP-001 from warn to error

BREAKING CHANGE: repositories that previously passed with MCP-001 warnings
will now fail unless `.cates.yml` lowers the severity.
```

---

## Release flow

1. Land Conventional Commits on `main`.
2. `release-please` opens / updates a **Release PR** that bumps
   `package.json`, updates `CHANGELOG.md`, and updates
   `.release-please-manifest.json`.
3. Merging the Release PR:
   - Tags the commit `vX.Y.Z`
   - Creates a GitHub Release with the changelog excerpt
4. (Future) Tag pushes can drive npm publish and Docker image tagging.

---

## Tagging conventions

- Git tags: `vMAJOR.MINOR.PATCH` (e.g., `v1.2.0`).
- Docker images should be tagged with the same `vMAJOR.MINOR.PATCH`, plus
  rolling `MAJOR.MINOR`, `MAJOR`, and `latest` aliases on stable releases.
- Helm chart `appVersion` tracks the analyzer version; the chart's own
  `version` follows SemVer for chart-shape changes.

---

## Versioning the CATES standard

`CATES-v1.0.md` carries its own version in the document header (currently
`1.0.0-draft`). Changes to the standard follow the same SemVer intent but
are released as document revisions, not as npm releases. When the standard
graduates from `-draft` or moves to `1.1.0` / `2.0.0`, update the document
header and reference the new version explicitly in analyzer release notes.

## Experimental rules and dimensions

Experimental rules and dimensions (currently cache-shaping `CS0xx` and
output-shaping `OS0xx`, marked 🧪 in the catalog) are **exempt from SemVer**.
They MAY change behavior, change severity, be renumbered, or be removed in any
**minor** release without a breaking-change bump, because they are off by
default, carry zero scoring weight, and never affect `score.overall`,
conformance, or CI gates. Automation MUST NOT depend on experimental rule IDs or
the `result.experimental` channel for gating. An experimental rule graduates to
stable only by being assigned a non-zero weight and admitted to conformance —
which changes default scores and therefore requires a **major** release.
