import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { setBusinessTz } from './format.js';
import { usePath, Link, navigate } from './router.jsx';
import Login from './pages/Login.jsx';
import Desk from './pages/Desk.jsx';
import LateReport from './pages/LateReport.jsx';
import CustomerNew from './pages/CustomerNew.jsx';
import CustomerTicket from './pages/CustomerTicket.jsx';

export default function App() {
  const path = usePath();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    api.get('/meta').then((m) => setBusinessTz(m.businessTz)).catch(() => {}).finally(() => setReady(true));
  }, []);
  if (!ready) return null;

  // Customer screens: no login
  if (path === '/support') return <CustomerNew />;
  const customer = path.match(/^\/t\/([\w-]+)$/);
  if (customer) return <CustomerTicket key={customer[1]} token={customer[1]} />;

  return <AgentArea path={path} />;
}

function AgentArea({ path }) {
  const [me, setMe] = useState(undefined); // undefined = checking, null = logged out
  const sessionExpired = useCallback(() => setMe(null), []);

  useEffect(() => {
    api.get('/auth/me').then((r) => setMe(r.agent)).catch(() => setMe(null));
  }, []);

  if (me === undefined) return null;
  if (me === null) return <Login onLogin={setMe} />;

  const logout = async () => {
    await api.post('/auth/logout').catch(() => {});
    setMe(null);
    navigate('/');
  };

  const ticketMatch = path.match(/^\/tickets\/(\d+)$/);
  const onReport = path === '/reports/late';

  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand">
          <img src="/favicon.svg" alt="" width="28" height="28" />
          <span>Frontdesk</span>
        </Link>
        <nav className="topnav" aria-label="Main">
          <Link to="/" aria-current={!onReport ? 'page' : undefined}>Tickets</Link>
          <Link to="/reports/late" aria-current={onReport ? 'page' : undefined}>Late tickets</Link>
        </nav>
        <div className="whoami">
          <span>{me.name}{me.role === 'manager' ? ' (manager)' : ''}</span>
          <button type="button" className="btn-plain" onClick={logout}>Sign out</button>
        </div>
      </header>
      {onReport
        ? <LateReport onSessionExpired={sessionExpired} />
        : <Desk me={me} selectedId={ticketMatch ? Number(ticketMatch[1]) : null} onSessionExpired={sessionExpired} />}
    </div>
  );
}
