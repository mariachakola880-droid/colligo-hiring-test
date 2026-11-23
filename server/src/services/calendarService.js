import { prisma } from '../db.js';
import { config } from '../config.js';
import { makeCalendar } from '../sla/calendar.js';

const TTL_MS = 5 * 60 * 1000;
let cached = null;
let loadedAt = 0;

/** Business calendar with holidays from the DB (cached for 5 minutes). */
export async function getCalendar() {
  if (cached && Date.now() - loadedAt < TTL_MS) return cached;
  const holidays = await prisma.holiday.findMany({ select: { date: true } });
  cached = makeCalendar({ tz: config.businessTz, holidays: holidays.map((h) => h.date.toISOString().slice(0, 10)) });
  loadedAt = Date.now();
  return cached;
}
