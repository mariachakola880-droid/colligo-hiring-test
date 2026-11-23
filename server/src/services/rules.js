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

/** @returns {string|null} an error message, or null if the change is allowed */
export function agentTransitionError(from, to) {
  if ((AGENT_TRANSITIONS[from] ?? []).includes(to)) return null;
  if (to === 'closed') return `Cannot change a ${from} ticket to closed. Only resolved tickets can be closed.`;
  if (to === 'waiting_on_customer') return 'To wait on the customer, send them a reply with "wait for customer" ticked.';
  return `Cannot change a ${from} ticket to ${to}.`;
}
