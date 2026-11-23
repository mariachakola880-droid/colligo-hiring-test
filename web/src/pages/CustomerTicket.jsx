import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Link, navigate } from '../router.jsx';
import { exact, when } from '../format.js';

/**
 * The private link is the customer's only way back to this request (no accounts),
 * so show it in full with a copy button, and highlight it right after they submit.
 */
function SaveLink({ justCreated }) {
  const url = `${window.location.origin}${window.location.pathname}`;
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard API unavailable (old browser or insecure context): select the text instead
      const input = document.getElementById('ticket-link');
      input.select();
      document.execCommand('copy');
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <section className={`save-link ${justCreated ? 'save-link-new' : ''}`} aria-labelledby="save-link-title">
      <h2 id="save-link-title">{justCreated ? 'Request sent. Save this link' : 'Your private link to this request'}</h2>
      <p>
        Come back to this link to read our replies and answer us. We don't email replies, and there's no account,
        so this link is the only way back. Anyone with the link can see this request, so don't share it.
      </p>
      <div className="save-link-row">
        <label htmlFor="ticket-link" className="sr-only">Link to this request</label>
        <input id="ticket-link" type="text" readOnly value={url} onFocus={(e) => e.target.select()} />
        <button type="button" className="btn-primary" onClick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
      </div>
      <p className="sr-only" role="status">{copied ? 'Link copied' : ''}</p>
    </section>
  );
}

export default function CustomerTicket({ token }) {
  // Set by the new-request form; read once so a later reload doesn't show "Request sent" again
  const [justCreated] = useState(() => new URLSearchParams(window.location.search).has('new'));
  const [ticket, setTicket] = useState(null);

  useEffect(() => {
    if (justCreated) window.history.replaceState(null, '', window.location.pathname);
  }, [justCreated]);
  const [error, setError] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setTicket(null);
    api.get(`/customer/tickets/${token}`).then((r) => setTicket(r.ticket)).catch((err) => setError(err.message));
  }, [token]);

  const send = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { ticket: updated } = await api.post(`/customer/tickets/${token}/messages`, { body });
      setBody('');
      if (updated.token !== token) navigate(`/t/${updated.token}?new=1`); // a new follow-up ticket, with a new link to save
      else setTicket(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!ticket) {
    return (
      <main className="customer">
        <header className="customer-brand"><img src="/favicon.svg" alt="" width="32" height="32" /> Arvo Systems support</header>
        <div className="customer-card">{error ? <p className="form-error" role="alert">{error}</p> : <p className="muted">Loading…</p>}</div>
      </main>
    );
  }

  const finished = ticket.status === 'closed' || (ticket.status === 'resolved' && !ticket.canReopen);
  const replyLabel = ticket.status === 'resolved' && ticket.canReopen ? 'Not fixed? Reply to reopen' : finished ? 'Need more help? Write to us' : 'Reply';

  return (
    <main className="customer">
      <header className="customer-brand"><img src="/favicon.svg" alt="" width="32" height="32" /> Arvo Systems support</header>
      <div className="customer-card">
        <p className="ticket-ref">{ticket.reference}</p>
        <h1>{ticket.subject}</h1>
        <p className={`status status-${ticket.status}`}>{ticket.statusLabel}</p>
        <SaveLink justCreated={justCreated} />

        <section className="thread" aria-label="Conversation">
          {ticket.messages.map((m) => (
            <div key={m.id} className={`msg ${m.from === 'You' ? 'msg-customer' : 'msg-reply'}`}>
              <p className="msg-head">
                <strong>{m.from}</strong>
                <time dateTime={m.createdAt} title={exact(m.createdAt)}>{when(m.createdAt)}</time>
              </p>
              <p className="msg-body">{m.body}</p>
            </div>
          ))}
        </section>

        <form className="composer" onSubmit={send}>
          <label htmlFor="customer-reply" className="composer-label">{replyLabel}</label>
          {finished && <p className="muted">This request is closed, so your message will start a new request linked to this one.</p>}
          <textarea id="customer-reply" rows={4} value={body} onChange={(e) => setBody(e.target.value)} required />
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="composer-foot">
            <Link to="/support" className="btn-plain">Start a different request</Link>
            <button type="submit" className="btn-primary" disabled={busy || !body.trim()}>Send</button>
          </div>
        </form>
      </div>
    </main>
  );
}
