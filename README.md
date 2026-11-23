# Frontdesk

Support ticket system for Arvo Systems: Node (Express) + Prisma + PostgreSQL backend, React (Vite) agent screen.

## Structure

```
server/   Express API, Prisma schema/migrations, SLA engine, auto-close job, tests
web/      React agent screen (built and served by the Express server in production)
```

## Run locally

Requires Node 20.6+ and PostgreSQL.

```bash
# 1. Backend
cd server
cp .env.example .env          # set DATABASE_URL
npm install
npx prisma migrate deploy     # applies migrations, including append-only triggers
npm run dev                   # http://localhost:3000

# 2. Frontend (separate terminal)
cd web
npm install
npm run dev                   # http://localhost:5173, proxies /api to :3000
```

## Design decisions

_To be filled in._
