// Customer-facing ticket operations (INC-0304).
// This module MUST NOT reference internal notes in any way. It builds every
// response from an explicit whitelist, so a new column or relation can never
// leak to a customer by accident. tests/no-leak.test.js enforces this.
import crypto from 'node:crypto';
import { prisma } from '../db.js';
import { HttpError, requireText } from '../http.js';
import { normalizeEmail } from '../emails.js';
import { getCalendar } from './calendarService.js';
import { autoCloseIfDue } from '../jobs/autoClose.js';
import { REOPEN_WINDOW_MS } from '../sla/policy.js';
import { asCustomer, recordEvent, transition, refreshSlaCache } from './ticketCore.js';

const PRIORITIES = ['urgent', 'medium', 'low'];
const newToken = () => crypto.randomBytes(24).toString('base64url');

const STATUS_LABEL = {
  new: 'Received',
  open: 'In progress',
  waiting_on_customer: 'Waiting for your reply',
  resolved: 'Resolved',
  closed: 'Closed',
};

/** Whitelisted customer view. Only these fields ever leave this module. */
async function customerView(ticketId) {
  const t = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: {
      id: true, subject: true, status: true, createdAt: true, resolvedAt: true, accessToken: true,
      messages: {
        orderBy: { id: 'asc' },
        select: { id: true, authorType: true, body: true, createdAt: true, agent: { select: { name: true } } },
      },
    },
  });
  return {
    reference: `FD-${t.id}`,
    token: t.accessToken,
    subject: t.subject,
    status: t.status,
    statusLabel: STATUS_LABEL[t.status],
    createdAt: t.createdAt,
    canReopen: t.status === 'resolved' && Date.now() - t.resolvedAt.getTime() <= REOPEN_WINDOW_MS,
    messages: t.messages.map((m) => ({
      id: m.id,
      from: m.authorType === 'agent' ? `${m.agent.name} (Arvo support)` : 'You',
      body: m.body,
      createdAt: m.createdAt,
    })),
  };
}

async function createTicketTx(tx, cal, { customerId, subject, body, priority, reopenedFromId = null }) {
  const ticket = await tx.ticket.create({
    data: { customerId, subject, priority, accessToken: newToken(), reopenedFromId },
  });
  await recordEvent(tx, ticket.id, asCustomer(customerId), 'created', { priority, reopenedFromId });
  const msg = await tx.message.create({ data: { ticketId: ticket.id, authorType: 'customer', customerId, body } });
  await recordEvent(tx, ticket.id, asCustomer(customerId), 'customer_replied', { messageId: msg.id });
  await refreshSlaCache(tx, cal, ticket.id);
  return ticket;
}

export async function createTicket({ name, email, subject, body, priority = 'low' }) {
  const cleanName = requireText(name, 'Name', 200);
  const cleanEmail = normalizeEmail(requireText(email, 'Email', 320));
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) throw new HttpError(400, 'Email is not valid');
  const cleanSubject = requireText(subject, 'Subject', 300);
  const cleanBody = requireText(body, 'Message');
  if (!PRIORITIES.includes(priority)) throw new HttpError(400, `Priority must be one of ${PRIORITIES.join(', ')}`);

  const cal = await getCalendar();
  const ticket = await prisma.$transaction(async (tx) => {
    const customer = await tx.customer.upsert({
      where: { email: cleanEmail },
      create: { name: cleanName, email: cleanEmail },
      update: {},
    });
    return createTicketTx(tx, cal, { customerId: customer.id, subject: cleanSubject, body: cleanBody, priority });
  });
  return customerView(ticket.id);
}

async function ticketIdByToken(token) {
  if (typeof token !== 'string' || token.length < 20) throw new HttpError(404, 'Ticket not found');
  const t = await prisma.ticket.findUnique({ where: { accessToken: token }, select: { id: true } });
  if (!t) throw new HttpError(404, 'Ticket not found');
  return t.id;
}

export async function getTicket(token) {
  await autoCloseIfDue();
  return customerView(await ticketIdByToken(token));
}

/**
 * Customer message. Depending on the ticket's state it:
 * - adds to an active ticket,
 * - resumes the clock on a ticket waiting for them,
 * - reopens a resolved ticket within the reopen window,
 * - otherwise (closed, or resolved too long ago) starts a NEW ticket linked to the old one.
 */
export async function customerReply(token, { body }) {
  const text = requireText(body, 'Message');
  await autoCloseIfDue();
  const id = await ticketIdByToken(token);
  const cal = await getCalendar();

  const resultId = await prisma.$transaction(async (tx) => {
    let t = await tx.ticket.findUnique({ where: { id } });
    const actor = asCustomer(t.customerId);
    const withinWindow = t.status === 'resolved' && Date.now() - t.resolvedAt.getTime() <= REOPEN_WINDOW_MS;

    if (t.status === 'closed' || (t.status === 'resolved' && !withinWindow)) {
      const fresh = await createTicketTx(tx, cal, {
        customerId: t.customerId, subject: t.subject, body: text, priority: t.priority, reopenedFromId: t.id,
      });
      await recordEvent(tx, t.id, actor, 'follow_up_created', { newTicketId: fresh.id });
      return fresh.id;
    }

    const msg = await tx.message.create({ data: { ticketId: id, authorType: 'customer', customerId: t.customerId, body: text } });
    await recordEvent(tx, id, actor, 'customer_replied', { messageId: msg.id });
    if (t.status === 'waiting_on_customer') t = await transition(tx, t, 'open', actor);
    if (t.status === 'resolved') {
      t = await transition(tx, t, 'open', actor, { reopened: true });
      await recordEvent(tx, id, actor, 'reopened');
    }
    await refreshSlaCache(tx, cal, id);
    return id;
  });
  return customerView(resultId);
}
