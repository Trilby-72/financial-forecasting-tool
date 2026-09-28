const test = require('node:test');
const assert = require('node:assert/strict');
const { buildContractRevenueSchedule, addInvoiceRevenueByTerms } = require('./contractRevenue');

test('monthly contracts keep a single monthly revenue amount', () => {
  const months = [
    { key: '2026-09', label: 'Sep 2026' },
    { key: '2026-10', label: 'Oct 2026' },
  ];

  const schedule = buildContractRevenueSchedule({
    paymentType: 'monthly',
    monthlyCharge: 1200,
  }, months);

  assert.deepEqual(schedule, [
    { month: '2026-09', amount: 1200 },
    { month: '2026-10', amount: 1200 },
  ]);
});

test('paymentTermBasis "periodEnd" measures payment terms from the work period end, not the invoice date', () => {
  const months = [
    { key: '2026-08', label: 'Aug 2026' },
    { key: '2026-09', label: 'Sep 2026' },
  ];
  const baseContract = {
    paymentType: 'fortnightly',
    dailyRate: 900,
    daysWorkedPerWeek: 5,
    firstInvoiceDate: '2026-08-27',
    paymentCount: 1,
    paymentTermDays: 5,
  };

  // Default basis ('invoiceDate'): due = 27 Aug + 5 days = 1 Sep -> falls in September.
  const invoiceDateBased = buildContractRevenueSchedule(baseContract, months);
  assert.deepEqual(invoiceDateBased, [
    { month: '2026-08', amount: 0 },
    { month: '2026-09', amount: 9000 },
  ]);

  // 'periodEnd' basis (Cimic's real arrangement): the period ends the day before the invoice
  // (26 Aug), so due = 26 Aug + 5 days = 31 Aug -> falls in August instead.
  const periodEndBased = buildContractRevenueSchedule({ ...baseContract, paymentTermBasis: 'periodEnd' }, months);
  assert.deepEqual(periodEndBased, [
    { month: '2026-08', amount: 9000 },
    { month: '2026-09', amount: 0 },
  ]);
});

test('fortnightly contracts spread the amount across the scheduled invoice dates', () => {
  const months = [
    { key: '2026-09', label: 'Sep 2026' },
    { key: '2026-10', label: 'Oct 2026' },
    { key: '2026-11', label: 'Nov 2026' },
  ];

  const schedule = buildContractRevenueSchedule({
    paymentType: 'fortnightly',
    monthlyCharge: 1500,
    firstInvoiceDate: '2026-09-30',
    paymentCount: 3,
  }, months);

  assert.deepEqual(schedule, [
    { month: '2026-09', amount: 1500 },
    { month: '2026-10', amount: 3000 },
    { month: '2026-11', amount: 0 },
  ]);
});

test('fortnightly contracts can calculate a daily-rate invoice using days worked per week', () => {
  const months = [
    { key: '2026-09', label: 'Sep 2026' },
    { key: '2026-10', label: 'Oct 2026' },
  ];

  const schedule = buildContractRevenueSchedule({
    paymentType: 'fortnightly',
    dailyRate: 500,
    daysWorkedPerWeek: 5,
    firstInvoiceDate: '2026-09-30',
    paymentCount: 2,
  }, months);

  assert.deepEqual(schedule, [
    { month: '2026-09', amount: 5000 },
    // This cycle's period (30 Sep - 13 Oct) contains the 5 Oct King's Birthday public holiday,
    // capping it from 10 to 9 working days.
    { month: '2026-10', amount: 4500 },
  ]);
});

test('monthly contracts place revenue in the due month after payment terms', () => {
  const months = [
    { key: '2026-09', label: 'Sep 2026' },
    { key: '2026-10', label: 'Oct 2026' },
  ];

  const schedule = buildContractRevenueSchedule({
    paymentType: 'monthly',
    monthlyCharge: 1200,
    invoiceDay: 25,
    paymentTermDays: 14,
  }, months);

  assert.deepEqual(schedule, [
    { month: '2026-09', amount: 1200 },
    { month: '2026-10', amount: 1200 },
  ]);
});

test('invoice revenue follows the due date after payment terms', () => {
  const totals = new Map();

  addInvoiceRevenueByTerms(totals, '2026-09-15', 5000, 14);
  addInvoiceRevenueByTerms(totals, '2026-09-20', 7000, 14);

  assert.equal(totals.get('2026-09'), 5000);
  assert.equal(totals.get('2026-10'), 7000);
});

test('dashboard month objects with month property are accepted by the contract scheduler', () => {
  const months = [
    { month: '2026-09', label: 'Sep 2026' },
    { month: '2026-10', label: 'Oct 2026' },
  ];

  const schedule = buildContractRevenueSchedule({
    paymentType: 'monthly',
    monthlyCharge: 1200,
    invoiceDay: 19,
    paymentTermDays: 14,
  }, months);

  assert.deepEqual(schedule, [
    { month: '2026-09', amount: 1200 },
    { month: '2026-10', amount: 1200 },
  ]);
});

test('recurring monthly contracts still show revenue in the forecast\'s first month', () => {
  const months = [
    { key: '2026-09', label: 'Sep 2026' },
    { key: '2026-10', label: 'Oct 2026' },
    { key: '2026-11', label: 'Nov 2026' },
  ];

  const schedule = buildContractRevenueSchedule({
    paymentType: 'monthly',
    monthlyCharge: 15500,
    invoiceDay: 19,
    paymentTermDays: 14,
  }, months);

  assert.deepEqual(schedule, [
    { month: '2026-09', amount: 15500 },
    { month: '2026-10', amount: 15500 },
    { month: '2026-11', amount: 15500 },
  ]);
});

test('daily-rate contracts still show revenue in the forecast\'s first month', () => {
  const months = [
    { key: '2026-09', label: 'Sep 2026' },
    { key: '2026-10', label: 'Oct 2026' },
  ];

  const schedule = buildContractRevenueSchedule({
    paymentType: 'daily_rate',
    dailyRate: 500,
    daysPerPeriod: 10,
    paymentTermDays: 14,
  }, months);

  assert.deepEqual(schedule, [
    { month: '2026-09', amount: 5000 },
    { month: '2026-10', amount: 5000 },
  ]);
});

test('fortnightly contracts with no payment count keep invoicing until the end date', () => {
  const months = [
    { key: '2026-09', label: 'Sep 2026' },
    { key: '2026-10', label: 'Oct 2026' },
    { key: '2026-11', label: 'Nov 2026' },
  ];

  const schedule = buildContractRevenueSchedule({
    paymentType: 'fortnightly',
    dailyRate: 500,
    daysWorkedPerWeek: 5,
    firstInvoiceDate: '2026-09-01',
    paymentTermDays: 0,
    endDate: '2026-10-15',
  }, months);

  assert.deepEqual(schedule, [
    { month: '2026-09', amount: 15000 },
    // Same 5 Oct King's Birthday capping as above: this cycle's period (29 Sep - 12 Oct) is
    // reduced from 10 to 9 working days.
    { month: '2026-10', amount: 4500 },
  ]);
});

test('fortnightly contracts with no payment count and no end date keep invoicing through the forecast window', () => {
  const months = [
    { key: '2026-09', label: 'Sep 2026' },
    { key: '2026-10', label: 'Oct 2026' },
    { key: '2026-11', label: 'Nov 2026' },
  ];

  const schedule = buildContractRevenueSchedule({
    paymentType: 'fortnightly',
    dailyRate: 500,
    daysWorkedPerWeek: 5,
    firstInvoiceDate: '2026-09-01',
    paymentTermDays: 0,
  }, months);

  assert.deepEqual(schedule, [
    { month: '2026-09', amount: 15000 },
    // The 13 Oct invoice's period (29 Sep - 12 Oct) contains the 5 Oct King's Birthday public
    // holiday, capping that cycle to 9 working days ($4,500) instead of the full 10 ($5,000);
    // the 27 Oct invoice's period has no holiday, so it stays at the full $5,000.
    { month: '2026-10', amount: 9500 },
    { month: '2026-11', amount: 10000 },
  ]);
});
