// Derive SLA inputs from the audit log, so the SLA is always computed from
// what actually happened rather than from mutable ticket columns.

// Statuses in which the SLA clock does not run.
export const PAUSED_STATUSES = new Set(['waiting_on_customer', 'resolved', 'closed']);

/**
 * Pause intervals from status_changed events. A pause keeps the reason it
 * started with (waiting_on_customer -> closed stays a waiting pause).
 * @param {{eventType: string, payload: any, occurredAt: Date}[]} events chronological
 * @returns {{from: Date, to: Date|null, reason: string}[]}
 */
export function pausesFromEvents(events) {
  const pauses = [];
  let open = null;
  for (const e of events) {
    if (e.eventType !== 'status_changed') continue;
    const wasPaused = PAUSED_STATUSES.has(e.payload?.from);
    const isPaused = PAUSED_STATUSES.has(e.payload?.to);
    if (!wasPaused && isPaused) {
      open = { from: e.occurredAt, to: null, reason: e.payload.to };
      pauses.push(open);
    } else if (wasPaused && !isPaused && open) {
      open.to = e.occurredAt;
      open = null;
    }
  }
  return pauses;
}

/**
 * Priority history from priority_changed events.
 * @returns {{priority: string, from: Date}[]} first entry starts at createdAt
 */
export function priorityHistoryFromEvents(createdAt, currentPriority, events) {
  const changes = events.filter((e) => e.eventType === 'priority_changed');
  const initial = changes.length ? changes[0].payload.from : currentPriority;
  return [
    { priority: initial, from: createdAt },
    ...changes.map((e) => ({ priority: e.payload.to, from: e.occurredAt })),
  ];
}
