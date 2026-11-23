// Time and SLA wording. Times are shown in the business time zone (from /api/meta),
// because "due 11:30" must mean Arvo's 11:30 whoever is looking.
let TZ = 'Asia/Kolkata';
export const setBusinessTz = (tz) => { if (tz) TZ = tz; };
export const businessTz = () => TZ;

const dayKey = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const clock = (d) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
const dayMonth = (d) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }).format(d);

/** "11:30" today, "Mon 23 Nov, 11:30" otherwise. */
export function when(iso, now = new Date()) {
  if (!iso) return '';
  const d = new Date(iso);
  return dayKey(d) === dayKey(now) ? `today ${clock(d)}` : `${dayMonth(d)}, ${clock(d)}`;
}

/** Full timestamp with seconds, for the audit trail. */
export function exact(iso) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(new Date(iso));
}

export const PRIORITY_LABEL = { urgent: 'Urgent', medium: 'Medium', low: 'Low' };
export const STATUS_LABEL = {
  new: 'New', open: 'Open', waiting_on_customer: 'Waiting on customer', resolved: 'Resolved', closed: 'Closed',
};

/**
 * One SLA timer in words. A breached timer shows the deadline it MISSED and the
 * priority it was under, not the current priority's deadline (which can be hours
 * away after a downgrade).
 */
export function timerText(timer, now = new Date()) {
  switch (timer.state) {
    case 'breached': return `Missed ${when(timer.breach.dueAt, now)} under ${timer.breach.priority}`;
    case 'met': return 'Met';
    case 'paused': return 'Paused';
    case 'closed_no_reply': return 'Closed, customer stopped replying';
    case 'on_track': return `Due ${when(timer.dueAt, now)}`;
    default: return timer.state;
  }
}

/** The one-line state shown in the queue: late beats waiting beats due. */
export function queueState(t, now = new Date()) {
  const { response, resolution } = t.sla;
  if (t.sla.isLate) {
    const missed = response.state === 'breached' ? response : resolution;
    const what = missed === response ? 'First reply' : 'Fix';
    return { tone: 'late', text: `Late. ${what} was due ${when(missed.breach.dueAt, now)}` };
  }
  if (t.status === 'waiting_on_customer') return { tone: 'waiting', text: 'Waiting on customer' };
  if (t.status === 'resolved') return { tone: 'quiet', text: 'Resolved' };
  if (t.status === 'closed') return { tone: 'quiet', text: 'Closed' };
  const running = response.state === 'on_track' ? response : resolution;
  const what = running === response ? 'First reply' : 'Fix';
  return { tone: 'ok', text: `${what} due ${when(running.dueAt, now)}`, dueAt: running.dueAt };
}

/** Queue order: late first, then soonest deadline, then waiting, then finished. */
export function sortQueue(tickets) {
  const rank = (t) => {
    const s = queueState(t);
    return { late: 0, ok: 1, waiting: 2, quiet: 3 }[s.tone];
  };
  const due = (t) => {
    const s = queueState(t);
    return s.dueAt ? new Date(s.dueAt).getTime() : Infinity;
  };
  return [...tickets].sort((a, b) => rank(a) - rank(b) || due(a) - due(b) || new Date(b.createdAt) - new Date(a.createdAt));
}

/** Audit events in plain words. */
export function describeEvent(e) {
  const p = e.payload ?? {};
  switch (e.type) {
    case 'created': return `opened the ticket as ${PRIORITY_LABEL[p.priority]?.toLowerCase() ?? 'new'}`;
    case 'customer_replied': return 'wrote a message';
    case 'claimed': return 'claimed the ticket';
    case 'replied': return 'replied to the customer';
    case 'note_added': return 'added a team note';
    case 'status_changed': return `changed the status from ${STATUS_LABEL[p.from]?.toLowerCase()} to ${STATUS_LABEL[p.to]?.toLowerCase()}`;
    case 'priority_changed': return `changed the priority from ${p.from} to ${p.to}`;
    case 'reopened': return 'reopened the ticket';
    case 'auto_closed': return 'closed the ticket: no reply from the customer for 5 working days';
    case 'closed_after_reopen_window': return 'closed the ticket: the 7-day reopen window ended';
    case 'follow_up_created': return `wrote again after closing, which started ticket FD-${p.newTicketId}`;
    default: return e.type.replaceAll('_', ' ');
  }
}
