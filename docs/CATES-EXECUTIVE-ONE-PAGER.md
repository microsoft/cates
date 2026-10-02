# CATES Executive One-Pager

## Coding Agent Token Economics Standard

**CATES is a vendor-neutral standard for governing the token footprint, security, and effectiveness of AI coding assistants.** It defines how organizations should structure, measure, and manage the instructions, prompts, rules, tool configurations, agents, hooks, and setup files that shape coding-agent behavior.

As AI coding tools become embedded across engineering teams, their configuration files become a new operational control plane. Those files determine what context is loaded, what tools agents may use, how secure the interaction is, and how many tokens are consumed before any useful work begins. Inefficient configuration directly becomes recurring context bloat, latency, and quality risk.

CATES gives leaders a common language and measurable framework for managing that risk.

The initial scan remains focused on configuration conformance. **Experimental
Annex L** extends the standard to end-to-end economics: actual request usage,
cache and output accounting, retries and delegation, non-model costs, and cost
per accepted task. These observations are separate from the configuration score.
See the [lifecycle coverage and evidence contract](TOKEN-ECONOMICS.md); no
unvalidated savings or vendor-independent price ratios are implied.

## Why it matters

AI coding assistants are moving from experimentation to enterprise-scale adoption. Without a standard, each team creates its own prompts, rules, agent definitions, and tool permissions. The result is predictable: duplicated guidance, oversized context, unclear authority, insecure tool access, and inconsistent quality.

CATES addresses this by establishing a disciplined operating model for coding-agent configuration:

| Executive concern | CATES response |
|---|---|
| **Token control** | Defines token budgets, loading scopes, and waste patterns. |
| **Security** | Requires protection against secrets exposure, prompt injection, unsafe execution, and excessive permissions. |
| **Productivity** | Improves signal-to-noise so agents allocate less context to boilerplate and more to useful work. |
| **Governance** | Provides conformance levels, policy controls, and measurable adoption targets. |
| **Vendor flexibility** | Applies across current and future coding-agent ecosystems rather than locking into one provider. |

## What CATES standardizes

CATES defines a taxonomy for the major configuration surfaces used by modern coding agents:

| Surface | Examples |
|---|---|
| **Instructions** | Repository, organization, or scoped guidance loaded by an assistant. |
| **Prompts and commands** | Reusable workflows, task prompts, slash commands, and prompt libraries. |
| **Agent definitions** | Specialized coding agents with roles, tools, and behavioral constraints. |
| **Rules and memories** | Persistent assistant rules that influence code generation or review. |
| **Tool configuration** | MCP servers, tool manifests, external integrations, and permissions. |
| **Setup and hooks** | Environment bootstrap, preflight checks, automation hooks, and guardrails. |

It also defines how these surfaces should be measured: what is always loaded, what is conditional, what is on demand, and how each category affects context footprint and behavior.

## Strategic outcomes

CATES helps organizations move from ad hoc prompt sprawl to managed AI engineering operations.

1. **Reduce avoidable token load** by eliminating duplicated, stale, verbose, or always-loaded context.
2. **Improve coding-agent quality** by making instructions specific, scoped, testable, and conflict-free.
3. **Lower security exposure** by standardizing permissions, injection resistance, and secret handling.
4. **Create executive visibility** into AI coding configuration quality across teams and portfolios.
5. **Enable governance without slowing adoption** by giving teams clear conformance levels and practical remediation paths.

## Conformance model

CATES uses progressive maturity levels so organizations can adopt the standard without requiring perfection on day one.

| Level | Meaning |
|---|---|
| **Level 1: Baseline** | Configurations exist, critical risks are absent, and basic hygiene is in place. |
| **Level 2: Managed** | High-risk findings are removed, always-loaded context is budgeted, and core guardrails exist. |
| **Level 3: Optimized** | Configurations are lean, secure, specific, low-noise, and ready for scaled governance. |

This gives executives a simple adoption metric while giving engineering teams a detailed path for improvement.

## The business case

CATES turns coding-agent configuration into a measurable management discipline. It reduces waste before it reaches the model, improves assistant effectiveness before teams blame the tool, and strengthens governance before agent usage becomes unmanaged infrastructure.

The core idea is simple: **every unnecessary token is recurring context bloat, every unclear instruction is quality risk, and every overpowered tool permission is security exposure.** CATES gives organizations the standard to manage all three.
