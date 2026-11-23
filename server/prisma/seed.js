import { seedDemoData } from '../src/seed.js';
import { prisma } from '../src/db.js';

seedDemoData()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
