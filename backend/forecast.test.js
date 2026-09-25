const test = require('node:test');
const assert = require('node:assert/strict');
const { buildForecast, applyScenario } = require('./forecasting');

const baseData = {
  employees: [
    { id: 'e1', name: 'Alice', monthlyCost: 7000, active: true },
    { id: 'e2', name: 'Bob', monthlyCost: 5000, active: true },
  ],
  contractors: [
    { id: 'c1', name: 'Design Support', monthlyCost: 3000, active: true },
  ],
  contracts: [
    { id: 's1', name: 'Retainer A', monthlyRevenue: 12000, active: true, startMonth: 1, endMonth: 12 },
  ],
  sow: [
    { id: 'sow-1', name: 'Project Orion', monthlyRevenue: 8000, active: true, startMonth: 3, endMonth: 6 },
  ],
  rent: { monthlyCost: 2500, active: true },
  outgoings: { monthlyCost: 1800, active: true },
  deals: [
    { id: 'deal-1', name: 'Pipeline Deal', probability: 0.6, value: 30000, month: 6 },
  ],
};

test('buildForecast totals the baseline monthly cashflow correctly', () => {
  const forecast = buildForecast(baseData, { months: 12 });

  assert.equal(forecast.summary.totalPayroll, 12000);
  assert.equal(forecast.summary.totalContractors, 3000);
  assert.equal(forecast.summary.totalRunRateCosts, 4300);
  assert.equal(forecast.summary.totalMonthlyRevenue, 12000);
  assert.equal(Number(forecast.summary.baselineNetCashflow.toFixed(2)), -3133.33);
  assert.equal(forecast.monthly[0].netCashflow, -7300);
  assert.equal(forecast.monthly[5].netCashflow, 18700);
});

test('applyScenario adds and removes personnel and adjusts deal value', () => {
  const scenario = applyScenario(baseData, {
    addPersonnel: [{ id: 'e3', name: 'Cara', monthlyCost: 6000, active: true }],
    removePersonnel: ['e2'],
    adjustDeals: [{ id: 'deal-1', value: 50000 }],
  });

  const forecast = buildForecast(scenario, { months: 12 });

  assert.equal(forecast.summary.totalPayroll, 13000);
  assert.equal(Number(forecast.summary.baselineNetCashflow.toFixed(2)), -3133.33);
  assert.equal(forecast.summary.dealValue, 30000);
});
