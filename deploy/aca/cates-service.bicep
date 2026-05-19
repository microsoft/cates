// Azure Container Apps **App** (not Job) for the CATES Service.
//
// Deploys the always-on HTTP service that powers the paste / scan / rules
// endpoints and serves the SPA. Reuses the same container image as the CLI
// — the Dockerfile's entrypoint is just overridden to launch the service.
//
// Deploy:
//   az group create -n rg-cates -l eastus2
//   az deployment group create -g rg-cates -f deploy/aca/cates-service.bicep \
//     -p image=ghcr.io/msfttoler/cates:1.1.0
//
// After deployment, browse to the FQDN printed in the outputs.

@description('ACA environment name. Created if it does not exist.')
param environmentName string = 'cae-cates'

@description('ACA App name.')
param appName string = 'cates-service'

@description('Azure region.')
param location string = resourceGroup().location

@description('Container image reference (registry/repo:tag). Must include the service entrypoint, e.g. `node /app/dist-service/service/server.js`.')
param image string

@description('CPU cores (0.25 - 4).')
param cpu string = '0.5'

@description('Memory (e.g. 1Gi).')
param memory string = '1Gi'

@description('Min replicas. Set to 0 for scale-to-zero on idle.')
@minValue(0)
@maxValue(10)
param minReplicas int = 0

@description('Max replicas under load.')
@minValue(1)
@maxValue(30)
param maxReplicas int = 5

@description('Concurrent requests per replica before scale-out triggers.')
param scaleConcurrency int = 30

@description('Container port the Express server listens on.')
param targetPort int = 8080

// ─── Log Analytics + ACA environment ─────────────────────────────────────────

resource law 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'law-${appName}'
  location: location
  properties: {
    retentionInDays: 30
    sku: { name: 'PerGB2018' }
  }
}

resource env 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: environmentName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: law.properties.customerId
        sharedKey: law.listKeys().primarySharedKey
      }
    }
  }
}

// ─── The service ─────────────────────────────────────────────────────────────

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: appName
  location: location
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      ingress: {
        external: true
        targetPort: targetPort
        transport: 'auto'
        allowInsecure: false
        // ACA gives us TLS + an HTTPS hostname for free.
      }
    }
    template: {
      containers: [
        {
          name: appName
          image: image
          // The Dockerfile's default ENTRYPOINT runs the CLI; override here.
          // Update once a service-specific image is published.
          command: [ 'node' ]
          args: [ '/app/dist-service/service/server.js' ]
          env: [
            {
              name: 'PORT'
              value: string(targetPort)
            }
            {
              name: 'NODE_ENV'
              value: 'production'
            }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: { path: '/api/healthz', port: targetPort }
              periodSeconds: 30
              failureThreshold: 3
              initialDelaySeconds: 5
            }
            {
              type: 'Readiness'
              httpGet: { path: '/api/readyz', port: targetPort }
              periodSeconds: 10
              failureThreshold: 3
              initialDelaySeconds: 3
            }
          ]
          resources: {
            cpu: json(cpu)
            memory: memory
          }
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
        rules: [
          {
            name: 'http-concurrency'
            http: {
              metadata: {
                concurrentRequests: string(scaleConcurrency)
              }
            }
          }
        ]
      }
    }
  }
}

output fqdn string = app.properties.configuration.ingress.fqdn
output appName string = app.name
