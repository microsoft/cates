# Helm chart: CATES batch scans

This chart runs a one-shot **Job** or scheduled **CronJob**. It does not deploy
the browser/API service. For the quickest local experience, use the
[illustrated user guide](../../../docs/USER-GUIDE.md).

## Before installing

- Use an image that exists and is reachable by your cluster. The chart defaults
  to `ghcr.io/microsoft/cates` and its `appVersion`; those defaults do not
  establish that a release has been published.
- Supply explicit scan arguments. The default demo arguments have no repository
  manifest, so they do not select useful scan targets.
- Arrange GitHub access, image-pull credentials and network egress as needed.
  Helm does not provision them automatically.

## Render a one-shot review before deploying

Replace `YOUR_REGISTRY`, `YOUR_TAG`, `OWNER` and `REPO` with actual values:

```bash
helm template cates ./deploy/helm/cates \
  --namespace cates \
  --set mode=job \
  --set image.repository=YOUR_REGISTRY/cates \
  --set image.tag=YOUR_TAG \
  --set-json 'args=["review","https://github.com/OWNER/REPO","--format","json"]'
```

This renders manifests locally; it does not create cluster resources. When the
rendered configuration and image are ready, use the same values with
`helm upgrade --install cates ./deploy/helm/cates --namespace cates --create-namespace`.
A one-shot Job is not an automatically repeated service.

## Schedule a batch of repositories

Create a values file such as `cates-values.yaml`:

```yaml
mode: cronjob
schedule: "0 6 * * *"
image:
  repository: YOUR_REGISTRY/cates
  tag: YOUR_TAG
repos:
  enabled: true
  content: |
    platform https://github.com/microsoft/cates
args:
  - demo
  - --repos-file
  - /etc/cates/repos.txt
  - --limit
  - "25"
  - --format
  - json
```

This example selects a public repository. Replace or extend it with the public
repositories you want to scan. Demo uses Git directly; private batch scans need
a configured Git credential helper or equivalent approved authentication.
Setting `GH_TOKEN` alone does not authenticate raw Git.

```bash
helm template cates ./deploy/helm/cates -n cates -f cates-values.yaml
helm upgrade --install cates ./deploy/helm/cates \
  -n cates --create-namespace -f cates-values.yaml
```

The schedule has no explicit chart timezone field; its interpretation follows
the cluster's CronJob configuration. The default concurrency policy is `Forbid`.

## Policy for a single-repository review

Enable the mounted policy **and** pass its path to a command that supports it:

```yaml
policy:
  enabled: true
  content: |
    minScore: 80
    requireLevel: 1
    failOn: [critical]
    copilot: all
args:
  - review
  - https://github.com/OWNER/REPO
  - --policy
  - /etc/cates/policy.yml
  - --format
  - json
```

Demo and portfolio do not accept this policy flag. The chart's sample policy
defaults are not a substitute for an explicitly chosen CATES policy.

For a private `review`, reference an existing Secret; the default review path
can use the GitHub CLI with the injected token:

```yaml
githubToken:
  existingSecret: cates-gh
  existingSecretKey: token
```

The Secret and key must already exist in the namespace. This is distinct from
the raw-Git authentication required by private demo batches.

## Identity, isolation and output

| Setting | What the chart provides |
| --- | --- |
| `githubToken.existingSecret` | Reference to an existing Secret rather than a token value in command history |
| `githubToken.workloadIdentity` | ServiceAccount/pod metadata for a separate identity integration |
| `securityContext`, `podSecurityContext` | Non-root execution, read-only root filesystem and reduced privileges |
| `networkPolicy.enabled` | Optional network policy; review DNS and HTTPS requirements in your cluster |
| `resources`, `job` | Resource requests/limits, deadlines, retries and lifecycle controls |
| `reports.persistence` | A mounted persistent reports volume, not automatic report capture |
| `image.pullSecrets`, scheduling settings | Existing image credentials and cluster placement controls |

Workload-identity annotations alone **do not exchange an identity for a GitHub
installation token**. This chart does not ship that exchange component. Supply
an approved integration before relying on it for authentication.

The analyzer writes reports to **stdout**. There is no `--output` option, and
enabling a reports PVC does not make CATES write into it. Use your log collector,
or implement an explicit report writer in your deployment. For a single Job:

```bash
kubectl logs job/JOB_NAME -n cates > cates-job.log
```

Container logs can contain errors as well as reports; do not assume every log
file is valid JSON. Never place tokens in Helm command arguments or committed
values files.

## Uninstall

```bash
helm uninstall cates -n cates
```

Review persistent-volume retention separately. See the
[maintainer runbook](../../../docs/MAINTAINER-SETUP.md) for release/image bootstrap,
which is separate from chart installation.
