// SLA computation. Pure: takes a ticket's history, returns deadlines and states.
//
// Rules:
// - Timers run only in working hours (see calendar.js).
// - Timers are PAUSED while a ticket is waiting on the customer or resolved
//   (a reopened ticket continues from where it stopped).
// - Priority changes never rewrite history:
//   * A completed timer is judged by the priority in effect when it completed.
//   * A timer that passed its deadline under some priority stays breached,
//     even after a later downgrade.
//   * Only a running timer switches to the new priority's target. Its deadline
//     is measured from creation (time already used is kept). After a change it
//     gets a grace of PRIORITY_CHANGE_GRACE_MIN working minutes from the change,
//     so an honest escalation does not create an instant breach, but the grace
//     never extends past the earliest deadline under any earlier priority, so
//     toggling priority cannot buy extra time.
// - A ticket closed while waiting on the customer (auto-close after they went
//   quiet) is neither met nor breached: its open timers end as 'closed_no_reply',
//   unless they had already breached. Any other close is judged against the
//   deadline as if the ticket had been resolved at that moment, so closing a
//   ticket cannot hide a breach.
import { SLA_TARGETS, PRIORITY_CHANGE_GRACE_MIN } from './policy.js';

/**
 * Deadline at which `targetMin` ACTIVE working minutes have elapsed since `start`,
 * skipping pause intervals. Returns null if the target is not reached before an
 * ongoing (open-ended) pause.
 * @param {{from: Date, to: Date|null}[]} pauses sorted, non-overlapping
 */
export function deadlineWithPauses(cal, start, targetMin, pauses) {
  let remaining = targetMin;
  let cursor = start;
  for (const p of pauses) {
    if (p.from <= cursor) { if (p.to === null) return null; if (p.to > cursor) cursor = p.to; continue; }
    const used = cal.workingMinutesBetween(cursor, p.from);
    if (remaining <= used) return cal.addWorkingMinutes(cursor, remaining);
    remaining -= used;
    if (p.to === null) return null; // paused now, deadline not reached yet
    cursor = p.to;
  }
  return cal.addWorkingMinutes(cursor, remaining);
}

/** Only the parts of pauses that start before `t` (or all if t is null). */
function pausesBefore(pauses, t) {
  if (!t) return pauses;
  return pauses.filter((p) => p.from < t).map((p) => (p.to === null || p.to > t ? { from: p.from, to: t } : p));
}

function targetFor(priority, key) {
  const target = SLA_TARGETS[priority];
  if (!target) throw new Error(`Unknown priority: ${priority}`);
  return target[key];
}

/**
 * Evaluate one timer ('responseMin' or 'resolveMin') against the priority history.
 * @param {Date|null} completedAt  when the timer was satisfied (first reply / resolution)
 * @param {Date|null} closedAt     when the ticket was closed without satisfying it
 * @returns {{ dueAt: Date|null,
 *             state: 'on_track'|'paused'|'breached'|'met'|'closed_no_reply',
 *             priority: string, breach: { priority: string, dueAt: Date } | null }}
 */
function evaluateTimer(cal, t, key, completedAt, closedAt, now) {
  const end = completedAt ?? closedAt ?? now;
  const pauses = pausesBefore(t.pauses, completedAt);
  // Priorities in effect before the timer ended (or before now).
  // A change at the exact moment of completion/close does not count; a change at 'now' does.
  const ended = Boolean(completedAt ?? closedAt);
  const segments = t.priorityHistory.filter((s, i) => i === 0 || (ended ? s.from < end : s.from <= end));

  // Deadline while segment i's priority is in effect: measured from creation.
  // For a changed priority, the grace (change time + PRIORITY_CHANGE_GRACE_MIN) can
  // push it later, but never past the earliest deadline under any earlier priority.
  const memo = [];
  const deadlineFor = (i) => {
    if (i in memo) return memo[i];
    let due = deadlineWithPauses(cal, t.createdAt, targetFor(segments[i].priority, key), pauses);
    if (i > 0 && due !== null) {
      let cap = deadlineWithPauses(cal, segments[i].from, PRIORITY_CHANGE_GRACE_MIN, pauses);
      for (let j = 0; j < i; j++) {
        const earlier = deadlineFor(j);
        if (earlier && (cap === null || earlier < cap)) cap = earlier;
      }
      if (cap === null) due = null; // grace still running into an open pause -> paused
      else if (cap > due) due = cap;
    }
    return (memo[i] = due);
  };

  // Sticky breach: did the deadline pass while an earlier priority was in effect?
  let breach = null;
  for (let i = 0; i < segments.length - 1 && !breach; i++) {
    const dueAt = deadlineFor(i);
    if (dueAt && dueAt < segments[i + 1].from) breach = { priority: segments[i].priority, dueAt };
  }

  // The priority in effect at the end (or now) sets the current deadline
  const current = segments.at(-1).priority;
  const dueAt = deadlineFor(segments.length - 1);

  let state;
  if (completedAt) state = dueAt && completedAt <= dueAt ? 'met' : 'breached';
  else if (closedAt) state = dueAt && dueAt <= closedAt ? 'breached' : 'closed_no_reply';
  else if (dueAt === null) state = 'paused';
  else state = dueAt <= now ? 'breached' : 'on_track';

  if (breach) state = 'breached';
  else if (state === 'breached') breach = { priority: current, dueAt };

  return { dueAt, state, priority: current, breach };
}

/**
 * @param {object} t
 * @param {Date} t.createdAt
 * @param {{priority: string, from: Date}[]} t.priorityHistory ascending; first entry starts at createdAt
 * @param {{from: Date, to: Date|null, reason: string}[]} t.pauses  from the audit log; an open pause
 *        has to: null; reason is the status that started it ('waiting_on_customer' | 'resolved')
 * @param {Date|null} t.firstResponseAt
 * @param {Date|null} t.resolvedAt  when the ticket was resolved; null if never resolved or reopened since
 * @param {Date|null} [t.closedAt]  when the ticket was closed. Closed while waiting on the customer:
 *        open timers end as 'closed_no_reply' (or 'breached'). Closed any other way without being
 *        resolved: judged as if resolved at closedAt.
 * @param {Date} now
 *
 * When a timer's state is 'breached', show `breach.dueAt` and `breach.priority`
 * ("missed 11:30 under urgent"), not `dueAt`, which is the deadline under the
 * current priority and may still be in the future after a downgrade.
 */
export function computeSla(cal, t, now = new Date()) {
  if (!t.priorityHistory?.length) throw new Error('priorityHistory is required');
  const closedAt = t.closedAt ?? null;
  // Only a close while a waiting-on-customer pause is open counts as "no reply".
  // Inclusive end: a timeline may end the waiting pause at the very moment of the close.
  const closedWaiting = closedAt !== null && t.pauses.some((p) =>
    p.reason === 'waiting_on_customer' && p.from <= closedAt && (p.to === null || p.to >= closedAt));

  const judge = (key, satisfiedAt) => {
    if (satisfiedAt || !closedAt) return evaluateTimer(cal, t, key, satisfiedAt, null, now);
    if (closedWaiting) return evaluateTimer(cal, t, key, null, closedAt, now);
    return evaluateTimer(cal, t, key, closedAt, null, now); // closed unresolved: judged as resolved now
  };
  const response = judge('responseMin', t.firstResponseAt);
  const resolution = judge('resolveMin', t.resolvedAt);
  return { response, resolution, isLate: response.state === 'breached' || resolution.state === 'breached' };
}
