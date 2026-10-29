# Modern Agent Assurance

**Status: proposed, informative, manual assessment only. Reviewed: 2026-10-29.**

This companion to [CATES v1](../CATES-v1.0.md) covers gaps between static
configuration hygiene and effective agent behavior. It proposes acceptance
criteria for a future revision; it is **not** a new conformance level,
implemented rule catalog, analyzer option, or security certification.
The existing 49 stable rules, scores, thresholds, and gates remain unchanged.
No new `MA` findings are emitted by the CLI, library, API, SARIF, or UI.

Use current, supported guidance for the **actual client and deployment**.
"Latest" does not mean automatically adopting prereleases, unreviewed packages,
or a protocol revision the client cannot consume. Publication, implementation,
deployment, and effective policy are different evidence levels.

## Holistic disposition of the existing standards

| Area | Disposition | Correction or missing coverage |
| --- | --- | --- |
| Token measurement and economics | Retain | Declared tokenizers and Annex L's outcome-normalized accounting already distinguish source counts, runtime usage, prices, and accepted tasks. Do not equate any of these. |
| Token budgets and instruction style | Retain as v1 criteria; qualify rationale | The 1,500/800-token budgets, example-size limits, and negative-bullet ratios are policy heuristics, not universal model limits or validated optimal values. Preserve useful context and test changes. |
| SEC004/SEC005 and Annex A | Correct security claims; propose replacement | Prompt secrecy is not access control. Replace the legacy non-disclosure gate only in a versioned migration, with effective trust-boundary and data-protection evidence (MA02/MA03). |
| Loading, duplication, precedence | Qualify | Client/version/session determines co-loading and precedence. Cross-product mirrors can be intentional. Skill metadata has a different load lifecycle from skill bodies (MA01/MA04). |
| MCP, tools, agents, commands | Update reference and interpretation | Use date-versioned MCP, client-specific configuration syntax, and separate tool availability from approval and backend authorization (MA03/MA05). |
| Setup, hooks, plugins, supply chain | Retain hygiene; add lifecycle evidence | Pinning is not provenance; major version numbers do not prove age or support. Hooks/plugins/scripts execute code and need review, bounded execution, and update ownership (MA06). |
| Optional integrations and editor settings | Qualify | Missing optional integrations and intentionally disabled AI features are not inherently defects. Consider privacy, licensing, language support, and deployment policy. |
| Governance, conformance, reporting | Retain; add evidence lifecycle | Report incomplete coverage and unresolved manual checks honestly. Conformance is not runtime assurance; require representative outcome and safety evidence (MA07/MA08). |

These are documentation corrections and proposals, not silent detector changes.
The [Copilot hygiene profile](COPILOT-HYGIENE.md) already implements selected
experimental configuration checks, including skill structure and client-specific
metadata. Its documented coverage is narrower than the proposal below.

## Proposed acceptance criteria

The `MA` labels below identify proposal sections, not registered CATES rule IDs.
All criteria are proposed guidance. Automated candidates, where mentioned,
would still need implementation, fixtures, and compatibility review.

### MA01: Effective configuration and progressive loading

Record the product, version/build, session mode, repository revision, selected
agent, and applicable organization/user/repository settings. Separate the
discovered inventory from the effective load set and identify unknown external
settings rather than assuming defaults. Identify actual precedence and whether
conflicting files can co-load before deduplicating them.

For skills and tool catalogs, account separately for discovery metadata, loaded
instructions/schemas, and referenced resources. Do not classify all skill bytes
as free until activation or all configured MCP schemas as always loaded.

**Evidence:** a client-specific load/precedence record and a reproducible probe
showing the relevant configuration applies. Source token counts remain distinct
from observed request usage. Static discovery alone leaves loading unverified.

### MA02: Trust boundaries and untrusted content

Treat repository content, retrieved pages, tool responses, issue text, and
external skill/plugin instructions according to their provenance. Text from
these sources must not grant itself higher authority, approve an operation,
or relax policy. Delimiters and refusal instructions may help behavior but are
not enforcement mechanisms.

Keep credentials and sensitive policy data outside model-visible instructions.
Use host/service authorization, constrained execution, and data-access controls
that continue to apply if the model follows malicious content.

**Evidence:** a trust-boundary map and controlled negative tests using synthetic
data: a retrieved instruction cannot authorize a write, disclose a protected
value, or change permissions. A keyword match is not proof of injection or safety.

### MA03: Least privilege, autonomy, and data handling

Declare needed tools, filesystem/network reach, service scopes, identities, and
credential lifetime. Distinguish tool discovery/availability, execution approval,
sandbox boundaries, and backend authorization. Validate the combined policy;
an empty, omitted, wildcard, or unknown tool entry can behave differently by client.

Require review of high-impact operations or a documented, bounded unattended
policy with compensating controls. Record approval scope, cancellation and
escalation paths, and retention/redaction rules for evidence. Neither a broad
tool inventory nor autonomous test execution alone proves unsafe authorization.

**Evidence:** allow/deny tests in an isolated environment, with synthetic
credentials and no live destructive side effects. Include attempted out-of-scope
access and cross-identity access; retain redacted decisions, not raw secrets.

### MA04: Portable skills and reusable workflows

For Agent Skills-compatible clients, validate an immediate skill directory with
`SKILL.md`, required `name` and `description`, and a name matching its directory.
The name is 1-64 characters, uses lowercase letters/numbers/hyphens, and has no
leading, trailing, or consecutive hyphens. The description is 1-1,024 characters
and explains both purpose and activation. Check duplicate identities in the
effective search path, not just filenames in one directory.

Separate metadata, activated body, and optional scripts/references/assets.
The specification recommends a body below 5,000 tokens and 500 lines; these are
guidelines, not hard protocol rejection limits or a replacement for CATES budgets.
Use the target's supported skill roots; personal locations are not implicitly
available in cloud sessions. Review bundled scripts before execution.
`allowed-tools` is experimental and client-dependent, not a portable sandbox.

**Evidence:** metadata validation plus positive and negative activation examples
in the target client, resolution of referenced resources, and reviewed executable
dependencies. A valid `SKILL.md` alone proves neither activation nor safety.

### MA05: MCP interoperability and authorization

Record the supported protocol revision, transport, optional extensions, server
identity, and host configuration schema. The currently verified published MCP
revision is **2026-07-28**; do not assume installed clients have adopted it.
Host `mcp.json` layouts and credential interpolation syntax are not a universal
MCP wire-protocol schema. Do not automatically rewrite older compatible clients.

For protected HTTP deployments using MCP authorization, verify the applicable
revision's resource/server metadata discovery, issuer and audience validation,
least-privilege scopes, redirect validation, and consent. Do not pass an incoming
token through to another service or accept a token intended for another resource.
STDIO uses environment-based credentials rather than the HTTP OAuth flow.
Do not treat OAuth drafts or optional extensions as universal requirements.

Validate remote TLS, local binding and origin controls where applicable, plus
outbound URL handling and redirect/SSRF protections. Tool descriptions and
annotations are not proof that a tool is safe or read-only.

**Evidence:** an interoperability result against the declared revision and
extensions; for protected endpoints, controlled denied-access, wrong-audience,
redirect, and consent tests. A valid URL or JSON file does not establish any
of these properties. No such network probing occurs in a CATES static scan.

### MA06: Executable configuration and supply-chain lifecycle

Inventory executable entry points in skills, commands, hooks, plugins, setup,
and MCP launchers. Use reviewed immutable versions/digests where available,
lockfiles, and provenance/integrity verification appropriate to the source.
An exact tag or version can still be compromised or mutable; pinning does not
replace review. Assign an update owner and support/advisory review cadence.

Validate untrusted inputs before execution; avoid interpolation into shell
programs. Define timeouts, resource/output bounds, failure behavior, and cleanup.
Hooks should fail visibly according to the host contract, not silently convert
an error into permission. Distinguish deterministic host enforcement from a
prompt hook that only influences model behavior.

**Evidence:** entry-point inventory, dependency origin and review records,
and isolated timeout/failure/invalid-input tests. Do not infer vulnerability,
obsolescence, or support status from a `v0` or `v1` prefix.

### MA07: Outcome-preserving optimization

Compare baseline and candidate configurations on representative tasks with
declared acceptance criteria. Include failures, retries, child/evaluator calls,
and human review in the chosen measurement boundary. Report correctness,
safety, rework, latency, and cost per accepted task alongside token counts.
Record model/client versions, workload selection, sample size, uncertainty,
and relevant cache/pricing assumptions.

Do not claim causal savings from one scan, a score change, a smaller file, or
a cached request alone. Predefine acceptable regressions and rollback criteria.
Use [Annex L accounting](TOKEN-ECONOMICS.md) for supplied usage/cost evidence;
it does not itself run or validate a comparative experiment.

**Evidence:** reproducible baseline/treatment results and acceptance decisions,
with limitations. Where runtime capture or outcomes are missing, report
"not assessed" rather than zero cost, full coverage, or preserved quality.

### MA08: Evidence, exceptions, and maintenance

For each applicable criterion, record **supported**, **failed**, **not assessed**,
or **not applicable** with rationale, subject/version, evidence reference, owner,
assessment date, and next review/expiry. These are manual review statuses, not
new analyzer output fields. An incomplete scan cannot establish complete assurance.

Reassess after meaningful client, model, protocol, permission, or executable
dependency changes. Keep exceptions scoped, owned, justified, time-bounded, and
visible with compensating controls. Do not retain secrets or unnecessary
transcripts as evidence; define access and retention before collection.

**Evidence:** a dated review record and exception register. A self-declaration,
passing static scan, or unsupported marketing claim is not independent proof.

## Adoption and graduation

Use these criteria for manual reviews now; no new `.cates.yml` keys or CLI
flags are required. Keep them separate from v1 conformance and existing
experimental outputs. Address real exposure even when the legacy score passes;
do not add confidentiality boilerplate or remove safety instructions just to
satisfy a heuristic.

Before any criterion becomes automated, define applicability, evidence,
unknown/not-applicable handling, detection limitations, safe remediation, and
positive/negative fixtures for each supported client. Publish coverage and
empirical detector evaluations before claiming accuracy.

Replacing SEC004/SEC005's legacy interpretation or changing any stable default
predicate, severity, weight, or level requirement needs an explicit compatibility
review and a major release wherever it changes existing pass/fail behavior.
Publish before/after fixtures, migration instructions, and deprecation notice
according to [the versioning policy](../VERSIONING.md). New advisory checks can
start as opt-in, non-scoring experiments; this document does not implement them.

Review sources at least quarterly and when upstream announces a relevant change.
Record the verified publication and actual supported deployment separately.
Do not claim a new snapshot date for a whole product profile based on reviewing
only one of its contracts.

## Source register

Primary sources retrieved on **2026-10-29**. Date-versioned references are pinned;
living product pages require re-verification before implementation changes.

| Source | Basis for this guidance |
| --- | --- |
| [MCP 2026-07-28 specification](https://modelcontextprotocol.io/specification/2026-07-28) | Date-versioned protocol, capabilities/extensions, trust and consent; verified through the official `latest` redirect |
| [MCP 2026-07-28 authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization) | Transport-specific authorization, metadata, resource identification, optionality and draft dependencies |
| [MCP security best practices](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices) | Consent, confused-deputy risks, token passthrough and authorization boundaries |
| [OWASP LLM07:2025](https://genai.owasp.org/llmrisk/llm072025-system-prompt-leakage/) | System prompts are not secrets or reliable security controls |
| [GitHub custom-agent configuration](https://docs.github.com/en/copilot/reference/custom-agents-configuration) | Metadata, target differences, omitted/wildcard/empty tool lists and retired `infer` property |
| [GitHub agent skills](https://docs.github.com/en/copilot/concepts/customizations/agent-skills) | Supported skill locations and client-dependent availability |
| [Agent Skills specification](https://agentskills.io/specification) | `SKILL.md` contract, progressive disclosure, recommended body sizes and experimental tool preapproval |

The broader operational criteria are CATES proposals, not claims that these
sources prescribe every acceptance test or that all clients implement them.
