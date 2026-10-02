# CATES Review Workflows

## Goal

CATES should review the right configuration surface no matter where it lives: a local folder, a cloned private repository, a public GitHub URL, a branch folder link, a file link, or a pull request.

The core design principle is separation of concerns:

1. **Source resolution** determines where the review target comes from.
2. **CATES analysis** evaluates the resolved folder against the standard.
3. **Reporting and gates** produce the same JSON, SARIF, dashboard, and CI outcomes regardless of source.

## Recommended commands

For the complete pictured walkthrough, start with the
[illustrated user guide](USER-GUIDE.md#choose-the-input).

If you are running from the source checkout before the package is installed globally or published, use:

```bash
npm run --silent review -- https://github.com/OWNER/REPO
npx tsx src/cli/index.ts review https://github.com/OWNER/REPO
```

Do not pass `review` or a GitHub URL to `tsc`/`npm run typecheck`; TypeScript will interpret them as root source files.

### Local or private repository already cloned

This is the safest and most reliable workflow for private code:

```bash
cates-analyzer review /path/to/private/repo --format json > report.json
```

No repository content leaves the machine. No personal access token is passed to CATES.

### Private GitHub repository

Use the GitHub CLI for authentication:

```bash
gh auth login
cates-analyzer review https://github.com/OWNER/PRIVATE-REPO --format json
```

CATES uses `gh repo clone` when available, so credentials stay in the GitHub CLI credential store rather than in command arguments, config files, logs, or environment variables.

### Public repository

```bash
cates-analyzer review https://github.com/OWNER/REPO
```

### Branch or folder URL

```bash
cates-analyzer review https://github.com/OWNER/REPO/tree/main/path/to/folder
```

The tool clones the repository, checks out the requested ref, and analyzes the linked folder.

### File URL

```bash
cates-analyzer review https://github.com/OWNER/REPO/blob/main/.github/copilot-instructions.md
```

The tool selects the exact file and retains its canonical repository-relative
path. Siblings are not implicitly included. The report describes the selected
scope; it is not an assessment of the rest of the repository.

### Pull request URL

```bash
cates-analyzer review https://github.com/OWNER/REPO/pull/123 --require-level 2
```

For private pull requests, authenticate with `gh auth login` first.
This checks the PR checkout's configuration, not only files changed by the PR.

## Better private repo patterns

For private repositories, the best workflow depends on the trust boundary.

| Pattern | Best for | Why |
|---|---|---|
| **Local clone** | Sensitive repos, regulated environments | No network beyond the user's existing clone; easiest to reason about. |
| **GitHub CLI clone** | Private GitHub repos | Uses existing `gh` auth; avoids handling tokens directly. |
| **GitHub Action in the repo** | Continuous governance | Runs inside the repository boundary and can upload SARIF/artifacts. |
| **Self-hosted runner** | High-security organizations | Keeps clone, analysis, and reports inside corporate infrastructure. |
| **GitHub App service** | Centralized SaaS-style governance | Best at scale, but requires careful app permissions and data-handling controls. |

The default recommendation is: **run CATES where the code already is**. For private repositories, avoid asking users to paste tokens or upload archives unless there is a formal service boundary and clear data policy.

## Failsafes

Remote review should preserve CATES' security posture:

- Use `gh` or Git credential helpers instead of command-line tokens.
- Clone into temporary folders and delete them by default.
- Support `--keep-worktree` only for debugging.
- Never execute repository code during source resolution or analysis.
- Treat linked file paths as analysis hints, not shell input.
- Verify resolved paths stay inside the cloned repository boundary.
- Prefer local analysis or in-repo CI for private and regulated code.

## Future polish

High-value enhancements:

1. Add `--changed-only` for pull requests that focuses findings on touched CATES-relevant files while still computing repository context.
2. Add GitHub Action examples that publish SARIF and dashboard-ready JSON artifacts.
3. Add a GitHub App mode for organization-wide scheduled reviews with least-privilege repository access.
4. Add GitHub Enterprise host support via `--github-host`.
5. Add authenticated archive download as an alternative to cloning for very large repositories.
