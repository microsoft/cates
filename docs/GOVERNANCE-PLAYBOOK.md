# CATES Governance Playbook

## Roles

- **Configuration Owner:** owns repository agent configuration.
- **Platform Engineer:** manages CI integration and policy defaults.
- **Security Champion:** reviews SEC findings and suppressions.
- **Platform Metrics Owner:** tracks token waste and reduction trends.

## Operating model

1. Require CATES analysis on PRs touching agent configuration.
2. Review suppressions monthly.
3. Publish portfolio scans to a central dashboard.
4. Raise required level gradually from Level 1 to Level 2.
5. Reserve Level 3 for showcase/high-volume repositories.

## End-to-end economics without changing the initial gate

The existing scan remains the first assessment. Treat its score as
configuration conformance, not spend, productivity, or ROI.

Use [Annex L runtime accounting](TOKEN-ECONOMICS.md) as a separate experimental
assessment for selected workloads. The metrics owner defines the cohort, cost
boundary, coverage declarations, rate provenance, and acceptance evidence.
Include failed/retried work, child and evaluator calls, human review, and
applicable non-model costs; do not report a known subtotal as a complete bill.

Review cost per accepted task alongside acceptance, rework/defects, safety, and
latency. A cheaper run with degraded quality is not a successful optimization.
Require comparable baseline/treatment evidence before claiming savings, and
keep unvalidated interventions experimental. Do not add Annex L metrics to
existing conformance levels or CI gates.
