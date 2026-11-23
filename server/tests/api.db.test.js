// API tests against a real database. They only insert rows (the audit tables are
// append-only), using unique emails, so they can run on any dev/test database.
// Run with: RUN_DB_TESTS=1 node --env-file=.env --test tests/api.db.test.js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const skip = !process.env.RUN_DB_TESTS && 'set RUN_DB_TESTS=1 (needs DATABASE_URL)';
const uid = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;

let app, prisma, bcrypt, request;
async function setup() {
  if (!app) {
    ({ app } = await import('../src/app.js'));
    ({ prisma } = await import('../src/db.js'));
    bcrypt = (await import('bcryptjs')).default;
    request = (await import('supertest')).default;
  }
}
after(async () => { if (prisma) await prisma.$disconnect(); });

async function loggedInAgent(name) {
  const email = `${name}-${uid}@test.local`.toLowerCase();
  await prisma.agent.create({ data: { name, email, passwordHash: await bcrypt.hash('pw', 4) } });
  const session = request.agent(app);
  await session.post('/api/auth/login').send({ email, password: 'pw' }).expect(200);
  return session;
}

async function newTicket(priority = 'urgent') {
  const res = await request(app).post('/api/customer/tickets').send({
    name: 'Test Customer', email: `customer-${uid}@test.local`, subject: `Test ${uid}`, body: 'Help', priority,
  }).expect(201);
  const token = res.body.ticket.token;
  const id = Number(res.body.ticket.reference.replace('FD-', ''));
  return { id, token };
}

test('INC-0291: two agents claiming at once, exactly one wins', { skip }, async () => {
  await setup();
  const [a, b] = await Promise.all([loggedInAgent('ClaimA'), loggedInAgent('ClaimB')]);
  const { id } = await newTicket();
  const results = await Promise.all([a.post(`/api/tickets/${id}/claim`), b.post(`/api/tickets/${id}/claim`)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);

  // and the loser cannot reply either
  const loser = results[0].status === 409 ? a : b;
  await loser.post(`/api/tickets/${id}/replies`).send({ body: 'My answer' }).expect(403);
});

test('INC-0304: internal notes never reach the customer API or the audit payloads', { skip }, async () => {
  await setup();
  const agent = await loggedInAgent('NoteWriter');
  const { id, token } = await newTicket();
  await agent.post(`/api/tickets/${id}/claim`).expect(200);
  const secret = `SECRET-NOTE-${uid}`;
  await agent.post(`/api/tickets/${id}/notes`).send({ body: secret }).expect(201);
  await agent.post(`/api/tickets/${id}/replies`).send({ body: 'Public answer', waitForCustomer: true }).expect(201);

  const asCustomer = await request(app).get(`/api/customer/tickets/${token}`).expect(200);
  assert.ok(!JSON.stringify(asCustomer.body).includes(secret), 'note text leaked to the customer view');
  const afterReply = await request(app).post(`/api/customer/tickets/${token}/messages`).send({ body: 'Thanks' }).expect(201);
  assert.ok(!JSON.stringify(afterReply.body).includes(secret), 'note text leaked in a customer response');

  const detail = await agent.get(`/api/tickets/${id}`).expect(200);
  assert.ok(detail.body.ticket.notes.some((n) => n.body === secret), 'agent should see the note');
  assert.ok(!JSON.stringify(detail.body.ticket.events).includes(secret), 'note text copied into the audit log');
});

test('INC-0318: the audit log, messages and notes cannot be changed or deleted', { skip }, async () => {
  await setup();
  const { id } = await newTicket();
  const event = await prisma.ticketEvent.findFirst({ where: { ticketId: id } });
  await assert.rejects(prisma.ticketEvent.update({ where: { id: event.id }, data: { eventType: 'tampered' } }));
  await assert.rejects(prisma.ticketEvent.delete({ where: { id: event.id } }));
  const message = await prisma.message.findFirst({ where: { ticketId: id } });
  await assert.rejects(prisma.message.update({ where: { id: message.id }, data: { body: 'tampered' } }));
});

test('agents cannot close an unresolved ticket', { skip }, async () => {
  await setup();
  const agent = await loggedInAgent('Closer');
  const { id } = await newTicket();
  await agent.post(`/api/tickets/${id}/claim`).expect(200);
  const res = await agent.post(`/api/tickets/${id}/status`).send({ status: 'closed' }).expect(409);
  assert.match(res.body.error, /Only resolved tickets can be closed/);
  await agent.post(`/api/tickets/${id}/status`).send({ status: 'resolved' }).expect(200);
  await agent.post(`/api/tickets/${id}/status`).send({ status: 'closed' }).expect(200);
});

test('waiting on the customer pauses the SLA; the customer reply resumes it', { skip }, async () => {
  await setup();
  const agent = await loggedInAgent('Waiter');
  const { id, token } = await newTicket('medium');
  await agent.post(`/api/tickets/${id}/claim`).expect(200);
  const waiting = await agent.post(`/api/tickets/${id}/replies`).send({ body: 'Question?', waitForCustomer: true }).expect(201);
  assert.equal(waiting.body.ticket.status, 'waiting_on_customer');
  assert.equal(waiting.body.ticket.sla.resolution.state, 'paused');

  await request(app).post(`/api/customer/tickets/${token}/messages`).send({ body: 'Answer' }).expect(201);
  const resumed = await agent.get(`/api/tickets/${id}`).expect(200);
  assert.equal(resumed.body.ticket.status, 'open');
  assert.notEqual(resumed.body.ticket.sla.resolution.state, 'paused');
});

test('agents cannot pause the SLA without contacting the customer', { skip }, async () => {
  await setup();
  const agent = await loggedInAgent('Pauser');
  const { id } = await newTicket();
  await agent.post(`/api/tickets/${id}/claim`).expect(200);
  const res = await agent.post(`/api/tickets/${id}/status`).send({ status: 'waiting_on_customer' }).expect(409);
  assert.match(res.body.error, /send them a reply/);
  const detail = await agent.get(`/api/tickets/${id}`).expect(200);
  assert.equal(detail.body.ticket.status, 'open');
  assert.notEqual(detail.body.ticket.sla.resolution.state, 'paused');
});

test('the database rejects an agent email that is not lowercase', { skip }, async () => {
  await setup();
  await assert.rejects(prisma.agent.create({ data: { name: 'Mixed', email: `Mixed-${uid}@Test.Local`, passwordHash: 'x' } }));
});
