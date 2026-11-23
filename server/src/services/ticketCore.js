// Shared ticket helpers used by BOTH agent and customer flows.
// This module must never read or write internal notes.
import { computeSla } from '../sla/sla.js';
import { HttpError } from '../http.js';
import { pausesFromEvents, priorityHistoryFromEvents } from './timeline.js';

export const SYSTEM = { type: 'system', id: null };
export const asAgent = (agent) => ({ type: 'agent', id: agent.id });
export const asCustomer = (customerId) => ({ type: 'customer', id: customerId });

/** Append one audit event. occurred_at always comes from the DB clock. */
export function recordEvent(tx, ticketId, actor, eventType, payload = {}) {
  return tx.ticketEvent.create({
    data: { ticketId, actorType: actor.type, actorId: actor.id ?? null, eventType, payload },
  });
}

/**
 * Change status with an optimistic-lock check on ticket.version.
 * Writes a status_changed event and keeps the timestamp columns in step with it.
 * Note: closing never sets resolvedAt (an auto-closed ticket is not resolved).
 */
export async function transition(tx, ticket, to, actor, payload = {}) {
  const from = ticket.status;
  if (from === to) return ticket;
  const ev = await recordEvent(tx, ticket.id, actor, 'status_changed', { from, to, ...payload });
  const at = ev.occurredAt;

  const data = { status: to, version: { increment: 1 } };
  if (to === 'waiting_on_customer') data.slaPausedAt = at;
  if (from === 'waiting_on_customer') data.slaPausedAt = null;
  if (to === 'resolved') data.resolvedAt = at;
  if (from === 'resolved' && to === 'open') data.resolvedAt = null; // reopened
  if (to === 'closed') data.closedAt = at;

  const { count } = await tx.ticket.updateMany({ where: { id: ticket.id, version: ticket.version }, data });
  if (count === 0) throw new HttpError(409, 'This ticket was changed by someone else. Reload and try again.');
  return { ...ticket, ...data, version: ticket.version + 1 };
}

/** Events the SLA needs, in order. */
export const slaEventsInclude = {
  events: {
    where: { eventType: { in: ['status_changed', 'priority_changed'] } },
    orderBy: { id: 'asc' },
    select: { eventType: true, payload: true, occurredAt: true },
  },
};

/** SLA for a ticket loaded with slaEventsInclude. */
export function slaFor(cal, ticket, now = new Date()) {
  return computeSla(cal, {
    createdAt: ticket.createdAt,
    priorityHistory: priorityHistoryFromEvents(ticket.createdAt, ticket.priority, ticket.events),
    pauses: pausesFromEvents(ticket.events),
    firstResponseAt: ticket.firstResponseAt,
    resolvedAt: ticket.resolvedAt,
    closedAt: ticket.status === 'closed' ? ticket.closedAt : null,
  }, now);
}

/** Recompute the cached due dates on the ticket row (convenience columns only). */
export async function refreshSlaCache(tx, cal, ticketId) {
  const t = await tx.ticket.findUnique({ where: { id: ticketId }, include: slaEventsInclude });
  const sla = slaFor(cal, t);
  await tx.ticket.update({
    where: { id: ticketId },
    data: { responseDueAt: sla.response.dueAt, resolveDueAt: sla.resolution.dueAt },
  });
}

/** SLA as JSON for the API. For breached timers the UI shows breach.dueAt/priority. */
export function slaToJson(sla) {
  const timer = (x) => ({
    state: x.state,
    dueAt: x.dueAt,
    priority: x.priority,
    breach: x.breach ? { priority: x.breach.priority, dueAt: x.breach.dueAt } : null,
  });
  return { response: timer(sla.response), resolution: timer(sla.resolution), isLate: sla.isLate };
}
