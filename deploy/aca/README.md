# Azure Container Apps deployment

CATES runs naturally as an **ACA Job** (not a long-running app) since it's a
batch analyzer that exits when done.

## Quick start (CLI)

```bash
RG=rg-cates
LOC=eastus2
IMG=ghcr.io/microsoft/cates:1.0.0

az group create -n $RG -l $LOC

az deployment group create \
  -g $RG \
  -f cates-job.bicep \
  -p image=$IMG githubToken=$GH_TOKEN
```

## Trigger modes

| `triggerType` | Use case                                           |
|---------------|----------------------------------------------------|
| `Schedule`    | Periodic portfolio scan (default, cron-driven)     |
| `Manual`      | Run on demand: `az containerapp job start -n cates -g $RG` |
| `Event`       | Wire up to Service Bus / storage / KEDA scalers    |

## Pure `az` (no Bicep)

```bash
az containerapp env create -n cae-cates -g $RG -l $LOC

az containerapp job create \
  -n cates -g $RG \
  --environment cae-cates \
  --trigger-type Schedule \
  --cron-expression "0 6 * * *" \
  --replica-timeout 3600 \
  --replica-retry-limit 1 \
  --image ghcr.io/microsoft/cates:1.0.0 \
  --cpu 0.5 --memory 1Gi \
  --secrets gh-token=$GH_TOKEN \
  --env-vars GH_TOKEN=secretref:gh-token \
  --args "demo --limit 10 --format json"
```

## Managed identity for GitHub auth

The bicep enables a system-assigned identity on the job. To avoid storing
`GH_TOKEN` as a secret, add an init step (or wrap the CLI) that exchanges
the federated MI token for a GitHub App installation token at runtime, then
write it to `GH_TOKEN` before invoking `cates-analyzer`.

For most teams a Key Vault-backed secret is the right trade-off:

```bash
az containerapp job secret set -n cates -g $RG \
  --secrets gh-token=keyvaultref:https://kv-cates.vault.azure.net/secrets/gh-token,identityref:system
```
