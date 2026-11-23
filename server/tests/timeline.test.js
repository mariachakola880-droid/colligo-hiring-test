import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pausesFromEvents, priorityHistoryFromEvents } from '../src/services/timeline.js';

const at = (s) => new Date(`2026-11-23T${s}:00+05:30`);
const status = (time, from, to) => ({ eventType: 'status_changed', payload: { from, to }, occurredAt: at(time) });
const priority = (time, from, to) => ({ eventType: 'priority_changed', payload: { from, to }, occurredAt: at(time) });

test('waiting -> open closes the pause and records its reason', () => {
  const pauses = pausesFromEvents([status('10:00', 'open', 'waiting_on_customer'), status('12:00', 'waiting_on_customer', 'open')]);
  assert.deepEqual(pauses, [{ from: at('10:00'), to: at('12:00'), reason: 'waiting_on_customer' }]);
});

test('waiting -> closed keeps the pause open with its original reason (auto-close)', () => {
  const pauses = pausesFromEvents([status('10:00', 'open', 'waiting_on_customer'), status('15:00', 'waiting_on_customer', 'closed')]);
  assert.deepEqual(pauses, [{ from: at('10:00'), to: null, reason: 'waiting_on_customer' }]);
});

test('resolved -> open (reopen) ends a resolved pause', () => {
  const pauses = pausesFromEvents([status('11:00', 'open', 'resolved'), status('13:00', 'resolved', 'open')]);
  assert.deepEqual(pauses, [{ from: at('11:00'), to: at('13:00'), reason: 'resolved' }]);
});

test('new -> open is not a pause, and other events are ignored', () => {
  const pauses = pausesFromEvents([status('09:30', 'new', 'open'), { eventType: 'replied', payload: {}, occurredAt: at('09:40') }]);
  assert.deepEqual(pauses, []);
});

test('priority history starts with the original priority at creation', () => {
  const created = at('09:30');
  assert.deepEqual(priorityHistoryFromEvents(created, 'medium', []), [{ priority: 'medium', from: created }]);
  assert.deepEqual(
    priorityHistoryFromEvents(created, 'low', [priority('10:00', 'medium', 'urgent'), priority('11:00', 'urgent', 'low')]),
    [{ priority: 'medium', from: created }, { priority: 'urgent', from: at('10:00') }, { priority: 'low', from: at('11:00') }],
  );
});
