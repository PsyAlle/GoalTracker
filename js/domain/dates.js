// dates.js
// All dates are stored and compared as ISO date strings ("YYYY-MM-DD") in the
// user's local timezone. We deliberately avoid storing Date objects or
// timestamps for calendar-day logic, since that's what stays stable across
// re-opening the app on different days/timezone quirks.

/** @returns {string} today's date as YYYY-MM-DD, local time */
export function todayStr() {
  return toDateStr(new Date());
}

/** @param {Date} d */
export function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** @param {string} dateStr YYYY-MM-DD @returns {Date} local midnight */
export function parseDateStr(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** @param {string} dateStr @param {number} days @returns {string} */
export function addDays(dateStr, days) {
  const d = parseDateStr(dateStr);
  d.setDate(d.getDate() + days);
  return toDateStr(d);
}

/** Inclusive day-count difference: daysBetween(a, b) = b - a in days. */
export function daysBetween(fromStr, toStr) {
  const a = parseDateStr(fromStr);
  const b = parseDateStr(toStr);
  return Math.round((b - a) / 86400000);
}

/** ISO weekday: 1 = Monday ... 7 = Sunday */
export function isoWeekday(dateStr) {
  const d = parseDateStr(dateStr);
  const jsDay = d.getDay(); // 0=Sun..6=Sat
  return jsDay === 0 ? 7 : jsDay;
}

export function isWeekend(dateStr) {
  const wd = isoWeekday(dateStr);
  return wd === 6 || wd === 7;
}

/**
 * Given a period's active start date, returns which week number (1-4) a
 * given date falls in, or null if outside the active range.
 */
export function weekNumberInPeriod(periodStartDate, dateStr) {
  const diff = daysBetween(periodStartDate, dateStr);
  if (diff < 0) return null;
  const week = Math.floor(diff / 7) + 1;
  return week >= 1 && week <= 4 ? week : null;
}

export function formatDateHuman(dateStr) {
  const d = parseDateStr(dateStr);
  return d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' });
}

export const WEEKDAY_LABELS = {
  1: 'Mån',
  2: 'Tis',
  3: 'Ons',
  4: 'Tor',
  5: 'Fre',
  6: 'Lör',
  7: 'Sön',
};
