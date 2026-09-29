const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { generatePayrollProjection, getDefaultRoster } = require('./payrollService');
const { buildContractRevenueSchedule, resolveDueDate, formatDateKey } = require('./contractRevenue');

const app = express();
const PORT = process.env.PORT || 4000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.resolve(process.env.SQLITE_DB_PATH || path.join(DATA_DIR, 'cashflow.db'));

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
console.log(`SQLite database path: ${DB_FILE}`);
app.use(cors());
app.use(express.json());

const db = new sqlite3.Database(DB_FILE);

function runQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onComplete(err) {
      if (err) {
        reject(err);
        return;
      }
      resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function allQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows || []);
    });
  });
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatMonthKey(date) {
  const value = new Date(date);
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  return `${value.getUTCFullYear()}-${month}`;
}

function addMonths(date, count) {
  const copy = new Date(date);
  copy.setUTCMonth(copy.getUTCMonth() + count);
  return copy;
}

function buildMonthSequence(count = 6) {
  const months = [];
  const start = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  for (let index = 0; index < count; index += 1) {
    const monthDate = addMonths(start, index);
    months.push({
      key: formatMonthKey(monthDate),
      label: monthDate.toLocaleString('en-AU', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
    });
  }
  return months;
}

function monthToDate(monthKey) {
  const [year, month] = monthKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, 1));
}

function initializeDatabase() {
  const schema = `
    CREATE TABLE IF NOT EXISTS employees (
      id TEXT PRIMARY KEY,
      name TEXT,
      payType TEXT,
      employmentType TEXT DEFAULT 'payg',
      paymentMethod TEXT DEFAULT 'payroll',
      payFrequency TEXT,
      payAmount REAL,
      netPay REAL,
      taxWithheld REAL,
      superAmount REAL,
      deductions REAL,
      dayRate REAL,
      workDaysPerPeriod REAL,
      state TEXT,
      daysWorkedPerWeek REAL,
      included INTEGER DEFAULT 1,
      createdAt TEXT
    );

    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      name TEXT,
      createdAt TEXT
    );

    CREATE TABLE IF NOT EXISTS payment_terms (
      id TEXT PRIMARY KEY,
      days INTEGER,
      label TEXT,
      createdAt TEXT
    );

    CREATE TABLE IF NOT EXISTS service_types (
      id TEXT PRIMARY KEY,
      name TEXT,
      createdAt TEXT
    );

    CREATE TABLE IF NOT EXISTS outgoing_types (
      id TEXT PRIMARY KEY,
      name TEXT,
      createdAt TEXT
    );

    CREATE TABLE IF NOT EXISTS outgoings (
      id TEXT PRIMARY KEY,
      typeId TEXT,
      amount REAL,
      dateDue TEXT,
      recurringMonthly INTEGER DEFAULT 0,
      createdAt TEXT
    );

    CREATE TABLE IF NOT EXISTS contracts (
      id TEXT PRIMARY KEY,
      clientId TEXT,
      serviceTypeId TEXT,
      paymentType TEXT DEFAULT 'monthly',
      monthlyCharge REAL,
      dailyRate REAL DEFAULT 0,
      daysPerPeriod INTEGER DEFAULT 0,
      daysWorkedPerWeek INTEGER DEFAULT 0,
      firstInvoiceDate TEXT,
      paymentCount INTEGER DEFAULT 0,
      invoiceDay INTEGER,
      paymentTermDays INTEGER,
      endDate TEXT,
      createdAt TEXT
    );

    CREATE TABLE IF NOT EXISTS milestones (
      id TEXT PRIMARY KEY,
      clientId TEXT,
      projectDescription TEXT,
      milestoneNumber INTEGER,
      amount REAL,
      contractValue REAL,
      percentComplete REAL,
      invoiceDate TEXT,
      paymentTermDays INTEGER,
      createdAt TEXT
    );

    CREATE TABLE IF NOT EXISTS sows (
      id TEXT PRIMARY KEY,
      clientId TEXT,
      projectDescription TEXT,
      amount REAL,
      invoiceDate TEXT,
      paymentTermDays INTEGER,
      createdAt TEXT
    );

    CREATE TABLE IF NOT EXISTS payg_overrides (
      month TEXT PRIMARY KEY,
      amount REAL,
      dueDate TEXT,
      reason TEXT,
      createdAt TEXT
    );

    CREATE TABLE IF NOT EXISTS actual_invoices (
      id TEXT PRIMARY KEY,
      description TEXT,
      clientId TEXT,
      amount REAL,
      dueDate TEXT,
      note TEXT,
      createdAt TEXT
    );

    CREATE TABLE IF NOT EXISTS actual_bills (
      id TEXT PRIMARY KEY,
      description TEXT,
      amount REAL,
      dueDate TEXT,
      note TEXT,
      createdAt TEXT
    );
  `;

  return new Promise((resolve, reject) => {
    db.exec(schema, async (err) => {
      if (err) {
        reject(err);
        return;
      }

      try {
        const columns = await allQuery('PRAGMA table_info(outgoings)');
        const hasRecurringFlag = columns.some((column) => column.name === 'recurringMonthly');
        if (!hasRecurringFlag) {
          await runQuery('ALTER TABLE outgoings ADD COLUMN recurringMonthly INTEGER DEFAULT 0');
        }

        const employeeColumns = await allQuery('PRAGMA table_info(employees)');
        const hasEmploymentType = employeeColumns.some((column) => column.name === 'employmentType');
        if (!hasEmploymentType) {
          await runQuery('ALTER TABLE employees ADD COLUMN employmentType TEXT DEFAULT "payg"');
        }
        const hasPaymentMethod = employeeColumns.some((column) => column.name === 'paymentMethod');
        if (!hasPaymentMethod) {
          await runQuery('ALTER TABLE employees ADD COLUMN paymentMethod TEXT DEFAULT "payroll"');
          await runQuery('UPDATE employees SET paymentMethod = "invoice" WHERE employmentType = "contractor"');
        }

        const contractColumns = await allQuery('PRAGMA table_info(contracts)');
        const contractFields = {
          paymentType: 'ALTER TABLE contracts ADD COLUMN paymentType TEXT DEFAULT "monthly"',
          dailyRate: 'ALTER TABLE contracts ADD COLUMN dailyRate REAL DEFAULT 0',
          daysPerPeriod: 'ALTER TABLE contracts ADD COLUMN daysPerPeriod INTEGER DEFAULT 0',
          daysWorkedPerWeek: 'ALTER TABLE contracts ADD COLUMN daysWorkedPerWeek INTEGER DEFAULT 0',
          firstInvoiceDate: 'ALTER TABLE contracts ADD COLUMN firstInvoiceDate TEXT',
          paymentCount: 'ALTER TABLE contracts ADD COLUMN paymentCount INTEGER DEFAULT 0',
          paymentTermBasis: 'ALTER TABLE contracts ADD COLUMN paymentTermBasis TEXT DEFAULT "invoiceDate"',
        };

        for (const [fieldName, statement] of Object.entries(contractFields)) {
          const hasField = contractColumns.some((column) => column.name === fieldName);
          if (!hasField) {
            await runQuery(statement);
          }
        }

        const milestoneColumns = await allQuery('PRAGMA table_info(milestones)');
        const milestoneFields = {
          contractValue: 'ALTER TABLE milestones ADD COLUMN contractValue REAL',
          percentComplete: 'ALTER TABLE milestones ADD COLUMN percentComplete REAL',
        };

        for (const [fieldName, statement] of Object.entries(milestoneFields)) {
          const hasField = milestoneColumns.some((column) => column.name === fieldName);
          if (!hasField) {
            await runQuery(statement);
          }
        }

        resolve();
      } catch (migrationError) {
        reject(migrationError);
      }
    });
  });
}

async function seedReferenceData() {
  const clientCount = await allQuery('SELECT COUNT(*) AS count FROM clients');
  if ((clientCount[0]?.count || 0) === 0) {
    const clients = ['Busy Bees', 'Cimic', 'Valmar', 'Vinnies', 'Centacare'];
    for (const name of clients) {
      await runQuery('INSERT INTO clients (id, name, createdAt) VALUES (?, ?, datetime("now"))', [
        `client-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name,
      ]);
    }
  }

  const termCount = await allQuery('SELECT COUNT(*) AS count FROM payment_terms');
  if ((termCount[0]?.count || 0) === 0) {
    const terms = [
      { id: 'term-7', days: 7, label: '7 days' },
      { id: 'term-14', days: 14, label: '14 days' },
      { id: 'term-30', days: 30, label: '30 days' },
    ];
    for (const term of terms) {
      await runQuery('INSERT INTO payment_terms (id, days, label, createdAt) VALUES (?, ?, ?, datetime("now"))', [
        term.id,
        term.days,
        term.label,
      ]);
    }
  }

  const serviceCount = await allQuery('SELECT COUNT(*) AS count FROM service_types');
  if ((serviceCount[0]?.count || 0) === 0) {
    const types = ['Workday Admin', 'AMS', 'Consulting', 'Payroll Support'];
    for (const name of types) {
      await runQuery('INSERT INTO service_types (id, name, createdAt) VALUES (?, ?, datetime("now"))', [
        `service-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name,
      ]);
    }
  }

  const outgoingTypeCount = await allQuery('SELECT COUNT(*) AS count FROM outgoing_types');
  if ((outgoingTypeCount[0]?.count || 0) === 0) {
    const types = ['Rent', 'General overheads'];
    for (const name of types) {
      await runQuery('INSERT INTO outgoing_types (id, name, createdAt) VALUES (?, ?, datetime("now"))', [
        `outgoing-type-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        name,
      ]);
    }
  }

  const employeeCount = await allQuery('SELECT COUNT(*) AS count FROM employees');
  if ((employeeCount[0]?.count || 0) === 0) {
    const roster = getDefaultRoster();
    for (const employee of roster) {
      await runQuery(
        `INSERT INTO employees (id, name, payType, employmentType, paymentMethod, payFrequency, payAmount, netPay, taxWithheld, superAmount, deductions, dayRate, workDaysPerPeriod, state, daysWorkedPerWeek, included, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime("now"))`,
        [
          employee.id,
          employee.name,
          employee.payType,
          employee.employmentType || (employee.payType === 'day_rate' ? 'contractor' : 'payg'),
          employee.paymentMethod || (employee.payType === 'day_rate' ? 'invoice' : 'payroll'),
          employee.payFrequency || 'fortnightly',
          employee.payAmount ?? employee.netPay ?? null,
          employee.netPay ?? null,
          employee.taxWithheld ?? 0,
          employee.superAmount ?? 0,
          employee.deductions ?? 0,
          employee.dayRate ?? employee.dailyRate ?? null,
          employee.workDaysPerPeriod ?? employee.daysPlanned ?? null,
          'QLD',
          employee.daysPlanned ?? employee.workDaysPerPeriod ?? 5,
          employee.included === false ? 0 : 1,
        ]
      );
    }
  }

  const contractCount = await allQuery('SELECT COUNT(*) AS count FROM contracts');
  if ((contractCount[0]?.count || 0) === 0) {
    const clients = await allQuery('SELECT * FROM clients ORDER BY name LIMIT 3');
    const serviceTypes = await allQuery('SELECT * FROM service_types ORDER BY name LIMIT 3');
    const clientIds = clients.map((item) => item.id);
    const serviceIds = serviceTypes.map((item) => item.id);

    for (let index = 0; index < 2; index += 1) {
      await runQuery(
        `INSERT INTO contracts (id, clientId, serviceTypeId, paymentType, monthlyCharge, dailyRate, daysPerPeriod, daysWorkedPerWeek, firstInvoiceDate, paymentCount, invoiceDay, paymentTermDays, endDate, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime("now"))`,
        [
          `contract-${index + 1}`,
          clientIds[index % clientIds.length],
          serviceIds[index % serviceIds.length],
          'monthly',
          9000 + index * 1500,
          0,
          0,
          0,
          null,
          0,
          7 + index,
          14,
          '2027-12-31',
        ]
      );
    }
  }

  const milestoneCount = await allQuery('SELECT COUNT(*) AS count FROM milestones');
  if ((milestoneCount[0]?.count || 0) === 0) {
    const clients = await allQuery('SELECT * FROM clients ORDER BY name LIMIT 2');
    for (let index = 0; index < 2; index += 1) {
      const client = clients[index % clients.length];
      await runQuery(
        'INSERT INTO milestones (id, clientId, projectDescription, milestoneNumber, amount, invoiceDate, paymentTermDays, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, datetime("now"))',
        [`milestone-${index + 1}`, client.id, `Project ${index + 1}`, index + 1, 18000 + index * 5000, `2026-${String((index + 9) % 12 + 1).padStart(2, '0')}-15`, 14]
      );
    }
  }

  const sowCount = await allQuery('SELECT COUNT(*) AS count FROM sows');
  if ((sowCount[0]?.count || 0) === 0) {
    const clients = await allQuery('SELECT * FROM clients ORDER BY name LIMIT 2');
    for (let index = 0; index < 2; index += 1) {
      const client = clients[index % clients.length];
      await runQuery(
        'INSERT INTO sows (id, clientId, projectDescription, amount, invoiceDate, paymentTermDays, createdAt) VALUES (?, ?, ?, ?, ?, ?, datetime("now"))',
        [`sow-${index + 1}`, client.id, `SOW ${index + 1}`, 12000 + index * 5000, `2026-${String((index + 10) % 12 + 1).padStart(2, '0')}-20`, 14]
      );
    }
  }

  const finalCounts = await Promise.all([
    allQuery('SELECT COUNT(*) AS count FROM employees'),
    allQuery('SELECT COUNT(*) AS count FROM clients'),
    allQuery('SELECT COUNT(*) AS count FROM contracts'),
  ]);
  console.log(`SQLite data counts: employees=${finalCounts[0][0]?.count || 0}, clients=${finalCounts[1][0]?.count || 0}, contracts=${finalCounts[2][0]?.count || 0}`);
}

async function getEmployees() {
  const rows = await allQuery('SELECT * FROM employees ORDER BY name');
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    payType: row.payType,
    employmentType: row.employmentType || (row.payType === 'day_rate' ? 'contractor' : 'payg'),
    paymentMethod: row.paymentMethod || (row.employmentType === 'contractor' ? 'invoice' : 'payroll'),
    payFrequency: row.payFrequency,
    payAmount: row.payAmount,
    netPay: row.netPay,
    taxWithheld: row.taxWithheld,
    superAmount: row.superAmount,
    deductions: row.deductions,
    dayRate: row.dayRate,
    dailyRate: row.dayRate,
    workDaysPerPeriod: row.workDaysPerPeriod,
    daysPlanned: row.daysWorkedPerWeek ?? row.workDaysPerPeriod,
    state: row.state || 'QLD',
    daysWorkedPerWeek: row.daysWorkedPerWeek ?? row.workDaysPerPeriod,
    included: row.included !== 0,
  }));
}

async function getClients() {
  return allQuery('SELECT * FROM clients ORDER BY name');
}

async function getPaymentTerms() {
  return allQuery('SELECT * FROM payment_terms ORDER BY days');
}

async function getServiceTypes() {
  return allQuery('SELECT * FROM service_types ORDER BY name');
}

async function getOutgoingTypes() {
  return allQuery('SELECT * FROM outgoing_types ORDER BY name');
}

async function getOutgoings() {
  const rows = await allQuery('SELECT * FROM outgoings ORDER BY dateDue');
  const types = await getOutgoingTypes();
  const typeMap = new Map(types.map((type) => [type.id, type]));
  return rows.map((row) => ({
    ...row,
    recurringMonthly: Number(row.recurringMonthly) === 1,
    type: typeMap.get(row.typeId) || null,
  }));
}

async function getContracts() {
  const rows = await allQuery('SELECT * FROM contracts ORDER BY createdAt');
  const clients = await getClients();
  const serviceTypes = await getServiceTypes();
  const clientMap = new Map(clients.map((client) => [client.id, client]));
  const serviceMap = new Map(serviceTypes.map((service) => [service.id, service]));
  return rows.map((row) => ({
    ...row,
    client: clientMap.get(row.clientId) || null,
    serviceType: serviceMap.get(row.serviceTypeId) || null,
  }));
}

async function getMilestones() {
  const rows = await allQuery('SELECT * FROM milestones ORDER BY invoiceDate');
  const clients = await getClients();
  const clientMap = new Map(clients.map((client) => [client.id, client]));
  return rows.map((row) => ({ ...row, client: clientMap.get(row.clientId) || null }));
}

async function getSows() {
  const rows = await allQuery('SELECT * FROM sows ORDER BY invoiceDate');
  const clients = await getClients();
  const clientMap = new Map(clients.map((client) => [client.id, client]));
  return rows.map((row) => ({ ...row, client: clientMap.get(row.clientId) || null }));
}

async function getPaygOverrides() {
  return allQuery('SELECT * FROM payg_overrides ORDER BY month');
}

async function getActualInvoices() {
  const rows = await allQuery('SELECT * FROM actual_invoices ORDER BY dueDate');
  const clients = await getClients();
  const clientMap = new Map(clients.map((client) => [client.id, client]));
  return rows.map((row) => ({ ...row, client: row.clientId ? clientMap.get(row.clientId) || null : null }));
}

async function getActualBills() {
  return allQuery('SELECT * FROM actual_bills ORDER BY dueDate');
}

function basicCrudHandlers({ tableName, requiredFields = ['name'], transform = (item) => item }) {
  return {
    get: async (req, res) => {
      try {
        const rows = await allQuery(`SELECT * FROM ${tableName} ORDER BY createdAt DESC`);
        res.json(rows.map(transform));
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    },
    post: async (req, res) => {
      try {
        const item = req.body || {};
        const missing = requiredFields.filter((field) => item[field] === undefined || item[field] === null || item[field] === '');
        if (missing.length) {
          throw new Error(`Missing required fields: ${missing.join(', ')}`);
        }
        const id = item.id || `${tableName}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const columns = Object.keys(item).filter((key) => key !== 'id');
        const placeholders = columns.map(() => '?').join(', ');
        const values = columns.map((key) => item[key]);
        await runQuery(`INSERT INTO ${tableName} (id, ${columns.join(', ')}, createdAt) VALUES (?, ${placeholders}, datetime("now"))`, [id, ...values]);
        const rows = await allQuery(`SELECT * FROM ${tableName} ORDER BY createdAt DESC`);
        res.status(201).json(rows.map(transform));
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    },
    put: async (req, res) => {
      try {
        const item = req.body || {};
        const missing = requiredFields.filter((field) => item[field] === undefined || item[field] === null || item[field] === '');
        if (missing.length) {
          throw new Error(`Missing required fields: ${missing.join(', ')}`);
        }
        const columns = Object.keys(item).filter((key) => key !== 'id');
        const assignments = columns.map((key) => `${key} = ?`).join(', ');
        const values = columns.map((key) => item[key]);
        await runQuery(`UPDATE ${tableName} SET ${assignments} WHERE id = ?`, [...values, req.params.id]);
        const rows = await allQuery(`SELECT * FROM ${tableName} ORDER BY createdAt DESC`);
        res.json(rows.map(transform));
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    },
    delete: async (req, res) => {
      try {
        await runQuery(`DELETE FROM ${tableName} WHERE id = ?`, [req.params.id]);
        const rows = await allQuery(`SELECT * FROM ${tableName} ORDER BY createdAt DESC`);
        res.json(rows.map(transform));
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    },
  };
}

const dashboardMonths = 6;

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'hc2-forecasting-app' });
});

app.get('/api/dashboard', async (req, res) => {
  try {
    const startingCashBalance = Number(req.query.startingCashBalance ?? 0);
    // The starting balance is a real bank figure observed on a specific date, not "the 1st of
    // the month" — it's the OPENING balance on that date. Income/outgoings are still shown in
    // full for every day/month regardless of this date; only the running "balance" trajectory
    // is re-anchored so it equals the entered figure at the start of the effective date, then
    // accumulates forward and backward from there using the (unfiltered) daily net figures.
    // Defaults to today when not supplied.
    const requestedEffectiveDate = req.query.effectiveDate ? new Date(req.query.effectiveDate) : null;
    const effectiveDate = requestedEffectiveDate && Number.isFinite(requestedEffectiveDate.getTime())
      ? requestedEffectiveDate
      : new Date();
    const employees = await getEmployees();
    const paygOverrides = await getPaygOverrides();
    const payroll = generatePayrollProjection({
      roster: employees.filter((employee) => employee.included !== false),
      forecastMonths: dashboardMonths,
      overrides: paygOverrides,
    });

    const contracts = await getContracts();
    const milestones = await getMilestones();
    const sowEntries = await getSows();
    const monthData = new Map();

    for (const month of buildMonthSequence(dashboardMonths)) {
      monthData.set(month.key, {
        month: month.key,
        label: month.label,
        income: 0,
        outgoings: 0,
        net: 0,
        balance: 0,
      });
    }

    // A real day-by-day ledger (every transaction placed on its actual date), rather than each
    // month's total smoothed evenly across its days — lets the daily chart surface genuine
    // intra-month cash crunches (e.g. a payroll run landing the same week bills are due).
    const monthKeys = Array.from(monthData.keys());
    const [firstYear, firstMonthNum] = monthKeys[0].split('-').map(Number);
    const [lastYear, lastMonthNum] = monthKeys[monthKeys.length - 1].split('-').map(Number);
    const windowStart = new Date(firstYear, firstMonthNum - 1, 1);
    const windowEnd = new Date(lastYear, lastMonthNum, 0); // last day of the final month
    const effectiveDateOnly = new Date(effectiveDate.getFullYear(), effectiveDate.getMonth(), effectiveDate.getDate());
    const dayData = new Map();
    for (const cursor = new Date(windowStart); cursor <= windowEnd; cursor.setDate(cursor.getDate() + 1)) {
      dayData.set(formatDateKey(cursor), { date: formatDateKey(cursor), income: 0, outgoings: 0 });
    }

    function addIncomeOnDate(dateKey, amount) {
      const row = dayData.get(dateKey);
      if (row) row.income += toNumber(amount, 0);
    }
    function addOutgoingOnDate(dateKey, amount) {
      const row = dayData.get(dateKey);
      if (row) row.outgoings += toNumber(amount, 0);
    }

    // The month-aggregated return value is unused here — `months` still drives which cycles get
    // generated (open-ended contracts loop until the last of these months, or their end date),
    // but the actual per-cycle amounts now come from contractDailyLedger, keyed by exact date.
    const contractDailyLedger = new Map();
    for (const contract of contracts) {
      buildContractRevenueSchedule(contract, Array.from(monthData.values()), contractDailyLedger);
    }
    for (const [dateKey, amount] of contractDailyLedger) {
      addIncomeOnDate(dateKey, amount);
    }

    for (const milestone of milestones) {
      const dueDate = resolveDueDate(milestone.invoiceDate, milestone.paymentTermDays);
      if (dueDate) addIncomeOnDate(formatDateKey(dueDate), milestone.amount);
    }

    for (const item of sowEntries) {
      const dueDate = resolveDueDate(item.invoiceDate, item.paymentTermDays);
      if (dueDate) addIncomeOnDate(formatDateKey(dueDate), item.amount);
    }

    // Actual invoices/bills: real, one-off Xero-style figures — either genuinely new revenue/
    // cost with no projection to begin with, or the real replacement for a projected milestone,
    // SOW or contract cycle the user has manually zeroed out to avoid double-counting.
    const actualInvoices = await getActualInvoices();
    for (const invoice of actualInvoices) {
      if (!invoice.dueDate) continue;
      addIncomeOnDate(invoice.dueDate, invoice.amount);
    }

    const actualBills = await getActualBills();
    for (const bill of actualBills) {
      if (!bill.dueDate) continue;
      addOutgoingOnDate(bill.dueDate, bill.amount);
    }

    for (const run of payroll.payRuns) {
      // Tax withheld is deferred to the ATO (see payroll.monthlyBills below), so payday cash
      // out is net pay + deductions + super, not gross pay.
      const cashOut = toNumber(run.netPay, 0) + toNumber(run.superAmount, 0) + toNumber(run.deductions, 0);
      addOutgoingOnDate(run.payDate, cashOut);
    }

    for (const bill of payroll.monthlyBills) {
      if (bill.dueDate) addOutgoingOnDate(bill.dueDate, bill.amount);
    }

    const outgoingEntries = await getOutgoings();
    for (const entry of outgoingEntries) {
      if (!entry.dateDue) continue;
      if (entry.recurringMonthly) {
        // Recurring outgoings (rent, overheads) are paid the last calendar day of each month,
        // matching the source spreadsheet's convention.
        for (const monthKey of monthKeys) {
          const [year, monthNum] = monthKey.split('-').map(Number);
          const lastDayOfMonth = new Date(year, monthNum, 0);
          addOutgoingOnDate(formatDateKey(lastDayOfMonth), entry.amount);
        }
        continue;
      }

      addOutgoingOnDate(entry.dateDue, entry.amount);
    }

    const seedBalance = Number.isFinite(startingCashBalance) ? startingCashBalance : 0;
    const sortedDays = Array.from(dayData.values())
      .sort((left, right) => left.date.localeCompare(right.date))
      .map((entry) => ({ ...entry, net: entry.income - entry.outgoings, balance: 0 }));

    // Anchor the running balance at the effective date: it equals the entered starting balance
    // at the START of that date, then accumulates forward using each day's real net from there.
    // Days before the effective date are walked backward from that same anchor — never assumed
    // to be $0 — so the whole trajectory is consistent with a single observed balance, without
    // altering the (unfiltered) income/outgoings figures those days still show.
    const effectiveDateKey = formatDateKey(effectiveDateOnly);
    let effectiveIndex = sortedDays.findIndex((entry) => entry.date >= effectiveDateKey);
    if (effectiveIndex === -1) effectiveIndex = sortedDays.length;

    let forwardBalance = seedBalance;
    for (let i = effectiveIndex; i < sortedDays.length; i += 1) {
      forwardBalance += sortedDays[i].net;
      sortedDays[i].balance = forwardBalance;
    }

    let backwardBalance = seedBalance;
    for (let i = effectiveIndex - 1; i >= 0; i -= 1) {
      sortedDays[i].balance = backwardBalance;
      backwardBalance -= sortedDays[i].net;
    }

    const dailyEntries = sortedDays;

    // The monthly summary table is derived from this same daily ledger, so the two views can
    // never disagree — income/outgoings are the full, unfiltered month totals; each month's
    // balance is simply its last day's (already correctly anchored) balance.
    for (const entry of dailyEntries) {
      const row = monthData.get(entry.date.slice(0, 7));
      if (row) {
        row.income += entry.income;
        row.outgoings += entry.outgoings;
        row.balance = entry.balance;
      }
    }

    const rows = Array.from(monthData.values()).map((row) => {
      row.net = row.income - row.outgoings;
      return row;
    });

    const payrollSummary = {
      totalGrossPayroll: payroll.payRuns.reduce((sum, run) => sum + toNumber(run.grossPay, 0), 0),
      totalSuper: payroll.payRuns.reduce((sum, run) => sum + toNumber(run.superAmount, 0), 0),
      totalTaxWithheld: payroll.payRuns.reduce((sum, run) => sum + toNumber(run.taxWithheld, 0), 0),
      totalNetPay: payroll.payRuns.reduce((sum, run) => sum + toNumber(run.netPay, 0), 0),
      monthlyPaygBills: payroll.monthlyBills,
      runs: payroll.payRuns.map((run) => ({
        employeeId: run.employeeId,
        employeeName: run.employeeName,
        payDate: run.payDate,
        month: run.month,
        grossPay: toNumber(run.grossPay, 0),
        superAmount: toNumber(run.superAmount, 0),
        taxWithheld: toNumber(run.taxWithheld, 0),
        netPay: toNumber(run.netPay, 0),
        dueDate: payroll.monthlyBills.find((bill) => bill.month === run.month)?.dueDate || null,
      })),
    };

    const summary = {
      totalIncome: rows.reduce((sum, row) => sum + row.income, 0),
      totalOutgoings: rows.reduce((sum, row) => sum + row.outgoings, 0),
      totalNet: rows.reduce((sum, row) => sum + row.net, 0),
      endingBalance: rows[rows.length - 1]?.balance || 0,
      chartData: rows.map((row) => ({ label: row.label, income: row.income, outgoings: row.outgoings, balance: row.balance })),
      months: rows,
      dailyEntries,
      payrollSummary,
    };

    res.json(summary);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/config/clients', async (req, res) => {
  try {
    res.json(await getClients());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/config/clients', async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name) throw new Error('Client name is required');
    const id = `client-${Date.now()}`;
    await runQuery('INSERT INTO clients (id, name, createdAt) VALUES (?, ?, datetime("now"))', [id, name]);
    res.status(201).json(await getClients());
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/config/clients/:id', async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name) throw new Error('Client name is required');
    await runQuery('UPDATE clients SET name = ? WHERE id = ?', [name, req.params.id]);
    res.json(await getClients());
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/config/clients/:id', async (req, res) => {
  try {
    await runQuery('DELETE FROM clients WHERE id = ?', [req.params.id]);
    res.json(await getClients());
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/config/payment-terms', async (req, res) => {
  try {
    res.json(await getPaymentTerms());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/config/payment-terms', async (req, res) => {
  try {
    const { days, label } = req.body || {};
    if (!days) throw new Error('Payment term days are required');
    const id = `term-${Date.now()}`;
    await runQuery('INSERT INTO payment_terms (id, days, label, createdAt) VALUES (?, ?, ?, datetime("now"))', [id, Number(days), label || `${days} days`]);
    res.status(201).json(await getPaymentTerms());
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/config/payment-terms/:id', async (req, res) => {
  try {
    const { days, label } = req.body || {};
    if (!days) throw new Error('Payment term days are required');
    await runQuery('UPDATE payment_terms SET days = ?, label = ? WHERE id = ?', [Number(days), label || `${days} days`, req.params.id]);
    res.json(await getPaymentTerms());
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/config/payment-terms/:id', async (req, res) => {
  try {
    await runQuery('DELETE FROM payment_terms WHERE id = ?', [req.params.id]);
    res.json(await getPaymentTerms());
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/config/service-types', async (req, res) => {
  try {
    res.json(await getServiceTypes());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/config/outgoing-types', async (req, res) => {
  try {
    res.json(await getOutgoingTypes());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/config/service-types', async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name) throw new Error('Service type name is required');
    const id = `service-${Date.now()}`;
    await runQuery('INSERT INTO service_types (id, name, createdAt) VALUES (?, ?, datetime("now"))', [id, name]);
    res.status(201).json(await getServiceTypes());
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/config/service-types/:id', async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name) throw new Error('Service type name is required');
    await runQuery('UPDATE service_types SET name = ? WHERE id = ?', [name, req.params.id]);
    res.json(await getServiceTypes());
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/config/service-types/:id', async (req, res) => {
  try {
    await runQuery('DELETE FROM service_types WHERE id = ?', [req.params.id]);
    res.json(await getServiceTypes());
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/config/outgoing-types', async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name) throw new Error('Outgoing type name is required');
    const id = `outgoing-type-${Date.now()}`;
    await runQuery('INSERT INTO outgoing_types (id, name, createdAt) VALUES (?, ?, datetime("now"))', [id, name]);
    res.status(201).json(await getOutgoingTypes());
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/config/outgoing-types/:id', async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name) throw new Error('Outgoing type name is required');
    await runQuery('UPDATE outgoing_types SET name = ? WHERE id = ?', [name, req.params.id]);
    res.json(await getOutgoingTypes());
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/config/outgoing-types/:id', async (req, res) => {
  try {
    await runQuery('DELETE FROM outgoing_types WHERE id = ?', [req.params.id]);
    res.json(await getOutgoingTypes());
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/outgoings', async (req, res) => {
  try {
    res.json(await getOutgoings());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/outgoings', async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.typeId) throw new Error('Outgoing type is required');
    if (!body.dateDue) throw new Error('Date due is required');
    const id = body.id || `outgoing-${Date.now()}`;
    const recurringMonthly = body.recurringMonthly === true || body.recurringMonthly === 'true' ? 1 : 0;
    await runQuery(
      'INSERT INTO outgoings (id, typeId, amount, dateDue, recurringMonthly, createdAt) VALUES (?, ?, ?, ?, ?, datetime("now"))',
      [id, body.typeId, Number(body.amount || 0), body.dateDue, recurringMonthly]
    );
    res.status(201).json(await getOutgoings());
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/outgoings/:id', async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.typeId) throw new Error('Outgoing type is required');
    if (!body.dateDue) throw new Error('Date due is required');
    const recurringMonthly = body.recurringMonthly === true || body.recurringMonthly === 'true' ? 1 : 0;
    await runQuery(
      'UPDATE outgoings SET typeId = ?, amount = ?, dateDue = ?, recurringMonthly = ? WHERE id = ?',
      [body.typeId, Number(body.amount || 0), body.dateDue, recurringMonthly, req.params.id]
    );
    res.json(await getOutgoings());
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/outgoings/:id', async (req, res) => {
  try {
    await runQuery('DELETE FROM outgoings WHERE id = ?', [req.params.id]);
    res.json(await getOutgoings());
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/payg-overrides', async (req, res) => {
  try {
    res.json(await getPaygOverrides());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/payg-overrides/:month', async (req, res) => {
  try {
    const body = req.body || {};
    if (body.amount === undefined || body.amount === null || body.amount === '') {
      throw new Error('Override amount is required');
    }
    await runQuery(
      `INSERT INTO payg_overrides (month, amount, dueDate, reason, createdAt)
       VALUES (?, ?, ?, ?, datetime("now"))
       ON CONFLICT(month) DO UPDATE SET amount = excluded.amount, dueDate = excluded.dueDate, reason = excluded.reason`,
      [req.params.month, Number(body.amount), body.dueDate || null, body.reason || null]
    );
    res.json(await getPaygOverrides());
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/payg-overrides/:month', async (req, res) => {
  try {
    await runQuery('DELETE FROM payg_overrides WHERE month = ?', [req.params.month]);
    res.json(await getPaygOverrides());
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/actual-invoices', async (req, res) => {
  try {
    res.json(await getActualInvoices());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/actual-invoices', async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.description) throw new Error('Description is required');
    if (!body.dueDate) throw new Error('Due date is required');
    const id = body.id || `actual-invoice-${Date.now()}`;
    await runQuery(
      'INSERT INTO actual_invoices (id, description, clientId, amount, dueDate, note, createdAt) VALUES (?, ?, ?, ?, ?, ?, datetime("now"))',
      [id, body.description, body.clientId || null, Number(body.amount || 0), body.dueDate, body.note || null]
    );
    res.status(201).json(await getActualInvoices());
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/actual-invoices/:id', async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.description) throw new Error('Description is required');
    if (!body.dueDate) throw new Error('Due date is required');
    await runQuery(
      'UPDATE actual_invoices SET description = ?, clientId = ?, amount = ?, dueDate = ?, note = ? WHERE id = ?',
      [body.description, body.clientId || null, Number(body.amount || 0), body.dueDate, body.note || null, req.params.id]
    );
    res.json(await getActualInvoices());
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/actual-invoices/:id', async (req, res) => {
  try {
    await runQuery('DELETE FROM actual_invoices WHERE id = ?', [req.params.id]);
    res.json(await getActualInvoices());
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/actual-bills', async (req, res) => {
  try {
    res.json(await getActualBills());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/actual-bills', async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.description) throw new Error('Description is required');
    if (!body.dueDate) throw new Error('Due date is required');
    const id = body.id || `actual-bill-${Date.now()}`;
    await runQuery(
      'INSERT INTO actual_bills (id, description, amount, dueDate, note, createdAt) VALUES (?, ?, ?, ?, ?, datetime("now"))',
      [id, body.description, Number(body.amount || 0), body.dueDate, body.note || null]
    );
    res.status(201).json(await getActualBills());
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/actual-bills/:id', async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.description) throw new Error('Description is required');
    if (!body.dueDate) throw new Error('Due date is required');
    await runQuery(
      'UPDATE actual_bills SET description = ?, amount = ?, dueDate = ?, note = ? WHERE id = ?',
      [body.description, Number(body.amount || 0), body.dueDate, body.note || null, req.params.id]
    );
    res.json(await getActualBills());
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/actual-bills/:id', async (req, res) => {
  try {
    await runQuery('DELETE FROM actual_bills WHERE id = ?', [req.params.id]);
    res.json(await getActualBills());
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/employees', async (req, res) => {
  try {
    res.json(await getEmployees());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/employees', async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.name) throw new Error('Employee name is required');
    const id = body.id || `emp-${Date.now()}`;
    const dayRateValue = body.dailyRate ?? body.dayRate ?? null;
    const workDaysValue = body.daysWorkedPerWeek ?? body.daysPlanned ?? body.workDaysPerPeriod ?? null;
    await runQuery(
      `INSERT INTO employees (id, name, payType, employmentType, paymentMethod, payFrequency, payAmount, netPay, taxWithheld, superAmount, deductions, dayRate, workDaysPerPeriod, state, daysWorkedPerWeek, included, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime("now"))`,
      [
        id,
        body.name,
        body.payType || 'fixed_cycle',
        body.employmentType || (body.payType === 'day_rate' ? 'contractor' : 'payg'),
        body.paymentMethod || 'payroll',
        body.payFrequency || 'fortnightly',
        body.payAmount ?? body.netPay ?? null,
        body.netPay ?? body.payAmount ?? null,
        body.taxWithheld ?? 0,
        body.superAmount ?? 0,
        body.deductions ?? 0,
        dayRateValue,
        workDaysValue,
        body.state || 'QLD',
        workDaysValue,
        body.included === false ? 0 : 1,
      ]
    );
    res.status(201).json(await getEmployees());
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/employees/:id', async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.name) throw new Error('Employee name is required');
    const dayRateValue = body.dailyRate ?? body.dayRate ?? null;
    const workDaysValue = body.daysWorkedPerWeek ?? body.daysPlanned ?? body.workDaysPerPeriod ?? null;
    await runQuery(
      `UPDATE employees
      SET name = ?, payType = ?, employmentType = ?, paymentMethod = ?, payFrequency = ?, payAmount = ?, netPay = ?, taxWithheld = ?, superAmount = ?, deductions = ?, dayRate = ?, workDaysPerPeriod = ?, state = ?, daysWorkedPerWeek = ?, included = ?
       WHERE id = ?`,
      [
        body.name,
        body.payType || 'fixed_cycle',
        body.employmentType || (body.payType === 'day_rate' ? 'contractor' : 'payg'),
        body.paymentMethod || 'payroll',
        body.payFrequency || 'fortnightly',
        body.payAmount ?? body.netPay ?? null,
        body.netPay ?? body.payAmount ?? null,
        body.taxWithheld ?? 0,
        body.superAmount ?? 0,
        body.deductions ?? 0,
        dayRateValue,
        workDaysValue,
        body.state || 'QLD',
        workDaysValue,
        body.included === false ? 0 : 1,
        req.params.id,
      ]
    );
    res.json(await getEmployees());
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/employees/:id', async (req, res) => {
  try {
    await runQuery('DELETE FROM employees WHERE id = ?', [req.params.id]);
    res.json(await getEmployees());
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/contracts', async (req, res) => {
  try {
    res.json(await getContracts());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/contracts', async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.clientId) throw new Error('Client is required');
    if (!body.serviceTypeId) throw new Error('Service type is required');
    const paymentType = body.paymentType || 'monthly';
    const dailyRate = Number(body.dailyRate || 0);
    const daysPerPeriod = Number(body.daysPerPeriod || 0);
    const daysWorkedPerWeek = Number(body.daysWorkedPerWeek || 0);
    const monthlyCharge = paymentType === 'daily_rate'
      ? dailyRate * daysPerPeriod
      : paymentType === 'fortnightly'
        ? (dailyRate > 0 && daysWorkedPerWeek > 0 ? dailyRate * daysWorkedPerWeek * 2 : Number(body.monthlyCharge || 0))
        : Number(body.monthlyCharge || 0);
    const paymentTermBasis = body.paymentTermBasis === 'periodEnd' ? 'periodEnd' : 'invoiceDate';
    const id = body.id || `contract-${Date.now()}`;
    await runQuery(
      `INSERT INTO contracts (id, clientId, serviceTypeId, paymentType, monthlyCharge, dailyRate, daysPerPeriod, daysWorkedPerWeek, firstInvoiceDate, paymentCount, invoiceDay, paymentTermDays, paymentTermBasis, endDate, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime("now"))`,
      [
        id,
        body.clientId,
        body.serviceTypeId,
        paymentType,
        monthlyCharge,
        dailyRate,
        daysPerPeriod,
        daysWorkedPerWeek,
        body.firstInvoiceDate || null,
        Number(body.paymentCount || 0),
        Number(body.invoiceDay || 1),
        Number(body.paymentTermDays || 14),
        paymentTermBasis,
        body.endDate || null,
      ]
    );
    res.status(201).json(await getContracts());
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/contracts/:id', async (req, res) => {
  try {
    const body = req.body || {};
    const paymentType = body.paymentType || 'monthly';
    const dailyRate = Number(body.dailyRate || 0);
    const daysPerPeriod = Number(body.daysPerPeriod || 0);
    const daysWorkedPerWeek = Number(body.daysWorkedPerWeek || 0);
    const monthlyCharge = paymentType === 'daily_rate'
      ? dailyRate * daysPerPeriod
      : paymentType === 'fortnightly'
        ? (dailyRate > 0 && daysWorkedPerWeek > 0 ? dailyRate * daysWorkedPerWeek * 2 : Number(body.monthlyCharge || 0))
        : Number(body.monthlyCharge || 0);
    const paymentTermBasis = body.paymentTermBasis === 'periodEnd' ? 'periodEnd' : 'invoiceDate';
    await runQuery(
      `UPDATE contracts SET clientId = ?, serviceTypeId = ?, paymentType = ?, monthlyCharge = ?, dailyRate = ?, daysPerPeriod = ?, daysWorkedPerWeek = ?, firstInvoiceDate = ?, paymentCount = ?, invoiceDay = ?, paymentTermDays = ?, paymentTermBasis = ?, endDate = ? WHERE id = ?`,
      [body.clientId, body.serviceTypeId, paymentType, monthlyCharge, dailyRate, daysPerPeriod, daysWorkedPerWeek, body.firstInvoiceDate || null, Number(body.paymentCount || 0), Number(body.invoiceDay || 1), Number(body.paymentTermDays || 14), paymentTermBasis, body.endDate || null, req.params.id]
    );
    res.json(await getContracts());
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/contracts/:id', async (req, res) => {
  try {
    await runQuery('DELETE FROM contracts WHERE id = ?', [req.params.id]);
    res.json(await getContracts());
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/milestones', async (req, res) => {
  try {
    res.json(await getMilestones());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// When both fields are given, the milestone's amount is the contract's total value times the
// percentage of the contract completed by this milestone (matching the source spreadsheet's
// Progress Payments model), rather than a manually typed dollar figure.
function resolveMilestoneAmount(body) {
  const contractValue = body.contractValue === '' || body.contractValue === undefined || body.contractValue === null
    ? null
    : Number(body.contractValue);
  const percentComplete = body.percentComplete === '' || body.percentComplete === undefined || body.percentComplete === null
    ? null
    : Number(body.percentComplete);

  if (Number.isFinite(contractValue) && Number.isFinite(percentComplete)) {
    return Number((contractValue * percentComplete).toFixed(2));
  }
  return Number(body.amount || 0);
}

app.post('/api/milestones', async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.clientId) throw new Error('Client is required');
    const id = body.id || `milestone-${Date.now()}`;
    await runQuery(
      'INSERT INTO milestones (id, clientId, projectDescription, milestoneNumber, amount, contractValue, percentComplete, invoiceDate, paymentTermDays, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime("now"))',
      [
        id,
        body.clientId,
        body.projectDescription || '',
        Number(body.milestoneNumber || 1),
        resolveMilestoneAmount(body),
        body.contractValue === '' || body.contractValue === undefined ? null : Number(body.contractValue),
        body.percentComplete === '' || body.percentComplete === undefined ? null : Number(body.percentComplete),
        body.invoiceDate || null,
        Number(body.paymentTermDays || 14),
      ]
    );
    res.status(201).json(await getMilestones());
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/milestones/:id', async (req, res) => {
  try {
    const body = req.body || {};
    await runQuery(
      'UPDATE milestones SET clientId = ?, projectDescription = ?, milestoneNumber = ?, amount = ?, contractValue = ?, percentComplete = ?, invoiceDate = ?, paymentTermDays = ? WHERE id = ?',
      [
        body.clientId,
        body.projectDescription || '',
        Number(body.milestoneNumber || 1),
        resolveMilestoneAmount(body),
        body.contractValue === '' || body.contractValue === undefined ? null : Number(body.contractValue),
        body.percentComplete === '' || body.percentComplete === undefined ? null : Number(body.percentComplete),
        body.invoiceDate || null,
        Number(body.paymentTermDays || 14),
        req.params.id,
      ]
    );
    res.json(await getMilestones());
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/milestones/:id', async (req, res) => {
  try {
    await runQuery('DELETE FROM milestones WHERE id = ?', [req.params.id]);
    res.json(await getMilestones());
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/sows', async (req, res) => {
  try {
    res.json(await getSows());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/sows', async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.clientId) throw new Error('Client is required');
    const id = body.id || `sow-${Date.now()}`;
    await runQuery(
      'INSERT INTO sows (id, clientId, projectDescription, amount, invoiceDate, paymentTermDays, createdAt) VALUES (?, ?, ?, ?, ?, ?, datetime("now"))',
      [id, body.clientId, body.projectDescription || '', Number(body.amount || 0), body.invoiceDate || null, Number(body.paymentTermDays || 14)]
    );
    res.status(201).json(await getSows());
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/sows/:id', async (req, res) => {
  try {
    const body = req.body || {};
    await runQuery(
      'UPDATE sows SET clientId = ?, projectDescription = ?, amount = ?, invoiceDate = ?, paymentTermDays = ? WHERE id = ?',
      [body.clientId, body.projectDescription || '', Number(body.amount || 0), body.invoiceDate || null, Number(body.paymentTermDays || 14), req.params.id]
    );
    res.json(await getSows());
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/sows/:id', async (req, res) => {
  try {
    await runQuery('DELETE FROM sows WHERE id = ?', [req.params.id]);
    res.json(await getSows());
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
const FRONTEND_DIST = path.join(FRONTEND_DIR, 'dist');
if (fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST));
  app.get('*', (req, res) => {
    res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
  });
}

initializeDatabase()
  .then(seedReferenceData)
  .then(() => {
    app.listen(PORT, () => {
      console.log(`HC2 forecasting API listening on http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Failed to initialize application database:', error);
    process.exit(1);
  });
