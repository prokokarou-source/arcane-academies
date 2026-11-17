import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dealDelays, REVEAL_MS } from '../src/ui/Reveal';
import { renderApp } from './render';
import { gameMsg, makeGame } from './views';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const s = makeGame(['Ana', 'Bob', 'Cleo', 'Dan']);
const reveal = {
  side: 'B' as const,
  academies: [
    { seat: 0, academyId: 'astral' },
    { seat: 1, academyId: 'pyromancy' },
    { seat: 2, academyId: 'shadow' },
    { seat: 3, academyId: 'runeforge' },
  ],
};

/** Join a 4-player game as the given seat, with the draw attached. */
function drawFor(seat = 1) {
  const h = renderApp();
  act(() => {
    h.sock().receive({ t: 'joined', code: 'WAND-42', seatId: 's1', token: 't' });
    h.sock().receive(gameMsg(s, seat, { reveal }));
  });
  return { h, draw: screen.getByRole('dialog', { name: 'The draw' }) };
}

describe('start-of-game draw', () => {
  it('lands the coin on the drawn side and says it under the title', () => {
    const { draw } = drawFor();
    expect(draw.querySelector('.coin')!.getAttribute('data-side')).toBe('B');
    expect(within(draw).getByText('Side B for every academy')).toBeTruthy();
    expect(within(draw).getByText('Tap to begin')).toBeTruthy();
  });

  it('deals every academy, the player’s own card last and marked', () => {
    const { draw } = drawFor(1);
    const cards = within(draw).getAllByRole('listitem');
    expect(cards.map((c) => c.querySelector('.name')!.textContent)).toEqual(['Ana', 'Cleo', 'Dan', 'You']);
    expect(cards.map((c) => c.classList.contains('mine'))).toEqual([false, false, false, true]);
    expect(cards[3].textContent).toContain('Pyromancy Academy');
    // Cards start one after another, in deal order.
    const starts = cards.map((c) => parseFloat(c.style.getPropertyValue('--d')));
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(new Set(starts).size).toBe(4);
  });

  it('ends by itself after REVEAL_MS, or sooner on a tap', () => {
    vi.useFakeTimers();
    const { h } = drawFor();
    act(() => vi.advanceTimersByTime(REVEAL_MS - 100));
    expect(screen.queryByRole('dialog', { name: 'The draw' })).not.toBeNull();
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByRole('dialog', { name: 'The draw' })).toBeNull();
    expect(h.client.getState().reveal).toBeNull();

    cleanup();
    const again = drawFor();
    fireEvent.click(again.draw);
    expect(screen.queryByRole('dialog', { name: 'The draw' })).toBeNull();
  });

  it('fits any table size in the time: the last card starts early enough to finish', () => {
    for (let n = 1; n <= 7; n++) {
      const d = dealDelays(n);
      expect(d).toHaveLength(n);
      // Flip starts 0.3 s after the deal, the own-card pop 0.45 s after that and lasts 0.4 s.
      expect(d[n - 1] + 0.3 + 0.45 + 0.4).toBeLessThanOrEqual(REVEAL_MS / 1000);
    }
  });
});
