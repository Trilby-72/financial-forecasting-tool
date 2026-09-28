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

function formatMonthKey(date) {
  const value = new Date(date);
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}`;
}

function formatDateKey(date) {
  const value = new Date(date);
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

// Milestone/SOW invoice dates entered via the paste-import feature are copied verbatim from
// pasted spreadsheet text, which uses the Australian D/M/Y convention (e.g. "30/9/2026") rather
// than the ISO format every date-input field on this app produces. `new Date('30/9/2026')`
// misreads that as month/day/year, and since day-of-month is frequently >12, it silently
// resolves to Invalid Date rather than throwing — so the entry vanishes from every forecast
// with no error. Parse D/M/Y explicitly before falling back to the native parser.
function parseFlexibleDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }

  const text = String(value).trim();

  const dayMonthYearMatch = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(text);
  if (dayMonthYearMatch) {
    const [, dayText, monthText, yearText] = dayMonthYearMatch;
    const year = Number(yearText.length === 2 ? `20${yearText}` : yearText);
    const parsed = new Date(year, Number(monthText) - 1, Number(dayText));
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }

  const parsed = new Date(text);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function resolveDueDate(invoiceDateValue, paymentTermDays = 0) {
  const invoiceDate = parseFlexibleDate(invoiceDateValue);
  if (!invoiceDate) {
    return null;
  }

  const termDays = Number(paymentTermDays) || 0;
  return addDays(invoiceDate, termDays);
}

function getDueMonthKey(invoiceDateValue, paymentTermDays = 0) {
  const dueDate = resolveDueDate(invoiceDateValue, paymentTermDays);
  if (!dueDate) {
    return null;
  }
  return formatMonthKey(dueDate);
}

// `dailyLedger`, when passed, additionally accumulates the same amount under its exact due
// DATE (not just its due month) — used to build a real day-by-day cash-flow ledger rather than
// smoothing each month's total evenly across its days.
function addInvoiceRevenueByTerms(revenueByMonth, invoiceDateValue, amount, paymentTermDays = 0, dailyLedger = null) {
  const dueDate = resolveDueDate(invoiceDateValue, paymentTermDays);
  if (!dueDate) {
    return revenueByMonth;
  }

  const dueMonthKey = formatMonthKey(dueDate);
  const nextAmount = (revenueByMonth.get(dueMonthKey) || 0) + toNumber(amount, 0);
  revenueByMonth.set(dueMonthKey, nextAmount);

  if (dailyLedger) {
    const dueDateKey = formatDateKey(dueDate);
    dailyLedger.set(dueDateKey, (dailyLedger.get(dueDateKey) || 0) + toNumber(amount, 0));
  }

  return revenueByMonth;
}

function getPreviousMonthKey(monthKey) {
  const [year, month] = monthKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, 1));
  date.setUTCMonth(date.getUTCMonth() - 1);
  return formatMonthKey(date);
}

// Includes the month before the forecast window so an invoice already raised for a recurring
// contract, but not yet due, still lands in the forecast's first month if its terms call for it.
function getInvoiceMonthKeysWithLookback(months) {
  const monthKeys = months.map((month) => month.key ?? month.month);
  if (!monthKeys.length) return [];
  return [getPreviousMonthKey(monthKeys[0]), ...monthKeys];
}

function getFortnightlyBoundaryDate(endDateValue, months) {
  if (endDateValue) {
    const endDate = new Date(endDateValue);
    if (Number.isFinite(endDate.getTime())) return endDate;
  }

  const monthKeys = months.map((month) => month.key ?? month.month);
  const lastMonthKey = monthKeys[monthKeys.length - 1];
  if (!lastMonthKey) return null;

  const [year, month] = lastMonthKey.split('-').map(Number);
  return new Date(year, month, 0); // last day of the forecast window's final month
}

function buildContractRevenueSchedule(contract = {}, monthSequence = [], dailyLedger = null) {
  const months = Array.isArray(monthSequence) ? monthSequence : [];
  const paymentType = contract.paymentType || 'monthly';
  const monthlyCharge = toNumber(contract.monthlyCharge, 0);
  const paymentTermDays = Number(contract.paymentTermDays || 0);
  // Most contracts are paid N days after the invoice is raised. Some (e.g. Cimic) are instead
  // paid N days after the work period ends — a day earlier than "invoice date", since the
  // invoice is raised the day after the period ends. 'periodEnd' captures that distinction.
  const paymentTermBasis = contract.paymentTermBasis === 'periodEnd' ? 'periodEnd' : 'invoiceDate';
  const revenueByMonth = new Map();

  if (paymentType === 'fortnightly') {
    const firstInvoiceDate = contract.firstInvoiceDate ? new Date(contract.firstInvoiceDate) : null;
    const paymentCount = Number(contract.paymentCount || 0);
    const dailyRate = toNumber(contract.dailyRate, 0);
    const daysWorkedPerWeek = toNumber(contract.daysWorkedPerWeek, 0);
    const isDayRateBased = dailyRate > 0 && daysWorkedPerWeek > 0;
    const targetDaysPerCycle = daysWorkedPerWeek * 2;

    // Each cycle is invoiced the day after its 14-day work period ends (matching the source
    // spreadsheet's "invoice date = period end + 1" convention), so the period the invoice
    // covers runs from (invoiceDate - 14) to (invoiceDate - 1).
    const invoiceAmountFor = (invoiceDate) => {
      if (!isDayRateBased) return monthlyCharge;
      const periodEnd = addDays(invoiceDate, -1);
      const periodStart = addDays(invoiceDate, -14);
      const workedDays = Math.min(targetDaysPerCycle, countQldWorkingDays(periodStart, periodEnd));
      return dailyRate * workedDays;
    };

    const recordCycle = (invoiceDate) => {
      const termsAnchorDate = paymentTermBasis === 'periodEnd' ? addDays(invoiceDate, -1) : invoiceDate;
      addInvoiceRevenueByTerms(revenueByMonth, termsAnchorDate, invoiceAmountFor(invoiceDate), paymentTermDays, dailyLedger);
    };

    if (firstInvoiceDate && Number.isFinite(firstInvoiceDate.getTime())) {
      if (paymentCount > 0) {
        for (let index = 0; index < paymentCount; index += 1) {
          recordCycle(addDays(firstInvoiceDate, index * 14));
        }
      } else {
        // No fixed payment count: keep invoicing every fortnight until the contract's end
        // date, or through the end of the forecast window when there is no end date.
        const boundaryDate = getFortnightlyBoundaryDate(contract.endDate, months);
        if (boundaryDate) {
          let invoiceDate = firstInvoiceDate;
          while (invoiceDate <= boundaryDate) {
            recordCycle(invoiceDate);
            invoiceDate = addDays(invoiceDate, 14);
          }
        }
      }
    }
  } else if (paymentType === 'daily_rate') {
    const dailyRate = toNumber(contract.dailyRate, 0);
    const daysPerPeriod = toNumber(contract.daysPerPeriod, 0);
    const amount = dailyRate * daysPerPeriod;
    for (const monthKey of getInvoiceMonthKeysWithLookback(months)) {
      const invoiceDate = new Date(`${monthKey}-01T00:00:00`);
      addInvoiceRevenueByTerms(revenueByMonth, invoiceDate, amount, paymentTermDays, dailyLedger);
    }
  } else {
    for (const monthKey of getInvoiceMonthKeysWithLookback(months)) {
      const invoiceDay = Number(contract.invoiceDay || 1);
      const invoiceDate = new Date(`${monthKey}-${pad(invoiceDay)}T00:00:00`);
      addInvoiceRevenueByTerms(revenueByMonth, invoiceDate, monthlyCharge, paymentTermDays, dailyLedger);
    }
  }

  return months
    .filter((month) => {
      const monthKey = month.key ?? month.month;
      if (!contract.endDate) return true;
      const endDate = new Date(contract.endDate);
      if (!Number.isFinite(endDate.getTime())) return true;
      return monthKey <= formatMonthKey(endDate);
    })
    .map((month) => {
      const monthKey = month.key ?? month.month;
      return {
        month: monthKey,
        amount: Number((revenueByMonth.get(monthKey) || 0).toFixed(2)),
      };
    });
}

module.exports = {
  buildContractRevenueSchedule,
  getDueMonthKey,
  addInvoiceRevenueByTerms,
  resolveDueDate,
  formatDateKey,
};
