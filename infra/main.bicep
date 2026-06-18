@description('Nom de l\'application')
param appName string = 'quiz-live'

@description('Region Azure')
param location string = resourceGroup().location

@description('Image Docker a deployer')
param dockerImage string = 'ororck/quiz-live:latest'

@description('Nom du storage account pour persister quiz.db')
param storageAccountName string

@description('Mot de passe admin PostgreSQL (non utilise en SQLite, garde pour future migration)')
@secure()
param storageAccountKey string

// --- Storage Account (File Share pour persister quiz.db) ---
// Deja cree manuellement via setup_fileshare.sh, on le reference ici
resource storageAccount 'Microsoft.Storage/storageAccounts@2023-01-01' existing = {
  name: storageAccountName
}

// --- Container Apps Environment ---
resource containerAppEnv 'Microsoft.App/managedEnvironments@2023-05-01' = {
  name: '${appName}-env'
  location: location
  properties: {
  }
}

// Montage du File Share dans l'environnement
resource envStorage 'Microsoft.App/managedEnvironments/storages@2023-05-01' = {
  name: 'quizdata'
  parent: containerAppEnv
  properties: {
    azureFile: {
      accountName: storageAccountName
      accountKey: storageAccountKey
      shareName: 'quizdata'
      accessMode: 'ReadWrite'
    }
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
          env: [
            {
              // Pointe vers le File Share monte en /mnt/quizdata
              name: 'DATABASE_URL'
              value: 'sqlite:////mnt/quizdata/quiz.db'
            }
          ]
          // Monte le volume dans le container
          volumeMounts: [
            {
              volumeName: 'quizdata'
              mountPath: '/mnt/quizdata'
            }
          ]
        }
      ]
      // Declaration du volume lie au File Share
      volumes: [
        {
          name: 'quizdata'
          storageType: 'AzureFile'
          storageName: 'quizdata'
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 3
      }
    }
  }
  // Le volume doit etre declare dans l'environnement avant le container
  dependsOn: [envStorage]
}

// --- Output : URL publique ---
output appUrl string = 'https://${containerApp.properties.configuration.ingress.fqdn}'
