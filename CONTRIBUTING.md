# Contributing

Thank you for your interest in contributing to **cates-analyzer**! This document explains how to
propose changes and the legal requirements for contribution.

## Contributor License Agreement (CLA)

This project welcomes contributions and suggestions. Most contributions require you to agree to a
Contributor License Agreement (CLA) declaring that you have the right to, and actually do, grant us
the rights to use your contribution. For details, visit <https://cla.opensource.microsoft.com>.

When you submit a pull request, a CLA bot will automatically determine whether you need to provide
a CLA and decorate the PR appropriately (e.g., status check, comment). Simply follow the
instructions provided by the bot. You will only need to do this once across all repos using our CLA.

## Code of Conduct

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/)
or contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## Reporting security issues

Please do **not** file security vulnerabilities as public GitHub issues. See [SECURITY.md](SECURITY.md)
for the proper disclosure process.

## Developing

Prerequisites:

- Node.js 20 or newer
- npm 10 or newer

Set up and verify a clean checkout:

```bash
npm install
npm run typecheck:all
npm test
npm run build
```

Other useful scripts:

- `npm run lint` — type-checks both the CLI and the service workspace (acts as our lint pass).
- `npm run test:coverage` — runs the Vitest suite with coverage.
- `npm pack --dry-run` — previews the published tarball.

## Pull requests

1. Fork the repo and create a topic branch from `main`.
2. Make focused, minimal changes. Keep unrelated refactoring out of the PR.
3. Add or update tests for any behavior changes.
4. Run `npm test` and `npm run build` locally and confirm both pass.
5. Open a PR against `main`. Include a clear description of the change and the motivation.

## Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/) where reasonable
(e.g., `feat:`, `fix:`, `chore:`, `docs:`, `perf:`, `refactor:`, `test:`). This repository uses
[release-please](https://github.com/googleapis/release-please) to automate releases from
conventional commits.

## Trademarks

See the **Trademarks** section in the [README](README.md#trademarks) for the policy on use of
Microsoft trademarks and logos.
