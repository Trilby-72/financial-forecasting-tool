function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getDefaultData() {
  return {
    employees: [
      { id: 'emp-1', name: 'Ava Patel', role: 'Account Director', monthlyCost: 7200, active: true },
      { id: 'emp-2', name: 'Milo Chen', role: 'Senior Consultant', monthlyCost: 6200, active: true },
      { id: 'emp-3', name: 'Priya Shah', role: 'Operations Manager', monthlyCost: 5400, active: true },
    ],
    contractors: [
      { id: 'ctr-1', name: 'Design Support', role: 'UX', monthlyCost: 2900, active: true },
      { id: 'ctr-2', name: 'Finance Admin', role: 'Bookkeeping', monthlyCost: 2200, active: true },
    ],
    contracts: [
      { id: 'ctrct-1', name: 'Retainer A', monthlyRevenue: 12000, active: true, startMonth: 1, endMonth: 12 },
      { id: 'ctrct-2', name: 'Business Support', monthlyRevenue: 6000, active: true, startMonth: 4, endMonth: 12 },
    ],
    sow: [
      { id: 'sow-1', name: 'Project Orion', monthlyRevenue: 8500, active: true, startMonth: 3, endMonth: 6 },
    ],
    rent: { monthlyCost: 2600, active: true },
    outgoings: { monthlyCost: 1800, active: true },
    deals: [
      { id: 'deal-1', name: 'Northwind Expansion', probability: 0.62, value: 48000, month: 6 },
      { id: 'deal-2', name: 'New Brand Retainer', probability: 0.45, value: 36000, month: 9 },
    ],
  };
}

function getMonthName(monthNumber, year) {
  return new Date(Date.UTC(year, monthNumber - 1, 1)).toLocaleString('en-US', {
    month: 'short',
    year: 'numeric',
  });
}

function getMonthRangeForItem(item, monthNumber) {
  if (!item || item.active === false) return false;
  const startMonth = asNumber(item.startMonth, 1);
  const endMonth = asNumber(item.endMonth, 12);
  return monthNumber >= startMonth && monthNumber <= endMonth;
}

function getExpectedPipeline(deals, monthNumber) {
  return (deals || []).reduce((sum, deal) => {
    if (Number(deal.month) !== monthNumber) return sum;
    const probability = asNumber(deal.probability, 0);
    const value = asNumber(deal.value, 0);
    return sum + (probability * value);
  }, 0);
}

function buildForecast(data, options = {}) {
  const safeData = data || getDefaultData();
  const months = Math.max(1, asNumber(options.months, 12));
  const year = Math.max(2025, asNumber(options.year, new Date().getFullYear()));

  const employees = Array.isArray(safeData.employees) ? safeData.employees : [];
  const contractors = Array.isArray(safeData.contractors) ? safeData.contractors : [];
  const contracts = Array.isArray(safeData.contracts) ? safeData.contracts : [];
  const sowItems = Array.isArray(safeData.sow) ? safeData.sow : [];
  const deals = Array.isArray(safeData.deals) ? safeData.deals : [];

  const monthly = [];
  let totalRecurringRevenue = 0;

  for (let monthIndex = 1; monthIndex <= months; monthIndex += 1) {
    const payroll = employees
      .filter((employee) => employee.active !== false)
      .reduce((sum, employee) => sum + asNumber(employee.monthlyCost, 0), 0);

    const contractCosts = contractors
      .filter((contractor) => contractor.active !== false)
      .reduce((sum, contractor) => sum + asNumber(contractor.monthlyCost, 0), 0);

    const revenueFromContracts = contracts
      .filter((contract) => getMonthRangeForItem(contract, monthIndex))
      .reduce((sum, contract) => sum + asNumber(contract.monthlyRevenue, 0), 0);

    const revenueFromSow = sowItems
      .filter((item) => getMonthRangeForItem(item, monthIndex))
      .reduce((sum, item) => sum + asNumber(item.monthlyRevenue, 0), 0);

    const pipelineRevenue = getExpectedPipeline(deals, monthIndex);
    const recurringRevenue = revenueFromContracts + revenueFromSow + pipelineRevenue;
    const fixedCosts = (safeData.rent && safeData.rent.active !== false ? asNumber(safeData.rent.monthlyCost, 0) : 0)
      + (safeData.outgoings && safeData.outgoings.active !== false ? asNumber(safeData.outgoings.monthlyCost, 0) : 0);
    const cashflowAdjustment = asNumber(safeData.cashflowAdjustment, 0);

    const netCashflow = recurringRevenue - payroll - contractCosts - fixedCosts + cashflowAdjustment;

    totalRecurringRevenue += recurringRevenue;

    monthly.push({
      month: monthIndex,
      label: getMonthName(monthIndex, year),
      payroll,
      contractors: contractCosts,
      fixedCosts,
      recurringRevenue,
      dealRevenue: pipelineRevenue,
      netCashflow,
    });
  }

  const averageMonthlyNetCashflow = monthly.reduce((sum, item) => sum + item.netCashflow, 0) / monthly.length;
  const summary = {
    totalPayroll: monthly[0]?.payroll || 0,
    totalContractors: monthly[0]?.contractors || 0,
    totalRunRateCosts: monthly[0]?.fixedCosts || 0,
    totalMonthlyRevenue: monthly[0]?.recurringRevenue || 0,
    baselineNetCashflow: Number(averageMonthlyNetCashflow.toFixed(2)),
    dealValue: deals.reduce((sum, deal) => sum + asNumber(deal.value, 0) * asNumber(deal.probability, 0), 0),
  };

  return {
    data: safeData,
    yearlyMonths: months,
    generatedAt: new Date().toISOString(),
    monthLabels: monthly.map((item) => item.label),
    monthly,
    summary,
  };
}

function applyScenario(data, scenario = {}) {
  const nextData = clone(data || getDefaultData());
  const scenarios = scenario || {};

  if (Array.isArray(scenarios.addPersonnel)) {
    nextData.employees = [
      ...(Array.isArray(nextData.employees) ? nextData.employees : []),
      ...scenarios.addPersonnel.map((person, index) => ({
        id: person.id || `person-${Date.now()}-${index}`,
        name: person.name || `New Hire ${index + 1}`,
        role: person.role || 'Team Member',
        monthlyCost: asNumber(person.monthlyCost, 0),
        active: person.active !== false,
      })),
    ];
  }

  if (Array.isArray(scenarios.removePersonnel)) {
    const removeIds = new Set(scenarios.removePersonnel.map((value) => String(value)));
    nextData.employees = (nextData.employees || []).filter((person) => {
      return !removeIds.has(String(person.id)) && !removeIds.has(String(person.name));
    });
  }

  if (Array.isArray(scenarios.addContractors)) {
    nextData.contractors = [
      ...(Array.isArray(nextData.contractors) ? nextData.contractors : []),
      ...scenarios.addContractors.map((person, index) => ({
        id: person.id || `contractor-${Date.now()}-${index}`,
        name: person.name || `Contractor ${index + 1}`,
        role: person.role || 'Contractor',
        monthlyCost: asNumber(person.monthlyCost, 0),
        active: person.active !== false,
      })),
    ];
  }

  if (Array.isArray(scenarios.removeContractors)) {
    const removeIds = new Set(scenarios.removeContractors.map((value) => String(value)));
    nextData.contractors = (nextData.contractors || []).filter((person) => {
      return !removeIds.has(String(person.id)) && !removeIds.has(String(person.name));
    });
  }

  if (Array.isArray(scenarios.adjustDeals)) {
    nextData.deals = (nextData.deals || []).map((deal) => {
      const override = scenarios.adjustDeals.find((item) => String(item.id) === String(deal.id));
      if (!override) return deal;
      return {
        ...deal,
        value: asNumber(override.value, asNumber(deal.value, 0)),
        probability: asNumber(override.probability, asNumber(deal.probability, 0)),
        month: asNumber(override.month, asNumber(deal.month, 1)),
      };
    });
  }

  if (scenarios.cashflowAdjustment !== undefined) {
    const value = asNumber(scenarios.cashflowAdjustment, 0);
    nextData.cashflowAdjustment = asNumber(nextData.cashflowAdjustment, 0) + value;
  }

  if (scenarios.rentAdjustment !== undefined) {
    nextData.rent = {
      ...(nextData.rent || { monthlyCost: 0, active: true }),
      monthlyCost: asNumber(nextData.rent?.monthlyCost || 0, 0) + asNumber(scenarios.rentAdjustment, 0),
      active: true,
    };
  }

  if (scenarios.outgoingAdjustment !== undefined) {
    nextData.outgoings = {
      ...(nextData.outgoings || { monthlyCost: 0, active: true }),
      monthlyCost: asNumber(nextData.outgoings?.monthlyCost || 0, 0) + asNumber(scenarios.outgoingAdjustment, 0),
      active: true,
    };
  }

  return nextData;
}

module.exports = {
  getDefaultData,
  buildForecast,
  applyScenario,
};
