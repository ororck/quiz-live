#!/bin/bash
# Script de création du File Share Azure pour persister quiz.db
# Lance-le une seule fois depuis ton terminal

RESOURCE_GROUP="msaidiRG"
STORAGE_ACCOUNT="quizlivestore$RANDOM"  # nom unique
SHARE_NAME="quizdata"
CONTAINER_APP="quiz-live"

# 1. Créer le storage account
az storage account create \
  --name $STORAGE_ACCOUNT \
  --resource-group $RESOURCE_GROUP \
  --location francecentral \
  --sku Standard_LRS \
  --kind StorageV2

# 2. Créer le file share
az storage share create \
  --name $SHARE_NAME \
  --account-name $STORAGE_ACCOUNT

# 3. Récupérer la clé du storage
STORAGE_KEY=$(az storage account keys list \
  --resource-group $RESOURCE_GROUP \
  --account-name $STORAGE_ACCOUNT \
  --query "[0].value" -o tsv)

# 4. Monter le file share dans Container Apps
az containerapp storage set \
  --name $CONTAINER_APP \
  --resource-group $RESOURCE_GROUP \
  --storage-name quizdata \
  --azure-file-account-name $STORAGE_ACCOUNT \
  --azure-file-account-key $STORAGE_KEY \
  --azure-file-share-name $SHARE_NAME \
  --access-mode ReadWrite

# 5. Mettre à jour le container avec le volume monté et DATABASE_URL pointant vers le file share
az containerapp update \
  --name $CONTAINER_APP \
  --resource-group $RESOURCE_GROUP \
  --image ororck/quiz-live:latest \
  --set-env-vars "DATABASE_URL=sqlite:////mnt/quizdata/quiz.db" \
  --revision-suffix v8

echo "File Share monté sur /mnt/quizdata/quiz.db"
echo "Storage account : $STORAGE_ACCOUNT"
