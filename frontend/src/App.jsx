import { useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { parseEmployeePasteRows, parsePastedRows } from './milestonePasteUtils.js';

const API_BASE = (import.meta.env.VITE_API_BASE || '/api').replace(/\/$/, '');

async function fetchJson(url, options = {}) {
  const response = await fetch(`${API_BASE}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'Request failed');
  }

  return response.json();
}

function formatMoney(value) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(amount);
}

function StatCard({ label, value, tone = 'neutral' }) {
  return (
    <div className={`stat-card ${tone}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

// Groups the backend's real day-by-day ledger into consecutive 7-day buckets, starting from
// the ledger's actual first day (the "as of" effective date) — not a fixed 4-weeks-per-calendar-
// month split starting on the 1st, which ignored the effective date and re-showed activity from
// days already excluded from the forecast.
function buildWeeklyChartData(dailyEntries) {
  if (!Array.isArray(dailyEntries) || dailyEntries.length === 0) return [];

  const weeklyData = [];
  for (let index = 0; index < dailyEntries.length; index += 7) {
    const weekDays = dailyEntries.slice(index, index + 7);
    const firstDay = weekDays[0];
    const lastDay = weekDays[weekDays.length - 1];
    const weeklyIncome = weekDays.reduce((sum, day) => sum + Number(day.income || 0), 0);
    const weeklyOutgoings = weekDays.reduce((sum, day) => sum + Number(day.outgoings || 0), 0);
    const date = new Date(`${firstDay.date}T00:00:00Z`);

    weeklyData.push({
      month: firstDay.date.slice(0, 7),
      label: date.toLocaleString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
      income: weeklyIncome,
      outgoings: weeklyOutgoings,
      net: weeklyIncome - weeklyOutgoings,
      balance: Number(lastDay.balance || 0),
    });
  }

  return weeklyData;
}

// Builds chart-ready points from the backend's real day-by-day ledger (each contract invoice,
// milestone, payroll run, PAYG bill and outgoing placed on its actual transaction date) —
// not a monthly total smoothed evenly across days, which would hide genuine intra-month cash
// crunches (e.g. a payroll run landing the same week a large bill is due).
function buildDailyCashflowData(dailyEntries) {
  if (!Array.isArray(dailyEntries) || dailyEntries.length === 0) return [];

  return dailyEntries.map((entry) => {
    const date = new Date(`${entry.date}T00:00:00Z`);
    return {
      month: entry.date.slice(0, 7),
      label: date.toLocaleString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
      date: date.toISOString(),
      income: Number(entry.income || 0),
      outgoings: Number(entry.outgoings || 0),
      net: Number(entry.net || 0),
      balance: Number(entry.balance || 0),
    };
  });
}

function buildMovingAverageSeries(values, windowSize = 5) {
  if (!Array.isArray(values) || values.length === 0) return [];

  const averaged = [];

  for (let index = 0; index < values.length; index += 1) {
    const start = Math.max(0, index - Math.floor(windowSize / 2));
    const end = Math.min(values.length - 1, index + Math.floor(windowSize / 2));
    let total = 0;
    let count = 0;

    for (let inner = start; inner <= end; inner += 1) {
      total += Number(values[inner] || 0);
      count += 1;
    }

    averaged.push(count > 0 ? total / count : 0);
  }

  return averaged;
}

function buildSmoothLinePath(series, width, height, maxValue) {
  if (!series.length) return '';

  const stepX = series.length > 1 ? (width - 60) / (series.length - 1) : 0;
  const points = series.map((point, index) => ({
    x: 30 + index * stepX,
    y: height - 30 - (point / maxValue) * (height - 60),
  }));

  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y}`;
  }

  let path = `M ${points[0].x} ${points[0].y}`;

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const previous2 = points[index - 2] || previous;
    const next = points[index + 1] || current;

    const controlOneX = previous.x + (current.x - previous2.x) / 6;
    const controlOneY = previous.y + (current.y - previous2.y) / 6;
    const controlTwoX = current.x - (next.x - previous.x) / 6;
    const controlTwoY = current.y - (next.y - previous.y) / 6;

    path += ` C ${controlOneX} ${controlOneY}, ${controlTwoX} ${controlTwoY}, ${current.x} ${current.y}`;
  }

  return path;
}

function buildRecommendationItems(summary) {
  if (!summary || !summary.months || summary.months.length === 0) {
    return [{ title: 'Forecast pending', text: 'Add data to generate a recommendation.', tone: 'neutral' }];
  }

  const months = summary.months;
  const totalIncome = Number(summary.totalIncome || 0);
  const totalOutgoings = Number(summary.totalOutgoings || 0);
  const totalNet = Number(summary.totalNet || 0);
  const endingBalance = Number(summary.endingBalance || 0);

  const recommendations = [];
  const lowestMonthNet = months.reduce((lowest, month) => Math.min(lowest, Number(month.net || 0)), 0);
  const ratio = totalIncome > 0 ? (totalOutgoings / totalIncome) * 100 : 0;
  const shortfall = Math.max(0, Math.abs(Math.min(endingBalance, lowestMonthNet, 0)));

  if (endingBalance < 0 || lowestMonthNet < 0) {
    recommendations.push({
      title: 'Reduce spend',
      text: `Cut discretionary spend or defer hiring by at least ${formatMoney(shortfall)} to protect the cash buffer before the next payroll run.`,
      tone: 'danger',
    });
  }

  if (ratio > 80) {
    recommendations.push({
      title: 'Hold hiring',
      text: `Operating costs are ${ratio.toFixed(0)}% of income. Pause additional headcount and only approve roles tied to signed work or a funded pipeline.`,
      tone: 'warning',
    });
  }

  if (totalNet > 0 && ratio < 75) {
    recommendations.push({
      title: 'Hire or invest',
      text: `The forecast shows a surplus of ${formatMoney(totalNet)}. This is a good point to add a contractor, expand capacity, or pursue a new strategic deal.`,
      tone: 'success',
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({
      title: 'Hold current position',
      text: 'The plan is stable. Maintain staffing levels, keep a small reserve, and only approve new cost when a signed contract or margin uplift is visible.',
      tone: 'neutral',
    });
  }

  return recommendations.slice(0, 3);
}

function getTodayDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function DashboardPage() {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Committed values — only these drive the dashboard fetch, and only change when "Apply" is
  // clicked. Typing into the fields below only updates the *draft* state, so the form never
  // gets torn down (and the input never loses focus) mid-keystroke.
  const [startingCashBalance, setStartingCashBalance] = useState(0);
  const [effectiveDate, setEffectiveDate] = useState(getTodayDateString());
  const [startingCashBalanceInput, setStartingCashBalanceInput] = useState('0');
  const [effectiveDateInput, setEffectiveDateInput] = useState(getTodayDateString());

  useEffect(() => {
    let active = true;
    const value = Number(startingCashBalance || 0);
    setLoading(true);
    fetchJson(`/dashboard?startingCashBalance=${encodeURIComponent(value)}&effectiveDate=${encodeURIComponent(effectiveDate)}`)
      .then((data) => {
        if (active) setSummary(data);
      })
      .catch((err) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [startingCashBalance, effectiveDate]);

  const handleApply = () => {
    const parsedBalance = Number(startingCashBalanceInput) || 0;
    setStartingCashBalanceInput(String(parsedBalance));
    setStartingCashBalance(parsedBalance);
    setEffectiveDate(effectiveDateInput || getTodayDateString());
  };

  if (loading && !summary) return <div className="page-panel">Loading dashboard...</div>;
  if (error) return <div className="page-panel error-box">{error}</div>;

  return (
    <div className="page-panel">
      <div className="page-header">
        <div>
          <p className="eyebrow">Executive view</p>
          <h2>Dashboard</h2>
        </div>
      </div>

      <div className="stats-grid">
        <StatCard label="Income" value={formatMoney(summary.totalIncome)} tone="income" />
        <StatCard label="Outgoings" value={formatMoney(summary.totalOutgoings)} tone="cost" />
        <StatCard label="Net cashflow" value={formatMoney(summary.totalNet)} tone={summary.totalNet >= 0 ? 'positive' : 'negative'} />
        <StatCard label="Ending balance" value={formatMoney(summary.endingBalance)} tone="neutral" />
      </div>

      <div className="dashboard-controls">
        <label className="starting-balance-control">
          <span>Starting cash balance</span>
          <input
            type="text"
            inputMode="decimal"
            value={startingCashBalanceInput}
            onChange={(event) => {
              const raw = event.target.value;
              if (raw === '' || /^-?\d*\.?\d*$/.test(raw)) {
                setStartingCashBalanceInput(raw);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') handleApply();
            }}
          />
        </label>
        <label className="starting-balance-control">
          <span>As of date</span>
          <input
            type="date"
            value={effectiveDateInput}
            onChange={(event) => setEffectiveDateInput(event.target.value)}
          />
        </label>
        <button type="button" onClick={handleApply}>Apply</button>
      </div>
      <p className="field-hint">
        The starting balance is treated as observed on the date above — transactions dated before
        it are assumed already reflected in that balance and are excluded from the forecast.
        Click Apply (or press Enter) to recalculate the forecast.
      </p>

      <div className="recommendations-block">
        <div className="page-header compact-header">
          <div>
            <p className="eyebrow">Actionable guidance</p>
            <h3>Recommendations</h3>
          </div>
        </div>

        <div className="recommendations-grid">
          {buildRecommendationItems(summary).map((item) => (
            <div key={item.title} className={`recommendation-card ${item.tone}`}>
              <div className="recommendation-tag">{item.tone === 'danger' ? 'Priority' : item.tone === 'warning' ? 'Watch' : item.tone === 'success' ? 'Opportunity' : 'Insight'}</div>
              <h4>{item.title}</h4>
              <p>{item.text}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="chart-card">
        <div className="chart-header-row">
          <h3>Six-month weekly forecast</h3>
          <div className="chart-legend" aria-label="Forecast chart legend">
            <span className="legend-item"><span className="legend-swatch income-swatch" />Income</span>
            <span className="legend-item"><span className="legend-swatch cost-swatch" />Outgoings</span>
            <span className="legend-item"><span className="legend-swatch balance-swatch" />Balance</span>
          </div>
        </div>
        <svg viewBox="0 0 760 240" className="chart-svg" role="img" aria-label="Weekly forecast chart">
          {summary.dailyEntries && summary.dailyEntries.length > 0 ? (() => {
            const weeklyData = buildWeeklyChartData(summary.dailyEntries);
            const todayKey = getTodayDateString();
            const todayDailyIndex = summary.dailyEntries.findIndex((entry) => entry.date === todayKey);
            const todayWeekIndex = todayDailyIndex === -1 ? -1 : Math.floor(todayDailyIndex / 7);
            const incomeSeries = buildMovingAverageSeries(weeklyData.map((point) => point.income));
            const outgoingSeries = buildMovingAverageSeries(weeklyData.map((point) => point.outgoings));
            const balanceSeries = buildMovingAverageSeries(weeklyData.map((point) => point.balance));
            const maxValue = Math.max(
              ...incomeSeries,
              ...outgoingSeries,
              ...balanceSeries,
              1
            );
            // Balance can go negative over the forecast window, so the axis floor can't be
            // pinned to 0 — otherwise the balance line renders far outside the chart.
            const minValue = Math.min(
              ...incomeSeries,
              ...outgoingSeries,
              ...balanceSeries,
              Number(startingCashBalance || 0),
              0
            );
            const valueRange = Math.max(maxValue - minValue, 1);
            const yAxisTicks = Array.from({ length: 6 }, (_, index) => {
              const value = minValue + (valueRange / 5) * index;
              const y = 190 - (index / 5) * 160;
              return { value, y };
            });
            const axisFormatter = new Intl.NumberFormat('en-AU', {
              style: 'currency',
              currency: 'AUD',
              notation: 'compact',
              maximumFractionDigits: 1,
            });
            // Every series is shifted by the same -minValue offset so a given dollar value
            // lands at the same height regardless of which line it belongs to, consistent
            // with the axis labels above.
            const incomePath = buildSmoothLinePath(incomeSeries.map((value) => value - minValue), 760, 240, valueRange);
            const outgoingPath = buildSmoothLinePath(outgoingSeries.map((value) => value - minValue), 760, 240, valueRange);
            const balancePath = buildSmoothLinePath(balanceSeries.map((value) => value - minValue), 760, 240, valueRange);
            const zeroY = 190 - ((0 - minValue) / valueRange) * 160;
            const todayX = todayWeekIndex >= 0 && weeklyData.length > 1
              ? 30 + (760 - 60) / (weeklyData.length - 1) * todayWeekIndex
              : null;

            return (
              <>
                {yAxisTicks.map((tick) => (
                  <g key={tick.value}>
                    <line x1="30" y1={tick.y} x2="720" y2={tick.y} className="grid-line" />
                    <text x="8" y={tick.y + 4} className="axis-label axis-value-label">{axisFormatter.format(tick.value)}</text>
                  </g>
                ))}
                <line x1="30" y1="190" x2="720" y2="190" className="axis" />
                <line x1="30" y1="15" x2="30" y2="190" className="axis" />
                <line x1="30" y1={zeroY} x2="720" y2={zeroY} className="zero-line" />
                {todayX !== null ? (
                  <g>
                    <line x1={todayX} y1="15" x2={todayX} y2="190" className="today-line" />
                    <text x={todayX + 4} y="24" className="today-line-label">Today</text>
                  </g>
                ) : null}
                <path d={incomePath} fill="none" stroke="#1ca76a" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
                <path d={outgoingPath} fill="none" stroke="#d64545" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
                <path d={balancePath} fill="none" stroke="#2457d6" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
                {weeklyData.filter((_, index) => index % 6 === 0 || index === weeklyData.length - 1).map((point, index) => {
                  const x = 30 + (weeklyData.length > 1 ? (760 - 60) / (weeklyData.length - 1) * (weeklyData.indexOf(point)) : 0);
                  return (
                    <g key={`${point.month}-${point.label}-${index}`}>
                      <text x={x - 12} y="210" className="axis-label">{point.label}</text>
                    </g>
                  );
                })}
              </>
            );
          })() : null}
        </svg>
      </div>

      <div className="chart-card">
        <div className="chart-header-row">
          <h3>Daily cashflow forecast</h3>
          <div className="chart-legend" aria-label="Daily cashflow forecast legend">
            <span className="legend-item"><span className="legend-swatch income-swatch" />Cash in</span>
            <span className="legend-item"><span className="legend-swatch cost-swatch" />Cash out</span>
            <span className="legend-item"><span className="legend-swatch balance-swatch" />Balance</span>
          </div>
        </div>
        <svg viewBox="0 0 760 240" className="chart-svg" role="img" aria-label="Daily cashflow forecast chart">
          {summary.dailyEntries && summary.dailyEntries.length > 0 ? (() => {
            const dailyData = buildDailyCashflowData(summary.dailyEntries);
            const todayKey = getTodayDateString();
            const todayIndex = dailyData.findIndex((point) => point.date.slice(0, 10) === todayKey);
            const incomeSeries = dailyData.map((point) => point.income);
            const outgoingSeries = dailyData.map((point) => point.outgoings);
            const balanceSeries = dailyData.map((point) => point.balance);
            const maxValue = Math.max(...incomeSeries, ...outgoingSeries, ...balanceSeries, 1);
            // Balance can go negative over the forecast window; income/outgoings are included
            // here too so the axis floor reflects the true minimum across all three series.
            const minValue = Math.min(...incomeSeries, ...outgoingSeries, ...balanceSeries, startingCashBalance, 0);
            const valueRange = Math.max(maxValue - minValue, 1);
            const yAxisTicks = Array.from({ length: 6 }, (_, index) => {
              const value = minValue + (valueRange / 5) * index;
              const y = 190 - (index / 5) * 160;
              return { value, y };
            });
            const axisFormatter = new Intl.NumberFormat('en-AU', {
              style: 'currency',
              currency: 'AUD',
              notation: 'compact',
              maximumFractionDigits: 1,
            });
            // Every series is shifted by the same -minValue offset so a given dollar value
            // lands at the same height regardless of which line it belongs to, consistent
            // with the axis labels above.
            const incomePath = buildSmoothLinePath(incomeSeries.map((point) => point - minValue), 760, 240, valueRange);
            const outgoingPath = buildSmoothLinePath(outgoingSeries.map((point) => point - minValue), 760, 240, valueRange);
            const balancePath = buildSmoothLinePath(balanceSeries.map((point) => point - minValue), 760, 240, valueRange);
            const labelStep = Math.max(1, Math.floor(dailyData.length / 8));
            const zeroY = 190 - ((0 - minValue) / valueRange) * 160;
            const todayX = todayIndex >= 0 && dailyData.length > 1
              ? 30 + (760 - 60) / (dailyData.length - 1) * todayIndex
              : null;

            return (
              <>
                {yAxisTicks.map((tick) => (
                  <g key={tick.value}>
                    <line x1="30" y1={tick.y} x2="720" y2={tick.y} className="grid-line" />
                    <text x="8" y={tick.y + 4} className="axis-label axis-value-label">{axisFormatter.format(tick.value)}</text>
                  </g>
                ))}
                <line x1="30" y1="190" x2="720" y2="190" className="axis" />
                <line x1="30" y1="15" x2="30" y2="190" className="axis" />
                <line x1="30" y1={zeroY} x2="720" y2={zeroY} className="zero-line" />
                {todayX !== null ? (
                  <g>
                    <line x1={todayX} y1="15" x2={todayX} y2="190" className="today-line" />
                    <text x={todayX + 4} y="24" className="today-line-label">Today</text>
                  </g>
                ) : null}
                <path d={incomePath} fill="none" stroke="#1ca76a" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
                <path d={outgoingPath} fill="none" stroke="#d64545" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
                <path d={balancePath} fill="none" stroke="#2457d6" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
                {dailyData.filter((_, index) => index % labelStep === 0 || index === dailyData.length - 1).map((point, index) => {
                  const x = 30 + (dailyData.length > 1 ? (760 - 60) / (dailyData.length - 1) * (dailyData.indexOf(point)) : 0);
                  return (
                    <g key={`${point.date}-${index}`}>
                      <text x={x - 12} y="210" className="axis-label">{point.label}</text>
                    </g>
                  );
                })}
              </>
            );
          })() : null}
        </svg>
      </div>

      {summary.payrollSummary ? (
        <div className="payroll-summary-block">
          <div className="page-header compact-header">
            <div>
              <p className="eyebrow">Payroll</p>
              <h3>Payroll summary</h3>
            </div>
          </div>

          <div className="stats-grid compact-grid">
            <StatCard label="Gross payroll" value={formatMoney(summary.payrollSummary.totalGrossPayroll)} tone="cost" />
            <StatCard label="Employer super" value={formatMoney(summary.payrollSummary.totalSuper)} tone="warning" />
            <StatCard label="Tax withheld" value={formatMoney(summary.payrollSummary.totalTaxWithheld)} tone="neutral" />
            <StatCard label="Net pay" value={formatMoney(summary.payrollSummary.totalNetPay)} tone="income" />
          </div>

          <div className="table-wrap payroll-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Pay date</th>
                  <th>Gross</th>
                  <th>Super</th>
                  <th>Tax</th>
                  <th>Net</th>
                  <th>PAYG due</th>
                </tr>
              </thead>
              <tbody>
                {(summary.payrollSummary.runs || []).map((run) => (
                  <tr key={`${run.employeeId}-${run.payDate}`}>
                    <td>{run.employeeName}</td>
                    <td>{new Date(`${run.payDate}T00:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}</td>
                    <td>{formatMoney(run.grossPay)}</td>
                    <td>{formatMoney(run.superAmount)}</td>
                    <td>{formatMoney(run.taxWithheld)}</td>
                    <td>{formatMoney(run.netPay)}</td>
                    <td>{run.dueDate ? new Date(`${run.dueDate}T00:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Month</th>
              <th>Income</th>
              <th>Outgoings</th>
              <th>Net</th>
              <th>Balance</th>
            </tr>
          </thead>
          <tbody>
            {summary.months.map((row) => (
              <tr key={row.month}>
                <td>{row.label}</td>
                <td>{formatMoney(row.income)}</td>
                <td>{formatMoney(row.outgoings)}</td>
                <td>{formatMoney(row.net)}</td>
                <td>{formatMoney(row.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PayrollPage() {
  const [summary, setSummary] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState('all');
  const [overrideDrafts, setOverrideDrafts] = useState({});
  const [overrideError, setOverrideError] = useState('');

  const loadSummary = () => fetchJson('/dashboard')
    .then((data) => setSummary(data))
    .catch((error) => console.error(error));

  useEffect(() => {
    let active = true;
    fetchJson('/dashboard')
      .then((data) => {
        if (active) setSummary(data);
      })
      .catch((error) => {
        if (active) console.error(error);
      });

    return () => {
      active = false;
    };
  }, []);

  const handleOverrideDraftChange = (month, field, value) => {
    setOverrideDrafts((current) => ({
      ...current,
      [month]: { ...current[month], [field]: value },
    }));
  };

  const handleSaveOverride = async (bill) => {
    const draft = overrideDrafts[bill.month] || {};
    const amount = draft.amount !== undefined && draft.amount !== '' ? draft.amount : bill.amount;
    if (amount === '' || amount === undefined || Number.isNaN(Number(amount))) {
      setOverrideError('Enter a valid override amount.');
      return;
    }

    try {
      await fetchJson(`/payg-overrides/${bill.month}`, {
        method: 'PUT',
        body: JSON.stringify({
          amount: Number(amount),
          dueDate: bill.dueDate,
          reason: draft.reason || bill.reason || 'Manual override',
        }),
      });
      setOverrideError('');
      setOverrideDrafts((current) => ({ ...current, [bill.month]: {} }));
      await loadSummary();
    } catch (error) {
      setOverrideError(error.message);
    }
  };

  const handleClearOverride = async (month) => {
    try {
      await fetchJson(`/payg-overrides/${month}`, { method: 'DELETE' });
      setOverrideError('');
      await loadSummary();
    } catch (error) {
      setOverrideError(error.message);
    }
  };

  const payrollSummary = summary?.payrollSummary || null;
  const payRuns = payrollSummary?.runs || [];
  const monthOptions = [...new Set(payRuns.map((run) => run.month))].sort();
  const filteredRuns = selectedMonth === 'all' ? payRuns : payRuns.filter((run) => run.month === selectedMonth);

  return (
    <div className="page-panel">
      <div className="page-header">
        <div>
          <p className="eyebrow">Payroll</p>
          <h2>Payroll register</h2>
        </div>
      </div>

      {payrollSummary ? (
        <>
          <div className="stats-grid compact-grid">
            <StatCard label="Gross payroll" value={formatMoney(payrollSummary.totalGrossPayroll)} tone="cost" />
            <StatCard label="Employer super" value={formatMoney(payrollSummary.totalSuper)} tone="warning" />
            <StatCard label="Tax withheld" value={formatMoney(payrollSummary.totalTaxWithheld)} tone="neutral" />
            <StatCard label="Net pay" value={formatMoney(payrollSummary.totalNetPay)} tone="income" />
          </div>

          <div className="toolbar-row">
            <label className="filter-inline">
              <span>Filter month</span>
              <select value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)}>
                <option value="all">All months</option>
                {monthOptions.map((month) => (
                  <option key={month} value={month}>{month}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="table-wrap compact payroll-register-table">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Pay date</th>
                  <th>Gross</th>
                  <th>Super</th>
                  <th>Tax</th>
                  <th>Net</th>
                  <th>PAYG due</th>
                </tr>
              </thead>
              <tbody>
                {filteredRuns.length ? filteredRuns.map((run) => (
                  <tr key={`${run.employeeId}-${run.payDate}`}>
                    <td>{run.employeeName}</td>
                    <td>{new Date(`${run.payDate}T00:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}</td>
                    <td>{formatMoney(run.grossPay)}</td>
                    <td>{formatMoney(run.superAmount)}</td>
                    <td>{formatMoney(run.taxWithheld)}</td>
                    <td>{formatMoney(run.netPay)}</td>
                    <td>{run.dueDate ? new Date(`${run.dueDate}T00:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—'}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan="7" className="empty-table-message">No payroll runs for this month.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="payroll-bills-block">
            <h3>PAYG accruals</h3>
            <p className="field-hint">
              Projected from the roster's tax withheld. Once the real ATO bill for a month arrives,
              override it here so the dashboard uses the real figure instead of the projection.
            </p>
            {overrideError ? <div className="error-box">{overrideError}</div> : null}
            <div className="table-wrap compact">
              <table>
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Tax due</th>
                    <th>Due date</th>
                    <th>Status</th>
                    <th>Override amount</th>
                    <th>Reason</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {(payrollSummary.monthlyPaygBills || []).map((bill) => {
                    const draft = overrideDrafts[bill.month] || {};
                    return (
                      <tr key={bill.month}>
                        <td>{bill.month}</td>
                        <td>{formatMoney(bill.amount)}</td>
                        <td>{new Date(`${bill.dueDate}T00:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}</td>
                        <td>{bill.overridden ? <span title={bill.reason || ''}>Overridden</span> : 'Projected'}</td>
                        <td>
                          <input
                            type="number"
                            step="0.01"
                            placeholder={bill.amount}
                            value={draft.amount ?? ''}
                            onChange={(event) => handleOverrideDraftChange(bill.month, 'amount', event.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            placeholder="e.g. Real ATO bill received"
                            value={draft.reason ?? ''}
                            onChange={(event) => handleOverrideDraftChange(bill.month, 'reason', event.target.value)}
                          />
                        </td>
                        <td>
                          <button type="button" className="small" onClick={() => handleSaveOverride(bill)}>Save</button>
                          {bill.overridden ? (
                            <button type="button" className="small" onClick={() => handleClearOverride(bill.month)}>Clear</button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <div className="page-panel">Loading payroll ledger...</div>
      )}
    </div>
  );
}

function EmployeePage() {
  const [employees, setEmployees] = useState([]);
  const [form, setForm] = useState({
    id: '',
    name: '',
    payType: 'fixed_cycle',
    employmentType: 'payg',
    paymentMethod: 'payroll',
    payFrequency: 'fortnightly',
    payAmount: '',
    dayRate: '',
    daysWorkedPerWeek: '',
    included: true,
    state: 'QLD',
  });
  const [error, setError] = useState('');
  const [pasteRows, setPasteRows] = useState([]);
  const [pasteError, setPasteError] = useState('');

  const loadEmployees = () => fetchJson('/employees').then(setEmployees).catch((err) => setError(err.message));

  useEffect(() => {
    loadEmployees();
  }, []);

  const handleChange = (event) => {
    const { name, value, type, checked } = event.target;
    setForm((current) => ({
      ...current,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    try {
      const payload = {
        ...form,
        employmentType: form.employmentType || 'payg',
        paymentMethod: form.paymentMethod || 'payroll',
        payAmount: form.payType === 'fixed_cycle' ? Number(form.payAmount || 0) : null,
        dailyRate: form.payType === 'day_rate' ? Number(form.dayRate || 0) : null,
        daysWorkedPerWeek: form.payType === 'day_rate' ? Number(form.daysWorkedPerWeek || 0) : null,
      };

      if (form.id) {
        await fetchJson(`/employees/${form.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } else {
        await fetchJson('/employees', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      setForm({
        id: '',
        name: '',
        payType: 'fixed_cycle',
        employmentType: 'payg',
        paymentMethod: 'payroll',
        payFrequency: 'fortnightly',
        payAmount: '',
        dayRate: '',
        daysWorkedPerWeek: '',
        included: true,
        state: 'QLD',
      });
      setError('');
      loadEmployees();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleEdit = (employee) => {
    setForm({
      id: employee.id,
      name: employee.name,
      payType: employee.payType || 'fixed_cycle',
      employmentType: employee.employmentType || (employee.payType === 'day_rate' ? 'contractor' : 'payg'),
      paymentMethod: employee.paymentMethod || (employee.employmentType === 'contractor' ? 'invoice' : 'payroll'),
      payFrequency: employee.payFrequency || 'fortnightly',
      payAmount: employee.payAmount ?? '',
      dayRate: employee.dayRate ?? '',
      daysWorkedPerWeek: employee.daysWorkedPerWeek ?? employee.workDaysPerPeriod ?? '',
      included: employee.included !== false,
      state: employee.state || 'QLD',
    });
  };

  const handleDelete = async (id) => {
    await fetchJson(`/employees/${id}`, { method: 'DELETE' });
    loadEmployees();
  };

  const handleToggleIncluded = async (employee) => {
    const nextIncluded = employee.included === false;
    // The PUT route replaces every column, so the full existing record has to be sent back —
    // not just the changed field — or the other fields would be overwritten with defaults.
    await fetchJson(`/employees/${employee.id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...employee, included: nextIncluded }),
    });
    loadEmployees();
  };

  const handleEmployeeGridChange = (rowId, field, value) => {
    setPasteRows((current) => current.map((row) => (
      row.id === rowId ? { ...row, [field]: value } : row
    )));
  };

  const parseEmployeeClipboardRows = (text) => parseEmployeePasteRows(text);

  const handlePasteIntoEmployeeTable = (event, rowId) => {
    event.preventDefault();
    const clipboardText = event.clipboardData.getData('text/plain');
    if (!clipboardText.trim()) return;

    const parsedRows = parseEmployeeClipboardRows(clipboardText);
    if (!parsedRows.length) return;

    setPasteRows((current) => {
      const index = current.findIndex((row) => row.id === rowId);
      if (index === -1) {
        return [...current, ...parsedRows];
      }

      const next = [...current];
      next.splice(index, 1, ...parsedRows);
      return next;
    });

    setPasteError('');
  };

  const addEmployeePasteRow = () => {
    setPasteRows((current) => [
      ...current,
      {
        id: `paste-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: '',
        payType: 'fixed_cycle',
        employmentType: 'payg',
        paymentMethod: 'payroll',
        payFrequency: 'fortnightly',
        payAmount: '',
        dayRate: '',
        daysWorkedPerWeek: '',
        state: 'QLD',
        included: true,
      },
    ]);
  };

  const handleSavePasteRows = async () => {
    if (!pasteRows.length) {
      setPasteError('Paste or add at least one employee row before saving.');
      return;
    }

    const invalidRow = pasteRows.find((row) => !row.name || (!row.payAmount && !row.dayRate && !row.daysWorkedPerWeek));
    if (invalidRow) {
      setPasteError('Each employee row needs a name and either a pay amount or a daily rate.');
      return;
    }

    for (const row of pasteRows) {
      const payload = {
        name: row.name,
        payType: row.payType || 'fixed_cycle',
        employmentType: row.employmentType || 'payg',
        paymentMethod: row.paymentMethod || 'payroll',
        payFrequency: row.payFrequency || 'fortnightly',
        payAmount: row.payType === 'fixed_cycle' ? Number(row.payAmount || 0) : null,
        dailyRate: row.payType === 'day_rate' ? Number(row.dayRate || 0) : null,
        dayRate: row.payType === 'day_rate' ? Number(row.dayRate || 0) : null,
        daysWorkedPerWeek: row.payType === 'day_rate' ? Number(row.daysWorkedPerWeek || 0) : null,
        state: row.state || 'QLD',
        included: row.included !== false,
      };

      await fetchJson('/employees', { method: 'POST', body: JSON.stringify(payload) });
    }

    setPasteRows([]);
    setPasteError('');
    loadEmployees();
  };

  return (
    <div className="page-panel split-layout">
      <section className="card">
        <h2>Employees</h2>
        {error ? <div className="error-box">{error}</div> : null}
        <form className="form-grid" onSubmit={handleSubmit}>
          <input type="hidden" name="id" value={form.id} />
          <label>
            Name
            <input name="name" value={form.name} onChange={handleChange} required />
          </label>
          <label>
            Pay type
            <select name="payType" value={form.payType} onChange={handleChange}>
              <option value="fixed_cycle">Fixed cycle</option>
              <option value="day_rate">Day rate</option>
            </select>
          </label>
          <label>
            Employment type
            <select name="employmentType" value={form.employmentType} onChange={handleChange}>
              <option value="payg">PAYG</option>
              <option value="contractor">Contractor</option>
            </select>
          </label>
          <label>
            Payment method
            <select name="paymentMethod" value={form.paymentMethod} onChange={handleChange}>
              <option value="payroll">Payroll</option>
              <option value="invoice">Invoice</option>
            </select>
          </label>
          <label>
            Pay frequency
            <select name="payFrequency" value={form.payFrequency} onChange={handleChange}>
              <option value="weekly">Weekly</option>
              <option value="fortnightly">Fortnightly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
          {form.payType === 'fixed_cycle' ? (
            <label>
              Net / pay amount (AUD)
              <input type="number" name="payAmount" value={form.payAmount} onChange={handleChange} />
            </label>
          ) : (
            <>
              <label>
                Daily rate (AUD)
                <input type="number" name="dayRate" value={form.dayRate} onChange={handleChange} />
              </label>
              <label>
                Days per week
                <input type="number" name="daysWorkedPerWeek" value={form.daysWorkedPerWeek} onChange={handleChange} />
              </label>
            </>
          )}
          <label>
            State
            <select name="state" value={form.state} onChange={handleChange}>
              <option value="QLD">QLD</option>
              <option value="NSW">NSW</option>
              <option value="VIC">VIC</option>
              <option value="WA">WA</option>
              <option value="SA">SA</option>
              <option value="ACT">ACT</option>
            </select>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" name="included" checked={form.included} onChange={handleChange} />
            Included in forecast
          </label>
          <div className="button-row">
            <button type="submit">{form.id ? 'Update employee' : 'Add employee'}</button>
            {form.id ? <button type="button" className="secondary" onClick={() => setForm({ id: '', name: '', payType: 'fixed_cycle', employmentType: 'payg', paymentMethod: 'payroll', payFrequency: 'fortnightly', payAmount: '', dayRate: '', daysWorkedPerWeek: '', included: true, state: 'QLD' })}>Clear</button> : null}
          </div>
        </form>
      </section>

      <section className="card">
        <div className="chart-header-row">
          <h3>Paste into table</h3>
          <button type="button" className="small" onClick={addEmployeePasteRow}>Add row</button>
        </div>
        <p className="eyebrow">Paste Excel/CSV rows into any cell. Use columns: Name, Pay type, Employment type, Payment method, Pay frequency, Amount or Daily rate, Days per week, State, Included.</p>

        {pasteError ? <div className="error-box">{pasteError}</div> : null}

        <div className="table-wrap compact">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Employment</th>
                <th>Payment</th>
                <th>Frequency</th>
                <th>Amount</th>
                <th>Days/week</th>
                <th>State</th>
                <th>Included</th>
              </tr>
            </thead>
            <tbody>
              {pasteRows.length ? (
                pasteRows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <input value={row.name} onChange={(event) => handleEmployeeGridChange(row.id, 'name', event.target.value)} onPaste={(event) => handlePasteIntoEmployeeTable(event, row.id)} placeholder="Name" />
                    </td>
                    <td>
                      <select value={row.payType} onChange={(event) => handleEmployeeGridChange(row.id, 'payType', event.target.value)} onPaste={(event) => handlePasteIntoEmployeeTable(event, row.id)}>
                        <option value="fixed_cycle">Fixed cycle</option>
                        <option value="day_rate">Day rate</option>
                      </select>
                    </td>
                    <td>
                      <select value={row.employmentType || 'payg'} onChange={(event) => handleEmployeeGridChange(row.id, 'employmentType', event.target.value)} onPaste={(event) => handlePasteIntoEmployeeTable(event, row.id)}>
                        <option value="payg">PAYG</option>
                        <option value="contractor">Contractor</option>
                      </select>
                    </td>
                    <td>
                      <select value={row.paymentMethod || 'payroll'} onChange={(event) => handleEmployeeGridChange(row.id, 'paymentMethod', event.target.value)} onPaste={(event) => handlePasteIntoEmployeeTable(event, row.id)}>
                        <option value="payroll">Payroll</option>
                        <option value="invoice">Invoice</option>
                      </select>
                    </td>
                    <td>
                      <select value={row.payFrequency} onChange={(event) => handleEmployeeGridChange(row.id, 'payFrequency', event.target.value)} onPaste={(event) => handlePasteIntoEmployeeTable(event, row.id)}>
                        <option value="weekly">Weekly</option>
                        <option value="fortnightly">Fortnightly</option>
                        <option value="monthly">Monthly</option>
                      </select>
                    </td>
                    <td>
                      <input type="number" value={row.payType === 'fixed_cycle' ? row.payAmount : row.dayRate} onChange={(event) => handleEmployeeGridChange(row.id, row.payType === 'fixed_cycle' ? 'payAmount' : 'dayRate', event.target.value)} onPaste={(event) => handlePasteIntoEmployeeTable(event, row.id)} placeholder="0" />
                    </td>
                    <td>
                      <input type="number" value={row.daysWorkedPerWeek} onChange={(event) => handleEmployeeGridChange(row.id, 'daysWorkedPerWeek', event.target.value)} onPaste={(event) => handlePasteIntoEmployeeTable(event, row.id)} placeholder="0" />
                    </td>
                    <td>
                      <select value={row.state} onChange={(event) => handleEmployeeGridChange(row.id, 'state', event.target.value)} onPaste={(event) => handlePasteIntoEmployeeTable(event, row.id)}>
                        <option value="QLD">QLD</option>
                        <option value="NSW">NSW</option>
                        <option value="VIC">VIC</option>
                        <option value="WA">WA</option>
                        <option value="SA">SA</option>
                        <option value="ACT">ACT</option>
                        <option value="TAS">TAS</option>
                        <option value="NT">NT</option>
                      </select>
                    </td>
                    <td>
                      <input type="checkbox" checked={row.included} onChange={(event) => handleEmployeeGridChange(row.id, 'included', event.target.checked)} onPaste={(event) => handlePasteIntoEmployeeTable(event, row.id)} />
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="7" className="empty-table-message">Paste or add rows here</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="button-row">
          <button type="button" onClick={handleSavePasteRows} disabled={!pasteRows.length}>Save pasted rows</button>
        </div>
      </section>

      <section className="card">
        <h3>Roster</h3>
        <div className="table-wrap compact">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Rate</th>
                <th>Included in forecast</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((employee) => (
                <tr key={employee.id}>
                  <td>{employee.name}</td>
                  <td>{employee.payType === 'day_rate' ? 'Day rate' : 'Fixed cycle'}</td>
                  <td>{employee.payType === 'day_rate' ? formatMoney(employee.dayRate) : formatMoney(employee.payAmount)}</td>
                  <td>
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={employee.included !== false}
                        onChange={() => handleToggleIncluded(employee)}
                      />
                    </label>
                  </td>
                  <td className="row-actions">
                    <button type="button" className="small" onClick={() => handleEdit(employee)}>Edit</button>
                    <button type="button" className="small danger" onClick={() => handleDelete(employee.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function ContractRevenuePage() {
  const [contracts, setContracts] = useState([]);
  const [clients, setClients] = useState([]);
  const [serviceTypes, setServiceTypes] = useState([]);
  const [form, setForm] = useState({
    id: '',
    clientId: '',
    serviceTypeId: '',
    paymentType: 'monthly',
    monthlyCharge: '',
    dailyRate: '',
    daysPerPeriod: '5',
    daysWorkedPerWeek: '5',
    firstInvoiceDate: '',
    paymentCount: '',
    invoiceDay: '7',
    paymentTermDays: '14',
    paymentTermBasis: 'invoiceDate',
    endDate: '',
  });

  const loadData = async () => {
    const [contractData, clientData, serviceData] = await Promise.all([
      fetchJson('/contracts'),
      fetchJson('/config/clients'),
      fetchJson('/config/service-types'),
    ]);
    setContracts(contractData);
    setClients(clientData);
    setServiceTypes(serviceData);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const paymentType = form.paymentType || 'monthly';
    const dailyRate = Number(form.dailyRate || 0);
    const daysPerPeriod = Number(form.daysPerPeriod || 0);
    const daysWorkedPerWeek = Number(form.daysWorkedPerWeek || 0);
    const monthlyCharge = paymentType === 'daily_rate'
      ? dailyRate * daysPerPeriod
      : paymentType === 'fortnightly'
        ? (dailyRate > 0 && daysWorkedPerWeek > 0 ? dailyRate * daysWorkedPerWeek * 2 : Number(form.monthlyCharge || 0))
        : Number(form.monthlyCharge || 0);

    const payload = {
      ...form,
      paymentType,
      monthlyCharge,
      dailyRate,
      daysPerPeriod,
      daysWorkedPerWeek,
      paymentCount: Number(form.paymentCount || 0),
      invoiceDay: Number(form.invoiceDay || 1),
      paymentTermDays: Number(form.paymentTermDays || 14),
    };

    if (form.id) {
      await fetchJson(`/contracts/${form.id}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      await fetchJson('/contracts', { method: 'POST', body: JSON.stringify(payload) });
    }
    setForm({
      id: '',
      clientId: '',
      serviceTypeId: '',
      paymentType: 'monthly',
      monthlyCharge: '',
      dailyRate: '',
      daysPerPeriod: '5',
      daysWorkedPerWeek: '5',
      firstInvoiceDate: '',
      paymentCount: '',
      invoiceDay: '7',
      paymentTermDays: '14',
      paymentTermBasis: 'invoiceDate',
      endDate: '',
    });
    loadData();
  };

  const handleDelete = async (id) => {
    await fetchJson(`/contracts/${id}`, { method: 'DELETE' });
    loadData();
  };

  return (
    <div className="page-panel split-layout">
      <section className="card">
        <h2>Contract revenue</h2>
        <form className="form-grid" onSubmit={handleSubmit}>
          <label>
            Client
            <select name="clientId" value={form.clientId} onChange={handleChange}>
              <option value="">Select client</option>
              {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
            </select>
          </label>
          <label>
            Service type
            <select name="serviceTypeId" value={form.serviceTypeId} onChange={handleChange}>
              <option value="">Select service</option>
              {serviceTypes.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
            </select>
          </label>
          <label>
            Payment type
            <select name="paymentType" value={form.paymentType} onChange={handleChange}>
              <option value="monthly">Monthly charge</option>
              <option value="daily_rate">Daily rate</option>
              <option value="fortnightly">Fortnightly payments</option>
            </select>
          </label>

          {form.paymentType === 'monthly' && (
            <label>
              Monthly charge (AUD)
              <input type="number" name="monthlyCharge" value={form.monthlyCharge} onChange={handleChange} />
            </label>
          )}

          {(form.paymentType === 'daily_rate' || form.paymentType === 'fortnightly') && (
            <label>
              Daily rate (AUD)
              <input type="number" name="dailyRate" value={form.dailyRate} onChange={handleChange} />
            </label>
          )}

          {form.paymentType === 'daily_rate' && (
            <label>
              Days per period
              <input type="number" name="daysPerPeriod" value={form.daysPerPeriod} onChange={handleChange} />
            </label>
          )}

          {form.paymentType === 'fortnightly' && (
            <>
              <label>
                Days worked per week
                <input type="number" name="daysWorkedPerWeek" value={form.daysWorkedPerWeek} onChange={handleChange} />
              </label>
              <label>
                First invoice date
                <input type="date" name="firstInvoiceDate" value={form.firstInvoiceDate} onChange={handleChange} />
              </label>
              <label>
                Number of payments
                <input type="number" name="paymentCount" value={form.paymentCount} onChange={handleChange} placeholder="Leave blank to invoice until end date" />
              </label>
            </>
          )}

          {form.paymentType !== 'fortnightly' && (
            <label>
              Invoice day
              <input type="number" name="invoiceDay" value={form.invoiceDay} onChange={handleChange} />
            </label>
          )}
          <label>
            Payment terms (days)
            <input type="number" name="paymentTermDays" value={form.paymentTermDays} onChange={handleChange} />
          </label>
          {form.paymentType === 'fortnightly' && (
            <label>
              Payment terms measured from
              <select name="paymentTermBasis" value={form.paymentTermBasis} onChange={handleChange}>
                <option value="invoiceDate">Invoice date (most contracts)</option>
                <option value="periodEnd">Work period end (e.g. Cimic — paid a fixed number of days after the period ends, not after the invoice is raised)</option>
              </select>
            </label>
          )}
          <label>
            End date
            <input type="date" name="endDate" value={form.endDate} onChange={handleChange} />
          </label>
          <div className="button-row">
            <button type="submit">{form.id ? 'Update contract' : 'Add contract'}</button>
          </div>
        </form>
      </section>

      <section className="card">
        <h3>Active contracts</h3>
        <div className="table-wrap compact">
          <table>
            <thead>
              <tr>
                <th>Client</th>
                <th>Service</th>
                <th>Payment</th>
                <th>Amount</th>
                <th>End date</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {contracts.map((contract) => (
                <tr key={contract.id}>
                  <td>{contract.client?.name || '—'}</td>
                  <td>{contract.serviceType?.name || '—'}</td>
                  <td>{contract.paymentType === 'daily_rate' ? 'Daily rate' : contract.paymentType === 'fortnightly' ? 'Fortnightly' : 'Monthly'}</td>
                  <td>{formatMoney(contract.monthlyCharge)}</td>
                  <td>{contract.endDate || 'Ongoing'}</td>
                  <td className="row-actions">
                    <button type="button" className="small" onClick={() => setForm({ id: contract.id, clientId: contract.clientId, serviceTypeId: contract.serviceTypeId, paymentType: contract.paymentType || 'monthly', monthlyCharge: contract.monthlyCharge, dailyRate: contract.dailyRate || '', daysPerPeriod: contract.daysPerPeriod || '5', daysWorkedPerWeek: contract.daysWorkedPerWeek || '5', firstInvoiceDate: contract.firstInvoiceDate || '', paymentCount: contract.paymentCount ? String(contract.paymentCount) : '', invoiceDay: contract.invoiceDay || '7', paymentTermDays: contract.paymentTermDays || '14', paymentTermBasis: contract.paymentTermBasis || 'invoiceDate', endDate: contract.endDate || '' })}>Edit</button>
                    <button type="button" className="small danger" onClick={() => handleDelete(contract.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function MilestonePage() {
  const [milestones, setMilestones] = useState([]);
  const [clients, setClients] = useState([]);
  const [pasteRows, setPasteRows] = useState([]);
  const [pasteError, setPasteError] = useState('');
  const [form, setForm] = useState({ id: '', clientId: '', projectDescription: '', milestoneNumber: '1', amount: '', contractValue: '', percentComplete: '', invoiceDate: '', paymentTermDays: '14' });

  const loadData = async () => {
    const [milestoneData, clientData] = await Promise.all([fetchJson('/milestones'), fetchJson('/config/clients')]);
    setMilestones(milestoneData);
    setClients(clientData);
  };

  const clientLookup = new Map(clients.map((client) => [client.name.trim().toLowerCase(), client]));

  useEffect(() => { loadData(); }, []);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const payload = { ...form, milestoneNumber: Number(form.milestoneNumber || 1), amount: Number(form.amount || 0), paymentTermDays: Number(form.paymentTermDays || 14) };
    if (form.id) {
      await fetchJson(`/milestones/${form.id}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      await fetchJson('/milestones', { method: 'POST', body: JSON.stringify(payload) });
    }
    setForm({ id: '', clientId: '', projectDescription: '', milestoneNumber: '1', amount: '', contractValue: '', percentComplete: '', invoiceDate: '', paymentTermDays: '14' });
    loadData();
  };

  const parseClipboardRows = (text) => parsePastedRows(text, clientLookup);

  const handleGridValueChange = (rowId, field, value) => {
    setPasteRows((current) => current.map((row) => (
      row.id === rowId ? { ...row, [field]: value } : row
    )));
  };

  const handlePasteIntoTable = (event, rowId) => {
    event.preventDefault();
    const clipboardText = event.clipboardData.getData('text/plain');
    if (!clipboardText.trim()) return;

    const parsedRows = parseClipboardRows(clipboardText);
    if (!parsedRows.length) return;

    setPasteRows((current) => {
      const index = current.findIndex((row) => row.id === rowId);
      if (index === -1) {
        return [...current, ...parsedRows];
      }

      const next = [...current];
      next.splice(index, 1, ...parsedRows);
      return next;
    });

    setPasteError('');
  };

  const addPasteRow = () => {
    setPasteRows((current) => [
      ...current,
      {
        id: `paste-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        clientName: '',
        projectDescription: '',
        milestoneNumber: '1',
        amount: '',
        invoiceDate: '',
        paymentTermDays: '14',
        clientId: '',
        isValid: false,
        error: '',
      },
    ]);
  };

  const handleSavePasteRows = async () => {
    if (!pasteRows.length) {
      setPasteError('Paste or add at least one row before saving.');
      return;
    }

    const invalidRow = pasteRows.find((row) => !row.clientName || !row.projectDescription || !row.invoiceDate || !row.amount || !row.clientId);
    if (invalidRow) {
      const field = !invalidRow.clientName || !invalidRow.clientId ? 'client name' : !invalidRow.projectDescription ? 'description' : !invalidRow.invoiceDate ? 'invoice date' : 'amount';
      setPasteError(`Row is incomplete. Check the ${field} value and use an existing client name.`);
      return;
    }

    for (const row of pasteRows) {
      const client = clientLookup.get(row.clientName.trim().toLowerCase());
      if (!client) {
        setPasteError(`Client "${row.clientName}" is not in the configured client list.`);
        return;
      }

      await fetchJson('/milestones', {
        method: 'POST',
        body: JSON.stringify({
          clientId: client.id,
          projectDescription: row.projectDescription,
          milestoneNumber: Number(row.milestoneNumber || 1),
          amount: Number(row.amount || 0),
          invoiceDate: row.invoiceDate,
          paymentTermDays: Number(row.paymentTermDays || 14),
        }),
      });
    }

    setPasteRows([]);
    setPasteError('');
    loadData();
  };

  const handleDelete = async (id) => {
    await fetchJson(`/milestones/${id}`, { method: 'DELETE' });
    loadData();
  };

  return (
    <div className="page-panel split-layout">
      <section className="card">
        <h2>Milestone payments</h2>
        <form className="form-grid" onSubmit={handleSubmit}>
          <label>
            Client
            <select name="clientId" value={form.clientId} onChange={handleChange}>
              <option value="">Select client</option>
              {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
            </select>
          </label>
          <label>
            Project description
            <input name="projectDescription" value={form.projectDescription} onChange={handleChange} />
          </label>
          <label>
            Milestone number
            <input type="number" name="milestoneNumber" value={form.milestoneNumber} onChange={handleChange} />
          </label>
          <label>
            Contract value (AUD, optional)
            <input type="number" name="contractValue" value={form.contractValue} onChange={handleChange} placeholder="e.g. 100000" />
          </label>
          <label>
            % complete (as a decimal, optional — e.g. 0.2 for 20%)
            <input type="number" step="0.01" name="percentComplete" value={form.percentComplete} onChange={handleChange} placeholder="e.g. 0.2" />
          </label>
          <label>
            Amount (AUD)
            <input type="number" name="amount" value={form.amount} onChange={handleChange} disabled={form.contractValue !== '' && form.percentComplete !== ''} />
            {form.contractValue !== '' && form.percentComplete !== '' ? (
              <span className="field-hint">
                = {formatMoney(Number(form.contractValue || 0) * Number(form.percentComplete || 0))} (contract value &times; % complete)
              </span>
            ) : null}
          </label>
          <label>
            Invoice date
            <input type="date" name="invoiceDate" value={form.invoiceDate} onChange={handleChange} />
          </label>
          <label>
            Payment term days
            <input type="number" name="paymentTermDays" value={form.paymentTermDays} onChange={handleChange} />
          </label>
          <div className="button-row">
            <button type="submit">{form.id ? 'Update milestone' : 'Add milestone'}</button>
          </div>
        </form>
      </section>

      <section className="card">
        <div className="chart-header-row">
          <h3>Paste into table</h3>
          <button type="button" className="small" onClick={addPasteRow}>Add row</button>
        </div>
        <p className="eyebrow">Paste Excel/CSV rows into any cell. The client name must match a configured client exactly.</p>

        {pasteError ? <div className="error-box">{pasteError}</div> : null}

        <div className="table-wrap compact">
          <table>
            <thead>
              <tr>
                <th>Client</th>
                <th>Description</th>
                <th>Milestone</th>
                <th>Amount</th>
                <th>Invoice date</th>
                <th>Terms</th>
              </tr>
            </thead>
            <tbody>
              {pasteRows.length ? (
                pasteRows.map((row) => {
                  const isClientValid = !row.clientName || !!clientLookup.get(row.clientName.trim().toLowerCase());
                  return (
                    <tr key={row.id} className={!isClientValid ? 'row-invalid' : ''}>
                      <td>
                        <input
                          value={row.clientName}
                          onChange={(event) => handleGridValueChange(row.id, 'clientName', event.target.value)}
                          onPaste={(event) => handlePasteIntoTable(event, row.id)}
                          placeholder="Client"
                        />
                      </td>
                      <td>
                        <input
                          value={row.projectDescription}
                          onChange={(event) => handleGridValueChange(row.id, 'projectDescription', event.target.value)}
                          onPaste={(event) => handlePasteIntoTable(event, row.id)}
                          placeholder="Project description"
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          value={row.milestoneNumber}
                          onChange={(event) => handleGridValueChange(row.id, 'milestoneNumber', event.target.value)}
                          onPaste={(event) => handlePasteIntoTable(event, row.id)}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          value={row.amount}
                          onChange={(event) => handleGridValueChange(row.id, 'amount', event.target.value)}
                          onPaste={(event) => handlePasteIntoTable(event, row.id)}
                          placeholder="0"
                        />
                      </td>
                      <td>
                        <input
                          type="date"
                          value={row.invoiceDate}
                          onChange={(event) => handleGridValueChange(row.id, 'invoiceDate', event.target.value)}
                          onPaste={(event) => handlePasteIntoTable(event, row.id)}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          value={row.paymentTermDays}
                          onChange={(event) => handleGridValueChange(row.id, 'paymentTermDays', event.target.value)}
                          onPaste={(event) => handlePasteIntoTable(event, row.id)}
                        />
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan="6" className="empty-table-message">Paste or add rows here</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="button-row">
          <button type="button" onClick={handleSavePasteRows} disabled={!pasteRows.length}>Save pasted rows</button>
        </div>
      </section>

      <section className="card">
        <h3>Milestones</h3>
        <div className="table-wrap compact">
          <table>
            <thead>
              <tr>
                <th>Client</th>
                <th>Description</th>
                <th>Amount</th>
                <th>Invoice date</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {milestones.map((item) => (
                <tr key={item.id}>
                  <td>{item.client?.name || '—'}</td>
                  <td>{item.projectDescription}</td>
                  <td>{formatMoney(item.amount)}</td>
                  <td>{item.invoiceDate}</td>
                  <td className="row-actions">
                    <button type="button" className="small" onClick={() => setForm({ id: item.id, clientId: item.clientId, projectDescription: item.projectDescription, milestoneNumber: item.milestoneNumber, amount: item.amount, contractValue: item.contractValue ?? '', percentComplete: item.percentComplete ?? '', invoiceDate: item.invoiceDate, paymentTermDays: item.paymentTermDays })}>Edit</button>
                    <button type="button" className="small danger" onClick={() => handleDelete(item.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function OutgoingPage() {
  const [entries, setEntries] = useState([]);
  const [types, setTypes] = useState([]);
  const [form, setForm] = useState({ id: '', typeId: '', amount: '', dateDue: '', recurringMonthly: false });

  const loadData = async () => {
    const [outgoingData, typeData] = await Promise.all([
      fetchJson('/outgoings'),
      fetchJson('/config/outgoing-types'),
    ]);
    setEntries(outgoingData);
    setTypes(typeData);
  };

  useEffect(() => { loadData(); }, []);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const payload = { ...form, amount: Number(form.amount || 0), recurringMonthly: Boolean(form.recurringMonthly) };
    if (form.id) {
      await fetchJson(`/outgoings/${form.id}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      await fetchJson('/outgoings', { method: 'POST', body: JSON.stringify(payload) });
    }
    setForm({ id: '', typeId: '', amount: '', dateDue: '', recurringMonthly: false });
    loadData();
  };

  const handleDelete = async (id) => {
    await fetchJson(`/outgoings/${id}`, { method: 'DELETE' });
    loadData();
  };

  return (
    <div className="page-panel split-layout">
      <section className="card">
        <h2>Outgoings</h2>
        <form className="form-grid" onSubmit={handleSubmit}>
          <label>
            Type
            <select name="typeId" value={form.typeId} onChange={handleChange}>
              <option value="">Select type</option>
              {types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
            </select>
          </label>
          <label>
            Amount (AUD)
            <input type="number" name="amount" value={form.amount} onChange={handleChange} />
          </label>
          <label>
            Date due
            <input type="date" name="dateDue" value={form.dateDue} onChange={handleChange} />
          </label>
          <label className="checkbox-row">
            <input type="checkbox" name="recurringMonthly" checked={form.recurringMonthly} onChange={(event) => setForm((current) => ({ ...current, recurringMonthly: event.target.checked }))} />
            Recurring monthly on this day
          </label>
          <div className="button-row">
            <button type="submit">{form.id ? 'Update outgoing' : 'Add outgoing'}</button>
          </div>
        </form>
      </section>

      <section className="card">
        <h3>Outgoing register</h3>
        <div className="table-wrap compact">
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Amount</th>
                <th>Date due</th>
                <th>Repeats</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((item) => (
                <tr key={item.id}>
                  <td>{item.type?.name || '—'}</td>
                  <td>{formatMoney(item.amount)}</td>
                  <td>{item.dateDue}</td>
                  <td>
                    {item.recurringMonthly ? <span className="status-badge active">Monthly</span> : <span className="status-badge muted">No</span>}
                  </td>
                  <td className="row-actions">
                    <button type="button" className="small" onClick={() => setForm({ id: item.id, typeId: item.typeId, amount: item.amount, dateDue: item.dateDue, recurringMonthly: Boolean(item.recurringMonthly) })}>Edit</button>
                    <button type="button" className="small danger" onClick={() => handleDelete(item.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function SowPage() {
  const [entries, setEntries] = useState([]);
  const [clients, setClients] = useState([]);
  const [form, setForm] = useState({ id: '', clientId: '', projectDescription: '', amount: '', invoiceDate: '', paymentTermDays: '14' });

  const loadData = async () => {
    const [sowData, clientData] = await Promise.all([fetchJson('/sows'), fetchJson('/config/clients')]);
    setEntries(sowData);
    setClients(clientData);
  };

  useEffect(() => { loadData(); }, []);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const payload = { ...form, amount: Number(form.amount || 0), paymentTermDays: Number(form.paymentTermDays || 14) };
    if (form.id) {
      await fetchJson(`/sows/${form.id}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      await fetchJson('/sows', { method: 'POST', body: JSON.stringify(payload) });
    }
    setForm({ id: '', clientId: '', projectDescription: '', amount: '', invoiceDate: '', paymentTermDays: '14' });
    loadData();
  };

  const handleDelete = async (id) => {
    await fetchJson(`/sows/${id}`, { method: 'DELETE' });
    loadData();
  };

  return (
    <div className="page-panel split-layout">
      <section className="card">
        <h2>Statements of work</h2>
        <form className="form-grid" onSubmit={handleSubmit}>
          <label>
            Client
            <select name="clientId" value={form.clientId} onChange={handleChange}>
              <option value="">Select client</option>
              {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
            </select>
          </label>
          <label>
            Project description
            <input name="projectDescription" value={form.projectDescription} onChange={handleChange} />
          </label>
          <label>
            Amount (AUD)
            <input type="number" name="amount" value={form.amount} onChange={handleChange} />
          </label>
          <label>
            Invoice date
            <input type="date" name="invoiceDate" value={form.invoiceDate} onChange={handleChange} />
          </label>
          <label>
            Payment term days
            <input type="number" name="paymentTermDays" value={form.paymentTermDays} onChange={handleChange} />
          </label>
          <div className="button-row">
            <button type="submit">{form.id ? 'Update SOW' : 'Add SOW'}</button>
          </div>
        </form>
      </section>

      <section className="card">
        <h3>SOW register</h3>
        <div className="table-wrap compact">
          <table>
            <thead>
              <tr>
                <th>Client</th>
                <th>Description</th>
                <th>Amount</th>
                <th>Invoice date</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((item) => (
                <tr key={item.id}>
                  <td>{item.client?.name || '—'}</td>
                  <td>{item.projectDescription}</td>
                  <td>{formatMoney(item.amount)}</td>
                  <td>{item.invoiceDate}</td>
                  <td className="row-actions">
                    <button type="button" className="small" onClick={() => setForm({ id: item.id, clientId: item.clientId, projectDescription: item.projectDescription, amount: item.amount, invoiceDate: item.invoiceDate, paymentTermDays: item.paymentTermDays })}>Edit</button>
                    <button type="button" className="small danger" onClick={() => handleDelete(item.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function ActualsPage() {
  const [invoices, setInvoices] = useState([]);
  const [bills, setBills] = useState([]);
  const [clients, setClients] = useState([]);
  const [invoiceForm, setInvoiceForm] = useState({ id: '', description: '', clientId: '', amount: '', dueDate: '', note: '' });
  const [billForm, setBillForm] = useState({ id: '', description: '', amount: '', dueDate: '', note: '' });

  const loadData = async () => {
    const [invoiceData, billData, clientData] = await Promise.all([
      fetchJson('/actual-invoices'),
      fetchJson('/actual-bills'),
      fetchJson('/config/clients'),
    ]);
    setInvoices(invoiceData);
    setBills(billData);
    setClients(clientData);
  };

  useEffect(() => { loadData(); }, []);

  const handleInvoiceChange = (event) => {
    const { name, value } = event.target;
    setInvoiceForm((current) => ({ ...current, [name]: value }));
  };

  const handleBillChange = (event) => {
    const { name, value } = event.target;
    setBillForm((current) => ({ ...current, [name]: value }));
  };

  const handleInvoiceSubmit = async (event) => {
    event.preventDefault();
    const payload = { ...invoiceForm, amount: Number(invoiceForm.amount || 0) };
    if (invoiceForm.id) {
      await fetchJson(`/actual-invoices/${invoiceForm.id}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      await fetchJson('/actual-invoices', { method: 'POST', body: JSON.stringify(payload) });
    }
    setInvoiceForm({ id: '', description: '', clientId: '', amount: '', dueDate: '', note: '' });
    loadData();
  };

  const handleBillSubmit = async (event) => {
    event.preventDefault();
    const payload = { ...billForm, amount: Number(billForm.amount || 0) };
    if (billForm.id) {
      await fetchJson(`/actual-bills/${billForm.id}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      await fetchJson('/actual-bills', { method: 'POST', body: JSON.stringify(payload) });
    }
    setBillForm({ id: '', description: '', amount: '', dueDate: '', note: '' });
    loadData();
  };

  const handleDeleteInvoice = async (id) => {
    await fetchJson(`/actual-invoices/${id}`, { method: 'DELETE' });
    loadData();
  };

  const handleDeleteBill = async (id) => {
    await fetchJson(`/actual-bills/${id}`, { method: 'DELETE' });
    loadData();
  };

  return (
    <div className="page-panel">
      <div className="page-header">
        <div>
          <p className="eyebrow">Reconciliation</p>
          <h2>Actual invoices &amp; bills</h2>
        </div>
      </div>
      <p className="field-hint">
        Record a real, one-off Xero invoice or bill here — either genuinely new revenue/cost with
        no existing projection, or the real figure replacing a projected milestone, SOW or
        contract cycle. If it replaces a projection, edit that projected entry down to $0 first
        (with a note why) so it isn't double-counted, then record the real amount here.
      </p>

      <div className="split-layout">
        <section className="card">
          <h3>Actual invoices (AR)</h3>
          <form className="form-grid" onSubmit={handleInvoiceSubmit}>
            <label>
              Description
              <input name="description" value={invoiceForm.description} onChange={handleInvoiceChange} />
            </label>
            <label>
              Client (optional)
              <select name="clientId" value={invoiceForm.clientId} onChange={handleInvoiceChange}>
                <option value="">No client</option>
                {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
              </select>
            </label>
            <label>
              Amount (AUD, GST-inclusive as invoiced)
              <input type="number" name="amount" value={invoiceForm.amount} onChange={handleInvoiceChange} />
            </label>
            <label>
              Due date
              <input type="date" name="dueDate" value={invoiceForm.dueDate} onChange={handleInvoiceChange} />
            </label>
            <label>
              Note (optional)
              <input name="note" value={invoiceForm.note} onChange={handleInvoiceChange} placeholder="e.g. Supersedes Sep milestone #2" />
            </label>
            <div className="button-row">
              <button type="submit">{invoiceForm.id ? 'Update invoice' : 'Add invoice'}</button>
            </div>
          </form>

          <div className="table-wrap compact">
            <table>
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Client</th>
                  <th>Amount</th>
                  <th>Due date</th>
                  <th>Note</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((item) => (
                  <tr key={item.id}>
                    <td>{item.description}</td>
                    <td>{item.client?.name || '—'}</td>
                    <td>{formatMoney(item.amount)}</td>
                    <td>{item.dueDate}</td>
                    <td>{item.note || '—'}</td>
                    <td className="row-actions">
                      <button type="button" className="small" onClick={() => setInvoiceForm({ id: item.id, description: item.description, clientId: item.clientId || '', amount: item.amount, dueDate: item.dueDate, note: item.note || '' })}>Edit</button>
                      <button type="button" className="small danger" onClick={() => handleDeleteInvoice(item.id)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <h3>Actual bills (AP)</h3>
          <form className="form-grid" onSubmit={handleBillSubmit}>
            <label>
              Description
              <input name="description" value={billForm.description} onChange={handleBillChange} />
            </label>
            <label>
              Amount (AUD, GST-inclusive as billed)
              <input type="number" name="amount" value={billForm.amount} onChange={handleBillChange} />
            </label>
            <label>
              Due date
              <input type="date" name="dueDate" value={billForm.dueDate} onChange={handleBillChange} />
            </label>
            <label>
              Note (optional)
              <input name="note" value={billForm.note} onChange={handleBillChange} placeholder="e.g. Real ATO PAYG bill for August" />
            </label>
            <div className="button-row">
              <button type="submit">{billForm.id ? 'Update bill' : 'Add bill'}</button>
            </div>
          </form>

          <div className="table-wrap compact">
            <table>
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Amount</th>
                  <th>Due date</th>
                  <th>Note</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {bills.map((item) => (
                  <tr key={item.id}>
                    <td>{item.description}</td>
                    <td>{formatMoney(item.amount)}</td>
                    <td>{item.dueDate}</td>
                    <td>{item.note || '—'}</td>
                    <td className="row-actions">
                      <button type="button" className="small" onClick={() => setBillForm({ id: item.id, description: item.description, amount: item.amount, dueDate: item.dueDate, note: item.note || '' })}>Edit</button>
                      <button type="button" className="small danger" onClick={() => handleDeleteBill(item.id)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

function ConfigurationPage() {
  const [clients, setClients] = useState([]);
  const [terms, setTerms] = useState([]);
  const [serviceTypes, setServiceTypes] = useState([]);
  const [outgoingTypes, setOutgoingTypes] = useState([]);
  const [clientForm, setClientForm] = useState({ name: '' });
  const [termForm, setTermForm] = useState({ days: '14', label: '14 days' });
  const [serviceForm, setServiceForm] = useState({ name: '' });
  const [outgoingTypeForm, setOutgoingTypeForm] = useState({ name: '' });

  const loadData = async () => {
    const [clientData, termData, serviceData, outgoingTypeData] = await Promise.all([
      fetchJson('/config/clients'),
      fetchJson('/config/payment-terms'),
      fetchJson('/config/service-types'),
      fetchJson('/config/outgoing-types'),
    ]);
    setClients(clientData);
    setTerms(termData);
    setServiceTypes(serviceData);
    setOutgoingTypes(outgoingTypeData);
  };

  useEffect(() => { loadData(); }, []);

  const addClient = async (event) => {
    event.preventDefault();
    await fetchJson('/config/clients', { method: 'POST', body: JSON.stringify(clientForm) });
    setClientForm({ name: '' });
    loadData();
  };

  const addTerm = async (event) => {
    event.preventDefault();
    await fetchJson('/config/payment-terms', { method: 'POST', body: JSON.stringify({ ...termForm, days: Number(termForm.days || 14) }) });
    setTermForm({ days: '14', label: '14 days' });
    loadData();
  };

  const addService = async (event) => {
    event.preventDefault();
    await fetchJson('/config/service-types', { method: 'POST', body: JSON.stringify(serviceForm) });
    setServiceForm({ name: '' });
    loadData();
  };

  const addOutgoingType = async (event) => {
    event.preventDefault();
    await fetchJson('/config/outgoing-types', { method: 'POST', body: JSON.stringify(outgoingTypeForm) });
    setOutgoingTypeForm({ name: '' });
    loadData();
  };

  return (
    <div className="page-panel">
      <div className="page-header">
        <div>
          <p className="eyebrow">Setup</p>
          <h2>Configuration</h2>
        </div>
      </div>

      <div className="config-grid">
        <section className="card">
          <h3>Clients</h3>
          <form onSubmit={addClient} className="stacked-form">
            <input value={clientForm.name} onChange={(event) => setClientForm({ name: event.target.value })} placeholder="Client name" />
            <button type="submit">Add client</button>
          </form>
          <ul className="list-stack">
            {clients.map((client) => <li key={client.id}>{client.name}</li>)}
          </ul>
        </section>

        <section className="card">
          <h3>Payment terms</h3>
          <form onSubmit={addTerm} className="stacked-form">
            <input type="number" value={termForm.days} onChange={(event) => setTermForm({ ...termForm, days: event.target.value, label: `${event.target.value} days` })} placeholder="14" />
            <button type="submit">Add term</button>
          </form>
          <ul className="list-stack">
            {terms.map((term) => <li key={term.id}>{term.label}</li>)}
          </ul>
        </section>

        <section className="card">
          <h3>Service types</h3>
          <form onSubmit={addService} className="stacked-form">
            <input value={serviceForm.name} onChange={(event) => setServiceForm({ name: event.target.value })} placeholder="Service type" />
            <button type="submit">Add service</button>
          </form>
          <ul className="list-stack">
            {serviceTypes.map((service) => <li key={service.id}>{service.name}</li>)}
          </ul>
        </section>

        <section className="card">
          <h3>Outgoing types</h3>
          <form onSubmit={addOutgoingType} className="stacked-form">
            <input value={outgoingTypeForm.name} onChange={(event) => setOutgoingTypeForm({ name: event.target.value })} placeholder="Outgoing type" />
            <button type="submit">Add type</button>
          </form>
          <ul className="list-stack">
            {outgoingTypes.map((type) => <li key={type.id}>{type.name}</li>)}
          </ul>
        </section>
      </div>
    </div>
  );
}

function AppLayout() {
  const navItems = [
    { to: '/', label: 'Dashboard' },
    { to: '/payroll', label: 'Payroll' },
    { to: '/employees', label: 'Employees' },
    { to: '/contracts', label: 'Contract Revenue' },
    { to: '/milestones', label: 'Milestone Payments' },
    { to: '/outgoings', label: 'Outgoings' },
    { to: '/sows', label: 'SOW' },
    { to: '/actuals', label: 'Actual Invoices & Bills' },
    { to: '/config', label: 'Configuration' },
  ];

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="logo-block">
          <div className="logo">HC2</div>
          <div>
            <strong>Cash Flow</strong>
            <small>Forecast dashboard</small>
          </div>
        </div>
        <nav className="nav">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="content">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/payroll" element={<PayrollPage />} />
          <Route path="/employees" element={<EmployeePage />} />
          <Route path="/contracts" element={<ContractRevenuePage />} />
          <Route path="/milestones" element={<MilestonePage />} />
          <Route path="/outgoings" element={<OutgoingPage />} />
          <Route path="/sows" element={<SowPage />} />
          <Route path="/actuals" element={<ActualsPage />} />
          <Route path="/config" element={<ConfigurationPage />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return <AppLayout />;
}
