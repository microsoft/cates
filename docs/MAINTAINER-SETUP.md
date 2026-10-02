# Maintainer setup and assurance

This runbook covers [branch protection (#34)](https://github.com/microsoft/cates/issues/34),
[first-release publishing (#35)](https://github.com/microsoft/cates/issues/35), and
[OpenSSF assurance (#36)](https://github.com/microsoft/cates/issues/36).
Owner: **@msfttoler**, with a repository administrator for administrative changes.
Reviewed **2026-10-02 UTC**.

Repository changes prepare controls; they do **not** install branch protection,
publish artifacts, register a badge, or certify a Scorecard result. Keep each
issue open until its external acceptance criteria are verified.

## Main branch protection

The ready-to-apply GitHub REST payload is
[`.github/main-branch-protection.json`](../.github/main-branch-protection.json).
It requires an up-to-date PR, one approving code-owner review, stale-approval
dismissal, approval after the latest reviewable push, resolved conversations,
linear history, and all three CI/CodeQL checks. It applies to administrators and
blocks force pushes and deletion.

The required checks are bound to the GitHub Actions application (`15368`), not
just their display names. Those application IDs and check names were verified
against successful checks on `main`. Regression tests also bind the names to
the CI matrices; update the protection payload when intentionally renaming jobs.

### Administrator activation

1. Verify that the account has repository administrator permission. Repository
   write permission and an existing ruleset bypass do not provide this permission.

   ```bash
   gh api repos/microsoft/cates --jq '.permissions.admin'
   ```

2. Review existing protections and export the current rulesets before changing
   them. The following PUT replaces classic branch-protection settings; merge in
   any additional existing controls rather than unintentionally weakening them.
   Apply the reviewed payload as an administrator:

   ```bash
   gh api --method PUT repos/microsoft/cates/branches/main/protection \
     --input .github/main-branch-protection.json
   gh api repos/microsoft/cates/branches/main/protection
   ```

3. Ensure reviews can actually be supplied. The current `CODEOWNERS` has only
   `@msfttoler`; that account cannot approve its own PR. Add another authorized
   code owner, or have changes authored by another contributor, before relying
   on this review path. Do not introduce an automatic bypass to work around it.

4. Only after protection is active, replace or narrow ruleset `17221683`
   (`Only msfttoler can update branches`) so normal topic-branch creation and
   reviewed merges are not blocked by its broad creation/update restrictions.
   Review the separate tag ruleset `17221684` when granting a release identity
   tag-creation access; do not weaken tag immutability incidentally.

5. Verify with a disposable test PR, using an identity without bypass:
   a failing required check must block merging, and missing required review must
   block merging after the checks pass. Confirm stale approvals are dismissed
   and a new push needs another review. Record the observations in #34.

6. Run `ossf-scorecard` and record the resulting `BranchProtectionID` status.
   Do not close #34 based solely on a successful API response. If organizational
   policy requires emergency bypass, document its narrowly authorized actor,
   permitted circumstances, and audit procedure; this payload grants none.

## First release and npm trusted publishing

The workflows now reject publishing from a branch, a mismatched tag, inconsistent
package/lockfile versions, or a prerelease into the stable distribution channel.
The preflight runs before dependency installation or registry login. Both npm and
container publishing can be retried manually against the **existing release tag**.

Automatic npm publishes use **OIDC only**. A bootstrap token is read only when an
operator explicitly chooses `bootstrap=true` on a manual `npm-publish` run.
The default is false; there is no silent token fallback.

### Maintainer bootstrap

1. Configure `RELEASE_PLEASE_TOKEN` with a dedicated, least-privilege identity
   authorized to update release PRs and create release tags under the repository
   rules. A suitable fine-grained token or GitHub App identity must have only the
   repository permissions needed for contents and pull requests. Do not copy an
   interactive `gh` OAuth token with broad repository access into this secret.
   Arrange a rotation/expiry process for the selected credential.

2. Configure the `npm-publish` GitHub environment with appropriate reviewers and
   release-tag restrictions. Obtain a short-lived granular npm token authorized
   for the initial `cates-analyzer` publication, and store it as `NPM_TOKEN` in
   that environment. Do not put the token in files, commands committed to git,
   issue comments, or logs.

3. After these workflow changes are merged, run release-please on `main`:

   ```bash
   gh workflow run release-please.yml --repo microsoft/cates --ref main
   ```

   Review and merge the resulting release PR normally. Its tag must agree with
   `package.json`, both lockfile version fields, and the generated release.
   The release workflow reports missing credentials and fails an explicit
   manual request when release automation is disabled.

4. The first automatic npm attempt may fail because the package has no trusted
   publisher yet. Select the tag created in the previous step for the one-time
   bootstrap. Replace `vX.Y.Z` below with that actual tag (the
   `cates-analyzer-vX.Y.Z` convention is also accepted):

   ```bash
   gh workflow run npm-publish.yml --repo microsoft/cates \
     --ref vX.Y.Z --field bootstrap=true
   ```

5. On npm, configure this package's trusted publisher with GitHub owner
   `microsoft`, repository `cates`, workflow **`npm-publish.yml`**, and environment
   **`npm-publish`**. Permit direct `npm publish`: this workflow does not implement
   staged publication. Verify that the workflow's Node 24 installation supplies
   an OIDC-capable npm CLI (11.5.1 or newer).

6. Verify OIDC with the next legitimate version release, with bootstrap false
   and no publish token supplied to the normal step. npm versions are immutable;
   attempting to republish the bootstrap version is not an OIDC acceptance test.
   After a successful OIDC publish, delete the environment's `NPM_TOKEN`, revoke
   the bootstrap token at npm, and restrict traditional token publishing on npm:

   ```bash
   gh secret delete NPM_TOKEN --repo microsoft/cates --env npm-publish
   ```

### Artifact acceptance

For the actual version, verify all of the following before closing #35:

- The version tag points to the reviewed release commit and a GitHub Release exists.
- `npm view cates-analyzer@X.Y.Z version dist --json` resolves publicly and exposes
  the expected provenance/attestation metadata. Verify an installed package's
  signatures with `npm audit signatures`; do not substitute package existence
  for provenance verification.
- The successful npm workflow contains the CycloneDX SBOM artifact.
- `docker buildx imagetools inspect ghcr.io/microsoft/cates:X.Y.Z` and the same
  command for `:latest` show both `linux/amd64` and `linux/arm64`. Inspect the
  attached provenance and SBOM attestations, not just the image tags.
- A subsequent publish succeeded through OIDC without a long-lived write token.

If container publication needs recovery, dispatch `container-publish.yml` with
`--ref` set to the same release tag. Do not retag a different commit or delete an
immutable npm version to retry. Update README distribution status only after
the actual artifacts have been verified.

## Managed-fuzzing decision

**Decision proposed for maintainer review:** defer managed coverage-guided
fuzzing for this release; use bounded, reproducible input-mutation and invariant
tests alongside the existing targeted regressions. This is not a claim that
deterministic testing finds every bug or that Scorecard detects these tests as
managed fuzzing.

Jazzer.js is maintained and its current documentation supports ESM on Node
20.6+ and the relevant LTS/native platforms. Language incompatibility is **not**
the reason to defer it. Jazzer.js/ClusterFuzzLite would add a native fuzzing
toolchain, instrumented harnesses, and corpus/crash ownership. This PR does not
yet establish the incremental coverage or defect yield of that infrastructure
relative to the existing parser/input-boundary tests.

The implemented compensation is `tests/input-boundaries.test.ts`:

| Boundary | Invariants exercised |
| --- | --- |
| JSON/JSONC, YAML and frontmatter | Stable acceptance/rejection, mapping roots, bounded body output, no global prototype pollution; unexpected runtime exception types fail |
| YAML/JSON policies | Equivalent normalized settings, finite numeric settings and filtered severities across generated cases |
| Configuration discovery | Consistent path classification and supported surface inventory, without executing discovered resources |
| GitHub URL/ref parsing | Deterministic rejection or safe owner/repository/ref/subpath components |
| JSON/SARIF/text reports | Lossless message/path round trips and bounded text rendering for quotes, controls, Unicode and markup |

The mutation seed is `0xca7e5`. Each mutation run includes its seed inputs plus
128 generated inputs capped at 2,048 characters; the policy test adds 64
generated cases. Existing fixtures seed the parser/report cases. These tests run
on every normal CI job and can be reproduced with:

```bash
npm test -- tests/input-boundaries.test.ts
```

A failing assertion identifies its boundary and case index. Re-run with the
same fixed seed, reduce the input, and add a literal regression to the relevant
test suite before fixing the defect. Do not silently remove the case or increase
timeouts to hide a failure. Follow `SECURITY.md` for security-sensitive findings.

**Residual risk:** the finite corpus does not explore arbitrary depths, all
filesystem states, long-running resource exhaustion, or native dependencies.
`FuzzingID` stays visible. @msfttoler must explicitly approve and record the risk
decision in #36; merely merging unrelated code does not constitute acceptance.
Review within 90 days of that approval, and sooner after a parser/resource-limit
incident or an expansion of untrusted-input surfaces.

Before adopting managed fuzzing, demonstrate instrumented coverage of the
actual shipped ESM code; cap PR fuzzing at two minutes per target with a hard job
timeout; schedule a separately bounded deeper run; seed from current fixtures;
and preserve reproducible crashes and regression inputs. Do not add an empty
fuzzing workflow solely to improve a Scorecard number.

## Best Practices badge

**Status: not registered; no badge level claimed.** The public project lookup
returned no registration for `https://github.com/microsoft/cates` at review time.
Registration and self-certification must be completed by an authorized
maintainer; no GitHub token should be forwarded to the badge site.

Register through the [OpenSSF Best Practices site](https://www.bestpractices.dev/).
Use the repository URL, MIT license, contributor/CLA and conduct policies,
`SECURITY.md` disclosure channel, build/test instructions, and the actual release
and review controls as evidence. Mark unmet criteria honestly; do not claim
published artifacts or active branch protection from a prepared workflow/config.
Record the project ID in #36, replace the README status with the site's real
badge linked to that registration, and review the resulting Scorecard finding.

## Primary references

- [GitHub branch-protection REST API](https://docs.github.com/en/rest/branches/branch-protection)
- [npm trusted publishers](https://docs.npmjs.com/trusted-publishers/)
- [Jazzer.js and supported platforms](https://github.com/CodeIntelligenceTesting/jazzer.js)
- [Jazzer.js fuzz targets and ESM](https://github.com/CodeIntelligenceTesting/jazzer.js/blob/main/docs/fuzz-targets.md)
- [OSS-Fuzz JavaScript integration](https://google.github.io/oss-fuzz/getting-started/new-project-guide/javascript-lang/)
- [OpenSSF Best Practices criteria](https://www.bestpractices.dev/en/criteria/0)
