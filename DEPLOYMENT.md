# Forecasting App Azure Deployment Runbook

This runbook is for deploying the forecasting app as a standalone Azure application in your tenant.

## 1. Target naming (recommended)

Use a dedicated naming set that is not shared with Staff Calendar resources.

- Resource group: rg-hc2-forecast-prod
- App Service plan: asp-hc2-forecast-prod
- Web app: app-hc2-forecast-prod
- Application Insights: ai-hc2-forecast-prod

## 2. Provision Azure resources

Create these in the same Azure region:

- Resource group
- Linux App Service Plan (Node 22 compatible)
- Web App (Linux, Node 22)
- Optional Application Insights

If you keep SQLite in production, create a Storage Account and Azure Files share for durable file persistence.

## 3. Configure App Service

In App Service Configuration, set:

- NODE_ENV = production
- SQLITE_DB_PATH = /home/site/data/cashflow.db

Do not set VITE_API_BASE for same-host deployment. Frontend defaults to /api.

Mount an Azure Files share to `/home/site/data` in the Web App's Path mappings configuration. The application creates `cashflow.db` inside that mount automatically.

Keep the app at one App Service instance while using SQLite. Do not scale out horizontally because SQLite is file-based and is not intended for concurrent writes from multiple app instances.

## 4. GitHub Actions deployment setup

This repository includes:

- .github/workflows/deploy-forecast-app.yml

Before first deploy:

- Update AZURE_WEBAPP_NAME in the workflow to your real web app name.
- In GitHub repository settings, add secret:
  - AZUREAPPSERVICE_PUBLISHPROFILE

To get publish profile:

- Azure Portal > Web App > Overview > Get publish profile
- Copy full XML into GitHub secret value

## 5. First deployment

Trigger one of:

- Push to main
- Manual run via Actions > Deploy Forecast App to Azure App Service > Run workflow

## 6. Post-deploy verification

Validate:

- Health endpoint: /api/health returns ok true
- Main app loads in browser
- Forecast API routes return data
- Data persists after web app restart

## 7. Persistence decision (production)

Current app stores data in SQLite. Locally it uses `backend/data/cashflow.db`; in Azure, `SQLITE_DB_PATH` points to the Azure Files mount.

For the current light-write workload, use the Azure Files mount. Revisit Azure SQL or PostgreSQL if the app needs multiple instances, higher write concurrency, or managed relational backups.

## 8. Security baseline

Apply these minimum controls:

- HTTPS only enabled
- Restrict inbound access if internal-only app
- Enable App Service logs and Application Insights
- Keep deployment secret scoped to this repo only
