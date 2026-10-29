# CATES Conformance

CATES defines repository conformance levels:

| Level | Requirement summary |
|-------|---------------------|
| 1 | No critical findings, no hardcoded secrets, score >= 40, at least one config file |
| 2 | Level 1 plus no high findings, score >= 70, always-loaded <= 1,500, prompt protection, no contradictions |
| 3 | Level 2 plus no findings above low, score >= 90, always-loaded <= 800, described MCP servers, prompt purpose headers |

Run:

```bash
cates-analyzer conformance . --require-level 2
```

These are v1 configuration criteria, not runtime security certification.
SEC004's prompt-protection requirement is retained for compatibility; matching
non-disclosure text does not enforce confidentiality, authorization, or
resistance to prompt injection. Do not place secrets in instructions.

The [Modern Agent Assurance proposal](MODERN-AGENT-ASSURANCE.md) separates
effective loading, privileges, skills, MCP interoperability, and outcome evidence
from the static score. It adds no level requirements or automated checks.
Changes to stable pass/fail behavior require a versioned migration, not an
unannounced standards refresh.
