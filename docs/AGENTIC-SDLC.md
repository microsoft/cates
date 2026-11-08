# Agentic SDLC for CATES

One issue, one agent workstream, one PR, existing delivery gates. No new
orchestrator, hosted model, paid automation, or secret is required.
This is a human-triggered coding-agent lifecycle, not an unattended merge bot.

## Start here

1. Open an **Agent-ready task** using the issue template. Define observable
   acceptance criteria and non-goals before assigning implementation.
2. In a Copilot client supporting custom agents, select **CATES SDLC**.
   Run `/sdlc-plan` with the issue, then `/sdlc-implement` with the accepted
   contract. Prompt-file support varies by client; otherwise paste those prompt
   files into your coding agent. Repository instructions apply in either case.
3. Use `/sdlc-review` in a separate review conversation. Fix findings, then open
   a PR using the existing template. Agent review supplements human approval.
4. `msfttoler` reviews the current-head checks and authorizes merge.
   Existing release workflows take over; production actions retain their gates.

Local setup: `npm ci`. Complete handoff gate: **`npm run verify`**.
It checks runtime dependency advisories (blocking HIGH/CRITICAL), CLI/service
types, coverage thresholds, both builds, then packs and
installs the actual npm artifact into a temporary directory and runs its CLI.
The package smoke test needs registry access for runtime dependencies, never
publish credentials. Temporary installation is removed even on failure.

## Lifecycle and exit criteria

| Phase | Agent responsibility | Exit evidence / owner |
| --- | --- | --- |
| Discover and triage | Reproduce the problem; classify feature, bug, rule, docs or operational work; search for duplicates | Issue with user outcome, acceptance criteria, non-goals; maintainer prioritizes |
| Plan | Read affected code; identify contracts, tests, version impact and smallest solution | Accepted issue contract; high-impact unresolved decisions block implementation |
| Implement | Add regression coverage, change code and related docs together, run targeted checks | Focused diff and acceptance-criterion evidence |
| Verify and review | Run `npm run verify`; review failures and independent feedback | Actual commands/results, current-head CI/security/CLA status, resolved actionable review threads |
| Merge and release | Prepare conventional-commit summary, migration notes and release evidence | Authorized maintainer merges; release-please produces version/release PR |
| Publish and deploy | Verify package version, provenance/SBOM and runtime readiness; prepare rollback | Maintainer approves npm environment and any deployment; artifact-specific evidence |
| Operate and improve | Triage regressions, dependency PRs and scheduled security findings; measure outcomes | New bounded issues, release fixes and lessons incorporated into tests/instructions |

Each handoff should fit in a PR/issue comment: **outcome, criterion evidence,
commands/results, remaining risks, next owner**. Do not generate lengthy
transcripts or duplicate every file as context.

## Keep and connect the pieces already here

| Existing piece | Role in the lifecycle |
| --- | --- |
| Issue and PR templates, CONTRIBUTING, SECURITY, VERSIONING | Intake, contribution/legal requirements, private vulnerability reporting and compatibility policy |
| Vitest, Supertest, fixture tests, coverage thresholds | Regression and HTTP integration evidence, reused without relaxing assertions |
| `ci.yml` | Calls the same `npm run verify` developers use; includes the service build and packed-artifact smoke test |
| `codeql.yml`, `trivy.yml`, `scorecard.yml` | Code, image and supply-chain security; preserve triggers and failing-check behavior |
| Microsoft CLA integration | Contributor compliance; preserve the live integration and verify its status on the PR |
| Dependabot | Existing npm, Actions and Docker update proposals; use the same review and validation gates |
| release-please | Conventional commits, release PR, changelog and package version; analyzer and standard stay independently versioned |
| `npm-publish.yml`, `container-publish.yml` | Existing tag/manual publishing, protected environments, OIDC/provenance, SBOM and container delivery |
| `Dockerfile`, `deploy/`, maintainer setup runbook | Existing image/deployment assets and external activation requirements; no new infrastructure provisioned |

## Change-specific verification

- **Rules:** detection + catalog + positive/negative tests + standard/quick-reference
  docs. Assess default-score and conformance impact against `VERSIONING.md`.
- **CLI/API:** test exit codes, errors, schema and exports; use fixtures. The
  packed CLI smoke test prevents source-only success hiding package omissions.
- **Service:** Supertest covers routes and middleware; service build is required.
  UI changes additionally require browser interaction and responsive checks.
- **Dependencies/images:** inspect lockfile changes, run existing security scans,
  and check both runtime and bundled base-image packages.
- **Deployment:** use the existing target and assets only after authorization.
  Confirm health/readiness, a representative analysis request and error behavior.
  No deployment target is assumed or created by this configuration.
- **Docs-only:** check links/examples and claims; CI retains the full gate.

## Failed checks and recovery

First identify the exact check, run attempt and HEAD. Read the failing logs and
compare the affected configuration with the base branch. Classify the cause:

| Cause | Action |
| --- | --- |
| Change-caused | Regression test, minimal fix, validate, authorized push; recheck the new HEAD |
| Transient infrastructure | Narrow retry when authorized; record the failure and retry result |
| Pre-existing / external configuration | Link an existing follow-up or file one when authorized; disclose the blocker, do not fold unrelated work into the PR |
| Unknown | Gather evidence; do not call it flaky, green or pre-existing without support |

Never disable scanners, lower thresholds, hide errors, or bypass branch rules.
Historical CLA/image failures are not assumed still present: inspect live state.
Repeated identical failure notifications reuse the recorded disposition rather
than spawning another implementation loop. Do not publish vulnerability details
in public issues; follow `SECURITY.md`.

## Release, deployment and rollback gates

Before a release, confirm required checks on its actual commit, version policy,
release notes and any migration. Follow `docs/MAINTAINER-SETUP.md` for the existing
release token, trusted publishing and protection setup. GitHub-token-created
events do not necessarily trigger downstream workflows: verify the publish run
exists after a release.
If it does not, use the existing manual publish workflow on the intended release
tag, with maintainer authorization and the same environment gate. Do not add a
broad token just to chain workflows.

Environment approval is enforced only if configured in GitHub settings; a YAML
environment name alone does not create a required reviewer. Maintainers should
verify that `npm-publish` is protected and that repository rules restrict
push/merge as intended. This change does not modify remote permissions.

After publishing, confirm npm version, provenance and SBOM, install the released
package in a clean directory and run a representative analysis. Before deployment,
record the exact image digest and previous known-good digest. After deployment,
check health/readiness and the analysis path. If it fails, restore the previous
deployment artifact under the same authorization; npm recovery uses a reviewed
patch release rather than silently overwriting an immutable version.

## Small feedback loop

For each completed issue record: elapsed time to accepted PR, review/fix cycles,
escaped regressions, checks requiring retries and agent context/token usage when
the client exposes it. Missing telemetry is unknown, not zero. Start with issue/PR
timestamps and short handoff notes, not a new monitoring service.

Weekly, review existing Dependabot and scheduled security results, pick bounded
maintenance tasks, and remove instructions that do not change agent behavior.
Keep CLI integration tests scoped to one subprocess per test so cold-start costs
do not accumulate under a shared timeout. Preserve assertions and coverage gates.
Use CATES to inspect agent configuration as an advisory signal; do not make a
new score threshold a delivery gate until its behavior is understood.
