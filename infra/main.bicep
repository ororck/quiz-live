@description('Nom de l\'application')
param appName string = 'quiz-live'

@description('Region Azure')
param location string = resourceGroup().location

@description('Image Docker a deployer')
param dockerImage string = 'ororck/quiz-live:latest'

// --- Container Apps Environment ---
resource containerAppEnv 'Microsoft.App/managedEnvironments@2023-05-01' = {
  name: '${appName}-env'
  location: location
  properties: {
  }
}

// --- Container App ---
resource containerApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: appName
  location: location
  properties: {
    managedEnvironmentId: containerAppEnv.id
    configuration: {
      ingress: {
        external: true
        targetPort: 8000
        transport: 'auto'
      }
    }
    template: {
      containers: [
        {
          name: appName
          image: dockerImage
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 3
      }
    }
  }
}

// --- Output : URL publique ---
output appUrl string = 'https://${containerApp.properties.configuration.ingress.fqdn}'
