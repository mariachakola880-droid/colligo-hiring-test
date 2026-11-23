// Closes tickets the meeting notes say should close:
// - waiting on the customer with no reply for AUTO_CLOSE_AFTER_MIN working minutes
// - resolved and past the reopen window (a later customer message starts a new ticket)
// Runs on a timer AND lazily before reads, because free hosting may sleep the process.
import { prisma } from '../db.js';
import { getCalendar } from '../services/calendarService.js';
import { AUTO_CLOSE_AFTER_MIN, REOPEN_WINDOW_MS } from '../sla/policy.js';
import { SYSTEM, recordEvent, transition, refreshSlaCache } from '../services/ticketCore.js';
import { HttpError } from '../http.js';

const MIN_INTERVAL_MS = 60_000;
let lastRun = 0;
let running = null;

async function closeOne(cal, ticket, eventType) {
  try {
    await prisma.$transaction(async (tx) => {
      await transition(tx, ticket, 'closed', SYSTEM);
      await recordEvent(tx, ticket.id, SYSTEM, eventType);
      await refreshSlaCache(tx, cal, ticket.id);
    });
    return true;
  } catch (err) {
    if (err instanceof HttpError && err.status === 409) return false; // changed meanwhile; next sweep decides
    throw err;
  }
}

export async function runAutoClose(now = new Date()) {
  const cal = await getCalendar();
  let closed = 0;

  const waiting = await prisma.ticket.findMany({
    where: { status: 'waiting_on_customer', slaPausedAt: { not: null } },
    select: { id: true, status: true, version: true, slaPausedAt: true },
  });
  for (const t of waiting) {
    if (cal.addWorkingMinutes(t.slaPausedAt, AUTO_CLOSE_AFTER_MIN) <= now) {
      if (await closeOne(cal, t, 'auto_closed')) closed++;
    }
  }

  const resolved = await prisma.ticket.findMany({
    where: { status: 'resolved', resolvedAt: { lt: new Date(now.getTime() - REOPEN_WINDOW_MS) } },
    select: { id: true, status: true, version: true },
  });
  for (const t of resolved) {
    if (await closeOne(cal, t, 'closed_after_reopen_window')) closed++;
  }
  return closed;
}

/** Lazy sweep before reads, at most once a minute, never two at once. */
export async function autoCloseIfDue() {
  if (running) return running;
  if (Date.now() - lastRun < MIN_INTERVAL_MS) return 0;
  lastRun = Date.now();
  running = runAutoClose().finally(() => { running = null; });
  return running;
}
