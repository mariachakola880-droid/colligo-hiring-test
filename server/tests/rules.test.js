import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentTransitionError, ticketPhrase } from '../src/services/rules.js';
import { normalizeEmail } from '../src/emails.js';

test('agents cannot pause the SLA by setting waiting_on_customer directly', () => {
  assert.match(agentTransitionError('open', 'waiting_on_customer'), /send them a reply/);
});

test('agents can close only resolved tickets', () => {
  assert.match(agentTransitionError('open', 'closed'), /Only resolved tickets can be closed/);
  assert.match(agentTransitionError('waiting_on_customer', 'closed'), /Only resolved tickets can be closed/);
  assert.equal(agentTransitionError('resolved', 'closed'), null);
});

test('allowed agent transitions', () => {
  assert.equal(agentTransitionError('open', 'resolved'), null);
  assert.equal(agentTransitionError('waiting_on_customer', 'open'), null);
  assert.equal(agentTransitionError('waiting_on_customer', 'resolved'), null);
  assert.notEqual(agentTransitionError('new', 'open'), null); // claiming opens a new ticket
});

test('emails are normalised to one form', () => {
  assert.equal(normalizeEmail('  ClaimA-123@Test.Local '), 'claima-123@test.local');
});

test('error messages use the right article and plain words for every status', () => {
  assert.equal(agentTransitionError('open', 'closed'), 'Cannot close an open ticket. Only resolved tickets can be closed.');
  assert.equal(agentTransitionError('new', 'resolved'), 'Cannot change a new ticket to resolved.');
  assert.equal(ticketPhrase('waiting_on_customer'), 'a ticket that is waiting on the customer');
  for (const status of ['new', 'open', 'waiting_on_customer', 'resolved', 'closed']) {
    assert.doesNotMatch(ticketPhrase(status), /\ba [aeiou]/, status);
    assert.doesNotMatch(ticketPhrase(status), /_/, status);
  }
});
