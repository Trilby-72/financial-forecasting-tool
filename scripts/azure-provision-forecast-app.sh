#!/usr/bin/env bash
set -euo pipefail

# Provision Azure resources for the standalone HC2 forecasting app.
# Usage:
#   chmod +x scripts/azure-provision-forecast-app.sh
#   ./scripts/azure-provision-forecast-app.sh
#
# Prerequisites:
# - Azure CLI installed
# - `az login` completed
# - Subscription selected (`az account set --subscription <id-or-name>`)

LOCATION="australiaeast"
RESOURCE_GROUP="rg-hc2-forecast-prod"
APP_SERVICE_PLAN="asp-hc2-forecast-prod"
WEB_APP="app-hc2-forecast-prod"
SQLITE_DB_PATH="/home/site/data/cashflow.db"
RUNTIME="NODE|22-lts"
SKU="B1"

# Optional: override defaults with environment variables
LOCATION="${LOCATION_OVERRIDE:-$LOCATION}"
RESOURCE_GROUP="${RESOURCE_GROUP_OVERRIDE:-$RESOURCE_GROUP}"
APP_SERVICE_PLAN="${APP_SERVICE_PLAN_OVERRIDE:-$APP_SERVICE_PLAN}"
WEB_APP="${WEB_APP_OVERRIDE:-$WEB_APP}"
SQLITE_DB_PATH="${SQLITE_DB_PATH_OVERRIDE:-$SQLITE_DB_PATH}"
RUNTIME="${RUNTIME_OVERRIDE:-$RUNTIME}"
SKU="${SKU_OVERRIDE:-$SKU}"

printf "\nProvisioning forecasting app resources in subscription:\n"
az account show --query "{name:name,id:id,tenantId:tenantId}" -o table

printf "\nCreating resource group %s in %s...\n" "$RESOURCE_GROUP" "$LOCATION"
az group create \
  --name "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --output table

printf "\nCreating Linux App Service plan %s...\n" "$APP_SERVICE_PLAN"
az appservice plan create \
  --name "$APP_SERVICE_PLAN" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --is-linux \
  --sku "$SKU" \
  --output table

printf "\nCreating Web App %s...\n" "$WEB_APP"
az webapp create \
  --name "$WEB_APP" \
  --resource-group "$RESOURCE_GROUP" \
  --plan "$APP_SERVICE_PLAN" \
  --runtime "$RUNTIME" \
  --output table

printf "\nConfiguring app settings...\n"
az webapp config appsettings set \
  --name "$WEB_APP" \
  --resource-group "$RESOURCE_GROUP" \
  --settings NODE_ENV=production SQLITE_DB_PATH="$SQLITE_DB_PATH" \
  --output table

printf "\nEnforcing HTTPS only...\n"
az webapp update \
  --name "$WEB_APP" \
  --resource-group "$RESOURCE_GROUP" \
  --https-only true \
  --output table

printf "\nSetting startup command...\n"
az webapp config set \
  --name "$WEB_APP" \
  --resource-group "$RESOURCE_GROUP" \
  --startup-file "npm start" \
  --output table

printf "\nDone. Forecasting app infrastructure created.\n"
printf "Web app URL: https://%s.azurewebsites.net\n" "$WEB_APP"

printf "\nNext steps:\n"
printf "1) Update workflow env AZURE_WEBAPP_NAME to %s\n" "$WEB_APP"
printf "2) Download publish profile in Azure Portal and set GitHub secret AZUREAPPSERVICE_PUBLISHPROFILE\n"
printf "3) Push to main or run GitHub Actions workflow manually\n\n"
