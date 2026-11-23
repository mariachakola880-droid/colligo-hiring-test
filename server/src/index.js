import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());
app.use(cookieParser());

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// TODO: mount routes
// app.use('/api/auth', authRoutes);
// app.use('/api/tickets', ticketRoutes);   // agent-facing (may include internal notes)
// app.use('/api/customer', customerRoutes); // customer-facing (must never touch internal_notes)

// Serve the built React app (web/dist) from the same service
const webDist = path.resolve(__dirname, '../../web/dist');
app.use(express.static(webDist));
app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Frontdesk listening on :${port}`));

export default app;
