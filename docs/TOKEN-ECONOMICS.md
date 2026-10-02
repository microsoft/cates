# End-to-End Token Economics

**Status:** Experimental, informative extension to CATES, Annex L.

**Contract:** Normalized ledger `schemaVersion: 1`.

**Compatibility:** No changes to the initial scan, stable rule catalog, weights,
grades, conformance levels, SARIF, or existing CI gates.

CATES is a **token economics standard**, not merely a smaller-prompts score.
Configuration analysis is the inexpensive first assessment. Full economics
requires connecting the complete execution cost to accepted, safe outcomes.
The extension makes that connection without pretending a static scan observes
runtime behavior.

## 1. Assessment layers

| Layer | Question | Evidence | Implementation |
|---|---|---|---|
| Core configuration scan | Is the configuration well structured and conformant? | Discovered bytes, declared tokenizer, static rules | Existing default scan, unchanged |
| Experimental static signals | Which cache/output practices warrant investigation? | Heuristic detections, not measured savings | Existing `--experimental` channel |
| Experimental runtime accounting | What did the captured work consume and cost? | Normalized request records, explicit prices/charges, outcome references | Separate `economics` command, library API, HTTP API |
| Validated optimization | Did an intervention improve cost at preserved quality and safety? | Controlled comparisons and representative outcome evaluation | Protocol specified below; no automatic benchmark runner or causal claim |

**Do not collapse these into one score.** Low token counts can reflect incomplete
work. High cost can be justified by better outcomes. A cache hit can save money
without reducing the number of context tokens. A high scan grade does not
establish task success, runtime security, lower spend, or return on investment.

`stable` means a compatibility/conformance commitment. It does not mean a rule's
precision or economic effect has been validated across workloads. New economic
heuristics remain experimental until the evidence supports stronger claims.

## 2. Lifecycle coverage and honest boundaries

This matrix is a coverage contract, **not a claim that every diagnostic is
automated**. “Accounted” means normalized records or supplied charges can
represent the cost. “Not measured” means that an adapter, additional data, or a
validated experiment is still needed.

| Economic surface | Existing scan / signals | Runtime extension | Still not measured or automated |
|---|---|---|---|
| Instructions, skills, agents, prompts, rules | Scope, size, duplication, quality, safety heuristics | Included in real request input | Agent-specific rendered loading and activation probabilities |
| User request, chat history, memory, retrieved context | Only repository configuration is inspected | Repeated/replayed context remains in each request's input | Token attribution to individual context sources |
| Tool schemas and tool responses | MCP descriptions, includes, permissions | Model input/output plus separately metered tool charges | Per-tool schema/result token breakdown and deferred-loading effectiveness |
| Cache read, write, expiry, eligibility | Experimental prefix signals | Separate cache subsets and explicit applicable rates | Measured hit causality, reuse distance, warm/cold cohorts, TTL optimizer |
| Output and hidden reasoning | Experimental output-contract signals | Output total; optional reasoning subset | Reasoning quality, optimal effort, or guarantees from shorter responses |
| Retries, errors, cancellation, repair | Guardrail/setup hints | Every attempt charged once; retry/status/purpose views | Automatic retry discovery, error classification, cancellation savings |
| Delegation, parallelism, handoffs | Agent definition checks | Exclusive child requests and parent references | Agent topology optimization or automatic fan-out limits |
| Compaction and summarization | No runtime measurement | Compaction requests and subsequent request usage | Break-even estimator or semantic-loss evaluation |
| Retrieval, embeddings, reranking, memory writes | Configuration hints only | `retrieval` requests; tools/storage charges | Recall/relevance metrics, index-build amortization, automatic adapters |
| Model routing, fallback, service tiers, context tiers | No economic routing judgment | Provider/model groups; caller-selected rate cards | Automatic tier selection, routing policy optimization, counterfactual prices |
| Images, audio, video, non-token units | Text tokenization is not a multimodal meter | Reported model-request charges; normalized provider token counts if meaningful | Modality-specific metering/adapters or one universal token exchange rate |
| Tool execution, sandbox/CI/GPU compute | Setup/hook configuration checks | Explicit tools/compute/network/storage charges | Resource metering, utilization, capacity or idle-time allocation |
| Human review and downstream rework | No labor measurement | Human-review charges; repair requests; evaluator evidence | Time tracking, defect attribution, automatic labor conversion |
| Pricing, discounts, credits, commitments, tax | No billing interpretation | Rate provenance, reported charges, signed adjustments | Invoice ingestion, billing reconciliation across accounts, FX, credit conversion |
| Acceptance, abandonment, quality, safety | Static conformance is only one input | Explicit task outcomes and evaluation references | Independent evaluation, defect/safety scoring, causal quality attribution |
| Latency, responsiveness, throughput | No runtime latency measurement | Request and task p50/p95 recorded elapsed times | Time to first token, queue time, critical paths, throughput under load |
| Team/repository allocation and governance | Policies, portfolio scans, suppressions | Declared cohort/window, task allocation, shared charges | Automatic organizational joins, budgets, anomaly detection, enforced runtime gates |
| Energy/carbon and sustainability | Not measured | Explicit compute costs only | Energy or carbon cannot be inferred from tokens or currency |

An assessment should carry this coverage inventory into its operating review.
For example, accounting for a retrieval call does not establish retrieval
quality, and accounting for a GPU charge does not establish capacity efficiency.

## 3. Run the reference implementation

From a source checkout:

```bash
npm run build
node dist/cli/index.js .                         # original scan
node dist/cli/index.js . --experimental          # optional static signals
node dist/cli/index.js economics examples/economics.json
node dist/cli/index.js economics examples/economics.json --format json
```

With the package installed, use `cates-analyzer economics usage.json`.
Invoking this distinct command is the opt-in; `--experimental` is neither
required nor used for ledger accounting. There is deliberately no implicit
discovery of `usage.json`, no automatic telemetry, and no repository scan within
the economics command.

The checked-in [complete example](../examples/economics.json) is **synthetic**:
its provider, prices, charges, and outcomes are invented to demonstrate
arithmetic. Do not use its rates for financial planning.

Library:

```ts
import { analyzeEconomics, EconomicsInputSchema, formatEconomics } from 'cates-analyzer';

const validation = EconomicsInputSchema.safeParse(normalizedLedger);
if (!validation.success) {
  throw validation.error;
}
const report = analyzeEconomics(validation.data);
console.log(formatEconomics(report));
```

Service:

```bash
curl -X POST http://localhost:8080/api/economics \
  -H 'Content-Type: application/json' \
  --data-binary @examples/economics.json
```

The HTTP endpoint accepts the ledger directly, not a `{ files, policy }`
wrapper. It returns the same report as the CLI/library. It uses the service's
existing JSON-body limit, rate limiting, and no-content-logging behavior.
There is **no hosted UI workflow for runtime economics yet**.

Valid but incomplete ledgers return reports with `null` totals and explicit
gaps, not a failed conformance result. The CLI exits `0` for a valid assessment,
including incomplete or unfavorable results; malformed input, invalid fields,
unsupported formats, or unreadable files exit `2`. Only `pretty` and `json` are
supported: accounting observations are not SARIF rule violations.

## 4. Normalized ledger contract

All objects reject undeclared fields. Omission is not a substitute for `null`
except where a field is explicitly optional. There are no prompt, completion,
source-code, or credential fields.

### 4.1 Envelope and provenance

| Field | Required semantics |
|---|---|
| `schemaVersion` | Literal `1`; reject unsupported versions |
| `currency` | One three-uppercase-letter ISO-style code; same accounting unit for every rate and charge |
| `source.kind` | `observed` for caller-reported captured work, or `scenario` for hypothetical inputs |
| `source.reference` | Export/run/capture reference, or an explicit scenario description |
| `window.startedAt`, `window.endedAt` | ISO timestamps with timezone; ordered capture/cohort interval |
| `requestCoverage` | `complete`, `partial`, or `unknown`; includes all attempts and child calls for all listed tasks |
| `costCoverage` | Explicit status for **every** category listed below |
| `rateCards` | Array of applicable price schedules, possibly empty |
| `tasks` | Nonempty array of evaluated or in-progress tasks |
| `requests` | Array of exclusive model requests, possibly empty |
| `additionalCosts` | Non-model charges or adjustments, possibly empty |

The currency field checks syntax, not membership in an authoritative currency
registry. It performs no foreign exchange, credit, premium-request, seat, or
subscription conversion. An adapter must resolve those terms with evidence
before emitting monetary charges. Do not invent a cost per token for an
unmetered subscription. Distinguish **marginal spend** from **allocated total
cost** in `source.reference` and cost-line sources.

`observed` is a provenance assertion, not independent verification. A report
can combine observed tokens with rate-card estimates; the per-request
`costBasis` identifies this distinction.

### 4.2 Tasks and acceptance

Every task has an `id`, `startedAt`, `endedAt`, and `outcome`:

| Outcome | Meaning |
|---|---|
| `accepted` | Satisfied a declared acceptance decision |
| `rejected` | Evaluated and did not satisfy that decision |
| `abandoned` | Work stopped without acceptance |
| `pending` | Not yet evaluated or complete |
| `unknown` | Outcome was not captured |

Accepted/rejected tasks require `outcomeEvidence`, an evaluation reference.
The reference should identify the acceptance criteria, evaluator, evaluation
version, and relevant correctness/safety checks. The implementation requires a
nonempty reference; it does **not** retrieve or verify the referenced evidence.

For a pending task, `endedAt` is the observation cutoff, not a claim that work
is complete. Include zero-call tasks when they belong to the selected cohort;
do not drop unsuccessful tasks from the denominator.

### 4.3 Requests and lineage

Each request carries:

- Unique `id`, existing `taskId`, `provider`, and `model`.
- `purpose`: `planning`, `generation`, `retrieval`, `compaction`,
  `verification`, `repair`, or `other`.
- `status`: `succeeded`, `failed`, or `cancelled`.
- Recorded `startedAt` and `endedAt`, within the task and capture interval.
- `usage`, with the normalized counters below.
- Optional `parentRequestId` for orchestration/child attribution and `retryOf`
  for another attempt. References must stay within one task and be acyclic.
- Optional `rateCardId`, and/or `billing: { amount, source }`.

**One row is one exclusive request/attempt, not a session or subtree total.**
If a platform exposes inclusive parent totals plus child totals, normalize to
exclusive requests before ingestion. Do not add logical operation aggregates
to physical attempt records. A logical span can include multiple retries;
its duration or aggregate usage is not automatically a CATES request record.

Automatic SDK retries, speculative branches, failed validation loops, rejected
candidates, compaction, and evaluator model calls can all incur real costs.
Include them. Status never makes usage free. Nor is failed/retried work
automatically avoidable waste: some validation and recovery is necessary.

IDs are unique within each collection. Parent/retry records may appear in any
array order, but cannot start later than their child/retry. The parser checks
cross-task references, cycles, unknown tasks, and out-of-window records.

### 4.4 Token counters: never double count

| `usage` field | Definition |
|---|---|
| `input` | Total model input, **including** cache reads and writes |
| `cacheRead` | Input subset served from a cache |
| `cacheWrite` | Disjoint input subset charged under a cache-write rate |
| `output` | Total model output, **including** reasoning where billed in output |
| `reasoning` | Optional diagnostic subset of `output`; not a fifth charged bucket |

The first four keys are required. Use integer counts or explicit `null` if
unknown. `reasoning` may be omitted or `null` without preventing output pricing.
Zero means measured/reliably established zero, not “the export omitted it.”

```text
cacheRead + cacheWrite <= input
reasoning <= output
uncachedInput = input - cacheRead - cacheWrite
totalTokens = input + output
```

The cache bound is checked against all known subsets even when one subset is
unknown. Unknowns propagate through calculations that need them. For example,
an unknown cache-read count prevents separating uncached input and pricing it,
but a known aggregate `input` still contributes to token totals.

**Provider normalization is mandatory.** Do not paste a provider's usage object
directly into this schema:

- OpenAI documentation exposes reasoning as an output subset. Normalize its
  reported input and cache details to the contract above; do not add reasoning
  again. If a model/API reports cache-write counters, include them explicitly.
- Anthropic's documented uncached `input_tokens` excludes its cache-read and
  cache-creation counters. Normalize CATES `input` as the sum of all three,
  with the corresponding cache subsets.
- Gemini cache counters and usage fields depend on the API/version. Map against
  that version's documentation; do not assume field names or inclusion semantics
  match another provider.
- OpenTelemetry is a useful interoperability source, not a billing oracle.
  Preserve the distinction between logical spans, physical attempts, and
  provider-reported usage; its GenAI conventions are still developing.

See the primary-source references in §10. No provider adapters ship in this
extension. Unknown or unsupported provider semantics should block an adapter
from declaring complete coverage.

### 4.5 Rate cards and reported charges

Every rate card has `id`, `provider`, `model`, `context`, `source`,
`retrievedAt`, `effectiveFrom`, optional `effectiveTo`, and `perMillion`.

`context` records the caller's selection of region, deployment, service tier,
long-context tier, cache TTL, modality, negotiated discount, and other relevant
terms. The implementation checks provider/model and effective dates, **not**
those commercial conditions. A card applies at request start in the half-open
interval `[effectiveFrom, effectiveTo)`.

```json
{
  "perMillion": {
    "input": 2,
    "cacheRead": 0.2,
    "cacheWrite": 2.5,
    "output": 10
  }
}
```

These are **synthetic** unit rates in the ledger currency per million tokens.
`input` and `output` rates are required when providing a card; cache rates
may be omitted. A zero count needs no price; a positive count with no applicable
rate remains unpriced. Explicit zero prices are valid.

The write rate is the **whole charge** for that bucket, not an incremental
premium to add to base input. Do not hardcode a universal cached-input discount
or output multiplier.

A single card cannot faithfully price mixed modalities or multiple cache-write
TTLs with different rates within one request. Normalize an externally computed,
documented aggregate model charge into `billing` for such requests. Do **not**
split one physical call into fake attempts or invent blended token counts.
Provider counts can remain unknown while reported cost is known.

`billing.amount` supersedes the rate-card estimate. When both exist, the report
retains `estimatedCost` and `reconciliationDelta = reported - estimated`.
This is line-level comparison, **not** complete invoice reconciliation.
The billing amount must cover only the model request: tool/hosting charges
already inside it must not be repeated under `additionalCosts`.

Floating-point arithmetic is used; results are estimates, not an invoice-grade
decimal/currency rounding engine. Machine-readable totals retain calculation
precision; human-readable rendering limits significant digits. Apply a
documented currency-rounding policy when reconciling externally.

### 4.6 Non-model costs, allocations, and adjustments

`costCoverage` must name `tools`, `compute`, `storage`, `network`,
`human-review`, `other`, and `adjustments`. Each is:

- `complete`: all applicable costs in the chosen accounting boundary supplied.
- `partial`: some applicable costs missing.
- `unknown`: coverage not established.
- `not-applicable`: explicitly outside/not applicable to the declared boundary;
  no line items allowed in that category.

Each cost line has `id`, `category`, `amount`, `source`, and optional `taskId`.
A missing amount is `null`. Negative amounts are permitted only for adjustments
such as credits or corrections. Adjustments must not repeat discounts/refunds
already included in request charges.

Examples include paid search/browser actions, sandbox seconds, CI minutes, GPU
capacity allocation, cache/index storage, network egress, human review, rollback,
and downstream defect repair. Convert quantities into currency outside this
engine and record the allocation basis in `source`.

Without `taskId`, a charge remains shared cohort cost. It is included once in
the cohort total, not silently divided across tasks. Per-task and model groups
show **model cost**, not fully allocated TCO. Shared-capacity allocation,
reserved-capacity amortization, and labor rates are assumptions, not directly
observed model prices.

## 5. Metrics, denominators, and completeness

```text
request_estimate =
  (uncached_input × input_rate
   + cache_read × read_rate
   + cache_write × write_rate
   + output × output_rate) / 1,000,000

request_cost = reported_model_charge, if present; otherwise request_estimate
cohort_cost = sum(all_request_costs) + sum(additional_costs_and_adjustments)
cost_per_accepted_task = cohort_cost / accepted_tasks
tokens_per_accepted_task = sum(input + output for every request) / accepted_tasks
acceptance_rate = accepted / (accepted + rejected + abandoned)
cache_read_share = sum(cache_read) / sum(input)
reasoning_share = sum(reasoning) / sum(output)
```

The cost/token-per-accepted numerator includes rejected, abandoned, and
in-progress work in the **same declared cohort**, not just successful calls.
Report pending and unknown outcomes alongside acceptance rate. That rate
excludes unclassified/in-progress tasks and must not be presented as an
unbiased population estimate.

| Situation | Report behavior |
|---|---|
| No accepted tasks | Per-accepted-task metrics are `null`, never zero or infinity |
| Request capture partial/unknown | Total model/cohort cost and per-accepted-task economics are `null` |
| Any request unpriced | Complete model/cohort cost is `null`; known charged components retained |
| Non-model coverage incomplete | Cohort cost is `null`, even if model cost is complete |
| Unknown reasoning only | Reasoning share unknown; known output and model pricing remain usable |
| Unknown token usage, reported charge present | Cost can be known while token metrics remain unknown |
| No model calls and coverage complete | Zero model cost and tokens; task outcome remains independently declared |
| Signed adjustments | Can reduce net costs; a known subtotal is not necessarily a lower bound |

`knownSubtotal` is the sum of known priced components and known additional
charges, using reported charges in place of estimates. It is **not** a completed
bill. Zero unknown rates are never assumed. The report's `gaps` describes
missing evidence and `limitations` stays present even when all fields are known.

Token sums, cache/reasoning shares, outcomes, and latency describe the supplied
records, not extrapolated population values. With partial capture, do not
interpret even these descriptive observations as the complete workload.

Latency uses **nearest-rank** p50/p95 over recorded durations. Request elapsed
time includes the supplied interval; task elapsed time is directly recorded,
not the sum of requests. Parallelism may reduce elapsed time while increasing
cost. These fields are not time-to-first-token, queueing measurements, throughput,
or statistically meaningful SLO estimates for tiny samples.

Attribution by model, purpose, task, retry, failure, and cancellation provides
different views of the **same requests**. Never add totals across those views.
The report retains per-request costs and provenance so an auditor can reproduce
the cohort arithmetic.

## 6. Worked example

For `examples/economics.json`:

| Request | Calculation | Model cost |
|---|---|---:|
| `attempt-1` (failed planning) | `(600×2 + 400×2.5 + 200×10) / 1e6` | 0.00420 |
| `attempt-2` (retry) | `(1100×2 + 400×0.2 + 300×10) / 1e6` | 0.00528 |
| `verification-child` | `(500×2 + 100×10) / 1e6` | 0.00200 |
| `rejected-work` | `(300×2 + 100×10) / 1e6` | 0.00160 |

Model cost is **USD 0.01308**. Adding review (0.50), compute (0.01), tools
(0.02), and a credit (-0.005) yields **USD 0.53808**. There is one accepted task,
so cohort cost per accepted task is also **USD 0.53808**.

Total input is **3,300** and output **700**, for **4,000 tokens** per accepted
task. The 400 cache-read tokens, 400 cache-write tokens, and 250 reasoning
tokens are **already inside** those totals. Adding them again is wrong.
The “succeeded” request for rejected work does not create another accepted task.

The 105-second retry overlaps its 60-second verification child. The accepted
task takes 120 seconds end to end, not the sum of all request durations.

## 7. Economic interventions to investigate

These are **experimental hypotheses**, not new scored rules or automatic
remediations. Rank them using measured workload contribution and outcome risk,
not a universal savings percentage.

| Intervention | Economic hypothesis | Required counter-check |
|---|---|---|
| Conditional loading and retrieval | Less repeated irrelevant input | Additional retrieval calls, relevance, omitted guidance, cache effects |
| Stable prefixes and appropriate cache TTL | Lower repeated processing cost | Eligibility, write/storage overhead, reuse frequency, privacy/retention |
| Narrower tool catalogs and bounded results | Less schema/context overhead | Tool discoverability, task success, extra discovery calls |
| Concise output contracts | Less unnecessary output | Truncation, rework, missing artifacts, accessibility and audit needs |
| Reasoning-effort/model routing | Cheaper adequate work | Escalations, fallbacks, failure rates, task-difficulty differences |
| Bounded retries and early stopping | Avoid redundant unsuccessful attempts | Premature abandonment, recovery success, cancellation billing semantics |
| Delegation and parallelism | Faster completion or specialized quality | Duplicated context, fan-out spend, handoff overhead, critical-path latency |
| Context compaction | Smaller later contexts | Compaction cost, summary loss, rehydration, cache invalidation |
| Better setup, tests, and verifiers | Fewer errors and downstream repairs | Verification cost, false alarms, escaped defects, human review |
| Batch/provisioned service use | Lower unit or allocated cost | Queue delay, utilization, commitment risk, differing terms |

**Break-even is workload-specific.** For example, compaction is economical only
when savings from subsequent requests exceed compaction, cache-change,
rehydration, and any additional rework costs at preserved quality. Cache writes
require enough eligible future reads to offset their incremental expense.
This engine accounts for supplied observations; it does not estimate either
counterfactual automatically.

Moving instructions to a reference file does not remove the cost if every task
then reads that file. Reducing review, tests, or security controls to improve
a token metric is not an acceptable optimization.

## 8. Evidence, validation, and graduation

Use separate labels for separate claims:

| Evidence label | Permitted claim | Not established |
|---|---|---|
| Static measurement | Count under a declared tokenizer for the supplied bytes | Rendered/billed context or behavioral usefulness |
| Static heuristic | Pattern suggests an investigation opportunity | Precision, causal benefit, guaranteed savings |
| Caller-reported observation | Supplied records describe a capture | Completeness, invoice correctness, independent outcome validation |
| Scenario / estimate | Result under explicit quantities, prices, and assumptions | Realized spend or validated production improvement |
| Evaluated intervention | Outcome comparison under a documented protocol | Universal benefit outside the evaluated population |

To graduate an economic recommendation:

1. Define the workload, unit of task, acceptance criteria, cost boundary,
   latency target, and safety constraints **before** optimizing.
2. Keep a baseline and treatment with comparable tasks and explicit model,
   prompt/config revision, tools, cache warmness, routing, and rate-card context.
   Use randomized assignment or paired/repeated tasks where feasible; document
   confounders when observational comparisons are unavoidable.
3. Include all attempts, child/evaluator calls, failed/abandoned tasks, labor,
   and applicable non-token costs. Report missing data and coverage.
4. Verify normalization against provider usage/billing examples. Reconcile
   reported versus estimated charges; document rounding, credits, and allocation.
5. Evaluate correctness, acceptance, rework/escaped defects, safety, and latency,
   not just shorter prompts or lower request cost. Report subgroup outcomes so
   routing does not improve aggregate cost by abandoning difficult tasks.
6. Publish sample sizes, variability, and a justified uncertainty method.
   State the minimum economically meaningful improvement. Do not relabel
   arbitrary multipliers as statistical confidence intervals.
7. For static rules, publish a labeled corpus, precision/recall, failure modes,
   and false-positive review. For remediations, publish outcome evidence too:
   detector precision alone does not prove savings.
8. Document applicability limits, owner, review/expiry date, rollback criteria,
   and a drift/revalidation cadence as models, tools, pricing, and work change.

Arithmetic and schema tests are necessary, but **not economic vetting**.
Graduation into stable scoring/conformance requires the standard's major-version
process. Runtime observations remain separate from the configuration grade.

## 9. Operational limits and integration boundaries

- CLI files: maximum **1,000,000 bytes**, bounded read of a regular JSON file.
- Schema: maximum **10,000** tasks, requests, or additional-cost rows per array,
  and **1,000** rate cards. The service's existing 1 MiB transport limit also
  applies; callers should use the stricter 1,000,000-byte CLI limit for parity.
- Token counters: nonnegative integers up to 1 billion per counter per request.
  Amounts: finite values up to 1 billion; only adjustments can be negative.
- IDs: nonempty, trimmed, at most 128 characters. Evidence/source/context
  references: at most 1,024 characters.
- No external fetches, model calls, code execution, provider credentials, or
  telemetry collection. JSON is data, never instructions.
- No automatic persist/history/merge/deduplication across reports. IDs are
  validated only within the submitted ledger. Do not sum overlapping windows.
- No raw transcripts or identifying data are required. Use pseudonymous IDs
  and controlled evidence references; do not put secrets into free-text fields.
- Treat submitted ledgers and returned reports as potentially sensitive billing
  metadata. Use the local CLI when a hosted service is not an authorized data
  destination. The existing anonymous service is not a multi-tenant billing store.

Current limitations are deliberate: no provider collectors, automatic invoice
parsers, UI, dataset-comparison engine, forecast/budget gates, source-level token
attribution, or calibrated intervention recommendations. These are expansion
points with evidence requirements, not implied shipped capabilities.

## 10. Primary-source grounding

Reviewed **October 2, 2026 (UTC)**. Sources describe provider/telemetry semantics;
they do not validate CATES thresholds, scoring weights, or savings claims.
Always version an adapter against the API/provider documentation it implements.

- [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching):
  rendered-prefix matching, cache availability, and model-dependent pricing and
  cache-write treatment.
- [OpenAI reasoning](https://developers.openai.com/api/docs/guides/reasoning):
  reasoning in output usage and incomplete responses that can still incur cost.
- [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching):
  separate uncached/read/write counters, whole cache-write rates, and TTL behavior.
- [Gemini context caching](https://ai.google.dev/gemini-api/docs/caching):
  API/model-dependent eligibility and cache-use observations.
- [OpenTelemetry GenAI spans](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-spans.md):
  developing conventions for model/tool operations and logical spans, including
  retry-aware duration semantics.

No live vendor price table is embedded in CATES. The standard's accounting
contract is intentionally provider-neutral and **stricter about uncertainty**
than an inferred price multiplier.
