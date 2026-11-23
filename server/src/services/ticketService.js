// Agent-side ticket operations. Every change is written in the same transaction
// as its audit event, so the record and the state can never disagree (INC-0318).
import { prisma } from '../db.js';
import { HttpError, requireText } from '../http.js';
import { getCalendar } from './calendarService.js';
import { autoCloseIfDue } from '../jobs/autoClose.js';
import {
  asAgent, recordEvent, transition, refreshSlaCache, slaEventsInclude, slaFor, slaToJson,
} from './ticketCore.js';
import { agentTransitionError } from './rules.js';

const PRIORITIES = ['urgent', 'medium', 'low'];

async function loadTicket(tx, id) {
  const t = await tx.ticket.findUnique({ where: { id } });
  if (!t) throw new HttpError(404, 'Ticket not found');
  return t;
}

function assertAssigneeOrManager(t, agent, action) {
  if (t.assigneeId === agent.id || agent.role === 'manager') return;
  if (t.assigneeId === null) throw new HttpError(403, `Claim this ticket before you ${action}`);
  throw new HttpError(403, `This ticket is assigned to someone else`);
}

function assertVersion(t, version) {
  if (version !== undefined && version !== t.version) {
    throw new HttpError(409, 'This ticket was changed by someone else. Reload and try again.');
  }
}

// ---------- Reads ----------

const VIEWS = {
  mine: (agent) => ({ assigneeId: agent.id, status: { not: 'closed' } }),
  unassigned: () => ({ assigneeId: null, status: { not: 'closed' } }),
  all: () => ({}),
};

export async function listTickets(agent, view = 'mine') {
  if (!VIEWS[view]) throw new HttpError(400, `Unknown view: ${view}`);
  await autoCloseIfDue();
  const [cal, tickets] = await Promise.all([
    getCalendar(),
    prisma.ticket.findMany({
      where: VIEWS[view](agent),
      include: {
        customer: { select: { id: true, name: true, email: true } },
        assignee: { select: { id: true, name: true } },
        ...slaEventsInclude,
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
  ]);
  const now = new Date();
  return tickets.map((t) => ({
    id: t.id,
    subject: t.subject,
    priority: t.priority,
    status: t.status,
    version: t.version,
    customer: t.customer,
    assignee: t.assignee,
    createdAt: t.createdAt,
    waitingOnCustomer: t.status === 'waiting_on_customer',
    sla: slaToJson(slaFor(cal, t, now)),
  }));
}

export async function getTicketDetail(id) {
  await autoCloseIfDue();
  const [cal, t, agents] = await Promise.all([
    getCalendar(),
    prisma.ticket.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, name: true, email: true } },
        assignee: { select: { id: true, name: true } },
        reopenedFrom: { select: { id: true, subject: true } },
        followUps: { select: { id: true, subject: true } },
        messages: { orderBy: { id: 'asc' }, include: { agent: { select: { name: true } } } },
        notes: { orderBy: { id: 'asc' }, include: { agent: { select: { name: true } } } },
      },
    }),
    prisma.agent.findMany({ select: { id: true, name: true } }),
  ]);
  if (!t) throw new HttpError(404, 'Ticket not found');

  const events = await prisma.ticketEvent.findMany({ where: { ticketId: id }, orderBy: { id: 'asc' } });
  const agentName = new Map(agents.map((a) => [a.id, a.name]));
  const sla = slaFor(cal, { ...t, events: events.filter((e) => e.eventType === 'status_changed' || e.eventType === 'priority_changed') });

  return {
    id: t.id,
    subject: t.subject,
    priority: t.priority,
    status: t.status,
    version: t.version,
    customer: t.customer,
    assignee: t.assignee,
    createdAt: t.createdAt,
    firstResponseAt: t.firstResponseAt,
    resolvedAt: t.resolvedAt,
    closedAt: t.closedAt,
    reopenedFrom: t.reopenedFrom,
    followUps: t.followUps,
    waitingOnCustomer: t.status === 'waiting_on_customer',
    sla: slaToJson(sla),
    messages: t.messages.map((m) => ({
      id: m.id,
      from: m.authorType,
      authorName: m.authorType === 'agent' ? m.agent?.name : t.customer.name,
      body: m.body,
      createdAt: m.createdAt,
    })),
    notes: t.notes.map((n) => ({ id: n.id, authorName: n.agent.name, body: n.body, createdAt: n.createdAt })),
    events: events.map((e) => ({
      id: e.id,
      type: e.eventType,
      actor: e.actorType === 'agent' ? (agentName.get(e.actorId) ?? `agent #${e.actorId}`)
        : e.actorType === 'customer' ? t.customer.name : 'system',
      payload: e.payload,
      at: e.occurredAt,
    })),
  };
}

// ---------- Writes ----------

/**
 * Atomic claim (INC-0291). The conditional UPDATE lets exactly one agent win;
 * the loser gets 409 with the winner's name.
 */
export async function claimTicket(id, agent) {
  const cal = await getCalendar();
  await prisma.$transaction(async (tx) => {
    const before = await loadTicket(tx, id);
    const { count } = await tx.ticket.updateMany({
      where: { id, assigneeId: null, status: { notIn: ['resolved', 'closed'] } },
      data: { assigneeId: agent.id, version: { increment: 1 } },
    });
    if (count === 0) {
      const now = await tx.ticket.findUnique({ where: { id }, include: { assignee: { select: { id: true, name: true } } } });
      if (now.assigneeId === agent.id) return; // already mine: idempotent
      if (now.assignee) throw new HttpError(409, `Already claimed by ${now.assignee.name}`);
      throw new HttpError(409, `A ${now.status} ticket cannot be claimed`);
    }
    await recordEvent(tx, id, asAgent(agent), 'claimed', { assigneeId: agent.id });
    if (before.status === 'new') {
      await transition(tx, { ...before, version: before.version + 1 }, 'open', asAgent(agent));
    }
    await refreshSlaCache(tx, cal, id);
  });
  return getTicketDetail(id);
}

/** Public reply to the customer. Only the assignee can reply, so two agents never answer at once. */
export async function replyToCustomer(id, agent, { body, waitForCustomer = false }) {
  const text = requireText(body, 'Reply');
  const cal = await getCalendar();
  await prisma.$transaction(async (tx) => {
    let t = await loadTicket(tx, id);
    if (t.assigneeId !== agent.id) {
      throw new HttpError(403, t.assigneeId === null ? 'Claim this ticket before replying' : 'Only the assigned agent can reply');
    }
    if (!['open', 'waiting_on_customer'].includes(t.status)) throw new HttpError(409, `Cannot reply to a ${t.status} ticket`);

    const msg = await tx.message.create({ data: { ticketId: id, authorType: 'agent', agentId: agent.id, body: text } });
    await recordEvent(tx, id, asAgent(agent), 'replied', { messageId: msg.id });
    if (!t.firstResponseAt) await tx.ticket.update({ where: { id }, data: { firstResponseAt: msg.createdAt } });

    const target = waitForCustomer ? 'waiting_on_customer' : 'open';
    t = await transition(tx, t, target, asAgent(agent));
    await refreshSlaCache(tx, cal, id);
  });
  return getTicketDetail(id);
}

/** Team-only note (INC-0304). The audit event stores the note id, never its text. */
export async function addNote(id, agent, { body }) {
  const text = requireText(body, 'Note');
  await prisma.$transaction(async (tx) => {
    await loadTicket(tx, id);
    const note = await tx.internalNote.create({ data: { ticketId: id, agentId: agent.id, body: text } });
    await recordEvent(tx, id, asAgent(agent), 'note_added', { noteId: note.id });
  });
  return getTicketDetail(id);
}

export async function changeStatus(id, agent, { status, version }) {
  const cal = await getCalendar();
  await prisma.$transaction(async (tx) => {
    const t = await loadTicket(tx, id);
    assertAssigneeOrManager(t, agent, 'change its status');
    assertVersion(t, version);
    const error = agentTransitionError(t.status, status);
    if (error) throw new HttpError(409, error);
    await transition(tx, t, status, asAgent(agent));
    await refreshSlaCache(tx, cal, id);
  });
  return getTicketDetail(id);
}

export async function changePriority(id, agent, { priority, version }) {
  if (!PRIORITIES.includes(priority)) throw new HttpError(400, `Priority must be one of ${PRIORITIES.join(', ')}`);
  const cal = await getCalendar();
  await prisma.$transaction(async (tx) => {
    const t = await loadTicket(tx, id);
    assertAssigneeOrManager(t, agent, 'change its priority');
    assertVersion(t, version);
    if (t.status === 'closed') throw new HttpError(409, 'Cannot change the priority of a closed ticket');
    if (t.priority === priority) return;
    const { count } = await tx.ticket.updateMany({
      where: { id, version: t.version },
      data: { priority, version: { increment: 1 } },
    });
    if (count === 0) throw new HttpError(409, 'This ticket was changed by someone else. Reload and try again.');
    await recordEvent(tx, id, asAgent(agent), 'priority_changed', { from: t.priority, to: priority });
    await refreshSlaCache(tx, cal, id);
  });
  return getTicketDetail(id);
}

// ---------- Reports ----------

/** "Which problems were late, and why?" Every ticket with a breached timer, with the breach details. */
export async function lateReport({ since } = {}) {
  await autoCloseIfDue();
  const cal = await getCalendar();
  const tickets = await prisma.ticket.findMany({
    where: since ? { createdAt: { gte: since } } : {},
    include: { assignee: { select: { name: true } }, customer: { select: { name: true } }, ...slaEventsInclude },
    orderBy: { createdAt: 'desc' },
  });
  const now = new Date();
  const rows = [];
  let finished = 0;
  for (const t of tickets) {
    const sla = slaFor(cal, t, now);
    // Late rate counts only tickets Arvo actually finished or missed (not closed_no_reply)
    const resState = sla.resolution.state;
    if (resState === 'met' || resState === 'breached') finished++;
    if (!sla.isLate) continue;
    rows.push({
      id: t.id,
      subject: t.subject,
      customer: t.customer.name,
      assignee: t.assignee?.name ?? null,
      status: t.status,
      priority: t.priority,
      createdAt: t.createdAt,
      sla: slaToJson(sla),
    });
  }
  return { totalTickets: tickets.length, lateTickets: rows.length, finishedOrMissed: finished, tickets: rows };
}
