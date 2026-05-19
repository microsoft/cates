# Azure App Service deployment (manual)

This template deploys the CATES Service as an **Azure Web App for
Containers** on an App Service Plan. It pulls the same container image
the [ACA template](../aca/cates-service.bicep) uses; the only difference
is the hosting surface.

> **No CI auto-deploy.** This template is invoked only when you run
> `az deployment group create`. There is no GitHub Actions workflow that
> deploys on push.

## When to pick App Service over ACA

| Pick App Service when… | Pick ACA when… |
| --- | --- |
| Your org already standardizes on App Service / has an existing App Service Plan | You want true scale-to-zero on idle |
| You need App Service-specific features (slots, Easy Auth, App Service Environment) | You want event-driven scaling on HTTP concurrency |
| You're more comfortable with App Service operations | You prefer Container Apps' simpler revisions model |

## Deploy

```bash
# Provision the resource group
az group create -n rg-cates -l eastus2

# Deploy
az deployment group create \
  -g rg-cates \
  -f deploy/appservice/cates-service.bicep \
  -p image=ghcr.io/msfttoler/cates:latest
```

Parameters you may want to override:

| Param | Default | Notes |
| --- | --- | --- |
| `planName` | `plan-cates` | Reuse an existing plan by setting this to its name. |
| `appName` | `app-cates-<hash>` | Must be globally unique. |
| `sku` | `B1` | `B*` is cheapest; bump to `P1v3` or `P2v3` for production. |
| `targetPort` | `8080` | Matches the Express server inside the image. |
| `startupCommand` | `node /app/dist-service/service/server.js` | Set to `''` to honor the image's ENTRYPOINT (which runs the CLI). |

After deployment, browse to `https://<appName>.azurewebsites.net`.

## What ships in the image

The container image carries **both the CLI and the service** so the same
artifact deploys here, to ACA, to your laptop, or to a Kubernetes
cluster:

```text
/app/dist/cli/index.js                CLI (default ENTRYPOINT)
/app/dist-service/service/server.js   HTTP service (App Service / ACA)
```

The startup command above selects the service.
