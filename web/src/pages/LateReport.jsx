import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Link } from '../router.jsx';
import { PRIORITY_LABEL, STATUS_LABEL, timerText, when } from '../format.js';

/** Answers the managers' question: which tickets were late, and why. */
export default function LateReport({ onSessionExpired }) {
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/reports/late').then(setReport).catch((err) => {
      if (err.status === 401) onSessionExpired();
      else setError(err.message);
    });
  }, [onSessionExpired]);

  if (error) return <main className="page"><p className="form-error" role="alert">{error}</p></main>;
  if (!report) return <main className="page"><p className="muted">Loading report…</p></main>;

  return (
    <main className="page">
      <h1>Late tickets</h1>
      <p className="lede">
        {report.lateTickets} of {report.totalTickets} tickets missed a deadline for the first reply, the fix, or both.
        Tickets closed because the customer stopped replying count as neither late nor on time.
      </p>
      {report.tickets.length === 0
        ? <p>No late tickets.</p>
        : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Ticket</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Agent</th>
                  <th scope="col">First reply</th>
                  <th scope="col">Fix</th>
                  <th scope="col">Now</th>
                </tr>
              </thead>
              <tbody>
                {report.tickets.map((t) => (
                  <tr key={t.id}>
                    <td><Link to={`/tickets/${t.id}`}>FD-{t.id}</Link> {t.subject}<br /><span className="muted">opened {when(t.createdAt)}</span></td>
                    <td>{t.customer}</td>
                    <td>{t.assignee ?? <span className="muted">unassigned</span>}</td>
                    <td className={t.sla.response.state === 'breached' ? 'tone-late' : ''}>{timerText(t.sla.response)}</td>
                    <td className={t.sla.resolution.state === 'breached' ? 'tone-late' : ''}>{timerText(t.sla.resolution)}</td>
                    <td>{STATUS_LABEL[t.status]}, {PRIORITY_LABEL[t.priority].toLowerCase()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      <p className="muted">Open a ticket and expand its history to see exactly who did what, and when.</p>
    </main>
  );
}
