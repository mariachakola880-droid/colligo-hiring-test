// Demo data: Meera (manager), nine agents, a few customers and tickets in different
// SLA states. Insert-only (the audit tables are append-only). Skipped only if the demo
// manager already exists, so other agents (e.g. from DB tests) never block it.
// Runs in ONE transaction: if anything fails, nothing is written and the next start
// seeds again, so the demo can never be left half-populated.
// Seed tickets are backdated so the demo shows late / paused / on-track tickets; this is
// the only code that ever supplies an event timestamp. The app always uses the DB clock.
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from './db.js';
import { normalizeEmail } from './emails.js';
import { config } from './config.js';
import { makeCalendar } from './sla/calendar.js';
import { refreshSlaCache } from './services/ticketCore.js';

export const DEMO_PASSWORD = 'frontdesk123';
export const DEMO_MANAGER_EMAIL = 'meera@arvo.test';

const AGENTS = [
  ['Meera', 'manager'], ['Anu', 'agent'], ['Ravi', 'agent'], ['Priya', 'agent'], ['Arjun', 'agent'],
  ['Divya', 'agent'], ['Kiran', 'agent'], ['Sneha', 'agent'], ['Vivek', 'agent'], ['Nikhil', 'agent'],
];

const HOLIDAYS = [
  ['2026-12-25', 'Christmas'],
  ['2027-01-01', 'New Year'],
  ['2027-01-26', 'Republic Day'],
];

const minutesAgo = (m) => new Date(Date.now() - m * 60_000);
const daysAgo = (d, extraMin = 0) => minutesAgo(d * 24 * 60 - extraMin);

export async function seedDemoData() {
  if (await prisma.agent.findUnique({ where: { email: DEMO_MANAGER_EMAIL } })) {
    console.log('Seed skipped: demo data already present');
    return false;
  }
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  // Built from the seed's own holiday list: rows written inside the transaction
  // are not visible to the shared (cached) calendar until it commits.
  const cal = makeCalendar({ tz: config.businessTz, holidays: HOLIDAYS.map(([date]) => date) });

  await prisma.$transaction(async (tx) => {
    const agents = {};
    for (const [name, role] of AGENTS) {
      const email = normalizeEmail(`${name}@arvo.test`);
      agents[name] = await tx.agent.upsert({ where: { email }, create: { name, role, email, passwordHash }, update: {} });
    }
    await tx.holiday.createMany({
      data: HOLIDAYS.map(([date, name]) => ({ date: new Date(`${date}T00:00:00Z`), name })),
      skipDuplicates: true,
    });

    const customers = {};
    for (const [name, email] of [['Lakshmi Traders', 'ops@lakshmi.test'], ['Northwind Clinic', 'it@northwind.test'], ['Kappa Logistics', 'help@kappa.test']]) {
      customers[name] = await tx.customer.upsert({ where: { email }, create: { name, email }, update: {} });
    }

    // Each step: [at, kind, data]. Builds rows and matching audit events with the same timestamps.
    async function ticket({ customer, subject, priority, createdAt, steps = [] }) {
      const c = customers[customer];
      let t = await tx.ticket.create({
        data: { customerId: c.id, subject, priority, createdAt, accessToken: crypto.randomBytes(24).toString('base64url') },
      });
      const ev = (at, actorType, actorId, eventType, payload = {}) =>
        tx.ticketEvent.create({ data: { ticketId: t.id, actorType, actorId, eventType, payload, occurredAt: at } });
      const setStatus = async (at, actor, to) => {
        await ev(at, actor.type, actor.id, 'status_changed', { from: t.status, to });
        const data = { status: to };
        if (to === 'waiting_on_customer') data.slaPausedAt = at;
        if (t.status === 'waiting_on_customer') data.slaPausedAt = null;
        if (to === 'resolved') data.resolvedAt = at;
        t = await tx.ticket.update({ where: { id: t.id }, data });
      };

      await ev(createdAt, 'customer', c.id, 'created', { priority });
      for (const [at, kind, d = {}] of steps) {
        if (kind === 'customer') {
          const m = await tx.message.create({ data: { ticketId: t.id, authorType: 'customer', customerId: c.id, body: d.body, createdAt: at } });
          await ev(at, 'customer', c.id, 'customer_replied', { messageId: m.id });
        } else if (kind === 'claim') {
          const a = agents[d.agent];
          t = await tx.ticket.update({ where: { id: t.id }, data: { assigneeId: a.id } });
          await ev(at, 'agent', a.id, 'claimed', { assigneeId: a.id });
          await setStatus(at, { type: 'agent', id: a.id }, 'open');
        } else if (kind === 'reply') {
          const a = agents[d.agent];
          const m = await tx.message.create({ data: { ticketId: t.id, authorType: 'agent', agentId: a.id, body: d.body, createdAt: at } });
          await ev(at, 'agent', a.id, 'replied', { messageId: m.id });
          if (!t.firstResponseAt) t = await tx.ticket.update({ where: { id: t.id }, data: { firstResponseAt: at } });
          if (d.wait) await setStatus(at, { type: 'agent', id: a.id }, 'waiting_on_customer');
        } else if (kind === 'note') {
          const a = agents[d.agent];
          const n = await tx.internalNote.create({ data: { ticketId: t.id, agentId: a.id, body: d.body, createdAt: at } });
          await ev(at, 'agent', a.id, 'note_added', { noteId: n.id });
        } else if (kind === 'resolve') {
          await setStatus(at, { type: 'agent', id: agents[d.agent].id }, 'resolved');
        }
      }
      await refreshSlaCache(tx, cal, t.id);
    }

    await ticket({
      customer: 'Northwind Clinic', subject: 'Nobody can log in to the dashboard', priority: 'urgent', createdAt: daysAgo(3),
      steps: [[daysAgo(3), 'customer', { body: 'Since this morning none of our staff can log in. We cannot work at all.' }]],
    });
    await ticket({
      customer: 'Lakshmi Traders', subject: 'CSV export fails for large reports', priority: 'medium', createdAt: daysAgo(2),
      steps: [
        [daysAgo(2), 'customer', { body: 'Exporting the monthly sales report to CSV gives an error.' }],
        [daysAgo(2, 30), 'claim', { agent: 'Anu' }],
        [daysAgo(2, 60), 'reply', { agent: 'Anu', wait: true, body: 'Thanks. Could you tell us roughly how many rows the report has?' }],
      ],
    });
    await ticket({
      customer: 'Kappa Logistics', subject: 'Invoices show the wrong tax rate', priority: 'medium', createdAt: minutesAgo(90),
      steps: [
        [minutesAgo(90), 'customer', { body: 'Our last three invoices show 12% tax instead of 18%.' }],
        [minutesAgo(70), 'claim', { agent: 'Ravi' }],
        [minutesAgo(60), 'note', { agent: 'Ravi', body: 'Customer was very upset on the phone last time. Keep replies short and confirm a fix date.' }],
        [minutesAgo(50), 'reply', { agent: 'Ravi', body: 'Sorry about this. We are checking the tax settings on your account now.' }],
      ],
    });
    await ticket({
      customer: 'Lakshmi Traders', subject: 'How do I add a new user?', priority: 'low', createdAt: minutesAgo(20),
      steps: [[minutesAgo(20), 'customer', { body: 'We hired someone new. How do we give them access?' }]],
    });
    await ticket({
      customer: 'Kappa Logistics', subject: 'Password reset email not arriving', priority: 'low', createdAt: daysAgo(4),
      steps: [
        [daysAgo(4), 'customer', { body: 'Password reset emails are not arriving for one of our users.' }],
        [daysAgo(4, 45), 'claim', { agent: 'Priya' }],
        [daysAgo(4, 60), 'reply', { agent: 'Priya', body: 'The address was on our bounce list. We have removed it; please try again.' }],
        [daysAgo(1), 'resolve', { agent: 'Priya' }],
      ],
    });
  }, { timeout: 60_000 });

  console.log(`Seeded ${AGENTS.length} agents (password: ${DEMO_PASSWORD}), customers, holidays and demo tickets`);
  return true;
}
