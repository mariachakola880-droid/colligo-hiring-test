import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCalendar } from '../src/sla/calendar.js';
import { computeSla } from '../src/sla/sla.js';

const TZ = 'Asia/Kolkata';
const cal = makeCalendar({ tz: TZ });
// Local IST wall time -> Date
const ist = (s) => new Date(`${s}+05:30`);

// Nov 2026: Fri 20, Sat 21, Sun 22, Mon 23 ... Fri 27
test('Friday 6 PM urgent ticket is not late on Sunday (from the meeting notes)', () => {
  const sla = computeSla(cal, { priorityHistory: [{ priority: 'urgent', from: ist('2026-11-20T18:00') }], createdAt: ist('2026-11-20T18:00'), pauses: [], firstResponseAt: null, resolvedAt: null }, ist('2026-11-22T09:00'));
  // 30 min on Friday + 90 min on Monday
  assert.deepEqual(sla.response.dueAt, ist('2026-11-23T11:00'));
  assert.equal(sla.response.state, 'on_track');
  assert.equal(sla.isLate, false);
});

test('holidays are skipped', () => {
  const holidayCal = makeCalendar({ tz: TZ, holidays: ['2026-11-23'] });
  const sla = computeSla(holidayCal, { priorityHistory: [{ priority: 'urgent', from: ist('2026-11-20T18:00') }], createdAt: ist('2026-11-20T18:00'), pauses: [], firstResponseAt: null, resolvedAt: null }, ist('2026-11-22T09:00'));
  assert.deepEqual(sla.response.dueAt, ist('2026-11-24T11:00'));
});

test('ticket created before opening starts counting at 9:30', () => {
  const sla = computeSla(cal, { priorityHistory: [{ priority: 'urgent', from: ist('2026-11-23T08:00') }], createdAt: ist('2026-11-23T08:00'), pauses: [], firstResponseAt: null, resolvedAt: null }, ist('2026-11-23T08:01'));
  assert.deepEqual(sla.response.dueAt, ist('2026-11-23T11:30'));
});

test('waiting on customer pauses the timer', () => {
  const sla = computeSla(cal, {
    priorityHistory: [{ priority: 'medium', from: ist('2026-11-23T09:30') }],
    createdAt: ist('2026-11-23T09:30'),
    firstResponseAt: ist('2026-11-23T10:00'),
    pauses: [{ from: ist('2026-11-23T10:00'), to: ist('2026-11-25T10:00') }],
    resolvedAt: null,
  }, ist('2026-11-25T11:00'));
  assert.equal(sla.response.state, 'met');
  // 3 working days = 1620 min; 30 used before pause, 1590 left from Wed 10:00 -> Fri 18:30
  assert.deepEqual(sla.resolution.dueAt, ist('2026-11-27T18:30'));
  assert.equal(sla.resolution.state, 'on_track');
});

test('ongoing pause shows as paused, not late', () => {
  const sla = computeSla(cal, {
    priorityHistory: [{ priority: 'medium', from: ist('2026-11-23T09:30') }],
    createdAt: ist('2026-11-23T09:30'),
    firstResponseAt: ist('2026-11-23T10:00'),
    pauses: [{ from: ist('2026-11-23T10:00'), to: null }],
    resolvedAt: null,
  }, ist('2026-12-10T12:00'));
  assert.equal(sla.resolution.dueAt, null);
  assert.equal(sla.resolution.state, 'paused');
  assert.equal(sla.isLate, false);
});

test('breach before a pause still counts as breached', () => {
  const sla = computeSla(cal, {
    priorityHistory: [{ priority: 'urgent', from: ist('2026-11-23T09:30') }],
    createdAt: ist('2026-11-23T09:30'),
    firstResponseAt: ist('2026-11-23T10:00'),
    pauses: [{ from: ist('2026-11-24T12:00'), to: null }],
    resolvedAt: null,
  }, ist('2026-11-24T13:00'));
  assert.deepEqual(sla.resolution.dueAt, ist('2026-11-23T18:30'));
  assert.equal(sla.resolution.state, 'breached');
});

const MON = '2026-11-23';
const hist = (...entries) => entries.map(([priority, time]) => ({ priority, from: ist(`${MON}T${time}`) }));

test('escalating a running timer gets a 30-minute grace instead of an instant breach', () => {
  // Medium created 09:30, unanswered; escalated to urgent at 12:30 (raw urgent deadline 11:30)
  const t = {
    createdAt: ist(`${MON}T09:30`), pauses: [], firstResponseAt: null, resolvedAt: null,
    priorityHistory: hist(['medium', '09:30'], ['urgent', '12:30']),
  };
  const atEscalation = computeSla(cal, t, ist(`${MON}T12:30`));
  assert.deepEqual(atEscalation.response.dueAt, ist(`${MON}T13:00`));
  assert.equal(atEscalation.response.state, 'on_track');
  // Nobody acts within the grace: late, under urgent
  const later = computeSla(cal, t, ist(`${MON}T13:10`));
  assert.equal(later.response.state, 'breached');
  assert.equal(later.response.breach.priority, 'urgent');
  // Replying within the grace counts as met
  const replied = computeSla(cal, { ...t, firstResponseAt: ist(`${MON}T12:45`) }, ist(`${MON}T13:10`));
  assert.equal(replied.response.state, 'met');
});

test('grace never hides a breach that already happened under the old priority', () => {
  // Medium response due 14:00; still unanswered when escalated at 15:00
  const sla = computeSla(cal, {
    createdAt: ist(`${MON}T09:30`), pauses: [], firstResponseAt: null, resolvedAt: null,
    priorityHistory: hist(['medium', '09:30'], ['urgent', '15:00']),
  }, ist(`${MON}T15:05`));
  assert.equal(sla.response.state, 'breached');
  assert.deepEqual(sla.response.breach, { priority: 'medium', dueAt: ist(`${MON}T14:00`) });
});

test('escalating early simply uses the new target when it is later than the grace', () => {
  // Medium created 09:30, escalated at 09:45: urgent deadline 11:30 is after 09:45 + 30 min
  const sla = computeSla(cal, {
    createdAt: ist(`${MON}T09:30`), pauses: [], firstResponseAt: null, resolvedAt: null,
    priorityHistory: hist(['medium', '09:30'], ['urgent', '09:45']),
  }, ist(`${MON}T10:00`));
  assert.deepEqual(sla.response.dueAt, ist(`${MON}T11:30`));
});

test('toggling priority down and back up cannot extend the deadline (scenario F)', () => {
  // Urgent due 11:30; low at 11:25, urgent again at 11:26. Without the cap this became 11:56.
  const sla = computeSla(cal, {
    createdAt: ist(`${MON}T09:30`), pauses: [], firstResponseAt: null, resolvedAt: null,
    priorityHistory: hist(['urgent', '09:30'], ['low', '11:25'], ['urgent', '11:26']),
  }, ist(`${MON}T11:40`));
  assert.deepEqual(sla.response.dueAt, ist(`${MON}T11:30`));
  assert.equal(sla.response.state, 'breached');
  assert.deepEqual(sla.response.breach, { priority: 'urgent', dueAt: ist(`${MON}T11:30`) });
});

test('downgrading after a late reply does not erase the breach', () => {
  // Urgent, replied after 4.5 h (2 h target), then downgraded to low
  const sla = computeSla(cal, {
    createdAt: ist(`${MON}T09:30`),
    priorityHistory: hist(['urgent', '09:30'], ['low', '15:00']),
    pauses: [], firstResponseAt: ist(`${MON}T14:00`), resolvedAt: null,
  }, ist(`${MON}T16:00`));
  assert.equal(sla.response.state, 'breached');
  assert.equal(sla.response.priority, 'urgent'); // judged by priority at completion
  assert.equal(sla.response.breach.priority, 'urgent');
});

test('downgrading a running timer after its deadline passed keeps it breached', () => {
  // Urgent, unanswered past 11:30, downgraded to low at 13:00, still unanswered
  const sla = computeSla(cal, {
    createdAt: ist(`${MON}T09:30`),
    priorityHistory: hist(['urgent', '09:30'], ['low', '13:00']),
    pauses: [], firstResponseAt: null, resolvedAt: null,
  }, ist(`${MON}T13:30`));
  assert.equal(sla.response.state, 'breached');
  assert.deepEqual(sla.response.breach, { priority: 'urgent', dueAt: ist(`${MON}T11:30`) });
  // ...but a downgrade BEFORE the deadline legitimately moves it
  const early = computeSla(cal, {
    createdAt: ist(`${MON}T09:30`),
    priorityHistory: hist(['urgent', '09:30'], ['low', '10:30']),
    pauses: [], firstResponseAt: null, resolvedAt: null,
  }, ist(`${MON}T13:30`));
  assert.equal(early.response.state, 'on_track');
  assert.deepEqual(early.response.dueAt, ist(`${MON}T18:30`));
});

test('escalating after an on-time reply does not turn the reply late', () => {
  // Medium, replied at 12:00 (due 14:00), escalated to urgent at 13:00
  const sla = computeSla(cal, {
    createdAt: ist(`${MON}T09:30`),
    priorityHistory: hist(['medium', '09:30'], ['urgent', '13:00']),
    pauses: [], firstResponseAt: ist(`${MON}T12:00`), resolvedAt: null,
  }, ist(`${MON}T13:30`));
  assert.equal(sla.response.state, 'met');
  assert.equal(sla.response.priority, 'medium');
  // The still-running resolution timer does switch to urgent: due Mon 18:30
  assert.deepEqual(sla.resolution.dueAt, ist(`${MON}T18:30`));
  assert.equal(sla.resolution.priority, 'urgent');
});

test('resolved within target is met; resolved period does not count after reopen', () => {
  const resolved = computeSla(cal, {
    priorityHistory: [{ priority: 'urgent', from: ist('2026-11-23T09:30') }], createdAt: ist('2026-11-23T09:30'),
    firstResponseAt: ist('2026-11-23T10:00'), pauses: [], resolvedAt: ist('2026-11-23T15:00'),
  }, ist('2026-11-24T10:00'));
  assert.equal(resolved.resolution.state, 'met');

  // Resolved Mon 15:00, reopened Wed 09:30: 330 min used, 210 left -> Wed 13:00
  const reopened = computeSla(cal, {
    priorityHistory: [{ priority: 'urgent', from: ist('2026-11-23T09:30') }], createdAt: ist('2026-11-23T09:30'),
    firstResponseAt: ist('2026-11-23T10:00'),
    pauses: [{ from: ist('2026-11-23T15:00'), to: ist('2026-11-25T09:30') }],
    resolvedAt: null,
  }, ist('2026-11-25T10:00'));
  assert.deepEqual(reopened.resolution.dueAt, ist('2026-11-25T13:00'));
  assert.equal(reopened.resolution.state, 'on_track');
});

test('workingMinutesBetween skips nights and weekends', () => {
  assert.equal(cal.workingMinutesBetween(ist('2026-11-20T18:00'), ist('2026-11-23T10:00')), 60);
  assert.equal(cal.workingMinutesBetween(ist('2026-11-23T09:30'), ist('2026-11-27T18:30')), 5 * 540);
});

test('addWorkingMinutes rejects negative or invalid minutes', () => {
  assert.throws(() => cal.addWorkingMinutes(ist('2026-11-23T10:00'), -5), RangeError);
  assert.throws(() => cal.addWorkingMinutes(ist('2026-11-23T10:00'), NaN), RangeError);
});

test('auto-closed while waiting on the customer is closed_no_reply, not met or paused (scenario H)', () => {
  // Medium, replied 10:00 and waiting on the customer from 10:00; auto-closed a week later.
  // The waiting -> closed change keeps the pause open (closed is a paused status).
  const sla = computeSla(cal, {
    priorityHistory: [{ priority: 'medium', from: ist('2026-11-23T09:30') }],
    createdAt: ist('2026-11-23T09:30'),
    firstResponseAt: ist('2026-11-23T10:00'),
    pauses: [{ from: ist('2026-11-23T10:00'), to: null }],
    resolvedAt: null,
    closedAt: ist('2026-11-30T10:00'),
  }, ist('2026-12-15T12:00'));
  assert.equal(sla.response.state, 'met');
  assert.equal(sla.resolution.state, 'closed_no_reply');
  assert.equal(sla.resolution.breach, null);
  assert.equal(sla.isLate, false);
});

test('a ticket that breached before the customer went quiet stays breached after auto-close', () => {
  // Urgent, resolution due Mon 18:30; still open Tuesday when it goes to waiting, then auto-closed
  const sla = computeSla(cal, {
    priorityHistory: [{ priority: 'urgent', from: ist('2026-11-23T09:30') }],
    createdAt: ist('2026-11-23T09:30'),
    firstResponseAt: ist('2026-11-23T10:00'),
    pauses: [{ from: ist('2026-11-24T12:00'), to: null }],
    resolvedAt: null,
    closedAt: ist('2026-12-01T12:00'),
  }, ist('2026-12-15T12:00'));
  assert.equal(sla.resolution.state, 'breached');
  assert.deepEqual(sla.resolution.breach, { priority: 'urgent', dueAt: ist('2026-11-23T18:30') });
  assert.equal(sla.isLate, true);
});

test('a resolved ticket that is later closed keeps its resolution result', () => {
  const sla = computeSla(cal, {
    priorityHistory: [{ priority: 'urgent', from: ist('2026-11-23T09:30') }],
    createdAt: ist('2026-11-23T09:30'),
    firstResponseAt: ist('2026-11-23T10:00'),
    pauses: [{ from: ist('2026-11-23T15:00'), to: null }],
    resolvedAt: ist('2026-11-23T15:00'),
    closedAt: ist('2026-11-30T15:00'),
  }, ist('2026-12-15T12:00'));
  assert.equal(sla.resolution.state, 'met');
});
