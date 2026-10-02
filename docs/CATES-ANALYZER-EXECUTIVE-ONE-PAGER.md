# CATES Analyzer Executive One-Pager

## Reference tooling for measuring CATES adoption

**The CATES Analyzer is a deterministic, offline assessment tool that helps organizations measure coding-agent configuration quality against the Coding Agent Token Economics Standard.** It scans repository configuration surfaces, scores them for token efficiency, security, specificity, completeness, conflicts, and harness quality, then produces actionable reporting for engineering teams and leadership.

The analyzer is not an AI assistant and does not call a model. It is a governance and measurement tool: it evaluates the files that shape AI coding-agent behavior before those files create token bloat, risk, or inconsistent outcomes at scale.

The initial scan is unchanged. A separate **experimental economics assessment**
now consumes caller-supplied usage, rates/charges, and task outcomes, reporting
cost per accepted task with explicit coverage gaps. It does not automatically
collect telemetry, verify invoices, or prove an optimization's benefit.
The [Annex L implementation guide](TOKEN-ECONOMICS.md) distinguishes shipped
accounting from unvalidated hypotheses and future diagnostics.

## What it does

The analyzer reviews the configuration assets used by modern coding-agent ecosystems, including instructions, prompt libraries, agent definitions, rules, MCP/tool configuration, setup steps, hooks, and editor settings. It then produces a structured report that can be used by individual teams, platform engineering groups, security teams, and executive stakeholders.

| Capability | Business value |
|---|---|
| **Configuration discovery** | Finds the files that influence coding-agent behavior across common ecosystem conventions. |
| **Token efficiency scoring** | Identifies duplicated, oversized, verbose, or always-loaded context that dilutes useful signal. |
| **Security review** | Flags secrets, prompt injection risks, unsafe command patterns, and excessive permissions. |
| **Quality assessment** | Detects vague instructions, missing essential guidance, conflicts, and weak harness controls. |
| **Conformance evaluation** | Maps repositories to CATES Level 1, 2, or 3 for portfolio-level governance. |
| **Recommendations** | Gives teams practical remediation guidance rather than just raw findings. |

## Why executives should care

At enterprise scale, AI coding-agent configuration becomes an invisible source of token bloat and risk. A few hundred unnecessary always-loaded tokens repeated across daily interactions can crowd out useful context. Poorly scoped instructions can reduce developer trust. Unsafe tool permissions can create security exposure.

The CATES Analyzer gives organizations a way to see and manage those issues before they compound.

## Outputs for different stakeholders

| Stakeholder | Analyzer output |
|---|---|
| **Engineering teams** | Specific findings and recommendations for improving local repository configuration. |
| **Platform engineering** | Policy gates, conformance levels, reusable standards, and portfolio comparisons. |
| **Security teams** | Evidence of risky patterns, tool permission issues, prompt protection gaps, and secrets exposure. |
| **Engineering leadership** | Token counts, reduction percentages, and score trends for portfolio-level improvement. |
| **Executives** | Scorecards showing readiness, maturity, and risk posture across engineering portfolios. |

## Deployment model

The analyzer is designed for low-friction adoption:

1. **Local assessment** by repository owners during cleanup or onboarding.
2. **CI quality gates** to prevent new high-risk or high-waste configuration from being introduced.
3. **Portfolio scanning** to compare readiness across many repositories or business units.
4. **Dashboard reporting** through static report visualization for leadership and program reviews.

Because the analyzer runs locally and does not transmit repository content to an external model, it can fit conservative security environments and early governance programs.

## Strategic use cases

The highest-value use cases are:

1. **AI coding readiness assessment** before expanding assistant adoption.
2. **Token reduction programs** focused on eliminating recurring context waste.
3. **Secure agent rollout** for teams adopting tool-enabled or autonomous coding agents.
4. **Portfolio governance** across many teams with inconsistent configuration practices.
5. **Continuous improvement** through policy gates, score tracking, and conformance targets.

## Success measures

A mature analyzer rollout should produce measurable improvements:

| Metric | Desired direction |
|---|---|
| Always-loaded tokens per repository | Down |
| Critical/high security findings | Down to zero |
| CATES conformance level | Up |
| Duplicate or generic instruction volume | Down |
| Repositories with policy gates | Up |
| Developer trust in assistant output | Up |

## Bottom line

The CATES Analyzer operationalizes the CATES standard. It gives organizations a practical way to find token waste, reduce risk, improve coding-agent effectiveness, and govern adoption across portfolios without sending sensitive content to an external AI service.
