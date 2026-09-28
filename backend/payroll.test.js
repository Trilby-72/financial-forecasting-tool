const test = require('node:test');
const assert = require('node:assert/strict');
const { generatePayrollProjection, buildMonthlyPaygBills } = require('./payrollService');

test('generates future pay runs for fixed-cycle employees and day-rate contractors', () => {
  const roster = [
    {
      id: 'emp-1',
      name: 'Ava Patel',
      payType: 'fixed_cycle',
      payFrequency: 'fortnightly',
      payAmount: 2600,
      taxWithheld: 350,
      superAmount: 260,
      included: true,
    },
    {
      id: 'ctr-1',
      name: 'Milo Chen',
      payType: 'day_rate',
      paymentMethod: 'invoice',
      dayRate: 850,
      workDaysPerPeriod: 5,
      included: true,
    },
  ];

  const result = generatePayrollProjection({
    roster,
    forecastMonths: 2,
    startDate: '2026-01-01T00:00:00Z',
  });

  assert.equal(result.payRuns.length >= 4, true);
  assert.equal(result.payRuns.some((run) => run.employeeId === 'emp-1' && run.grossPay === 2600 && run.superAmount === 312 && run.taxWithheld === 321.78), true);
  assert.equal(result.payRuns.some((run) => run.employeeId === 'ctr-1' && run.grossPay > 0 && run.taxWithheld === 0), true);
});

test('annualises taxable pay before calculating PAYG withholding', () => {
  const roster = [{
    id: 'emp-tax',
    name: 'Taxed Staff',
    payType: 'fixed_cycle',
    payFrequency: 'fortnightly',
    payAmount: 100000,
    included: true,
  }];

  const result = generatePayrollProjection({
    roster,
    forecastMonths: 1,
    startDate: '2026-01-01T00:00:00Z',
  });

  const run = result.payRuns.find((entry) => entry.employeeId === 'emp-tax');
  assert.equal(run.grossPay, 100000);
  assert.equal(run.superAmount, 12000);
  assert.equal(run.taxWithheld, 38287.31);
  assert.equal(run.netPay, 61712.69);
});

test('buildMonthlyPaygBills sums tax by calendar month and respects overrides', () => {
  const payRuns = [
    { employeeId: 'emp-1', payDate: '2026-01-15', taxWithheld: 300 },
    { employeeId: 'emp-1', payDate: '2026-01-30', taxWithheld: 250 },
    { employeeId: 'emp-2', payDate: '2026-02-15', taxWithheld: 125 },
  ];

  const monthlyBills = buildMonthlyPaygBills({
    payRuns,
    overrides: [{ month: '2026-01', amount: 400, reason: 'A real ATO bill was received', dueDate: '2026-02-21' }],
    defaultDueDay: 21,
  });

  assert.equal(monthlyBills[0].month, '2026-01');
  assert.equal(monthlyBills[0].amount, 400);
  assert.equal(monthlyBills[0].overridden, true);
  assert.equal(monthlyBills[1].amount, 125);
  assert.equal(monthlyBills[1].dueDate, '2026-03-21');
});

test('uses daily rate and planned work days for contractor projections', () => {
  const roster = [{
    id: 'ctr-3',
    name: 'Contractor A',
    payType: 'day_rate',
    dailyRate: 900,
    payFrequency: 'weekly',
    daysPlanned: 4,
    included: true,
  }];

  const result = generatePayrollProjection({
    roster,
    forecastMonths: 1,
    startDate: '2026-01-01T00:00:00Z',
  });

  assert.equal(result.payRuns.some((run) => run.employeeId === 'ctr-3' && run.grossPay === 3600), true);
  assert.equal(result.monthlyBills.length >= 1, true);
});

test('does not infer invoice treatment from a day rate employee', () => {
  const roster = [{
    id: 'ctr-weekly',
    name: 'Weekly Contractor',
    payType: 'day_rate',
    paymentMethod: 'payroll',
    payFrequency: 'weekly',
    dailyRate: 1200,
    daysPlanned: 5,
    included: true,
  }];

  const result = generatePayrollProjection({
    roster,
    forecastMonths: 1,
    startDate: '2026-09-25T00:00:00Z',
  });

  const run = result.payRuns.find((entry) => entry.employeeId === 'ctr-weekly');
  assert.equal(run.payDate, '2026-09-30');
  assert.equal(run.grossPay, 6000);
  assert.equal(run.superAmount, 720);
  assert.equal(run.taxWithheld, 1719.65);
});

test('uses two weeks of day-rate work for fortnightly payroll', () => {
  const roster = [{
    id: 'emp-day-rate-fortnightly',
    name: 'Fortnightly Day Rate',
    payType: 'day_rate',
    paymentMethod: 'payroll',
    payFrequency: 'fortnightly',
    dailyRate: 1000,
    daysWorkedPerWeek: 5,
    included: true,
  }];

  const result = generatePayrollProjection({
    roster,
    forecastMonths: 1,
    startDate: '2026-01-01T00:00:00Z',
  });

  const run = result.payRuns.find((entry) => entry.employeeId === 'emp-day-rate-fortnightly');
  // This cycle's period (25 Dec 2025 - 7 Jan 2026) spans Christmas Day, Boxing Day and New
  // Year's Day, capping it from 10 to 7 working days — day-rate contractors aren't paid for
  // QLD public holidays (see qldPublicHolidays.js).
  assert.equal(run.grossPay, 7000);
  assert.equal(run.superAmount, 840);
  assert.equal(run.taxWithheld, 1551.12);
});

test('skips super and tax for employees paid by invoice', () => {
  const roster = [{
    id: 'emp-contractor',
    name: 'Contractor Staff',
    payType: 'fixed_cycle',
    paymentMethod: 'invoice',
    payFrequency: 'fortnightly',
    payAmount: 1000,
    included: true,
  }];

  const result = generatePayrollProjection({
    roster,
    forecastMonths: 1,
    startDate: '2026-01-01T00:00:00Z',
  });

  const run = result.payRuns.find((entry) => entry.employeeId === 'emp-contractor');
  assert.equal(run.grossPay, 1000);
  assert.equal(run.superAmount, 0);
  assert.equal(run.taxWithheld, 0);
  assert.equal(run.netPay, 1000);
});

test('schedules both weekly and fortnightly payroll on Wednesdays and uses 30/9 as the next fortnight pay date', () => {
  const roster = [
    {
      id: 'emp-weekly',
      name: 'Weekly Staff',
      payType: 'fixed_cycle',
      payFrequency: 'weekly',
      netPay: 1500,
      taxWithheld: 200,
      superAmount: 150,
      included: true,
    },
    {
      id: 'emp-fortnightly',
      name: 'Fortnightly Staff',
      payType: 'fixed_cycle',
      payFrequency: 'fortnightly',
      netPay: 2600,
      taxWithheld: 350,
      superAmount: 260,
      included: true,
    },
  ];

  const result = generatePayrollProjection({
    roster,
    forecastMonths: 2,
    startDate: '2026-09-25T00:00:00Z',
  });

  const weekly = result.payRuns.filter((run) => run.employeeId === 'emp-weekly');
  const fortnightly = result.payRuns.filter((run) => run.employeeId === 'emp-fortnightly');

  assert.equal(weekly[0].payDate, '2026-09-30');
  assert.equal(weekly[1].payDate, '2026-10-07');
  assert.equal(fortnightly[0].payDate, '2026-09-30');
  assert.equal(fortnightly[1].payDate, '2026-10-14');
});
