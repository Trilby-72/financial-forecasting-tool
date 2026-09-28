import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEmployeePasteRows, parsePastedRows } from './milestonePasteUtils.js';

test('parses pasted CSV rows without dropping quoted values or extra columns', () => {
  const text = [
    'Steel Builder,"Project Alpha, Phase 2",1,15000,2026-10-15,14',
    'Vinnies,"Implementation Work, Phase 1",2,22000,2026-10-20,30',
  ].join('\n');

  const rows = parsePastedRows(text, new Map([
    ['steel builder', { id: 1 }],
    ['vinnies', { id: 2 }],
  ]));

  assert.equal(rows.length, 2);
  assert.equal(rows[0].clientName, 'Steel Builder');
  assert.equal(rows[0].projectDescription, 'Project Alpha, Phase 2');
  assert.equal(rows[0].amount, '15000');
  assert.equal(rows[0].invoiceDate, '2026-10-15');
  assert.equal(rows[0].paymentTermDays, '14');
  assert.equal(rows[1].projectDescription, 'Implementation Work, Phase 1');
});

test('keeps extra columns by folding them into the description before the last four values', () => {
  const text = 'Busy Bees,Project Anchor, Upgrade,1,15000,2026-10-15,14';
  const rows = parsePastedRows(text, new Map([['busy bees', { id: 2 }]]));

  assert.equal(rows.length, 1);
  assert.equal(rows[0].clientName, 'Busy Bees');
  assert.equal(rows[0].projectDescription, 'Project Anchor Upgrade');
  assert.equal(rows[0].milestoneNumber, '1');
  assert.equal(rows[0].amount, '15000');
  assert.equal(rows[0].invoiceDate, '2026-10-15');
  assert.equal(rows[0].paymentTermDays, '14');
});

test('parses raw spreadsheet rows pasted without commas and normalises D/M/Y dates to ISO', () => {
  const text = [
    'Steel Builder Implementation 1/9/2026 20000.00 30/9/2026 14',
    'Vinnies Implementation 1/7/2026 8498.82 31/7/2026 14',
  ].join('\n');

  const rows = parsePastedRows(text, new Map([
    ['steel builder', { id: 1 }],
    ['vinnies', { id: 2 }],
  ]));

  assert.equal(rows.length, 2);
  assert.equal(rows[0].clientName, 'Steel Builder');
  assert.equal(rows[0].projectDescription, 'Implementation');
  assert.equal(rows[0].amount, '20000.00');
  // The pasted "30/9/2026" is Australian D/M/Y; stored as ISO so `new Date(...)` on the backend
  // doesn't misread day-30 as an invalid month and silently drop the row (see contractRevenue.js).
  assert.equal(rows[0].invoiceDate, '2026-09-30');
  assert.equal(rows[0].paymentTermDays, '14');
  assert.equal(rows[1].clientName, 'Vinnies');
  assert.equal(rows[1].amount, '8498.82');
  assert.equal(rows[1].invoiceDate, '2026-07-31');
});

test('parses pasted employee rows in Excel/CSV format', () => {
  const text = [
    'Jane Smith,day_rate,fortnightly,650,5,QLD,true',
    'John Brown,fixed_cycle,monthly,5200,,NSW,1',
  ].join('\n');

  const rows = parseEmployeePasteRows(text);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, 'Jane Smith');
  assert.equal(rows[0].payType, 'day_rate');
  assert.equal(rows[0].dayRate, '650');
  assert.equal(rows[0].daysWorkedPerWeek, '5');
  assert.equal(rows[1].payType, 'fixed_cycle');
  assert.equal(rows[1].payAmount, '5200');
  assert.equal(rows[1].state, 'NSW');
  assert.equal(rows[1].included, true);
});
