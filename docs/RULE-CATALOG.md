# CATES Rule Catalog

The machine-readable catalog is available from:

```bash
cates-analyzer rules --format json
```

Explain a single rule:

```bash
cates-analyzer explain TE004
```

The catalog includes ID, title, dimension, severity, summary, detection, remediation, CATES section, and autofix support.

## 🧪 Experimental rules (non-normative)

The catalog also includes **experimental** cache-shaping (`CS001`–`CS005`) and
output-shaping (`OS001`–`OS005`) rules, marked with a 🧪 in
`cates-analyzer rules` and tagged `"stability": "experimental"` in the JSON.

They are **off by default, carry zero scoring weight, and are excluded from
conformance and CI gates**. Enable them explicitly:

```bash
cates-analyzer . --experimental        # full report + experimental section
cates-analyzer . --experimental-only   # just the cache/output-shaping section
CATES_EXPERIMENTAL=1 cates-analyzer .   # or via env var (handy for CI trials)
cates-optimize . --experimental         # advisory token impact (never auto-applied)
```

See [`EXPERIMENTAL-CACHE-OUTPUT-DIMENSIONS.md`](./EXPERIMENTAL-CACHE-OUTPUT-DIMENSIONS.md)
for the full proposal and `CATES-v1.0.md` §5.4 / §9.9 / §9.10 for the rule
definitions. Experimental rule IDs are SemVer-exempt and may change.

## Economics measurements are not additional scored rules

The separate [Annex L economics assessment](TOKEN-ECONOMICS.md) accounts for
caller-supplied usage, prices/charges, and outcomes. It adds no rule IDs,
dimensions, or conformance gates. Detector confidence describes the strength
of a static signal, not calibrated precision or proven savings. Stable rule
status is a compatibility promise, not empirical economic validation.

## Copilot hygiene checks are a separate profile

`cates-analyzer rules --copilot` lists `GHCP001` through `GHCP015`.
Use `cates-analyzer explain GHCP007` for an individual check and
`cates-analyzer . --copilot` to run the profile.

These checks live under `result.copilot`, not the stable findings or
cache/output dimensions. The API exposes them as `copilotChecks`; SARIF
retains them as run metadata, not alerts. The 49 stable rules and 10 existing
cache/output rules remain in the original catalog.

See [Copilot hygiene](COPILOT-HYGIENE.md) for the full coverage matrix,
target differences, evidence basis, policy controls and external checks.
