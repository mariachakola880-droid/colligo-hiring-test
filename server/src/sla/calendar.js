// Business-hours calendar. Pure functions, no DB, no dependencies.
// All inputs/outputs are JS Dates (UTC instants). Working hours and holidays
// are evaluated in the business timezone (e.g. Asia/Kolkata).

const MS_PER_MIN = 60_000;
const fmtCache = new Map();

function formatter(tz) {
  if (!fmtCache.has(tz)) {
    fmtCache.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }));
  }
  return fmtCache.get(tz);
}

/** Local wall-clock parts of a UTC instant in tz. */
function localParts(date, tz) {
  const p = Object.fromEntries(formatter(tz).formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour, mm: +p.minute, ss: +p.second };
}

/** Offset of tz from UTC at the given instant, in ms. */
function offsetMs(date, tz) {
  const p = localParts(date, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** UTC instant for a local wall-clock time (minutes after local midnight) in tz. */
function localToUtc(y, m, d, minutesOfDay, tz) {
  const guess = Date.UTC(y, m - 1, d, 0, minutesOfDay);
  let t = guess - offsetMs(new Date(guess), tz);
  const off2 = offsetMs(new Date(t), tz);
  if (guess - off2 !== t) t = guess - off2; // DST edge
  return new Date(t);
}

const pad = (n) => String(n).padStart(2, '0');
const isoDate = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

function nextDay({ y, m, d }) {
  const n = new Date(Date.UTC(y, m - 1, d + 1));
  return { y: n.getUTCFullYear(), m: n.getUTCMonth() + 1, d: n.getUTCDate() };
}

/**
 * @param {object} opts
 * @param {string} opts.tz            IANA timezone, e.g. 'Asia/Kolkata'
 * @param {number} [opts.openMin]     minutes after midnight (default 9:30)
 * @param {number} [opts.closeMin]    minutes after midnight (default 18:30)
 * @param {number[]} [opts.workDays]  0=Sun..6=Sat (default Mon–Fri)
 * @param {Iterable<string>} [opts.holidays] local dates 'YYYY-MM-DD'
 */
export function makeCalendar({ tz, openMin = 9 * 60 + 30, closeMin = 18 * 60 + 30, workDays = [1, 2, 3, 4, 5], holidays = [] }) {
  const holidaySet = new Set(holidays);
  const workDaySet = new Set(workDays);
  const MAX_DAYS = 3660;

  function isWorkingDay({ y, m, d }) {
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return workDaySet.has(dow) && !holidaySet.has(isoDate(y, m, d));
  }

  function window(day) {
    return [localToUtc(day.y, day.m, day.d, openMin, tz).getTime(),
            localToUtc(day.y, day.m, day.d, closeMin, tz).getTime()];
  }

  /** Instant reached after `minutes` working minutes from `start`. */
  function addWorkingMinutes(start, minutes) {
    if (!Number.isFinite(minutes) || minutes < 0) throw new RangeError(`addWorkingMinutes: minutes must be >= 0, got ${minutes}`);
    let cursor = start.getTime();
    let left = minutes * MS_PER_MIN;
    let day = localParts(start, tz);
    for (let i = 0; i < MAX_DAYS; i++, day = nextDay(day)) {
      if (!isWorkingDay(day)) continue;
      const [open, close] = window(day);
      const from = Math.max(cursor, open);
      if (from >= close) continue;
      if (left <= close - from) return new Date(from + left);
      left -= close - from;
    }
    throw new Error('addWorkingMinutes: exceeded search range');
  }

  /** Working minutes between two instants (0 if b <= a). */
  function workingMinutesBetween(a, b) {
    const start = a.getTime(), end = b.getTime();
    if (end <= start) return 0;
    let total = 0;
    let day = localParts(a, tz);
    for (let i = 0; i < MAX_DAYS; i++, day = nextDay(day)) {
      const [open, close] = window(day);
      if (open >= end) break;
      if (!isWorkingDay(day)) continue;
      const lo = Math.max(start, open), hi = Math.min(end, close);
      if (hi > lo) total += hi - lo;
    }
    return total / MS_PER_MIN;
  }

  return { tz, minutesPerDay: closeMin - openMin, isWorkingDay, addWorkingMinutes, workingMinutesBetween };
}
