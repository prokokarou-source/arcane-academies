import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Admin } from '../src/admin/Admin';
import type { Fetch } from '../src/admin/adminApi';
import { pct } from '../src/admin/adminApi';

afterEach(cleanup);

const W = {
  visitors: 12,
  activePlayers: 4,
  newAccounts: 3,
  games: { bots: { started: 5, finished: 4 }, casual: { started: 2, finished: 1 }, ranked: { started: 0, finished: 0 }, room: { started: 1, finished: 1 } },
  funnel: { opened: 12, started: 6, term2: 5, finished: 4, secondGame: 2 },
  nextDay: { cohort: 10, returned: 3 },
  nextWeek: { cohort: 0, returned: 0 },
};
const NUMBERS = { today: W, week: W, month: W, live: { online: 2, connections: 5, gamesInProgress: 1 }, at: 0 };
const ITEM = { id: '7', username: 'Ana', kind: 'bug', text: 'Cards overlap', device: 'Android · Chrome', version: '0.1.0', screen: 'game', at: 0, read: false, hasScreenshot: true };

/** A scripted server: path -> reply, recording every call. */
function fakeServer(routes: Record<string, (body: unknown, headers: Record<string, string>) => { status: number; body?: unknown }>) {
  const calls: { path: string; body: unknown; headers: Record<string, string> }[] = [];
  const fetchFn: Fetch = async (url, init) => {
    const path = new URL(url).pathname.replace('/api/admin/', '');
    const body = init.body ? JSON.parse(init.body as string) : undefined;
    const headers = init.headers as Record<string, string>;
    calls.push({ path, body, headers });
    const r = routes[path]?.(body, headers) ?? { status: 404 };
    return { status: r.status, text: async () => (r.body === undefined ? '' : JSON.stringify(r.body)) };
  };
  return { fetchFn, calls };
}

const show = (fetchFn: Fetch, token: string | null = 'login-token-123456') =>
  render(<Admin serverUrl="wss://g.example" token={() => token} fetch={fetchFn} />);

describe('admin page', () => {
  it('asks to log in to the game first when this browser has no login', () => {
    show(fakeServer({}).fetchFn, null);
    expect(screen.getByRole('heading', { name: 'Log in first' })).toBeTruthy();
  });

  it('shows nothing to non-admins', async () => {
    show(fakeServer({ status: () => ({ status: 404 }) }).fetchFn);
    await screen.findByRole('heading', { name: 'Nothing here' });
  });

  it('first time: explains the app, shows the QR once, then the backup codes, then the dashboard', async () => {
    const { fetchFn, calls } = fakeServer({
      status: () => ({ status: 200, body: { stage: 'setup', username: 'Boss' } }),
      setup: () => ({ status: 200, body: { qr: '<svg xmlns="http://www.w3.org/2000/svg"></svg>', secret: 'ABCD EFGH' } }),
      confirm: (b) =>
        (b as { code: string }).code === '123456'
          ? { status: 200, body: { session: 'admin-session-123456', backupCodes: ['AAAAA-BBBBB', 'CCCCC-DDDDD'], backupLeft: 2 } }
          : { status: 401, body: { error: 'wrong_code', left: 4 } },
      feedback: (_b, h) => (h['x-admin-session'] === 'admin-session-123456' ? { status: 200, body: { items: [ITEM] } } : { status: 401 }),
      'feedback/7/screenshot': () => ({ status: 200, body: { screenshot: 'data:image/jpeg;base64,AAAA' } }),
      'feedback/7/read': () => ({ status: 204 }),
      numbers: () => ({ status: 200, body: NUMBERS }),
    });
    show(fetchFn);
    await screen.findByText(/Google Authenticator/);
    expect(screen.getByText(/Microsoft Authenticator/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /show the QR code/ }));
    await screen.findByRole('img', { name: /QR code/ });
    expect(screen.getByText('ABCD EFGH')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Code' }), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('Wrong code. 4 tries left.');
    fireEvent.change(screen.getByRole('textbox', { name: 'Code' }), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('heading', { name: 'Save your backup codes' });
    expect(screen.getByText('AAAAA-BBBBB')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'I saved them' }));

    // Feedback tab: list, screenshot on demand, mark read.
    await screen.findByText('Cards overlap');
    expect(screen.getByRole('tab', { name: 'Feedback (1)' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show screenshot' }));
    await screen.findByRole('img', { name: 'Screenshot from Ana' });
    fireEvent.click(screen.getByRole('button', { name: 'Mark read' }));
    await screen.findByRole('button', { name: 'Mark unread' });
    expect(screen.getByRole('tab', { name: 'Feedback' })).toBeTruthy();
    expect(calls.find((c) => c.path === 'feedback/7/read')!.body).toEqual({ read: true });

    // Numbers tab.
    fireEvent.click(screen.getByRole('tab', { name: 'Numbers' }));
    await screen.findByText('Visitors (devices)');
    expect(screen.getByText('Games in progress')).toBeTruthy();
    expect(screen.getByText('5 / 4')).toBeTruthy();
    expect(screen.getByText('3 of 10')).toBeTruthy();
    // Every data call carried both the login and the admin session.
    for (const c of calls.filter((x) => ['feedback', 'numbers'].includes(x.path))) {
      expect(c.headers.authorization).toBe('Bearer login-token-123456');
      expect(c.headers['x-admin-session']).toBe('admin-session-123456');
    }
  });

  it('asks for a new code when the server ends the session', async () => {
    let n = 0;
    const { fetchFn } = fakeServer({
      status: () => ({ status: 200, body: { stage: 'code', username: 'Boss' } }),
      login: () => ({ status: 200, body: { session: `admin-session-00000${n++}`, backupLeft: 8 } }),
      feedback: () => ({ status: 401, body: { error: 'session' } }),
    });
    show(fetchFn);
    await screen.findByRole('heading', { name: 'Enter your code' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Code' }), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText(/session ended/);
    expect(screen.getByRole('heading', { name: 'Enter your code' })).toBeTruthy();
  });

  it('shows the lock time after too many wrong codes', async () => {
    show(fakeServer({ status: () => ({ status: 429, body: { error: 'locked', until: Date.now() + 60_000 } }) }).fetchFn);
    await screen.findByRole('heading', { name: 'Locked for now' });
  });

  it('formats percentages', () => {
    expect(pct(1, 3)).toBe('33%');
    expect(pct(0, 0)).toBe('–');
  });
});
