# Frontdesk

Support ticket system for Arvo Systems: Node (Express) + Prisma + PostgreSQL backend, React (Vite) agent screen.

**Live:** https://frontdesk-9ng8.onrender.com/

- Agents: sign in as `meera@arvo.test` (manager) or `anu@arvo.test` (agent), password `frontdesk123`.
- Customers: start a request at https://frontdesk-9ng8.onrender.com/support
- It runs on Render's free tier, so the first visit after a quiet spell can take up to a minute while the server wakes up.

What I didn't finish, and why: see [NOTE.md](NOTE.md).

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
npm run dev                   # http://localhost:3000 (SEED_DEMO=true seeds demo data on first start)

# 2. Frontend (separate terminal)
cd web
npm install
npm run dev                   # http://localhost:5173, proxies /api to :3000
```

**Demo logins:** `meera@arvo.test` (manager) and `anu@`, `ravi@`, `priya@`, `arjun@`, `divya@`, `kiran@`, `sneha@`, `vivek@`, `nikhil@arvo.test` (agents). Password for all: `frontdesk123`. The seed includes a late urgent ticket, one waiting on the customer, one with an internal note, a new one, and a resolved one.

### Screens

- **`/`: agent desk.** The queue sorts late tickets first (red, with the deadline they missed), then by the soonest deadline, then tickets waiting on the customer (amber). Opening a ticket shows both SLA timers, the conversation, the composer and the full history.
- **Reply vs team note.** The composer has two modes. Switching to *Team note* turns the whole composer yellow and hatched, with a warning that it is never sent to the customer, and notes look the same in the thread (INC-0304). The *I'm asking the customer something* box on a reply is the only way to pause the clock.
- **History** lists every recorded event with who did it and the exact time to the second (INC-0318).
- **`/reports/late`: late tickets.** Every ticket that missed a deadline, which deadline, when, and under which priority.
- **`/support` and `/t/:token`: customer side.** A new-request form and a private link where the customer follows the conversation, replies, or reopens a resolved ticket within 7 days. The form asks how much the problem affects them, in Meera's words ("I cannot work at all" is urgent, and so on), with nothing preselected: severity decides which promise applies, so a default would bias it. The API itself treats a missing priority as low. Because there are no customer accounts or emails, the private link is the customer's only way back, so their ticket page shows it in full with a *Copy link* button (highlighted as "Request sent. Save this link" right after they submit, and again when a message to a closed ticket starts a new linked request).
- **On a phone**, the desk shows one pane at a time: the queue, or the open ticket with a link back.

All times are shown in the business time zone, so "due 11:30" means Arvo's 11:30 wherever the viewer is.

### Tests

```bash
cd server
npm test          # SLA engine, timeline and no-leak checks (no database needed)
npm run test:db   # API tests for INC-0291, INC-0304, INC-0318 against DATABASE_URL
```

The database tests only insert rows with unique emails, so they can run against a dev database. They cannot clean up after themselves, because the audit tables are append-only.

## API

| Agent (login required) | Customer (secret ticket link, no login) |
|---|---|
| `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` | `POST /api/customer/tickets` |
| `GET /api/tickets?view=mine\|unassigned\|all` | `GET /api/customer/tickets/:token` |
| `GET /api/tickets/:id` (messages, notes, audit trail, SLA) | `POST /api/customer/tickets/:token/messages` |
| `POST /api/tickets/:id/claim` | |
| `POST /api/tickets/:id/replies` `{ body, waitForCustomer }` | |
| `POST /api/tickets/:id/notes` `{ body }` | |
| `POST /api/tickets/:id/status` `{ status, version? }` | |
| `POST /api/tickets/:id/priority` `{ priority, version? }` | |
| `GET /api/reports/late?since=` | |

## How the three incidents are handled

- **INC-0291, two agents took the same ticket.** Claiming is one conditional `UPDATE … WHERE assignee_id IS NULL`, so the database lets exactly one agent win and the other gets a 409 naming the winner. Only the assigned agent can reply. No external lock (such as Redis) is needed: ownership is a column, and the row lock lasts only for that one statement.
- **INC-0304, a private note reached a customer.** Notes live in their own table. The customer code path (routes, service and shared helpers) never references it, which a test checks, and customer responses are built from an explicit field whitelist. The audit log records a note's id, never its text.
- **INC-0318, nobody could prove when a reply was sent.** Every change is written in the same transaction as an audit event carrying who did it and when. The time comes from the database clock: an insert trigger stamps it on every audit event, message, note and ticket, overwriting whatever the app sends, so neither the app server's clock nor a bug can backdate the record. Database triggers also reject any UPDATE, DELETE or TRUNCATE on the audit log, messages and notes. SLA results are computed from that log, so "which tickets were late and why" is answered by `GET /api/reports/late`.

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
- **The only way to wait on the customer is to ask them something:** a reply sent with "wait for customer" ticked. Agents can't set the status directly, so the clock can't be paused without contacting the customer.
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
- **Closing can't be used to dodge a deadline.** Agents can only close tickets that are already resolved; only the auto-close job closes a ticket that is waiting on the customer. As a backstop in the SLA engine, only a close while a waiting-on-customer pause is open counts as `closed_no_reply`. Any other close is judged against the deadline as if the ticket had been resolved at that moment.
- **Reopen window** is 7 calendar days after resolution. After that, a customer message starts a new ticket linked to the old one.
