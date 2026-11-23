// Customer API: identified by a secret per-ticket token, no login.
// Must never reference internal notes (see tests/no-leak.test.js).
import { Router } from 'express';
import { ah } from '../http.js';
import * as customer from '../services/customerService.js';

export const customerRoutes = Router();

customerRoutes.post('/tickets', ah(async (req, res) => {
  res.status(201).json({ ticket: await customer.createTicket(req.body ?? {}) });
}));

customerRoutes.get('/tickets/:token', ah(async (req, res) => {
  res.json({ ticket: await customer.getTicket(req.params.token) });
}));

customerRoutes.post('/tickets/:token/messages', ah(async (req, res) => {
  res.status(201).json({ ticket: await customer.customerReply(req.params.token, { body: req.body?.body }) });
}));
