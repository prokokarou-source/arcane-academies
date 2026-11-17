/**
 * The hidden admin page at /admin (no link to it anywhere in the game). Every check happens on the
 * server; this page only shows what the server allows. The admin session lives in memory only, so a
 * reload asks for a new code, and it is dropped after 30 minutes without use.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createAdminApi, pct, type AdminApi, type FeedbackItem, type Fetch, type Mode, type Numbers, type WindowNumbers } from './adminApi';
import './admin.css';

export const ADMIN_IDLE_MS = 30 * 60_000;

type Stage =
  | { s: 'loading' }
  | { s: 'nologin' }
  | { s: 'hidden' }
  | { s: 'offline' }
  | { s: 'locked'; until: number }
  | { s: 'setup' }
  | { s: 'backup'; codes: string[] }
  | { s: 'code'; note?: string }
  | { s: 'in' };

export function Admin(props: { serverUrl: string; token: () => string | null; fetch?: Fetch; now?: () => number }) {
  const token = props.token();
  const api = useMemo(
    () => (token ? createAdminApi(props.serverUrl, token, props.fetch ?? ((u, i) => fetch(u, i))) : null),
    [props.serverUrl, token, props.fetch],
  );
  const [stage, setStage] = useState<Stage>(token ? { s: 'loading' } : { s: 'nologin' });
  const now = props.now ?? Date.now;

  useEffect(() => {
    document.title = 'Admin · Arcane Academies';
    if (!api) return;
    void api.call<{ stage: 'setup' | 'code'; until?: number }>('status', {}).then((r) => {
      if (r.status === 200 && r.body) setStage({ s: r.body.stage });
      else if (r.status === 429) setStage({ s: 'locked', until: Number(r.body?.until ?? 0) });
      else if (r.status === 0 || r.status >= 500) setStage({ s: 'offline' });
      else setStage({ s: 'hidden' });
    });
  }, [api]);

  // The session ends after 30 minutes without use (the server checks too).
  const lastUse = useRef(now());
  const touch = () => {
    lastUse.current = now();
  };
  useEffect(() => {
    if (stage.s !== 'in') return;
    const id = setInterval(() => {
      if (now() - lastUse.current > ADMIN_IDLE_MS) {
        api?.setSession(null);
        setStage({ s: 'code', note: 'Signed out after 30 minutes without use.' });
      }
    }, 30_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage.s, api]);

  const expired = () => {
    api?.setSession(null);
    setStage({ s: 'code', note: 'Your admin session ended. Enter a new code.' });
  };

  const wrong = (r: { status: number; body: { left?: number } | null }) =>
    r.status === 401 ? `Wrong code.${r.body?.left ? ` ${r.body.left} tries left.` : ''}` : 'Something went wrong. Try again.';

  let body: ReactNode;
  if (stage.s === 'loading') body = <p className="muted">Checking…</p>;
  else if (stage.s === 'nologin')
    body = (
      <Card title="Log in first">
        <p>Log in to the game with your account in this browser, then open this page again.</p>
        <a className="button primary" href="/">
          Open the game
        </a>
      </Card>
    );
  else if (stage.s === 'hidden')
    body = (
      <Card title="Nothing here">
        <a href="/">Back to the game</a>
      </Card>
    );
  else if (stage.s === 'offline')
    body = (
      <Card title="Server not reachable">
        <p>The server may be waking up. Wait a few seconds and reload.</p>
      </Card>
    );
  else if (stage.s === 'locked')
    body = (
      <Card title="Locked for now">
        <p>{`Too many wrong codes. Try again after ${new Date(stage.until).toLocaleTimeString()}.`}</p>
      </Card>
    );
  else if (stage.s === 'setup')
    body = (
      <Setup
        api={api!}
        wrong={wrong}
        onDone={(codes) => {
          touch();
          setStage({ s: 'backup', codes });
        }}
        onLocked={(until) => setStage({ s: 'locked', until })}
      />
    );
  else if (stage.s === 'backup')
    body = (
      <Card title="Save your backup codes">
        <p>
          If you lose your phone, each of these codes lets you in <strong>once</strong>. Write them down or save them somewhere safe.
          They are shown only now.
        </p>
        <ul className="adm-codes">
          {stage.codes.map((c) => (
            <li key={c}>
              <code>{c}</code>
            </li>
          ))}
        </ul>
        <button className="primary" onClick={() => setStage({ s: 'in' })}>
          I saved them
        </button>
      </Card>
    );
  else if (stage.s === 'code')
    body = (
      <CodeForm
        title="Enter your code"
        hint="Open your authenticator app and type the 6-digit code for Arcane Academies (or one of your backup codes)."
        note={stage.note}
        submit={async (code) => {
          const r = await api!.call<{ session?: string; until?: number; left?: number }>('login', { code });
          if (r.status === 200 && r.body?.session) {
            api!.setSession(r.body.session);
            touch();
            setStage({ s: 'in' });
            return null;
          }
          if (r.status === 429 && r.body?.until) {
            setStage({ s: 'locked', until: r.body.until });
            return null;
          }
          return wrong(r);
        }}
      />
    );
  else
    body = (
      <Dashboard
        api={api!}
        onUse={touch}
        onExpired={expired}
        onLogout={async () => {
          await api!.call('logout', {});
          api!.setSession(null);
          setStage({ s: 'code', note: 'Signed out.' });
        }}
      />
    );

  return (
    <div className="adm" onPointerDown={touch} onKeyDown={touch}>
      <header className="adm-top">
        <h1>Admin</h1>
        <span className="muted small">Arcane Academies</span>
      </header>
      {body}
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel adm-card">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function CodeForm(props: { title: string; hint: ReactNode; note?: string; submit(code: string): Promise<string | null>; children?: ReactNode }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Card title={props.title}>
      {props.note && (
        <p className="banner" role="status">
          {props.note}
        </p>
      )}
      {props.children}
      <form
        className="adm-code"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy || !code.trim()) return;
          setBusy(true);
          const err = await props.submit(code.trim());
          setBusy(false);
          setError(err);
          setCode('');
        }}
      >
        <label className="field">
          <span>{props.hint}</span>
          <input aria-label="Code" autoComplete="one-time-code" autoFocus maxLength={16} value={code} onChange={(e) => setCode(e.target.value)} />
        </label>
        {error && (
          <p className="danger-text" role="alert">
            {error}
          </p>
        )}
        <button className="primary" type="submit" disabled={busy || !code.trim()}>
          {busy ? 'Checking…' : 'Continue'}
        </button>
      </form>
    </Card>
  );
}

function Setup(props: {
  api: AdminApi;
  wrong(r: { status: number; body: { left?: number } | null }): string;
  onDone(codes: string[]): void;
  onLocked(until: number): void;
}) {
  const { api } = props;
  const [qr, setQr] = useState<{ qr: string; secret: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!qr)
    return (
      <Card title="Set up your second lock">
        <p>
          The admin page asks for a 6-digit code from an app on your phone every time. First install the free app{' '}
          <strong>Google Authenticator</strong> or <strong>Microsoft Authenticator</strong> from your phone’s app store.
        </p>
        <p className="muted small">The QR code is shown only once, so have your phone in your hand.</p>
        {error && <p className="danger-text">{error}</p>}
        <button
          className="primary"
          onClick={async () => {
            const r = await api.call<{ qr: string; secret: string; until?: number }>('setup', {});
            if (r.status === 200 && r.body) setQr(r.body);
            else if (r.status === 429 && r.body?.until) props.onLocked(r.body.until);
            else setError('Could not start. Reload the page.');
          }}
        >
          I have the app — show the QR code
        </button>
      </Card>
    );
  return (
    <CodeForm
      title="Scan the QR code"
      hint="Then type the 6-digit code the app shows for Arcane Academies:"
      submit={async (code) => {
        const r = await api.call<{ session?: string; backupCodes?: string[]; until?: number; left?: number }>('confirm', { code });
        if (r.status === 200 && r.body?.session && r.body.backupCodes) {
          api.setSession(r.body.session);
          props.onDone(r.body.backupCodes);
          return null;
        }
        if (r.status === 429 && r.body?.until) {
          props.onLocked(r.body.until);
          return null;
        }
        return props.wrong(r);
      }}
    >
      <p>
        In the app tap <strong>+</strong>, choose <strong>Scan a QR code</strong> and point the camera at this:
      </p>
      <img className="adm-qr" alt="QR code for your authenticator app" src={`data:image/svg+xml;utf8,${encodeURIComponent(qr.qr)}`} />
      <p className="muted small">
        No camera? Choose “Enter a setup key” and type: <code className="adm-secret">{qr.secret}</code>
      </p>
    </CodeForm>
  );
}

type Tab = 'feedback' | 'numbers';

function Dashboard(props: { api: AdminApi; onUse(): void; onExpired(): void; onLogout(): void }) {
  const [tab, setTab] = useState<Tab>('feedback');
  const [items, setItems] = useState<FeedbackItem[] | null>(null);
  const [numbers, setNumbers] = useState<Numbers | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async (what: Tab) => {
    props.onUse();
    setError(null);
    const r = what === 'feedback' ? await props.api.call<{ items: FeedbackItem[] }>('feedback') : await props.api.call<Numbers>('numbers');
    if (r.status === 401) return props.onExpired();
    if (r.status !== 200 || !r.body) return setError('Could not load. Try again.');
    if (what === 'feedback') setItems((r.body as { items: FeedbackItem[] }).items);
    else setNumbers(r.body as Numbers);
  };
  useEffect(() => {
    void load(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const unread = items?.filter((i) => !i.read).length ?? 0;
  return (
    <>
      <nav className="adm-tabs" role="tablist" aria-label="Admin sections">
        <button role="tab" aria-selected={tab === 'feedback'} onClick={() => setTab('feedback')}>
          {`Feedback${unread ? ` (${unread})` : ''}`}
        </button>
        <button role="tab" aria-selected={tab === 'numbers'} onClick={() => setTab('numbers')}>
          Numbers
        </button>
        <span className="grow" />
        <button className="link" onClick={() => void load(tab)}>
          Refresh
        </button>
        <button className="link" onClick={props.onLogout}>
          Sign out
        </button>
      </nav>
      {error && (
        <p className="banner banner-error" role="alert">
          {error}
        </p>
      )}
      {tab === 'feedback' ? (
        <FeedbackList
          items={items}
          api={props.api}
          onExpired={props.onExpired}
          onUse={props.onUse}
          onRead={(id, read) => setItems((xs) => xs?.map((x) => (x.id === id ? { ...x, read } : x)) ?? null)}
        />
      ) : (
        <NumbersView numbers={numbers} />
      )}
    </>
  );
}

function FeedbackList(props: { items: FeedbackItem[] | null; api: AdminApi; onExpired(): void; onUse(): void; onRead(id: string, read: boolean): void }) {
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [shots, setShots] = useState<Record<string, string>>({});
  if (!props.items) return <p className="muted">Loading…</p>;
  const list = props.items.filter((i) => !onlyUnread || !i.read);
  return (
    <section className="adm-feedback">
      <label className="adm-filter">
        <input type="checkbox" checked={onlyUnread} onChange={(e) => setOnlyUnread(e.target.checked)} /> Unread only
      </label>
      {list.length === 0 && <p className="muted">No feedback yet.</p>}
      {list.map((f) => (
        <article key={f.id} className={`panel adm-item${f.read ? ' read' : ''}`} aria-label={`Feedback from ${f.username}`}>
          <header>
            <span className={`tag adm-kind-${f.kind}`}>{f.kind === 'bug' ? 'Bug' : f.kind === 'idea' ? 'Idea' : 'Other'}</span>
            <strong>{f.username}</strong>
            <span className="muted small">{new Date(f.at).toLocaleString()}</span>
          </header>
          <p className="adm-text">{f.text}</p>
          <p className="muted small">{[f.device, f.version && `v${f.version}`, f.screen && `screen: ${f.screen}`].filter(Boolean).join(' · ')}</p>
          {shots[f.id] && <img className="adm-shot" src={shots[f.id]} alt={`Screenshot from ${f.username}`} />}
          <div className="row">
            {f.hasScreenshot && !shots[f.id] && (
              <button
                onClick={async () => {
                  props.onUse();
                  const r = await props.api.call<{ screenshot: string | null }>(`feedback/${f.id}/screenshot`);
                  if (r.status === 401) return props.onExpired();
                  const s = r.body?.screenshot;
                  if (s && /^data:image\/(jpeg|png|webp);base64,/.test(s)) setShots((x) => ({ ...x, [f.id]: s }));
                }}
              >
                Show screenshot
              </button>
            )}
            <button
              onClick={async () => {
                props.onUse();
                const r = await props.api.call(`feedback/${f.id}/read`, { read: !f.read });
                if (r.status === 401) return props.onExpired();
                if (r.status === 204) props.onRead(f.id, !f.read);
              }}
            >
              {f.read ? 'Mark unread' : 'Mark read'}
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}

const MODE_LABEL: Record<Mode, string> = { bots: 'Bots', casual: 'Casual', ranked: 'Ranked', room: 'Rooms' };
type Range = 'today' | 'week' | 'month';
const RANGE_LABEL: Record<Range, string> = { today: 'Today', week: '7 d', month: '30 d' };

function NumbersView({ numbers }: { numbers: Numbers | null }) {
  const [range, setRange] = useState<Range>('week');
  if (!numbers) return <p className="muted">Loading…</p>;
  const n: WindowNumbers = numbers[range];
  const f = n.funnel;
  const steps: [string, number][] = [
    ['Opened the app', f.opened],
    ['Started a game', f.started],
    ['Reached Term 2', f.term2],
    ['Finished a game', f.finished],
    ['Played a 2nd game', f.secondGame],
  ];
  return (
    <section className="adm-numbers">
      <section className="panel" aria-label="Live now">
        <h3>Live now</h3>
        <div className="adm-stats">
          <Stat label="Players online" value={numbers.live.online} />
          <Stat label="Open connections" value={numbers.live.connections} />
          <Stat label="Games in progress" value={numbers.live.gamesInProgress} />
        </div>
      </section>
      <div className="adm-tabs" role="tablist" aria-label="Period">
        {(Object.keys(RANGE_LABEL) as Range[]).map((r) => (
          <button key={r} role="tab" aria-selected={range === r} onClick={() => setRange(r)}>
            {RANGE_LABEL[r]}
          </button>
        ))}
      </div>
      <div className="adm-stats">
        <Stat label="Visitors (devices)" value={n.visitors} />
        <Stat label="Logged-in players" value={n.activePlayers} />
        <Stat label="New accounts" value={n.newAccounts} />
      </div>
      <section className="panel">
        <h3>Games started / finished</h3>
        <table className="adm-table">
          <tbody>
            {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
              <tr key={m}>
                <th scope="row">{MODE_LABEL[m]}</th>
                <td>{`${n.games[m].started} / ${n.games[m].finished}`}</td>
                <td className="muted">{pct(n.games[m].finished, n.games[m].started)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="panel">
        <h3>Funnel (players)</h3>
        {steps.map(([label, v]) => (
          <div key={label} className="adm-bar">
            <span>{label}</span>
            <span className="adm-bar-track">
              <span className="adm-bar-fill" style={{ width: f.opened ? `${Math.min(100, (100 * v) / f.opened)}%` : '0%' }} />
            </span>
            <span>{`${v} · ${pct(v, f.opened)}`}</span>
          </div>
        ))}
      </section>
      <section className="panel">
        <h3>Came back (new devices)</h3>
        <table className="adm-table">
          <tbody>
            <tr>
              <th scope="row">Next day</th>
              <td>{`${n.nextDay.returned} of ${n.nextDay.cohort}`}</td>
              <td className="muted">{pct(n.nextDay.returned, n.nextDay.cohort)}</td>
            </tr>
            <tr>
              <th scope="row">Within a week</th>
              <td>{`${n.nextWeek.returned} of ${n.nextWeek.cohort}`}</td>
              <td className="muted">{pct(n.nextWeek.returned, n.nextWeek.cohort)}</td>
            </tr>
          </tbody>
        </table>
        <p className="muted small">Days are UTC. AI opponents and bots are never counted.</p>
      </section>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="adm-stat">
      <strong>{value}</strong>
      <span className="muted small">{label}</span>
    </div>
  );
}
