# What I did not finish, and why

The core of the brief is done and tested: the SLA rules from the meeting notes (working hours, pauses while waiting on the customer, auto-close, the reopen window, and a decision on the open priority-change question), and a fix for each of the three incidents. Everything below was skipped on purpose, to keep the time on those.

## Not built

**Reassigning tickets.** A manager cannot move a ticket to another agent, for example when someone is off sick. Agents claim unassigned tickets, and a manager can resolve or reprioritise any ticket, but the assignee can't be changed. The brief doesn't ask for it, but a real team would need it soon. The next step is a manager-only endpoint that writes a `reassigned` event to the audit log, like every other change.

**Managing holidays.** Working-time calculations skip any date in the `holidays` table, but only three are seeded (Christmas, New Year and Republic Day), and there is no screen to edit them. I didn't guess festival dates such as Diwali from memory, because several follow the lunar calendar and a wrong date would silently move deadlines. Arvo would need to supply its own list. Until then, a festival day counts as a working day.

**Email notifications.** Nobody is emailed. Customers see replies by opening their private ticket link, and agents see new tickets by watching the queue, which refreshes every 30 seconds.

**Customer accounts.** Customers create a ticket from a form and get a private link instead of logging in. The link is a long random token, but anyone who has it can read and reply to that ticket.

**Agents logging tickets for customers.** The only way to raise a ticket is the public form at `/support`. Arvo's customers report problems by WhatsApp and phone today, and an agent who takes a call can't create a ticket for that customer; they have to send the customer the form link. There's also no email or WhatsApp intake. The next step is a "New ticket for a customer" form on the agent side, recorded in the audit log as created by the agent on the customer's behalf.

**Triage.** Customers choose their own severity, using Meera's descriptions ("I cannot work at all", and so on). Agents can correct it, and the SLA history keeps the change, but nobody reviews severity when a ticket arrives.

**Rate limiting.** The public customer endpoints, creating a ticket and replying, have no rate limit, so a bot could flood the queue.

**Protection from database administrators.** Audit times are stamped by a database trigger with the database clock, overwriting anything the app sends, and other triggers stop the record being changed or deleted. The demo seed is the one deliberate exception: it switches the time stamping off for its own transaction so the demo has late tickets to show. Like any trigger, these protect the record from the application, not from someone with administrator access to the database, who could disable them.

**Automated test runs.** There are 36 tests that need no database (SLA engine, timeline, rules, and checks that the customer code never touches notes) and 9 database tests for the incidents and key rules. They run with `npm test` and `npm run test:db`, but nothing runs them on every push.

## Known limits of the hosting

The app runs on Render's free tier. The server sleeps after about 15 minutes without traffic, so the first visit can take up to a minute. Because the server can sleep, auto-close also runs whenever tickets are read, not only on a timer. The free database expires after 30 days, which covers the one-week requirement.
