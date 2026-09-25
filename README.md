# Financial Forecasting Tool

A small forecasting app for business planning across payroll, contractors, fixed costs, contracts, statements of work, and opportunity pipeline.

## Features

- Employee payroll tracking
- Contractor cost tracking
- Service contracts and statement-of-work revenue
- Rent and operating outgoings
- Scenario modelling for adding/removing staff and changing deal value
- 12-month cashflow projection dashboard
- JSON-backed persistence so the current forecast can be stored and updated

## Local setup

```bash
cd backend
npm install
npm start
```

Then open http://localhost:4000

## API

- GET /api/health
- GET /api/forecast
- POST /api/forecast/scenario
- POST /api/forecast/reset

## Data model

The working forecast is stored in backend/data/forecast.json.
