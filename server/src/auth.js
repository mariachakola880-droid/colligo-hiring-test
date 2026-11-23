import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from './db.js';
import { config } from './config.js';
import { ah, HttpError } from './http.js';

const COOKIE = 'fd_token';
const TTL_MS = 12 * 60 * 60 * 1000;

export const authRoutes = Router();

authRoutes.post('/login', ah(async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string') throw new HttpError(400, 'Email and password are required');
  const agent = await prisma.agent.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!agent || !(await bcrypt.compare(password, agent.passwordHash))) throw new HttpError(401, 'Invalid email or password');

  const token = jwt.sign({ aid: agent.id, name: agent.name, role: agent.role }, config.jwtSecret, { expiresIn: TTL_MS / 1000 });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: TTL_MS });
  res.json({ agent: { id: agent.id, name: agent.name, email: agent.email, role: agent.role } });
}));

authRoutes.post('/logout', (_req, res) => {
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});

authRoutes.get('/me', requireAgent, (req, res) => res.json({ agent: req.agent }));

/** Every agent action is attributed to req.agent (INC-0318: who did it). */
export function requireAgent(req, _res, next) {
  const header = req.headers.authorization;
  const token = req.cookies?.[COOKIE] || (header?.startsWith('Bearer ') ? header.slice(7) : null);
  if (!token) return next(new HttpError(401, 'Not logged in'));
  try {
    const p = jwt.verify(token, config.jwtSecret);
    req.agent = { id: p.aid, name: p.name, role: p.role };
    next();
  } catch {
    next(new HttpError(401, 'Session expired, please log in again'));
  }
}
