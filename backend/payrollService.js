const { countQldWorkingDays } = require('./qldPublicHolidays');

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getNextWednesday(date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  const weekday = next.getDay();
  const daysUntilWednesday = (3 - weekday + 7) % 7;
  next.setDate(next.getDate() + daysUntilWednesday);
  return next;
}

function formatDateISO(date) {
  const value = new Date(date);
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function formatMonthKey(date) {
  const value = new Date(date);
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}`;
}

function calculateAustralianTax(income) {
  const taxableIncome = Math.max(0, Number(income || 0));

  if (taxableIncome <= 18200) return 0;
  if (taxableIncome <= 45000) return (taxableIncome - 18200) * 0.15;
  if (taxableIncome <= 135000) return 4020 + (taxableIncome - 45000) * 0.3;
  if (taxableIncome <= 190000) return 31020 + (taxableIncome - 135000) * 0.37;
  return 51370 + (taxableIncome - 190000) * 0.45;
}

function getPayPeriodsPerYear(payFrequency) {
  if (payFrequency === 'weekly') return 52;
  if (payFrequency === 'monthly') return 12;
  return 26;
}

function calculatePayBreakdown(grossPay, payFrequency) {
  const gross = Number(Math.max(0, Number(grossPay || 0)).toFixed(2));
  const superAmount = Number((gross * 0.12).toFixed(2));
  const taxableIncome = Math.max(0, gross - superAmount);
  const payPeriodsPerYear = getPayPeriodsPerYear(payFrequency);
  const annualTaxableIncome = taxableIncome * payPeriodsPerYear;
  const taxWithheld = Number((calculateAustralianTax(annualTaxableIncome) / payPeriodsPerYear).toFixed(2));
  const netPay = Number((gross - taxWithheld).toFixed(2));

  return {
    grossPay: gross,
    superAmount,
    taxWithheld,
    netPay,
  };
}

function getDueDateForMonth(monthKey, defaultDueDay = 21) {
  const [year, month] = monthKey.split('-').map(Number);
  const dueYear = month === 12 ? year + 1 : year;
  const dueMonth = month === 12 ? 1 : month + 1;
  return `${dueYear}-${pad(dueMonth)}-${pad(defaultDueDay)}`;
}

function getDefaultRoster() {
  return [
    {
      id: 'emp-1',
      name: 'Ava Patel',
      payType: 'fixed_cycle',
      payFrequency: 'fortnightly',
      netPay: 2600,
      taxWithheld: 350,
      superAmount: 260,
      deductions: 0,
      included: true,
    },
    {
      id: 'emp-2',
      name: 'Milo Chen',
      payType: 'fixed_cycle',
      payFrequency: 'weekly',
      netPay: 1800,
      taxWithheld: 240,
      superAmount: 180,
      deductions: 0,
      included: true,
    },
    {
      id: 'ctr-1',
      name: 'Design Support',
      payType: 'day_rate',
      dailyRate: 850,
      dayRate: 850,
      daysPlanned: 5,
      workDaysPerPeriod: 5,
      included: true,
    },
    {
      id: 'ctr-2',
      name: 'Finance Admin',
      payType: 'day_rate',
      dailyRate: 720,
      dayRate: 720,
      daysPlanned: 4,
      workDaysPerPeriod: 4,
      included: true,
    },
  ];
}

function createFixedCyclePayRuns(employee, startDate, forecastMonths) {
  const frequencyDays = {
    weekly: 7,
    fortnightly: 14,
    monthly: 30,
  };

  const isInvoiceEmployee = employee.paymentMethod === 'invoice';
  const interval = frequencyDays[employee.payFrequency] || 14;
  const totalPeriods = Math.max(1, Math.ceil((forecastMonths * 30) / interval) + 3);
  const runs = [];
  const firstDate = getNextWednesday(startDate);
  firstDate.setHours(0, 0, 0, 0);

  for (let i = 0; i < totalPeriods; i += 1) {
    const payDate = addDays(firstDate, i * interval);
    const payDateString = formatDateISO(payDate);
    const payMonthKey = formatMonthKey(payDate);
    const baseGross = toNumber(
      employee.grossPay,
      toNumber(employee.payAmount, toNumber(employee.netPay, 0) + toNumber(employee.taxWithheld, 0) + toNumber(employee.superAmount, 0))
    );
    const deductions = toNumber(employee.deductions, 0);

    if (isInvoiceEmployee) {
      runs.push({
        employeeId: employee.id,
        employeeName: employee.name,
        payType: employee.payType,
        payDate: payDateString,
        periodStart: formatDateISO(addDays(payDate, -interval + 1)),
        periodEnd: payDateString,
        grossPay: Number((baseGross).toFixed(2)),
        netPay: Number((baseGross).toFixed(2)),
        taxWithheld: 0,
        superAmount: 0,
        deductions: Number((deductions).toFixed(2)),
        month: payMonthKey,
      });
      continue;
    }

    const { superAmount, taxWithheld, netPay } = calculatePayBreakdown(baseGross, employee.payFrequency);

    runs.push({
      employeeId: employee.id,
      employeeName: employee.name,
      payType: employee.payType,
      payDate: payDateString,
      periodStart: formatDateISO(addDays(payDate, -interval + 1)),
      periodEnd: payDateString,
      grossPay: Number((baseGross).toFixed(2)),
      netPay: Number((netPay).toFixed(2)),
      taxWithheld: Number((taxWithheld).toFixed(2)),
      superAmount: Number((superAmount).toFixed(2)),
      deductions: Number((deductions).toFixed(2)),
      month: payMonthKey,
    });
  }

  return runs;
}

function getDayRateValue(employee) {
  return toNumber(employee.dailyRate, toNumber(employee.dayRate, 0));
}

function getPlannedWorkDays(employee) {
  const daysPerWeek = toNumber(employee.daysWorkedPerWeek, 0);
  if (daysPerWeek > 0) {
    const weeksPerPayPeriod = {
      weekly: 1,
      fortnightly: 2,
      monthly: 52 / 12,
    };
    return daysPerWeek * (weeksPerPayPeriod[employee.payFrequency] || 1);
  }
  return toNumber(employee.daysPlanned, toNumber(employee.workDaysPerPeriod, 0));
}

function createDayRatePayRuns(employee, startDate, forecastMonths) {
  const runs = [];
  const frequencyDays = {
    weekly: 7,
    fortnightly: 14,
    monthly: 30,
  };
  const isInvoiceEmployee = employee.paymentMethod === 'invoice';
  const interval = frequencyDays[employee.payFrequency] || 7;
  const totalPeriods = Math.max(1, Math.ceil((forecastMonths * 30) / interval) + 2);
  const firstDate = getNextWednesday(new Date(startDate));
  firstDate.setHours(0, 0, 0, 0);

  for (let index = 0; index < totalPeriods; index += 1) {
    const payDate = addDays(firstDate, index * interval);
    const payDateString = formatDateISO(payDate);
    const payMonthKey = formatMonthKey(payDate);
    const dailyRate = getDayRateValue(employee);
    // Contractors on the day-rate model aren't paid for QLD public holidays (unlike
    // fixed-cycle employees, whose pay doesn't change whether or not a holiday falls in their
    // period) — cap the planned work days at the period's actual working days.
    const periodStart = addDays(payDate, -interval + 1);
    const workDaysPerPeriod = Math.min(getPlannedWorkDays(employee), countQldWorkingDays(periodStart, payDate));
    const grossPay = dailyRate * workDaysPerPeriod;

    if (isInvoiceEmployee) {
      runs.push({
        employeeId: employee.id,
        employeeName: employee.name,
        payType: employee.payType,
        payDate: payDateString,
        periodStart: formatDateISO(addDays(payDate, -interval + 1)),
        periodEnd: payDateString,
        grossPay: Number(grossPay.toFixed(2)),
        netPay: Number(grossPay.toFixed(2)),
        taxWithheld: 0,
        superAmount: 0,
        deductions: 0,
        month: payMonthKey,
      });
      continue;
    }

    const { superAmount, taxWithheld, netPay } = calculatePayBreakdown(grossPay, employee.payFrequency);

    runs.push({
      employeeId: employee.id,
      employeeName: employee.name,
      payType: employee.payType,
      payDate: payDateString,
      periodStart: formatDateISO(addDays(payDate, -interval + 1)),
      periodEnd: payDateString,
      grossPay: Number(grossPay.toFixed(2)),
      netPay: Number(netPay.toFixed(2)),
      taxWithheld: Number(taxWithheld.toFixed(2)),
      superAmount: Number(superAmount.toFixed(2)),
      deductions: 0,
      month: payMonthKey,
    });
  }

  return runs;
}

function generatePayrollProjection({
  roster = getDefaultRoster(),
  forecastMonths = 6,
  startDate = new Date(),
  includedEmployeeIds = null,
  overrides = [],
} = {}) {
  const employees = Array.isArray(roster) ? roster : [];
  const includedSet = new Set(
    Array.isArray(includedEmployeeIds) && includedEmployeeIds.length
      ? includedEmployeeIds
      : employees.filter((employee) => employee.included !== false).map((employee) => employee.id)
  );

  const payRuns = employees
    .filter((employee) => includedSet.has(employee.id))
    .flatMap((employee) => {
      if (employee.payType === 'day_rate') {
        return createDayRatePayRuns(employee, new Date(startDate), forecastMonths);
      }
      return createFixedCyclePayRuns(employee, new Date(startDate), forecastMonths);
    })
    .sort((a, b) => a.payDate.localeCompare(b.payDate));

  const monthlyBills = buildMonthlyPaygBills({ payRuns, overrides, defaultDueDay: 21 });
  const totalGrossPayroll = payRuns.reduce((sum, run) => sum + toNumber(run.grossPay, 0), 0);
  const totalTaxAccrued = monthlyBills.reduce((sum, bill) => sum + toNumber(bill.amount, 0), 0);

  return {
    generatedAt: new Date().toISOString(),
    forecastMonths,
    includedEmployees: Array.from(includedSet),
    payRuns,
    monthlyBills,
    summary: {
      totalGrossPayroll: Number(totalGrossPayroll.toFixed(2)),
      totalTaxAccrued: Number(totalTaxAccrued.toFixed(2)),
      includedCount: includedSet.size,
    },
  };
}

function buildMonthlyPaygBills({ payRuns = [], overrides = [], defaultDueDay = 21 } = {}) {
  const monthMap = new Map();
  const projectedMonths = new Set();

  for (const run of payRuns) {
    const monthKey = formatMonthKey(run.payDate);
    projectedMonths.add(monthKey);
    const taxAmount = toNumber(run.taxWithheld, 0);
    if (taxAmount <= 0) continue;
    const current = monthMap.get(monthKey) || 0;
    monthMap.set(monthKey, Number((current + taxAmount).toFixed(2)));
  }

  const rows = Array.from(projectedMonths)
    .sort((left, right) => left.localeCompare(right))
    .map((monthKey) => ({
      month: monthKey,
      amount: Number((monthMap.get(monthKey) || 0).toFixed(2)),
      dueDate: getDueDateForMonth(monthKey, defaultDueDay),
      overridden: false,
      reason: null,
    }));

  const overrideMap = new Map();
  rows.forEach((row) => overrideMap.set(row.month, row));

  (Array.isArray(overrides) ? overrides : []).forEach((override) => {
    const monthKey = override.month || 'unknown';
    const nextRow = overrideMap.get(monthKey) || {
      month: monthKey,
      amount: 0,
      dueDate: getDueDateForMonth(monthKey, defaultDueDay),
      overridden: false,
      reason: null,
    };

    nextRow.amount = Number(toNumber(override.amount, nextRow.amount).toFixed(2));
    nextRow.dueDate = override.dueDate || getDueDateForMonth(monthKey, defaultDueDay);
    nextRow.overridden = true;
    nextRow.reason = override.reason || 'Manual override applied';
    overrideMap.set(monthKey, nextRow);
  });

  return Array.from(overrideMap.values()).sort((a, b) => a.month.localeCompare(b.month));
}

module.exports = {
  getDefaultRoster,
  generatePayrollProjection,
  buildMonthlyPaygBills,
  formatMonthKey,
  getDueDateForMonth,
};
