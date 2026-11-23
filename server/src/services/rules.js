// Status changes an agent may make directly. Pure, so it can be unit-tested.
//
// - Agents can close ONLY resolved tickets; tickets waiting on the customer are
//   closed by the auto-close job. (Closing must not dodge a deadline.)
// - Agents cannot set waiting_on_customer directly. The clock pauses only when
//   "we ask the customer a question", i.e. a reply sent with waitForCustomer: true.
//   (Pausing must not dodge a deadline either.)
export const AGENT_TRANSITIONS = {
  open: ['resolved'],
  waiting_on_customer: ['open', 'resolved'],
  resolved: ['closed'],
};

// Statuses in plain words, with the right article, for error messages.
const TICKET_PHRASE = {
  new: 'a new ticket',
  open: 'an open ticket',
  waiting_on_customer: 'a ticket that is waiting on the customer',
  resolved: 'a resolved ticket',
  closed: 'a closed ticket',
};
const STATUS_WORDS = {
  new: 'new', open: 'open', waiting_on_customer: 'waiting on the customer', resolved: 'resolved', closed: 'closed',
};
export const ticketPhrase = (status) => TICKET_PHRASE[status] ?? `a ticket with status "${status}"`;
const statusWords = (status) => STATUS_WORDS[status] ?? `"${status}"`;

/** @returns {string|null} an error message, or null if the change is allowed */
export function agentTransitionError(from, to) {
  if ((AGENT_TRANSITIONS[from] ?? []).includes(to)) return null;
  if (to === 'closed') return `Cannot close ${ticketPhrase(from)}. Only resolved tickets can be closed.`;
  if (to === 'waiting_on_customer') return 'To wait on the customer, send them a reply with "wait for customer" ticked.';
  return `Cannot change ${ticketPhrase(from)} to ${statusWords(to)}.`;
}
