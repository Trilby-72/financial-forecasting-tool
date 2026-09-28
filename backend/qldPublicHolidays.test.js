const test = require('node:test');
const assert = require('node:assert/strict');
const { getQldPublicHolidaysForYear, isQldPublicHoliday, countQldWorkingDays } = require('./qldPublicHolidays');

test('matches the spreadsheet\'s stated 2026/2027 QLD public holidays', () => {
  const holidays2026 = getQldPublicHolidaysForYear(2026).map((date) => date.toISOString().slice(0, 10));

  assert.equal(holidays2026.includes('2026-10-05'), true); // King's Birthday
  assert.equal(holidays2026.includes('2026-12-25'), true); // Christmas Day
  assert.equal(holidays2026.includes('2026-12-28'), true); // Boxing Day in-lieu (26th is a Saturday)
  assert.equal(holidays2026.includes('2026-12-26'), false); // not observed separately

  const holidays2027 = getQldPublicHolidaysForYear(2027).map((date) => date.toISOString().slice(0, 10));
  assert.equal(holidays2027.includes('2027-01-01'), true); // New Year's Day
  assert.equal(holidays2027.includes('2027-01-26'), true); // Australia Day
});

test('isQldPublicHoliday recognises a holiday regardless of time-of-day on the Date object', () => {
  assert.equal(isQldPublicHoliday(new Date('2026-10-05T23:00:00Z')), true);
  assert.equal(isQldPublicHoliday(new Date('2026-10-06T00:00:00Z')), false);
});

test('countQldWorkingDays matches the spreadsheet\'s NETWORKDAYS figures for Cimic\'s cycles', () => {
  // Normal 14-day cycle, no holiday: Contracts Schedule!H2/I2 = 10.
  assert.equal(countQldWorkingDays('2026-08-10', '2026-08-23'), 10);
  // Cycle containing the 5 Oct 2026 King's Birthday holiday: Contracts Schedule!H6/I6 = 9.
  assert.equal(countQldWorkingDays('2026-10-05', '2026-10-18'), 9);
});

test('countQldWorkingDays excludes weekends and returns 0 for an inverted range', () => {
  assert.equal(countQldWorkingDays('2026-09-28', '2026-09-28'), 1); // Monday
  assert.equal(countQldWorkingDays('2026-09-26', '2026-09-27'), 0); // Sat-Sun
  assert.equal(countQldWorkingDays('2026-09-28', '2026-09-20'), 0); // end before start
});
