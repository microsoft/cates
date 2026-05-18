# Helm chart: cates

Deploy the CATES analyzer to any Kubernetes cluster (AKS, EKS, GKE, k3s, kind)
as a one-shot Job or a scheduled CronJob.

## Install

```bash
helm install cates ./deploy/helm/cates \
  --namespace cates --create-namespace \
  --set image.tag=1.0.0 \
  --set githubToken.value=ghp_xxx \
  --set-json 'args=["demo","--limit","10","--format","json"]'
```

## Common patterns

### Scheduled portfolio scan (default)

```bash
helm install cates ./deploy/helm/cates \
  --set schedule="0 6 * * *" \
  --set githubToken.existingSecret=cates-gh \
  --set-json 'args=["demo","--category","microsoft","--limit","25","--format","json"]'
```

### One-shot review of a single repo

```bash
helm install cates-review ./deploy/helm/cates \
  --set mode=job \
  --set githubToken.value=$GH_TOKEN \
  --set-json 'args=["review","https://github.com/owner/repo","--format","sarif"]'
```

### AKS Workload Identity

Avoid storing a token in-cluster. Federate an Entra app to the chart's
ServiceAccount, then have your init container (or a sidecar) exchange the
federated token for a GitHub App installation token and write it to a
shared volume / env var consumed by cates.

```bash
helm install cates ./deploy/helm/cates \
  --set githubToken.workloadIdentity.enabled=true \
  --set githubToken.workloadIdentity.clientId=$AZ_CLIENT_ID \
  --set githubToken.workloadIdentity.tenantId=$AZ_TENANT_ID
```

### Persistent reports

```bash
helm install cates ./deploy/helm/cates \
  --set reports.persistence.enabled=true \
  --set reports.persistence.storageClass=managed-csi \
  --set-json 'args=["demo","--format","json","--output","/work/reports/scan.json"]'
```

## Uninstall

```bash
helm uninstall cates -n cates
```
