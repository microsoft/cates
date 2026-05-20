// Azure Container Apps Job for cates-analyzer.
//
// Deploys cates as an event-driven or scheduled ACA Job (not a long-running
// app). Pulls the image from any OCI registry, mounts GH_TOKEN from Key Vault
// via a secret, and runs on the consumption plan.
//
// Deploy:
//   az group create -n rg-cates -l eastus2
//   az deployment group create -g rg-cates -f deploy/aca/cates-job.bicep \
//     -p image=ghcr.io/microsoft/cates:1.0.0 githubToken=$GH_TOKEN

@description('ACA environment name. Created if it does not exist.')
param environmentName string = 'cae-cates'

@description('ACA Job name.')
param jobName string = 'cates'

@description('Azure region.')
param location string = resourceGroup().location

@description('Container image reference (registry/repo:tag).')
param image string

@description('GitHub token used by the analyzer. Stored as an ACA secret.')
@secure()
param githubToken string

@description('Trigger mode: Schedule, Event, or Manual.')
@allowed([ 'Schedule', 'Event', 'Manual' ])
param triggerType string = 'Schedule'

@description('Cron expression when triggerType=Schedule. Default: daily 06:00 UTC.')
param cronExpression string = '0 6 * * *'

@description('CLI args passed to cates-analyzer.')
param args array = [
  'demo'
  '--limit'
  '10'
  '--format'
  'json'
]

@description('CPU cores (0.25 - 4).')
param cpu string = '0.5'

@description('Memory (e.g. 1Gi).')
param memory string = '1Gi'

@description('Max retries on failure.')
param replicaRetryLimit int = 1

@description('Per-replica timeout in seconds.')
param replicaTimeout int = 3600

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-${jobName}'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource env 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: environmentName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
    workloadProfiles: [
      {
        name: 'Consumption'
        workloadProfileType: 'Consumption'
      }
    ]
  }
}

resource job 'Microsoft.App/jobs@2024-03-01' = {
  name: jobName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    environmentId: env.id
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: triggerType
      replicaTimeout: replicaTimeout
      replicaRetryLimit: replicaRetryLimit
      scheduleTriggerConfig: triggerType == 'Schedule' ? {
        cronExpression: cronExpression
        parallelism: 1
        replicaCompletionCount: 1
      } : null
      manualTriggerConfig: triggerType == 'Manual' ? {
        parallelism: 1
        replicaCompletionCount: 1
      } : null
      secrets: [
        {
          name: 'gh-token'
          value: githubToken
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'cates'
          image: image
          args: args
          resources: {
            cpu: json(cpu)
            memory: memory
          }
          env: [
            {
              name: 'GH_TOKEN'
              secretRef: 'gh-token'
            }
          ]
        }
      ]
    }
  }
}

output jobName string = job.name
output principalId string = job.identity.principalId
