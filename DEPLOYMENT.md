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
- Linux App Service Plan (Node 20 compatible)
- Web App (Linux, Node 20)
- Optional Application Insights

If you keep SQLite in production, create a Storage Account and Azure Files share for durable file persistence.

## 3. Configure App Service

In App Service Configuration, set:

- NODE_ENV = production

Do not set VITE_API_BASE for same-host deployment. Frontend defaults to /api.

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

Current app stores data in SQLite file backend/data/cashflow.db.

Choose one:

- Preferred: migrate to Azure SQL or PostgreSQL
- Interim: mount Azure Files to store cashflow.db durably

## 8. Security baseline

Apply these minimum controls:

- HTTPS only enabled
- Restrict inbound access if internal-only app
- Enable App Service logs and Application Insights
- Keep deployment secret scoped to this repo only
