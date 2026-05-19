# Azure Static Web Apps deployment

This directory deploys the **public-demo target** of the CATES Service.

- **Frontend** — the SPA in [`service/web/`](../../service/web/) is served
  as the static site root.
- **API** — the Azure Functions v4 app in
  [`service/functions/`](../../service/functions/) provides
  `/api/analyze`, `/api/rules`, `/api/healthz`, `/api/readyz`.
  `/api/scan` returns `501` on this target (no `git` binary in the
  Functions runtime); use ACA for repo scanning until Phase 2 lands the
  `isomorphic-git` rewrite.

## Initial setup

1. Create the Static Web App once in Azure (Free tier is fine for the
   demo):

   ```bash
   az staticwebapp create \
     -g rg-cates \
     -n swa-cates \
     -l eastus2 \
     --sku Free \
     --source https://github.com/msfttoler/cates \
     --branch main \
     --login-with-github
   ```

2. Grab the deployment token and add it to the repo as the GitHub Actions
   secret `AZURE_STATIC_WEB_APPS_API_TOKEN`:

   ```bash
   az staticwebapp secrets list -n swa-cates -g rg-cates \
     --query 'properties.apiKey' -o tsv
   ```

3. Push to `main`. The
   [`swa-deploy.yml`](../../.github/workflows/swa-deploy.yml) workflow
   builds the service, packages the SPA + Functions, and deploys.

## Configuration

[`staticwebapp.config.json`](./staticwebapp.config.json) sets:

- Anonymous access on `/api/*` and `/*`
- SPA navigation fallback to `/index.html`
- Global hardening headers (strict CSP, HSTS, noindex, nosniff,
  SAMEORIGIN, no-referrer)

## Local development with the SWA CLI

```bash
npm install -g @azure/static-web-apps-cli
npm run build:service

# In one terminal — Functions:
cd service/functions && func start

# In another — SWA CLI emulator:
swa start service/web --api-location http://localhost:7071
```

Default URL: `http://localhost:4280`.
