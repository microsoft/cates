# Pairing static assessment with runtime evidence

CATES is a static configuration analyzer, not a runtime enforcement plane.
Existing rules, scores, thresholds, conformance criteria and gates remain
unchanged. Reports include `assessment` metadata describing static scope,
discovery limits and policy exclusions. SEC004 still checks legacy non-disclosure
wording for compatibility; that wording does not protect secrets or enforce access.

## Optional records, not certification

Copy `examples/runtime-evidence.json` to a local file and replace the placeholders
with records from your own controlled evaluations:

```bash
cates-analyzer . --runtime-evidence runtime-evidence.json
cates-analyzer review https://github.com/OWNER/REPO --runtime-evidence runtime-evidence.json --format json
```

The CLI reads one regular JSON file up to 100,000 bytes. It never runs probes,
contacts models, fetches evidence references, or sends telemetry. The library
accepts the same object as `analyze({ repoPath, runtimeEvidence })` or
`analyzeInMemory({ files, runtimeEvidence })`. Both service endpoints,
`POST /api/analyze` and `POST /api/scan`, accept `runtimeEvidence` alongside
their normal input; it is not a policy setting. Service body limits still apply.

Records appear separately in pretty/JSON/SARIF output as **reported, not verified**.
The dashboard's optional runtime evidence file input attaches the same JSON with
your next scan and shows check statuses, unassessed kinds and outcome summaries.
Failed probes and
missing checks stay visible but **do not change static scores or gates**.
If runtime checks must block delivery, gate on your evaluation system's results,
not a CATES grade or a submitted claim of success.

Use only redacted records and artifact references: no secrets, raw sensitive
prompts, credentials or private transcript contents. Records are included in
reports and API responses; treat shared reports accordingly.

## What to collect

Use a disposable environment and synthetic data; do not test destructive
operations or real exfiltration against production.

| Check kind | Evidence to record |
| --- | --- |
| `effective-configuration` | Actual client/version, loaded instructions, precedence, effective tool/host permissions, sandbox and relevant backend authorization |
| `permission-allow` | A controlled permitted operation and the observed result |
| `permission-deny` | A controlled forbidden operation and the observed denial at the enforcing host/service boundary, not just model refusal |
| `task-acceptance` | Representative task execution and independent acceptance criteria, including tests and human review where needed |

Each check has a description and `pass`, `fail` or `not-run` status.
Pass/fail records require an evidence reference. At most 50 checks are accepted;
text fields are bounded to 512 characters. Missing and not-run check kinds are
explicitly unassessed. A passed probe establishes only the tested case, not
universal permission enforcement. CATES validates the record shape, not its truth.

`context` records the claimed revision, client, model and environment;
`recordedAt` must be an ISO timestamp with a timezone. **CATES does not verify
revision correspondence, freshness, client version, provenance or artifact
contents.** Independently confirm these match the configuration being assessed.
The example is an unexecuted template, not evidence of a passing system.

## Compare outcomes, not just shorter prompts

Optional `outcomes.baseline` and `outcomes.candidate` cohorts record revision,
task-suite identity, client, model, environment, attempted/accepted task counts,
total cost, currency, whether all attempts are included, and an evidence reference.
Acceptance must use the same criteria across both cohorts. Count unsuccessful,
abandoned and retried work in the costs; use the existing
[economics ledger](TOKEN-ECONOMICS.md) for request-level accounting.

CATES reports acceptance rate and cost per accepted task. Cost per accepted task
is **unknown (`null`)** if cost is missing, all attempts were not included, or
no task was accepted. Zero attempted tasks also yields an unknown acceptance rate.
Unknown is never replaced with zero cost or zero improvement.

A cost comparison is reported only when task-suite, client, model, environment
and currency labels match, the candidate matches the reported context, and both
cost rates are known. The delta is candidate minus baseline; negative means a
lower reported cost per accepted task. Matching labels alone do not control task
difficulty, workload mix or measurement error: this is a **descriptive comparison,
not causal savings, ROI or statistical evidence of improvement**.

## Compatibility

Legacy savings field names (`estimatedTokenWaste`, `tokenSavings`,
`conservativeTokensPerInvocation`, `projectedTokensPerInvocation`,
`estimatedTokensSavedPerInvocation`, `efficiencyGainPct`) remain available.
Their numeric calculations are unchanged; interpret them as static heuristics or
source-token changes, never measured runtime savings.

Optimizer `safety: "lossless"` and per-file `functionPreserved` remain legacy
text-check labels. `guarantee.noLossOfFunction` now returns **false**, because
behavioral equivalence was never established. Use
`guarantee.textPreservationChecksPassed` for structural-check status;
`guarantee.behaviorPreservation` is `"not-assessed"`, including no-change runs.
