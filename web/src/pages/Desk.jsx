import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { Link } from '../router.jsx';
import { PRIORITY_LABEL, queueState, sortQueue } from '../format.js';
import TicketDetail from './TicketDetail.jsx';

const VIEWS = [
  ['mine', 'My tickets'],
  ['unassigned', 'Unassigned'],
  ['all', 'All'],
];
const REFRESH_MS = 30_000;

export default function Desk({ me, selectedId, onSessionExpired }) {
  const [view, setView] = useState('mine');
  const [tickets, setTickets] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const { tickets } = await api.get(`/tickets?view=${view}`);
      setTickets(sortQueue(tickets));
      setError('');
    } catch (err) {
      if (err.status === 401) return onSessionExpired();
      setError(err.message);
    }
  }, [view, onSessionExpired]);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const late = tickets?.filter((t) => t.sla.isLate).length ?? 0;
  const waiting = tickets?.filter((t) => t.status === 'waiting_on_customer').length ?? 0;

  return (
    <div className={`desk ${selectedId ? 'has-selection' : ''}`}>
      <aside className="queue" aria-label="Ticket queue">
        <div className="tabs" role="tablist">
          {VIEWS.map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={view === key} onClick={() => { setTickets(null); setView(key); }}>
              {label}
            </button>
          ))}
        </div>
        {tickets && (
          <p className="queue-summary">
            {late > 0 ? <strong className="tone-late">{late} late</strong> : 'Nothing late'}
            {waiting > 0 && <span>, {waiting} waiting on the customer</span>}
          </p>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
        {tickets === null && !error && <p className="muted pad">Loading tickets…</p>}
        {tickets?.length === 0 && (
          <p className="muted pad">
            {view === 'mine' ? 'No tickets assigned to you. Pick one up from Unassigned.' : 'No tickets here.'}
          </p>
        )}
        <ul className="queue-list">
          {tickets?.map((t) => {
            const state = queueState(t);
            return (
              <li key={t.id}>
                <Link to={`/tickets/${t.id}`} className={`queue-item tone-${state.tone}`} aria-current={t.id === selectedId ? 'true' : undefined}>
                  <span className="qi-top">
                    <span className={`prio prio-${t.priority}`}>{PRIORITY_LABEL[t.priority]}</span>
                    <span className="qi-ref">FD-{t.id}</span>
                  </span>
                  <span className="qi-subject">{t.subject}</span>
                  <span className="qi-meta">{t.customer.name}{t.assignee ? `, ${t.assignee.name}` : ', unassigned'}</span>
                  <span className="qi-state">{state.text}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </aside>
      <main className="detail">
        {selectedId
          ? <TicketDetail key={selectedId} id={selectedId} me={me} onChanged={load} onSessionExpired={onSessionExpired} />
          : <div className="detail-empty"><p>Choose a ticket from the queue.</p><p className="muted">Late tickets are at the top.</p></div>}
      </main>
    </div>
  );
}
