# HC2 Forecasting App

Forecasting dashboard for payroll, contract revenue, outgoings, and cash position.

## Tech stack

- Backend: Node.js + Express + SQLite
- Frontend: React + Vite
- Hosting model: single Node app where backend serves the built frontend

## Project structure

- `backend/`: API and forecast logic
- `frontend/`: React app
- `backend/data/cashflow.db`: SQLite database file (created automatically)

## Local development

Install dependencies:

```bash
npm install
cd backend && npm install
cd ../frontend && npm install
```

Run both backend and frontend dev servers from repo root:

```bash
npm run dev
```

- Frontend dev URL: `http://localhost:5173`
- Backend API URL: `http://localhost:4000`

## API base URL behavior

Frontend API calls use `VITE_API_BASE` when set, otherwise default to `/api`.

- Local split-host example: `VITE_API_BASE=http://localhost:4000/api`
- Azure single-host example: leave unset so requests go to same host `/api`

## Production build

Build frontend assets:

```bash
npm run build:frontend
```

Start app:

```bash
npm start
```

When `frontend/dist` exists, the backend serves it automatically.

## Deploy to Azure (App Service)

This app should be deployed as a separate Azure app from any Staff Calendar project.

### 1. Create separate Azure resources

- Resource group (example): `rg-forecast-prod`
- App Service plan (Linux, Node 20): `asp-forecast-prod`
- Web app (example): `app-forecast-prod`

### 2. Configure app settings in Azure

Set in App Service Configuration:

- `NODE_ENV=production`
- Optional `PORT` is provided by App Service automatically
- Optional `VITE_API_BASE` is not required for single-host deployment

### 3. CI/CD

Use the included GitHub Actions workflow:

- Workflow file: `.github/workflows/deploy-forecast-app.yml`
- Required secret: `AZUREAPPSERVICE_PUBLISHPROFILE`

The workflow installs dependencies, builds frontend assets, and deploys to App Service.

### 4. Persistence note (important)

Current storage is SQLite file-based (`backend/data/cashflow.db`).

For production durability, prefer:

- Azure SQL/PostgreSQL migration (recommended), or
- mounted Azure Files volume dedicated to this app

### 5. Post-deploy checks

- `GET /api/health` returns `ok: true`
- Forecast dashboard loads from web app URL
- Data persists across app restarts

## Tests

Backend tests:

```bash
cd backend
npm test
```
