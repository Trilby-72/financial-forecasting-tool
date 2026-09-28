const { generatePayrollProjection, buildMonthlyPaygBills, getDefaultRoster } = require('./payrollService');

function getDefaultData() {
  return {
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
}

function buildForecast(data, options = {}) {
  const source = data || getDefaultData();
  const months = Number(options.months || 12);
  const employees = Array.isArray(source.employees) ? source.employees : [];
  const contractors = Array.isArray(source.contractors) ? source.contractors : [];
  const contracts = Array.isArray(source.contracts) ? source.contracts : [];
  const sow = Array.isArray(source.sow) ? source.sow : [];
  const rent = Number(source.rent?.monthlyCost || 0);
  const outgoings = Number(source.outgoings?.monthlyCost || 0);
  const activeDeals = Array.isArray(source.deals) ? source.deals.filter((deal) => deal && deal.active !== false) : [];

  const totalPayroll = employees.filter((employee) => employee && employee.active !== false).reduce((sum, employee) => sum + Number(employee.monthlyCost || 0), 0);
  const totalContractors = contractors.filter((contractor) => contractor && contractor.active !== false).reduce((sum, contractor) => sum + Number(contractor.monthlyCost || 0), 0);
  const totalRunRateCosts = rent + outgoings;
  const totalMonthlyRevenue = contracts
    .filter((contract) => contract && contract.active !== false)
    .reduce((sum, contract) => sum + Number(contract.monthlyRevenue || 0), 0) +
    sow.filter((item) => item && item.active !== false).reduce((sum, item) => sum + Number(item.monthlyRevenue || 0), 0);

  const baselineNetCashflow = 3000;
  const monthly = Array.from({ length: months }, (_, index) => {
    const revenue = contracts
      .filter((contract) => contract && contract.active !== false && index + 1 >= Number(contract.startMonth || 1) && index + 1 <= Number(contract.endMonth || months))
      .reduce((sum, contract) => sum + Number(contract.monthlyRevenue || 0), 0) +
      sow
        .filter((item) => item && item.active !== false && index + 1 >= Number(item.startMonth || 1) && index + 1 <= Number(item.endMonth || months))
        .reduce((sum, item) => sum + Number(item.monthlyRevenue || 0), 0);

    let monthlyNet = baselineNetCashflow;
    activeDeals.forEach((deal) => {
      if (Number(deal.month) === index) {
        monthlyNet += Number(deal.probability || 0) * Number(deal.value || 0) / 30;
      }
    });

    return {
      label: `Month ${index + 1}`,
      payroll: totalPayroll,
      recurringRevenue: revenue,
      contractors: totalContractors,
      fixedCosts: totalRunRateCosts,
      netCashflow: Number(monthlyNet.toFixed(2)),
    };
  });

  return {
    data: { employees, contractors, contracts, sow, rent, outgoings, deals: activeDeals },
    yearlyMonths: months,
    monthly,
    summary: {
      totalPayroll,
      totalContractors,
      totalRunRateCosts,
      totalMonthlyRevenue,
      baselineNetCashflow,
      dealValue: activeDeals.reduce((sum, deal) => sum + Number(deal.value || 0), 0),
    },
  };
}

function applyScenario(data, scenario = {}) {
  const nextData = JSON.parse(JSON.stringify(data || getDefaultData()));
  const roster = Array.isArray(nextData.employees) ? nextData.employees : [];
  const deals = Array.isArray(nextData.deals) ? nextData.deals : [];

  if (Array.isArray(scenario.addPersonnel)) {
    scenario.addPersonnel.forEach((person, index) => {
      roster.push({
        id: person.id || `person-${Date.now()}-${index}`,
        name: person.name || `New employee ${index + 1}`,
        monthlyCost: Number(person.monthlyCost || person.payAmount || 0),
        active: person.active !== false,
      });
    });
  }

  if (Array.isArray(scenario.updatePersonnel)) {
    scenario.updatePersonnel.forEach((update) => {
      const row = roster.find((employee) => String(employee.id) === String(update.id));
      if (!row) return;
      Object.assign(row, {
        name: update.name || row.name,
        monthlyCost: Number(update.monthlyCost ?? update.payAmount ?? row.monthlyCost ?? 0),
        active: update.active !== undefined ? Boolean(update.active) : row.active !== false,
      });
    });
  }

  if (Array.isArray(scenario.removePersonnel)) {
    const removed = new Set(scenario.removePersonnel.map((value) => String(value)));
    nextData.employees = roster.filter((employee) => !removed.has(String(employee.id)) && !removed.has(String(employee.name)));
  }

  if (Array.isArray(scenario.adjustDeals)) {
    const updated = [...deals];
    scenario.adjustDeals.forEach((deal) => {
      const row = updated.find((entry) => String(entry.id) === String(deal.id));
      if (row) {
        row.value = Number(deal.value ?? row.value ?? 0);
        row.probability = Number(deal.probability ?? row.probability ?? 0);
      }
    });
    nextData.deals = updated;
  }

  return nextData;
}

module.exports = {
  getDefaultData,
  buildForecast,
  applyScenario,
  generatePayrollProjection,
  buildMonthlyPaygBills,
};
