// Agent API. Every route requires a logged-in agent; every write is attributed to them.
import { Router } from 'express';
import { requireAgent } from '../auth.js';
import { ah, parseId, HttpError } from '../http.js';
import * as tickets from '../services/ticketService.js';

export const ticketRoutes = Router();
ticketRoutes.use(requireAgent);

ticketRoutes.get('/', ah(async (req, res) => {
  res.json({ tickets: await tickets.listTickets(req.agent, req.query.view || 'mine') });
}));

ticketRoutes.get('/:id', ah(async (req, res) => {
  res.json({ ticket: await tickets.getTicketDetail(parseId(req.params.id)) });
}));

ticketRoutes.post('/:id/claim', ah(async (req, res) => {
  res.json({ ticket: await tickets.claimTicket(parseId(req.params.id), req.agent) });
}));

ticketRoutes.post('/:id/replies', ah(async (req, res) => {
  const { body, waitForCustomer } = req.body ?? {};
  res.status(201).json({ ticket: await tickets.replyToCustomer(parseId(req.params.id), req.agent, { body, waitForCustomer: waitForCustomer === true }) });
}));

ticketRoutes.post('/:id/notes', ah(async (req, res) => {
  res.status(201).json({ ticket: await tickets.addNote(parseId(req.params.id), req.agent, { body: req.body?.body }) });
}));

ticketRoutes.post('/:id/status', ah(async (req, res) => {
  const { status, version } = req.body ?? {};
  if (typeof status !== 'string') throw new HttpError(400, 'status is required');
  res.json({ ticket: await tickets.changeStatus(parseId(req.params.id), req.agent, { status, version }) });
}));

ticketRoutes.post('/:id/priority', ah(async (req, res) => {
  const { priority, version } = req.body ?? {};
  res.json({ ticket: await tickets.changePriority(parseId(req.params.id), req.agent, { priority, version }) });
}));

export const reportRoutes = Router();
reportRoutes.use(requireAgent);

reportRoutes.get('/late', ah(async (req, res) => {
  const since = req.query.since ? new Date(String(req.query.since)) : undefined;
  if (since && Number.isNaN(since.getTime())) throw new HttpError(400, 'since must be a date');
  res.json(await tickets.lateReport({ since }));
}));
