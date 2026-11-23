import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { Link } from '../router.jsx';
import { PRIORITY_LABEL, STATUS_LABEL, describeEvent, exact, timerText, when } from '../format.js';

const REFRESH_MS = 30_000;

export default function TicketDetail({ id, me, onChanged, onSessionExpired }) {
  const [ticket, setTicket] = useState(null);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setTicket((await api.get(`/tickets/${id}`)).ticket);
      setError('');
    } catch (err) {
      if (err.status === 401) return onSessionExpired();
      setError(err.message);
    }
  }, [id, onSessionExpired]);

  // Refresh on the same rhythm as the queue, so timers and "Take this ticket" don't go stale.
  // Only the ticket data reloads; a half-written reply in the composer is kept.
  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  // Every action returns the updated ticket; a 409 means someone else changed it, so reload.
  const act = async (path, body) => {
    setBusy(true);
    setActionError('');
    try {
      setTicket((await api.post(`/tickets/${id}${path}`, body)).ticket);
      onChanged();
      return true;
    } catch (err) {
      if (err.status === 401) { onSessionExpired(); return false; }
      setActionError(err.message);
      if (err.status === 409) load();
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (error) return <div className="detail-empty"><p className="form-error" role="alert">{error}</p></div>;
  if (!ticket) return <div className="detail-empty"><p className="muted">Loading ticket…</p></div>;

  const mine = ticket.assignee?.id === me.id;
  const canManage = mine || me.role === 'manager';
  const finished = ['resolved', 'closed'].includes(ticket.status);

  return (
    <article className="ticket">
      <Link to="/" className="back-link">Back to the queue</Link>
      <header className="ticket-head">
        <div>
          <p className="ticket-ref">FD-{ticket.id}{ticket.reopenedFrom && <> follows up <Link to={`/tickets/${ticket.reopenedFrom.id}`}>FD-{ticket.reopenedFrom.id}</Link></>}</p>
          <h1>{ticket.subject}</h1>
          <p className="muted">{ticket.customer.name} ({ticket.customer.email}), opened {when(ticket.createdAt)}</p>
        </div>
        <div className="ticket-controls">
          <span className={`status status-${ticket.status}`}>{STATUS_LABEL[ticket.status]}</span>
          <label className="prio-select">
            Priority
            <select
              value={ticket.priority}
              disabled={!canManage || ticket.status === 'closed' || busy}
              onChange={(e) => act('/priority', { priority: e.target.value, version: ticket.version })}
            >
              {Object.entries(PRIORITY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        </div>
      </header>

      <section className="sla" aria-label="Service level">
        <Timer label="First reply" timer={ticket.sla.response} />
        <Timer label="Fix" timer={ticket.sla.resolution} />
      </section>

      <div className="assign-bar">
        {ticket.assignee
          ? <span>Assigned to <strong>{mine ? 'you' : ticket.assignee.name}</strong></span>
          : <span>Nobody has this ticket yet.</span>}
        <div className="actions">
          {!ticket.assignee && !finished && (
            <button type="button" className="btn-primary" disabled={busy} onClick={() => act('/claim')}>Take this ticket</button>
          )}
          {canManage && ticket.status === 'waiting_on_customer' && (
            <button type="button" className="btn" disabled={busy} onClick={() => act('/status', { status: 'open', version: ticket.version })}>Stop waiting</button>
          )}
          {canManage && ['open', 'waiting_on_customer'].includes(ticket.status) && (
            <button type="button" className="btn" disabled={busy} onClick={() => act('/status', { status: 'resolved', version: ticket.version })}>Mark resolved</button>
          )}
          {canManage && ticket.status === 'resolved' && (
            <button type="button" className="btn" disabled={busy} onClick={() => act('/status', { status: 'closed', version: ticket.version })}>Close ticket</button>
          )}
        </div>
      </div>
      {actionError && <p className="form-error" role="alert">{actionError}</p>}

      <Thread ticket={ticket} />
      <Composer ticket={ticket} mine={mine} busy={busy} act={act} />
      <History events={ticket.events} />
    </article>
  );
}

function Timer({ label, timer }) {
  return (
    <div className={`timer timer-${timer.state}`}>
      <span className="timer-label">{label}</span>
      <span className="timer-value">{timerText(timer)}</span>
    </div>
  );
}

/** Messages and team notes in one timeline; notes are unmistakably marked as private. */
function Thread({ ticket }) {
  const items = [
    ...ticket.messages.map((m) => ({ ...m, kind: m.from === 'agent' ? 'reply' : 'customer' })),
    ...ticket.notes.map((n) => ({ ...n, kind: 'note' })),
  ].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  return (
    <section className="thread" aria-label="Conversation">
      {items.map((item) => (
        <div key={`${item.kind}-${item.id}`} className={`msg msg-${item.kind}`}>
          <p className="msg-head">
            <strong>{item.authorName}</strong>
            {item.kind === 'note' && <span className="private-tag">Team note, only your team can see this</span>}
            {item.kind === 'reply' && <span className="muted">to the customer</span>}
            <time dateTime={item.createdAt} title={exact(item.createdAt)}>{when(item.createdAt)}</time>
          </p>
          <p className="msg-body">{item.body}</p>
        </div>
      ))}
    </section>
  );
}

function Composer({ ticket, mine, busy, act }) {
  const [mode, setMode] = useState('reply');
  const [body, setBody] = useState('');
  const [wait, setWait] = useState(false);

  const canReply = mine && ['open', 'waiting_on_customer'].includes(ticket.status);
  const replyBlocked = !mine
    ? (ticket.assignee ? `Only ${ticket.assignee.name} can reply to the customer.` : 'Take this ticket to reply to the customer.')
    : 'This ticket is finished. The customer can reopen it by replying.';
  const isNote = mode === 'note';

  const submit = async (e) => {
    e.preventDefault();
    const ok = isNote
      ? await act('/notes', { body })
      : await act('/replies', { body, waitForCustomer: wait });
    if (ok) { setBody(''); setWait(false); }
  };

  return (
    <form className={`composer ${isNote ? 'composer-note' : ''}`} onSubmit={submit}>
      <div className="composer-tabs" role="tablist" aria-label="Message type">
        <button type="button" role="tab" aria-selected={!isNote} onClick={() => setMode('reply')}>Reply to customer</button>
        <button type="button" role="tab" aria-selected={isNote} onClick={() => setMode('note')}>Team note</button>
      </div>
      {isNote && <p className="composer-warning">Only your team sees team notes. They are never sent to the customer.</p>}
      {!isNote && !canReply
        ? <p className="muted composer-blocked">{replyBlocked}</p>
        : (
          <>
            <label className="sr-only" htmlFor="composer-body">{isNote ? 'Team note' : 'Reply to the customer'}</label>
            <textarea
              id="composer-body"
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={isNote ? 'Write a note for your team' : `Write to ${ticket.customer.name}`}
              required
            />
            <div className="composer-foot">
              {!isNote && (
                <label className="check">
                  <input type="checkbox" checked={wait} onChange={(e) => setWait(e.target.checked)} />
                  I'm asking the customer something (pauses the clock until they reply)
                </label>
              )}
              <button type="submit" className={isNote ? 'btn-note' : 'btn-primary'} disabled={busy || !body.trim()}>
                {isNote ? 'Save team note' : 'Send to customer'}
              </button>
            </div>
          </>
        )}
    </form>
  );
}

function History({ events }) {
  return (
    <details className="history">
      <summary>History ({events.length} {events.length === 1 ? 'event' : 'events'})</summary>
      <p className="muted">Recorded by the system at the moment each thing happened. It cannot be edited.</p>
      <ol>
        {events.map((e) => (
          <li key={e.id}>
            <time dateTime={e.at}>{exact(e.at)}</time>
            <span><strong>{e.actor}</strong> {describeEvent(e)}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}
