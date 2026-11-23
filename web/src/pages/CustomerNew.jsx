import { useState } from 'react';
import { api } from '../api.js';
import { navigate } from '../router.jsx';

const IMPACT = [
  ['urgent', 'I cannot work at all'],
  ['medium', 'Something is broken, but I can still work'],
  ['low', 'A question or a small request'],
];

export default function CustomerNew() {
  const [form, setForm] = useState({ name: '', email: '', subject: '', body: '', priority: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { ticket } = await api.post('/customer/tickets', form);
      navigate(`/t/${ticket.token}?new=1`); // the ticket page then highlights "save this link"
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <main className="customer">
      <header className="customer-brand"><img src="/favicon.svg" alt="" width="32" height="32" /> Arvo Systems support</header>
      <form className="customer-card" onSubmit={submit}>
        <h1>Tell us what's wrong</h1>
        <div className="field-row">
          <label>Your name<input value={form.name} onChange={set('name')} required autoComplete="name" /></label>
          <label>Email<input type="email" value={form.email} onChange={set('email')} required autoComplete="email" /></label>
        </div>
        <fieldset>
          <legend>How much is this affecting you?</legend>
          {IMPACT.map(([value, label]) => (
            <label key={value} className="radio">
              <input type="radio" name="priority" value={value} checked={form.priority === value} onChange={set('priority')} required />
              {label}
            </label>
          ))}
        </fieldset>
        <label>Subject<input value={form.subject} onChange={set('subject')} required maxLength={300} /></label>
        <label>What happened?<textarea rows={6} value={form.body} onChange={set('body')} required /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Send to support'}</button>
      </form>
    </main>
  );
}
