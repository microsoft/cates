# CATES Implementation Guide

## Quick start

```bash
npm ci
npm run build
npx tsx src/cli/index.ts analyze . --format json > report.json
```

## Recommended rollout

1. Run `cates-analyzer analyze --format json` across representative repositories.
2. Set `.cates.yml` to Level 1 initially.
3. Fix critical/high security findings.
4. Reduce always-loaded tokens below 1,500.
5. Move project-specific guidance into scoped or on-demand files.
6. Raise the policy to Level 2 once teams have remediated recurring findings.

## Policy file

```yaml
minScore: 80
requireLevel: 2
failOn: [critical, high]
maxAlwaysLoadedTokens: 1500
suppressions:
  - ruleId: SEC004
    file: generated/agent-doc.md
    reason: Generated documentation, not loaded by any agent
    expires: 2026-12-31
```
