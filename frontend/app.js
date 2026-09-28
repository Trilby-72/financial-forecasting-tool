const state = {
  employees: [],
  forecast: null,
  selectedIds: [],
  months: 6,
  error: '',
  loading: true,
};

const appEl = document.getElementById('app');

function formatCurrency(value) {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-AU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

async function loadEmployees() {
  try {
    const response = await fetch('/api/employees');
    if (!response.ok) {
      throw new Error('Unable to load employee roster');
    }
    const employees = await response.json();
    state.employees = employees;
    state.selectedIds = employees.filter((employee) => employee.included !== false).map((employee) => employee.id);
    state.error = '';
    render();
    await loadForecast();
  } catch (error) {
    state.error = error.message;
    render();
  }
}

async function loadForecast() {
  if (!state.employees.length) {
    state.forecast = null;
    render();
    return;
  }

  state.loading = true;
  render();

  try {
    const response = await fetch('/api/payroll/forecast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        months: state.months,
        includedEmployeeIds: state.selectedIds,
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Forecast could not be generated');
    }

    state.forecast = payload;
    state.error = '';
  } catch (error) {
    state.error = error.message;
    state.forecast = null;
  } finally {
    state.loading = false;
    render();
  }
}

function toggleIncluded(employeeId) {
  if (state.selectedIds.includes(employeeId)) {
    state.selectedIds = state.selectedIds.filter((id) => id !== employeeId);
  } else {
    state.selectedIds = [...state.selectedIds, employeeId];
  }

  loadForecast();
}

function renderSummaryCards() {
  if (!state.forecast || !state.forecast.summary) return '';

  const summary = state.forecast.summary;
  const cards = [
    { label: 'Gross payroll', value: formatCurrency(summary.totalGrossPayroll) },
    { label: 'Tax accrued', value: formatCurrency(summary.totalTaxAccrued) },
    { label: 'Included', value: String(summary.includedCount) },
    { label: 'Projected bills', value: String(state.forecast.monthlyBills.length) },
  ];

  return `
    <div class="summary-grid">
      ${cards.map((card) => `
        <div class="summary-card">
          <span class="label">${card.label}</span>
          <span class="value">${card.value}</span>
        </div>
      `).join('')}
    </div>
  `;
}

function renderEmployeeRoster() {
  if (!state.employees.length) {
    return '<div class="muted">No employees loaded.</div>';
  }

  return state.employees.map((employee) => {
    const checked = state.selectedIds.includes(employee.id);
    const payLabel = employee.payType === 'day_rate'
      ? `${formatCurrency(employee.dayRate || 0)} per day`
      : `${employee.payFrequency || 'fortnightly'} fixed cycle`;

    return `
      <div class="employee-row" data-id="${employee.id}">
        <input class="employee-toggle" type="checkbox" data-id="${employee.id}" ${checked ? 'checked' : ''} aria-label="Include ${employee.name}" />
        <div class="employee-meta">
          <strong>${employee.name}</strong>
          <span>${payLabel}</span>
        </div>
        <span class="tag ${employee.payType === 'day_rate' ? 'day-rate' : 'fixed'}">${employee.payType === 'day_rate' ? 'Day-rate' : 'Fixed-cycle'}</span>
      </div>
    `;
  }).join('');
}

function renderPayRuns() {
  if (!state.forecast || !state.forecast.payRuns || !state.forecast.payRuns.length) {
    return '<div class="muted">No pay runs have been generated for the current selection.</div>';
  }

  return `
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Employee</th>
            <th>Pay date</th>
            <th>Gross</th>
            <th>Net</th>
            <th>Tax</th>
            <th>Super</th>
          </tr>
        </thead>
        <tbody>
          ${state.forecast.payRuns.map((run) => `
            <tr>
              <td>${run.employeeName}</td>
              <td>${formatDate(run.payDate)}</td>
              <td class="amount">${formatCurrency(run.grossPay)}</td>
              <td class="amount">${formatCurrency(run.netPay)}</td>
              <td class="amount">${formatCurrency(run.taxWithheld)}</td>
              <td class="amount">${formatCurrency(run.superAmount)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderBills() {
  if (!state.forecast || !state.forecast.monthlyBills || !state.forecast.monthlyBills.length) {
    return '<div class="muted">No PAYG accruals for the current selection.</div>';
  }

  return `
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Month</th>
            <th>Accrued tax</th>
            <th>Due date</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${state.forecast.monthlyBills.map((bill) => `
            <tr>
              <td>${bill.month}</td>
              <td class="amount">${formatCurrency(bill.amount)}</td>
              <td>${formatDate(bill.dueDate)}</td>
              <td>${bill.overridden ? '<span class="bill-overridden">Override</span>' : '<span class="status-pill">Projected</span>'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function render() {
  const countLabel = state.employees.length
    ? `${state.selectedIds.length} of ${state.employees.length} included`
    : '0 included';

  appEl.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div>
          <p>HC2 Consulting</p>
          <h1>Payroll Forecast Module</h1>
        </div>
        <button class="secondary" type="button" data-role="select-all">Select all</button>
      </header>

      <main class="panel-grid">
        <section class="panel summary-panel">
          <div class="panel-header">
            <h2>Forecast overview</h2>
            <div class="status-row">
              <span class="status-pill">${countLabel}</span>
              <label class="muted" for="monthsSelect">Horizon:</label>
              <select id="monthsSelect">
                <option value="3" ${state.months === 3 ? 'selected' : ''}>3 months</option>
                <option value="6" ${state.months === 6 ? 'selected' : ''}>6 months</option>
                <option value="12" ${state.months === 12 ? 'selected' : ''}>12 months</option>
              </select>
            </div>
          </div>
          ${state.error ? `<div class="error-box">${state.error}</div>` : ''}
          ${renderSummaryCards()}
        </section>

        <section class="panel roster-panel">
          <div class="panel-header">
            <h2>Employee roster</h2>
            <button class="secondary" type="button" data-role="reset-selection">Reset session</button>
          </div>
          <div class="roster-list">
            ${renderEmployeeRoster()}
          </div>
        </section>

        <section class="panel forecast-panel">
          <div class="panel-header">
            <h2>Pay run projection</h2>
            <span class="muted">${state.loading ? 'Loading...' : 'Live'}</span>
          </div>
          ${renderPayRuns()}
        </section>

        <section class="panel summary-panel">
          <div class="panel-header">
            <h2>Monthly PAYG bills</h2>
          </div>
          ${renderBills()}
        </section>
      </main>
    </div>
  `;

  document.getElementById('monthsSelect').addEventListener('change', (event) => {
    state.months = Number(event.target.value);
    loadForecast();
  });

  document.querySelector('[data-role="select-all"]').addEventListener('click', () => {
    state.selectedIds = state.employees.map((employee) => employee.id);
    loadForecast();
  });

  document.querySelector('[data-role="reset-selection"]').addEventListener('click', () => {
    state.selectedIds = state.employees.filter((employee) => employee.included !== false).map((employee) => employee.id);
    loadForecast();
  });

  document.querySelectorAll('.employee-toggle').forEach((checkbox) => {
    checkbox.addEventListener('change', (event) => {
      const id = event.target.dataset.id;
      toggleIncluded(id);
    });
  });
}

loadEmployees();
