const summaryCards = document.getElementById('summaryCards');
const forecastTableBody = document.getElementById('forecastTableBody');
const removePersonSelect = document.getElementById('removePersonSelect');
const scenarioForm = document.getElementById('scenarioForm');
const resetBtn = document.getElementById('resetBtn');

async function fetchForecast() {
  const response = await fetch('/api/forecast');
  const payload = await response.json();
  return payload;
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function renderSummary(forecast) {
  const summary = forecast.summary || {};
  const cards = [
    { label: 'Payroll', value: formatCurrency(summary.totalPayroll) },
    { label: 'Contractors', value: formatCurrency(summary.totalContractors) },
    { label: 'Fixed costs', value: formatCurrency(summary.totalRunRateCosts) },
    { label: 'Baseline net', value: formatCurrency(summary.baselineNetCashflow) },
  ];

  summaryCards.innerHTML = cards
    .map((card) => `
      <div class="summary-card">
        <span class="label">${card.label}</span>
        <span class="value">${card.value}</span>
      </div>
    `)
    .join('');
}

function renderTable(monthly) {
  forecastTableBody.innerHTML = monthly
    .map((month) => {
      const typeClass = month.netCashflow >= 0 ? 'positive' : 'negative';
      return `
        <tr>
          <td>${month.label}</td>
          <td>${formatCurrency(month.recurringRevenue)}</td>
          <td>${formatCurrency(month.payroll)}</td>
          <td>${formatCurrency(month.contractors)}</td>
          <td>${formatCurrency(month.fixedCosts)}</td>
          <td class="${typeClass}">${formatCurrency(month.netCashflow)}</td>
        </tr>
      `;
    })
    .join('');
}

function renderEmployeePicker(data) {
  const employees = Array.isArray(data.employees) ? data.employees : [];
  removePersonSelect.innerHTML = employees
    .map((person) => `<option value="${person.id}">${person.name}</option>`)
    .join('');
}

async function applyScenario(payload) {
  const response = await fetch('/api/forecast/scenario', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error('Scenario update failed');
  }

  const result = await response.json();
  render(result.forecast);
}

function render(payload) {
  const { data, forecast } = payload;
  renderSummary(forecast);
  renderTable(forecast.monthly || []);
  renderEmployeePicker(data || { employees: [] });
}

async function onLoad() {
  const payload = await fetchForecast();
  render(payload);
}

document.getElementById('addPersonBtn').addEventListener('click', async () => {
  const name = document.getElementById('addPersonName').value.trim();
  const monthlyCost = Number(document.getElementById('addPersonCost').value || 0);

  if (!name || !monthlyCost) {
    alert('Add a name and monthly salary before saving a new employee.');
    return;
  }

  await applyScenario({
    addPersonnel: [{ name, monthlyCost }],
  });

  document.getElementById('addPersonName').value = '';
  document.getElementById('addPersonCost').value = '';
});

document.getElementById('removePersonBtn').addEventListener('click', async () => {
  const personId = removePersonSelect.value;
  if (!personId) {
    alert('Choose an employee to remove.');
    return;
  }

  await applyScenario({ removePersonnel: [personId] });
});

document.getElementById('applyDealBtn').addEventListener('click', async () => {
  const dealValue = Number(document.getElementById('newDealValue').value || 0);
  if (!dealValue) {
    alert('Enter a deal value before updating the pipeline.');
    return;
  }

  await applyScenario({
    adjustDeals: [{ id: 'deal-1', value: dealValue, probability: 0.7 }],
  });

  document.getElementById('newDealValue').value = '';
});

document.getElementById('applyCashflowBtn').addEventListener('click', async () => {
  const adjustment = Number(document.getElementById('cashflowAdjustment').value || 0);
  if (!adjustment) {
    alert('Enter a cashflow adjustment value.');
    return;
  }

  await applyScenario({ cashflowAdjustment: adjustment });
  document.getElementById('cashflowAdjustment').value = '';
});

resetBtn.addEventListener('click', async () => {
  const response = await fetch('/api/forecast/reset', { method: 'POST' });
  const payload = await response.json();
  render(payload);
});

scenarioForm.addEventListener('submit', (event) => event.preventDefault());
onLoad();
