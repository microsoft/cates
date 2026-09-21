# Contributing

Thank you for your interest in contributing to **cates-analyzer**! This document explains how to
propose changes and the legal requirements for contribution.

## Contributor License Agreement (CLA)

All contributions must be made subject to Microsoft's Contributor License Agreement ("CLA"). When
you submit a pull request on GitHub, the CLA check will determine whether you need to sign the CLA
and will provide instructions. If contributing outside GitHub, sign the Microsoft CLA before
submitting your contribution.

## Code of Conduct

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).

## Reporting security issues

Please do **not** file security vulnerabilities as public GitHub issues. See [SECURITY.md](SECURITY.md)
for the proper disclosure process.

## Developing

Prerequisites:

- Node.js 22.12 or newer
- npm 10 or newer

Set up and verify a clean checkout:

```bash
npm ci
npm run typecheck:all
npm run test:coverage
npm run build
```

Other useful scripts:

- `npm run lint` — type-checks both the CLI and the service workspace (acts as our lint pass).
- `npm run test:coverage` — runs the Vitest suite with coverage.
- `npm run release:check` — runs release validation and previews the npm tarball.
- `npm pack --dry-run` — previews the published tarball.

Keep dependencies current within their supported release lines. The Node
types stay on the oldest supported runtime major (22) to prevent accidental
use of newer runtime APIs; patch and minor updates within that major are
expected. Prerelease dependency versions are not adopted for stable releases.

## Pull requests

1. Fork the repo and create a topic branch from `main`.
2. Make focused, minimal changes. Keep unrelated refactoring out of the PR.
3. Add or update tests for any behavior changes.
4. Run `npm run release:check` locally and confirm it passes.
5. Open a PR against `main`. Include a clear description of the change and the motivation.

## Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/) where reasonable
(e.g., `feat:`, `fix:`, `chore:`, `docs:`, `perf:`, `refactor:`, `test:`). This repository uses
[release-please](https://github.com/googleapis/release-please) to automate releases from
conventional commits.
