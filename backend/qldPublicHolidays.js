const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toDateOnly(date) {
  const value = new Date(date);
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function addDays(date, days) {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

// Meeus/Jones/Butcher algorithm — exact for the Gregorian calendar, no lookup table needed.
function getEasterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

// New Year's Day and Australia Day: if the fixed date falls on a weekend, the holiday is
// observed on the following Monday.
function nextMondayIfWeekend(date) {
  const weekday = date.getUTCDay();
  if (weekday === 6) return addDays(date, 2);
  if (weekday === 0) return addDays(date, 1);
  return date;
}

function firstMondayOfMonth(year, monthIndex) {
  const firstOfMonth = new Date(Date.UTC(year, monthIndex, 1));
  const weekday = firstOfMonth.getUTCDay();
  const daysUntilMonday = (8 - weekday) % 7;
  return addDays(firstOfMonth, daysUntilMonday);
}

// Christmas Day / Boxing Day in-lieu: when either fixed date falls on a weekend, QLD gazettes
// substitute holidays on the next available weekday(s) so two holidays are always observed.
function getChristmasAndBoxingDayHolidays(year) {
  const christmasDay = new Date(Date.UTC(year, 11, 25));
  const boxingDay = new Date(Date.UTC(year, 11, 26));
  const christmasWeekday = christmasDay.getUTCDay();

  if (christmasWeekday === 6) {
    // Christmas Sat, Boxing Day Sun — both shift forward, observed Mon 27th and Tue 28th.
    return [addDays(christmasDay, 2), addDays(christmasDay, 3)];
  }
  if (christmasWeekday === 0) {
    // Christmas Sun, Boxing Day Mon — Boxing Day stands, Christmas shifts to Tue 27th.
    return [addDays(christmasDay, 2), boxingDay];
  }
  if (christmasWeekday === 5) {
    // Christmas Fri stands, Boxing Day Sat shifts to Mon 28th.
    return [christmasDay, addDays(boxingDay, 2)];
  }
  return [christmasDay, boxingDay];
}

function getQldPublicHolidaysForYear(year) {
  const easterSunday = getEasterSunday(year);

  return [
    nextMondayIfWeekend(new Date(Date.UTC(year, 0, 1))), // New Year's Day
    nextMondayIfWeekend(new Date(Date.UTC(year, 0, 26))), // Australia Day
    addDays(easterSunday, -2), // Good Friday
    addDays(easterSunday, -1), // Easter Saturday
    easterSunday, // Easter Sunday
    addDays(easterSunday, 1), // Easter Monday
    new Date(Date.UTC(year, 3, 25)), // ANZAC Day (not shifted in QLD)
    firstMondayOfMonth(year, 4), // Labour Day (May)
    firstMondayOfMonth(year, 9), // King's/Queen's Birthday (October)
    ...getChristmasAndBoxingDayHolidays(year),
  ];
}

const holidaySetCache = new Map();

function getHolidaySetForYear(year) {
  if (!holidaySetCache.has(year)) {
    const keys = new Set(getQldPublicHolidaysForYear(year).map(dateKey));
    holidaySetCache.set(year, keys);
  }
  return holidaySetCache.get(year);
}

function isQldPublicHoliday(date) {
  const value = toDateOnly(date);
  return getHolidaySetForYear(value.getUTCFullYear()).has(dateKey(value));
}

function isWeekday(date) {
  const weekday = date.getUTCDay();
  return weekday !== 0 && weekday !== 6;
}

// NETWORKDAYS equivalent: counts Mon-Fri days in [startDate, endDate] inclusive, excluding QLD
// public holidays — matches the spreadsheet's `NETWORKDAYS(period_start, period_end, Holidays)`.
function countQldWorkingDays(startDate, endDate) {
  const start = toDateOnly(startDate);
  const end = toDateOnly(endDate);
  if (end.getTime() < start.getTime()) return 0;

  let count = 0;
  for (let cursor = start; cursor.getTime() <= end.getTime(); cursor = addDays(cursor, 1)) {
    if (isWeekday(cursor) && !isQldPublicHoliday(cursor)) {
      count += 1;
    }
  }
  return count;
}

module.exports = {
  getQldPublicHolidaysForYear,
  isQldPublicHoliday,
  countQldWorkingDays,
};
