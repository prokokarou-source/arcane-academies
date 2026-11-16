import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LobbyState, ReactionId } from '@arcane/protocol';
import type { SoundBoard } from '../src/audio/sounds';
import { BUBBLE_MS } from '../src/ui/Reactions';
import { harness, memoryStorage } from './fakeSocket';
import { renderApp } from './render';
import { gameMsg, makeGame } from './views';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const lobby: LobbyState = {
  code: 'WAND-42',
  inviteUrl: 'http://x/?room=WAND-42',
  hostId: 's1',
  settings: { graceMs: 60_000, turnTimerMs: null },
  seats: [
    { id: 's1', kind: 'human', name: 'Ana', academyId: null, side: 'A', connected: true },
    { id: 's2', kind: 'human', name: 'Bob', academyId: null, side: 'A', connected: true },
  ],
};

const spyBoard = () => ({ unlock: vi.fn(), play: vi.fn(), music: vi.fn(), setPrefs: vi.fn() }) satisfies SoundBoard;

function inLobby(opts: Parameters<typeof renderApp>[0] = {}) {
  const h = renderApp(opts);
  act(() => {
    h.sock().receive({ t: 'joined', code: 'WAND-42', seatId: 's1', token: 't' });
    h.sock().receive({ t: 'lobby', lobby });
  });
  h.sock().sent.length = 0;
  return h;
}

const react = (h: ReturnType<typeof renderApp>, seatId: string, reaction: ReactionId, seat: number | null = null) =>
  act(() => h.sock().receive({ t: 'reaction', seatId, seat, reaction }));

describe('GameClient reactions', () => {
  it('sends a reaction only while seated and connected, and never queues it', () => {
    const h = harness();
    h.client.start();
    h.client.react('clap');
    h.sock().open();
    h.client.react('clap');
    expect(h.sock().sent).toEqual([]);
    h.sock().receive({ t: 'joined', code: 'WAND-42', seatId: 's1', token: 't' });
    h.client.react('gg');
    expect(h.sock().sent).toEqual([{ t: 'react', reaction: 'gg' }]);
  });

  it('passes incoming reactions to listeners as events, only while in a room', () => {
    const h = harness();
    h.client.start();
    h.sock().open();
    const fn = vi.fn();
    const off = h.client.onReaction(fn);
    h.sock().receive({ t: 'reaction', seatId: 's2', seat: null, reaction: 'wow' });
    expect(fn).not.toHaveBeenCalled();
    h.sock().receive({ t: 'joined', code: 'WAND-42', seatId: 's1', token: 't' });
    h.sock().receive({ t: 'reaction', seatId: 's2', seat: 1, reaction: 'wow' });
    expect(fn).toHaveBeenCalledWith({ seatId: 's2', seat: 1, reaction: 'wow' });
    off();
    h.sock().receive({ t: 'reaction', seatId: 's2', seat: 1, reaction: 'fire' });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('reactions in the lobby', () => {
  it('picks a reaction from the picker and sends it', () => {
    const h = inLobby();
    fireEvent.click(screen.getByRole('button', { name: 'React' }));
    expect(screen.getAllByRole('dialog', { name: 'React' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Good move!' }));
    expect(h.sock().sent).toEqual([{ t: 'react', reaction: 'goodMove' }]);
    expect(screen.queryByRole('dialog', { name: 'React' })).toBeNull();
  });

  it('shows a bubble next to the sender for a few seconds, with a soft cue for others', () => {
    const sound = spyBoard();
    const h = inLobby({ sound });
    react(h, 's2', 'clap');
    expect(screen.getByRole('status', { name: 'Bob: Applause' }).textContent).toBe('👏');
    expect(sound.play).toHaveBeenCalledWith('reaction');
    act(() => vi.advanceTimersByTime(BUBBLE_MS - 100));
    // A new reaction from the same seat replaces the bubble and restarts its time.
    react(h, 's2', 'hurry');
    expect(screen.queryByRole('status', { name: 'Bob: Applause' })).toBeNull();
    act(() => vi.advanceTimersByTime(BUBBLE_MS - 100));
    expect(screen.getByRole('status', { name: 'Bob: Hurry up!' }).textContent).toBe('Hurry up!');
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByRole('status', { name: /^Bob:/ })).toBeNull();
  });

  it('my own reaction shows without a sound', () => {
    const sound = spyBoard();
    const h = inLobby({ sound });
    react(h, 's1', 'fire');
    expect(screen.getByRole('status', { name: 'Ana: On fire' })).toBeTruthy();
    expect(sound.play).not.toHaveBeenCalledWith('reaction');
  });

  it('Mute reactions hides other players and their sound', () => {
    const storage = memoryStorage();
    storage.setItem('arcane.prefs', JSON.stringify({ muteReactions: true }));
    const sound = spyBoard();
    const h = inLobby({ storage, sound });
    react(h, 's2', 'laugh');
    expect(screen.queryByRole('status', { name: /^Bob:/ })).toBeNull();
    expect(sound.play).not.toHaveBeenCalledWith('reaction');
    react(h, 's1', 'laugh');
    expect(screen.getByRole('status', { name: 'Ana: Ha ha' })).toBeTruthy();
  });
});

describe('reactions in the game', () => {
  it('shows bubbles on neighbours, my panel, and a strip for other seats', () => {
    const h = renderApp();
    act(() => {
      h.sock().receive({ t: 'joined', code: 'WAND-42', seatId: 's1', token: 't' });
      h.sock().receive(gameMsg(makeGame(['Ana', 'Bob', 'Cleo', 'Dan']), 0));
    });
    h.sock().sent.length = 0;
    react(h, 's2', 'wow', 1);
    react(h, 's1', 'gg', 0);
    react(h, 's3', 'think', 2);
    expect(document.querySelector('.neighbor .react-bubble')!.getAttribute('aria-label')).toBe('Bob: Wow');
    expect(document.querySelector('.me > .react-bubble')!.getAttribute('aria-label')).toBe('Ana: Good game!');
    expect(document.querySelector('.react-strip')!.textContent).toBe('Cleo🤔');
    fireEvent.click(screen.getByRole('button', { name: 'React' }));
    fireEvent.click(screen.getByRole('button', { name: 'Applause' }));
    expect(h.sock().sent).toEqual([{ t: 'react', reaction: 'clap' }]);
  });
});

describe('Settings', () => {
  it('has a Mute reactions switch that is saved', () => {
    const storage = memoryStorage();
    renderApp({ storage });
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const box = screen.getByRole('checkbox', { name: 'Mute reactions' }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    expect(JSON.parse(storage.getItem('arcane.prefs')!).muteReactions).toBe(true);
  });
});
