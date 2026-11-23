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

The brief gives a story rather than a requirements list. These are the rules I took from it, and the calls I made where it is ambiguous.

### SLA targets and working time

- **Targets** (working time, 9:30–18:30 Mon–Fri, excluding holidays in the `holidays` table):

  | Priority | First response | Resolution |
  |---|---|---|
  | Urgent | 2 working hours | 1 working day (9 working hours) |
  | Medium | Half a working day (4.5 h) | 3 working days |
  | Low | 1 working day | 5 working days |

- **"Fix it the same working day" is read as 9 working hours from creation**, not "by 18:30 on the day it arrived". An urgent ticket arriving at 17:00 is due at 17:00 the next working day. The literal reading breaks for late arrivals: a ticket arriving at 18:00 would have 30 minutes to be fixed but until Monday 11:00 for its first reply.
- **Time zone:** everything is stored in UTC. Working hours and holidays are evaluated in `BUSINESS_TZ` (default `Asia/Kolkata`), because 9:30–18:30 is Arvo's local working day.

### Pausing

- The clock **pauses while a ticket is waiting on the customer** ("that week is not our fault") **and while it is resolved**. A reopened ticket continues from where it stopped.
- Pauses are derived from the audit log, not from mutable ticket columns.

### Priority changes (the open question from the meeting)

- **Changing priority never rewrites history.** A finished timer is judged by the priority in effect when it finished. A deadline missed under one priority stays a breach after a downgrade, and the record keeps which priority it was breached under.
- **A running timer switches to the new priority's target, measured from creation**, so time already used counts.
- **A priority change gets a 30-working-minute grace** (`PRIORITY_CHANGE_GRACE_MIN`): the new deadline is never earlier than the change time plus 30 minutes. Without this, escalating a ticket honestly could make it late instantly, which would teach agents not to escalate. If nobody acts within the grace, the ticket is late.
- **The grace can never extend past the earliest deadline under any earlier priority.** Otherwise a quick downgrade and re-escalation just before a deadline would buy 30 extra minutes and hide a breach. Escalating a medium ticket due at 14:00 at 12:30 gives until 13:00; toggling an urgent ticket due at 11:30 down and back up at 11:25 still leaves it due at 11:30.
- On screen, a breached timer shows **the deadline it missed and the priority it was under** ("missed 11:30 under urgent"), not the current priority's deadline, which can still be hours away after a downgrade.

### Closing and reopening

- **Auto-close** after 5 working days with no customer reply while waiting on them.
- **An auto-closed ticket is not "resolved".** Its open timers end as `closed_no_reply`: neither met nor breached, so customers who go quiet don't inflate the on-time rate. If a timer had already breached before the ticket went quiet, it stays breached.
- **Reopen window** is 7 calendar days after resolution. After that, a customer message starts a new ticket linked to the old one.
