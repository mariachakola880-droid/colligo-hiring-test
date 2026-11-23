import { app } from './app.js';
import { config } from './config.js';
import { runAutoClose } from './jobs/autoClose.js';
import { seedDemoData } from './seed.js';

if (process.env.SEED_DEMO === 'true') {
  await seedDemoData().catch((err) => console.error('Demo seed failed:', err));
}

app.listen(config.port, () => console.log(`Frontdesk listening on :${config.port}`));

// Scheduled auto-close. Reads also run it lazily, because a free host may sleep this process.
const FIVE_MIN = 5 * 60 * 1000;
setInterval(() => runAutoClose().catch((err) => console.error('Auto-close failed:', err)), FIVE_MIN);
