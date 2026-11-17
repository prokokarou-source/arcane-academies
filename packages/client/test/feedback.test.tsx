import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApi, deviceId, deviceSummary, httpUrl, withDevice, type Api, type FeedbackDraft, type TrackEvent } from '../src/net/api';
import type { GameClient } from '../src/net/client';
import { harness, memoryStorage } from './fakeSocket';
import { openMore, renderApp } from './render';

afterEach(cleanup);

function fakeApi(result: Awaited<ReturnType<Api['feedback']>> = 'ok') {
  const sent: { draft: FeedbackDraft; token: string }[] = [];
  const tracked: { e: TrackEvent; token: string | null }[] = [];
  const api: Api = {
    feedback: vi.fn(async (draft: FeedbackDraft, token: string) => {
      sent.push({ draft, token });
      return result;
    }),
    track: (e, token) => {
      tracked.push({ e, token });
    },
  };
  return { api, sent, tracked };
}

describe('Feedback in More', () => {
  it('asks guests to log in first', () => {
    renderApp({ api: fakeApi().api });
    openMore('Feedback');
    expect(screen.getByText('Log in to send feedback.')).toBeTruthy();
  });

  it('sends a report with the screen the player came from, then says thanks', async () => {
    const { api, sent } = fakeApi();
    const storage = memoryStorage();
    storage.setItem('arcane.account', JSON.stringify({ token: 'tok-1234567890abcdef' }));
    const h = renderApp({ api, storage });
    act(() => h.sock().receive({ t: 'account', username: 'Ana' }));
    openMore('Feedback');
    expect(screen.getByText(/Sent as Ana/)).toBeTruthy();
    const send = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Idea' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: '  More academies please  ' } });
    fireEvent.click(send);
    await screen.findByText('Thanks!');
    expect(sent).toEqual([{ draft: { kind: 'idea', text: 'More academies please', screenshot: null, screen: 'play › more' }, token: 'tok-1234567890abcdef' }]);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('button', { name: 'Feedback' })).toBeTruthy();
  });

  it('shows a friendly message when the player sent too much', async () => {
    const storage = memoryStorage();
    storage.setItem('arcane.account', JSON.stringify({ token: 'tok-1234567890abcdef' }));
    const h = renderApp({ api: fakeApi('too_many').api, storage });
    act(() => h.sock().receive({ t: 'account', username: 'Ana' }));
    openMore('Feedback');
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Hi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText(/sent a lot of feedback/);
  });
});

describe('api helpers', () => {
  it('keeps one random device id per device', () => {
    const storage = memoryStorage();
    const id = deviceId(storage, () => 'abcdefabcdefabcdef12');
    expect(id).toBe('abcdefabcdefabcdef12');
    expect(deviceId(storage, () => 'other-other-other-other')).toBe(id);
  });

  it('builds addresses and a nameless device summary', () => {
    expect(httpUrl('wss://game.example/', '/api/feedback')).toBe('https://game.example/api/feedback');
    expect(httpUrl('ws://localhost:8787', '/api/event')).toBe('http://localhost:8787/api/event');
    expect(withDevice('wss://game.example', 'abcdefabcdefabcdef12')).toBe('wss://game.example/?d=abcdefabcdefabcdef12');
    const android = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
    expect(deviceSummary(android, 412, 915)).toBe('Android · Chrome · 412×915');
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    expect(deviceSummary(iphone, 390, 844)).toBe('iOS · Safari · 390×844');
  });

  it('posts feedback with the login and maps answers', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    let status = 201;
    const fetchFn = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return { ok: status < 300, status } as Response;
    }) as unknown as typeof fetch;
    const api = createApi({ serverUrl: 'wss://g.example', fetch: fetchFn, device: 'abcdefabcdefabcdef12', version: '0.2.0', deviceInfo: () => 'Android · Chrome · 1×1' });
    const draft: FeedbackDraft = { kind: 'bug', text: 'x', screenshot: null, screen: 'game' };
    expect(await api.feedback(draft, 'tok')).toBe('ok');
    expect(calls[0].url).toBe('https://g.example/api/feedback');
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ ...draft, device: 'Android · Chrome · 1×1', version: '0.2.0' });
    status = 429;
    expect(await api.feedback(draft, 'tok')).toBe('too_many');
    status = 401;
    expect(await api.feedback(draft, 'tok')).toBe('login');
    api.track({ kind: 'open' }, null);
    expect(calls.at(-1)!.url).toBe('https://g.example/api/event');
    expect(JSON.parse(calls.at(-1)!.init.body as string)).toEqual({ kind: 'open', device: 'abcdefabcdefabcdef12' });
  });
});

function playToEnd(client: GameClient, runTimers: () => void): void {
  for (let i = 0; i < 2000; i++) {
    const s = client.getState();
    if (s.game?.result) return;
    if (s.duels) client.clearDuels();
    if (s.game && s.game.legal.length > 0 && !s.acting) client.act(s.game.legal[0]);
    else runTimers();
  }
  throw new Error('game did not end');
}

describe('offline Bots games in the usage numbers', () => {
  it('reports start, Term 2 and finish once each, with one game id', async () => {
    const { api, tracked } = fakeApi();
    const h = harness(memoryStorage(), { api });
    h.client.start();
    h.sock().open();
    h.client.solo('Ana', 2, 'easy');
    playToEnd(h.client, h.runTimers);
    await waitFor(() => expect(tracked.map((x) => x.e.kind)).toEqual(['game_start', 'term2', 'game_finish']));
    const games = new Set(tracked.map((x) => (x.e.kind === 'open' ? null : x.e.game)));
    expect(games.size).toBe(1);
    expect(tracked.every((x) => x.e.kind !== 'open' && x.e.mode === 'bots')).toBe(true);
  });
});
