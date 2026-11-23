import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authRoutes } from './auth.js';
import { ticketRoutes, reportRoutes } from './routes/tickets.js';
import { customerRoutes } from './routes/customer.js';
import { errorHandler } from './http.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const app = express();
app.set('trust proxy', 1); // Render terminates TLS in front of us (needed for secure cookies)
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api/tickets', ticketRoutes);    // agent-facing (includes internal notes)
app.use('/api/reports', reportRoutes);    // agent-facing
app.use('/api/customer', customerRoutes); // customer-facing (never touches internal notes)
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

// Serve the built React app (web/dist) from the same service
const webDist = path.resolve(__dirname, '../../web/dist');
app.use(express.static(webDist));
app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
