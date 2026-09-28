#!/usr/bin/env bash
set -euo pipefail

# Enable basic observability for the forecasting app.
# Usage:
#   chmod +x scripts/azure-enable-observability.sh
#   ./scripts/azure-enable-observability.sh

LOCATION="australiaeast"
RESOURCE_GROUP="rg-hc2-forecast-prod"
WEB_APP="app-hc2-forecast-prod"
APP_INSIGHTS="ai-hc2-forecast-prod"

LOCATION="${LOCATION_OVERRIDE:-$LOCATION}"
RESOURCE_GROUP="${RESOURCE_GROUP_OVERRIDE:-$RESOURCE_GROUP}"
WEB_APP="${WEB_APP_OVERRIDE:-$WEB_APP}"
APP_INSIGHTS="${APP_INSIGHTS_OVERRIDE:-$APP_INSIGHTS}"

printf "\nCreating Application Insights component %s...\n" "$APP_INSIGHTS"
az monitor app-insights component create \
  --app "$APP_INSIGHTS" \
  --location "$LOCATION" \
  --resource-group "$RESOURCE_GROUP" \
  --application-type web \
  --output table

CONNECTION_STRING=$(az monitor app-insights component show \
  --app "$APP_INSIGHTS" \
  --resource-group "$RESOURCE_GROUP" \
  --query connectionString -o tsv)

printf "\nApplying Application Insights connection string to Web App...\n"
az webapp config appsettings set \
  --name "$WEB_APP" \
  --resource-group "$RESOURCE_GROUP" \
  --settings APPLICATIONINSIGHTS_CONNECTION_STRING="$CONNECTION_STRING" \
  --output table

printf "\nDone. Application Insights linked to %s.\n\n" "$WEB_APP"
