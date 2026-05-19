// Azure App Service (Web App for Containers) deployment for the CATES Service.
//
// Use this when you prefer App Service over Azure Container Apps —
// e.g., to fit an existing App Service Environment or App Service Plan,
// or because your org standardizes on Web Apps for Linux.
//
// This template only DEFINES the infrastructure. It is *not* invoked by
// any CI workflow. Trigger it manually when you want a deployment:
//
//   az group create -n rg-cates -l eastus2
//   az deployment group create -g rg-cates \
//     -f deploy/appservice/cates-service.bicep \
//     -p image=ghcr.io/msfttoler/cates:latest
//
// After deployment, browse to https://<appName>.azurewebsites.net.

@description('App Service Plan name. Created if it does not exist.')
param planName string = 'plan-cates'

@description('Web App name. Must be globally unique.')
param appName string = 'app-cates-${uniqueString(resourceGroup().id)}'

@description('Azure region.')
param location string = resourceGroup().location

@description('Container image reference (registry/repo:tag). Must include the service entrypoint, e.g. `node /app/dist-service/service/server.js`.')
param image string

@description('App Service Plan SKU. B1 is the cheapest always-on tier; choose P1v3 / P2v3 for production workloads.')
@allowed([
  'B1'
  'B2'
  'B3'
  'S1'
  'S2'
  'S3'
  'P0v3'
  'P1v3'
  'P2v3'
  'P3v3'
])
param sku string = 'B1'

@description('Container port the Express server listens on.')
param targetPort int = 8080

@description('Optional command override; pass empty string to use the image ENTRYPOINT.')
param startupCommand string = 'node /app/dist-service/service/server.js'

// ─── App Service Plan (Linux) ────────────────────────────────────────────────

resource plan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: planName
  location: location
  sku: {
    name: sku
  }
  kind: 'linux'
  properties: {
    reserved: true // Linux
  }
}

// ─── Web App for Containers ──────────────────────────────────────────────────

resource webApp 'Microsoft.Web/sites@2024-04-01' = {
  name: appName
  location: location
  kind: 'app,linux,container'
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'DOCKER|${image}'
      alwaysOn: !startsWith(sku, 'B')
      http20Enabled: true
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      appCommandLine: empty(startupCommand) ? '' : startupCommand
      appSettings: [
        {
          name: 'WEBSITES_PORT'
          value: string(targetPort)
        }
        {
          name: 'PORT'
          value: string(targetPort)
        }
        {
          name: 'NODE_ENV'
          value: 'production'
        }
        {
          name: 'WEBSITES_ENABLE_APP_SERVICE_STORAGE'
          value: 'false'
        }
        {
          name: 'WEBSITE_HEALTHCHECK_MAXPINGFAILURES'
          value: '3'
        }
      ]
      healthCheckPath: '/api/healthz'
    }
  }
}

output appName string = webApp.name
output defaultHostName string = webApp.properties.defaultHostName
