# Proposal: Experimental Cache-Shaping & Output-Shaping Dimensions

> 🧪 **Status: EXPERIMENTAL PROPOSAL — non-normative.**
> Everything described here ships **off by default**, carries **zero scoring weight**,
> is **excluded from conformance and CI gates**, and is **SemVer-exempt** (rules may
> change or be removed in a minor release). Nothing here changes a repository's existing
> CATES score or conformance level unless a user explicitly opts in.

**Target version:** `cates-analyzer` 1.3.0 (minor) · **Owner:** TBD · **Created:** 2026-06-24

---

## 1. Summary

CATES today optimizes one token class: **input** (the `token-efficiency` dimension shrinks
always-loaded config). But under token-based billing, input is the *cheapest* class. Two
higher-leverage classes are unaddressed:

- **Cache** — a cache *hit* costs ≈ **0.1×** input (≈ 90% off). Whether a request hits is
  driven by **prefix stability**, which is partly visible in static config.
- **Output** — output tokens cost ≈ **2–5× input** and drive latency. Several config
  anti-patterns provably inflate output.

*(Illustrative ratios — Claude-family, 2026; verify per model/provider. The structural
ordering `output ≫ uncached-input ≫ cached-input` is stable across vendors.)*

This proposal adds two **experimental** scoring dimensions — `cache-shaping` and
`output-shaping` — that flag the **statically-detectable** config smells which wreck cache
hit-rate or inflate output, **without** touching the established score until the rules earn
graduation.

> The framing: CLEAR/CATES optimize *input authoring*. This adds two orthogonal axes —
> **Cache** (structure) and **Output** (contract) — that can be improved without changing a
> single instruction's meaning, so functionality is preserved by construction.

---

## 2. The "experimental for sure" guarantees (design contract)

These are hard requirements for every change below. A reviewer should reject the PR if any
is violated.

| Guarantee | Mechanism |
|---|---|
| **Off by default** | Findings only produced when `--experimental` (CLI) or `experimental: true` (`.cates.yml`) is set. |
| **Zero score impact** | New dimensions are **not** in `DIMENSION_WEIGHTS`; `score.overall` math is byte-for-byte unchanged. |
| **Excluded from conformance** | Experimental findings never enter the `findings` array consumed by `evaluateConformance` / `level{1,2,3}Failures`. |
| **Excluded from CI gates** | Not eligible for `failOn`, `minScore`, `requireLevel`, or `maxAlwaysLoadedTokens`. |
| **Visibly labeled** | `🧪 EXPERIMENTAL (not scored)` banner in CLI; `"stability": "experimental"` in JSON; flagged in the rule catalog and docs. |
| **Separate output channel** | Emitted under `result.experimental.*`, never merged into `result.findings`, so automation can't accidentally depend on it. |
| **SemVer-exempt** | Documented in `VERSIONING.md`: experimental rule IDs may change/be removed in minor releases. |

**Why isolation is non-negotiable:** `src/conformance.ts` fails Level 2 on *any* `high`
finding and Level 3 on anything above `low`. If an experimental rule's finding leaked into
`result.findings`, it would silently break existing users' conformance and CI gates. The
separate channel is the safeguard.

---

## 3. Scope: static-detectable vs. runtime (be honest)

CATES is **static, zero-LLM** analysis of config at rest (§11 Measurement). That bounds what
these dimensions can do.

### In scope (this proposal) — static config smells
Config patterns that *predict* poor cache/output economics: volatile tokens in the cacheable
prefix, dynamic-before-static ordering, full-file-rewrite mandates, unbounded output, forced
verbose reasoning, etc. (rules in §4).

### Out of scope (future, informative) — runtime telemetry
Actual **cache-hit %**, **output:input ratio**, **reasoning-token share**, sticky-routing,
and stream-and-cancel are **runtime** signals. They require a telemetry feed (gateway or
billing export), not source files. Proposed as a **future Informative Annex G —
Token-Economics Telemetry** and a possible `cates-rt` ingest mode. **Explicitly not in 1.3.0.**
Calling this out prevents the failure mode of asserting runtime numbers the static analyzer
cannot measure.

---

## 4. New dimensions & rules

Two dimensions, dimension-prefixed IDs consistent with the existing catalog (`TE`, `SEC`, …):
`CS` = cache-shaping, `OS` = output-shaping. Severities are **advisory only** while
experimental (they aid prioritization but never gate or score).

### 4.1 Cache-Shaping (`CS0xx`) — protect the cacheable prefix

| ID | Title | Sev | Static detection (config at rest) |
|----|-------|-----|-----------------------------------|
| **CS001** | Volatile Tokens in Always-Loaded Config | high | Always-loaded scope embeds timestamps/dates, UUIDs, build numbers, git SHAs, or `current date/time` directives → busts the prefix every call. |
| **CS002** | Dynamic-Before-Static Ordering | medium | Prompt/instruction template places variable placeholders (`${…}`, `{{…}}`) or `@include`s **ahead** of a large static block, minimizing the cacheable prefix. |
| **CS003** | Non-Deterministic Context Directive | medium | Instructions tell the agent to inject live/volatile state at the top (e.g., "always include current git status / latest logs / today's date"). |
| **CS004** | Unstable Tool/Context Ordering | low | Directives that randomize or re-sort tool lists / retrieved context per call. |
| **CS005** | Fragmented Preamble (no shared prelude) | info | High cross-file near-duplication of preamble that could be one shared, cacheable prelude (correlates with `TE006`). |

### 4.2 Output-Shaping (`OS0xx`) — contain the priciest token class

| ID | Title | Sev | Static detection (config at rest) |
|----|-------|-----|-----------------------------------|
| **OS001** | Missing Output Contract | medium | Config never bounds output (no length cap, no "code-only / no-preamble", no format spec). Complements `TE004` (which flags *forced* verbosity; OS001 flags *absent* bounds). |
| **OS002** | Full-File Rewrite Mandate | high | Instructions require emitting entire files instead of diffs/patches ("return the complete file"). Large output waste; same end-state achievable via patch. |
| **OS003** | Unconditional Verbose Reasoning | medium | Forces detailed chain-of-thought/explanation on every response regardless of task → reasoning/output inflation. |
| **OS004** | Output Echo / Restatement | low | Instructs the agent to restate the prompt, echo inputs, or repeat context back. |
| **OS005** | Verbose Format Mandate | info | Requires heavyweight formatting (decorative sections, full tables) where compact output suffices. |

Overlaps with existing `TE004`/`CNF002` are intentional and noted; graduation (§9) may merge
or promote rules.

---

## 5. Architecture & code changes (file-by-file)

### 5.1 `src/types.ts`
- Extend `Dimension` with `'cache-shaping' | 'output-shaping'` **for typing only** — these
  do **not** get weights (see 5.4).
- Add a stability marker and a dedicated channel:
  ```ts
  export type Stability = 'stable' | 'experimental';

  export interface ExperimentalFinding extends Finding {
    stability: 'experimental';
  }

  // on AnalysisResult:
  experimental?: {
    enabled: boolean;
    findings: ExperimentalFinding[];
    dimensions: DimensionScore[]; // informational only; weight = 0
  };
  ```
- Keep `result.findings` **stable-only**. Experimental findings live solely under
  `result.experimental.findings`.

### 5.2 `src/analyzers/cache-shaping.ts`, `src/analyzers/output-shaping.ts` (new)
- Mirror the shape of `src/analyzers/token-efficiency.ts`.
- Pure, deterministic, regex/AST detectors over `DiscoveredFile`s; reuse
  `src/utils/tokenizer.ts` and `src/utils/regex-guards.ts`.
- Each returns `ExperimentalFinding[]`. **Only invoked when experimental mode is on.**
- Register in `src/analyzers/index.ts` behind the gate (do not add to the default analyzer
  sweep).

### 5.3 `src/rules/catalog.ts`
- Add `CS0xx`/`OS0xx` entries. Extend `RuleMetadata` with `stability?: Stability` (default
  `'stable'`); mark all new rules `stability: 'experimental'`.
- Set `catesSection` to `'9.9'` (cache) / `'9.10'` (output).
- `cates-analyzer rules` / `explain` must show a 🧪 marker for experimental rules.

### 5.4 `src/scoring/calculator.ts`
- **Do not** add the new dimensions to `DIMENSION_WEIGHTS` (it must keep summing to 1.0).
  `score.overall` is provably unchanged.
- Add a side computation that scores experimental dimensions **for display only** (weight 0),
  written to `result.experimental.dimensions`, never folded into `overall`.
- Add a regression test asserting overall score is identical with/without experimental on a
  fixture corpus (see §7).

### 5.5 `src/conformance.ts`
- No behavioral change required **because** experimental findings never reach
  `result.findings`. Add a defensive filter + a unit test proving `level{1,2,3}Failures`
  ignore `stability: 'experimental'` even if one leaked in.

### 5.6 `src/rule-config.ts` + `.cates.yml`
- Add a top-level `experimental: boolean` (default `false`) to the policy schema.
- Preserve existing precedence (`rules[id] > dimensions[dim] > defaults`). A user can:
  ```yaml
  experimental: true            # opt in to all experimental rules
  rules:
    OS002: off                  # …but disable a specific one
    CS001: { severity: low }    # …or soften it
  ```
- When `experimental: false`, the analyzers in 5.2 are not run at all (no wasted work).

### 5.7 `src/cli/index.ts`
- New flags: `--experimental` (run + show experimental findings), `--experimental-only`
  (only the experimental section, useful for focused review), and surface in `--help`.
- Render a distinct, clearly-labeled block:
  ```
  🧪 Experimental — NOT scored, subject to change
     CS001  high    .github/copilot-instructions.md:3  Volatile "current date" in always-loaded config
     OS002  high    .github/copilot-instructions.md:42 Mandates full-file output; prefer diffs
  ```
- JSON output: add an `experimental` object sibling to `findings`; never inside `findings`.
  Each entry carries `"stability": "experimental"`.

### 5.8 `src/scoring/report.ts` / `src/optimizer/report.ts`
- Add the experimental section to text + JSON reports, gated and labeled. Default reports
  (no flag) are byte-identical to today.

---

## 6. Standard changes (`CATES-v1.0.md`) — all Informative/Experimental

Leverage the existing §4.5 *Normative vs. Informative* split — experimental content is
**Informative** and MUST NOT affect conformance.

- **§4.2 Rule Identifiers** — register `CS`/`OS` prefixes; define a 🧪 **Experimental**
  status marker for rule IDs.
- **§4.5** — add an "Experimental (non-normative)" status: experimental rules are Informative,
  carry zero weight, and are excluded from conformance classes/profiles.
- **§5 Conceptual Model** — extend 5.1/5.2 with the **token cost vector**
  (cached-input ≈ 0.1×, uncached-input 1×, cache-write 1.25–2×, output ≈ 5×) and a
  **prefix-stability** concept; note `1 output ≈ ~50 cached-input` as motivation.
- **§9.9 Cache-Shaping Rules (Experimental)** and **§9.10 Output-Shaping Rules
  (Experimental)** — full rule definitions using the §9.1 attribute table, each headed
  "Experimental — Informative".
- **§8 Conformance** — one sentence: experimental rules are excluded from all classes/profiles.
- **§10 Scoring** — one sentence: experimental dimensions have weight 0 and are excluded from
  the overall score and grade.
- **§11 Measurement** — reaffirm static-only; reference future **Annex G (Telemetry)** for
  runtime cache/output measurement.

---

## 7. Testing strategy

- **Fixtures** under `fixtures/experimental/` — minimal repos exhibiting each `CS`/`OS`
  anti-pattern plus clean counterparts (true-positive and true-negative per rule).
- **Unit tests** (`tests/`) — one per rule (detection + remediation message + advisory
  severity), following existing analyzer test patterns.
- **Isolation guardrail tests (the important ones):**
  1. `score.overall` and `grade` are **identical** with and without `--experimental` across
     the full fixture corpus.
  2. `evaluateConformance` / `evaluateGates` results are **identical** with experimental on.
  3. `result.findings` never contains a `stability: 'experimental'` entry.
  4. With `experimental: false`, the new analyzers are not invoked (spy/mocks).
- **Snapshot test** of default (no-flag) CLI/JSON output to prove zero drift for existing users.

---

## 8. Versioning & release

- **Minor bump → 1.3.0** (additive, opt-in). Existing behavior unchanged.
- `CHANGELOG.md` entry clearly labeled **Experimental**.
- `VERSIONING.md` — add a clause: *experimental rules/dimensions are exempt from SemVer; they
  may change or be removed in any minor release.*
- release-please config: no special handling needed beyond the conventional-commit
  `feat:` (minor). Keep the experimental rules out of any "stable rule count" advertised in
  the README.

---

## 9. Phased rollout

- [ ] **Phase 0 — Spec groundwork.** §4.5/§5 edits + the experimental marker convention. No code.
- [ ] **Phase 1 — Engine plumbing (zero rules).** Experimental channel in `types.ts`, the
      `experimental` policy flag, CLI flags, report section, scoring isolation, guardrail
      tests. Ship with **no active rules** to validate isolation in production first.
- [ ] **Phase 2 — Cache-Shaping.** `cache-shaping.ts` + `CS001–CS005` + fixtures + tests + §9.9.
- [ ] **Phase 3 — Output-Shaping.** `output-shaping.ts` + `OS001–OS005` + fixtures + tests + §9.10.
- [ ] **Phase 4 — Docs & DX.** `docs/RULE-CATALOG.md` experimental section, this guide linked
      from README (with a 🧪 note), `examples/`, `explain`/`rules` 🧪 markers.
- [ ] **Phase 5 — Future (separate proposal).** Annex G telemetry + `cates-rt` ingest.

---

## 10. Graduation criteria (experimental → stable)

A rule graduates only when:
1. **Precision/recall** measured on a labeled corpus (target: precision ≥ 0.9, low FP rate).
2. Sustained low false-positive feedback across real repos.
3. Remediation is concrete and autofix-able where claimed.

Promotion then: assign a **non-zero weight** (rebalancing existing weights) and admit to
conformance — which **changes default scores**, so it requires a **major** release and a
migration note. Until then, weight stays 0.

---

## 11. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Experimental finding leaks into score/gates | Separate channel + 4 guardrail tests (§7); defensive filter in `conformance.ts`. |
| False positives erode trust | Advisory-only severity, off by default, `explain` rationale, easy per-rule disable. |
| Users build automation on unstable IDs | `"stability":"experimental"` in JSON + SemVer-exempt clause + separate channel. |
| Overlap/confusion with `TE`/`CNF` rules | Document overlaps in §9.9/§9.10; plan merges at graduation. |
| Scope creep into runtime claims | Hard line in §3; telemetry deferred to Annex G. |

---

## 12. Open questions

- [ ] Confirm GitHub Copilot / AI-credits per-model treatment of cached input & output before
      quoting ratios in any customer-facing surface (don't cite Anthropic/OpenAI numbers as
      GitHub's). TBB hub: aka.ms/ghcpubb.
- [ ] One combined `token-economics-experimental` dimension vs. two (`cache-shaping`,
      `output-shaping`)? Two is clearer for graduation; one is simpler in the report.
- [ ] Should `--experimental` also be enabled by an env var for CI experimentation
      (`CATES_EXPERIMENTAL=1`)?
- [ ] Minimum file-size thresholds for `OS001`/`CS002` to suppress noise on tiny configs.

---

### References
- Source ideation: *"Scaling Prompt Optimization — Beyond Input Tokens (Cache & Output
  Shaping)"* (three-axis model: Input / Cache / Output).
- Pricing ratios are illustrative (Claude-family, 2026) and vary by provider/model — verify
  against the current model card before use in customer-facing material.
