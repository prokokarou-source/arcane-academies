import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SoundBoard } from '../src/audio/sounds';
import { handOptions } from '../src/game/derive';
import { renderApp } from './render';
import { gameMsg, makeGame } from './views';

afterEach(cleanup);

function spyBoard() {
  return { unlock: vi.fn(), play: vi.fn(), music: vi.fn(), setPrefs: vi.fn() } satisfies SoundBoard;
}

describe('sounds in the app', () => {
  it('unlocks audio on the first touch, starts the music and follows the Settings', () => {
    const sound = spyBoard();
    renderApp({ sound });
    expect(sound.music).toHaveBeenCalledWith(true);
    expect(sound.setPrefs).toHaveBeenCalledWith(expect.objectContaining({ music: true, sfx: true, haptics: true }));
    fireEvent.pointerDown(document.body);
    expect(sound.unlock).toHaveBeenCalled();
  });

  it('plays turn on a new turn, select on a card and build on Build', () => {
    const sound = spyBoard();
    const h = renderApp({ sound });
    const g = gameMsg(makeGame(['Ana', 'Bob', 'Cleo']), 0);
    act(() => {
      h.sock().receive({ t: 'joined', code: 'WAND-42', seatId: 's1', token: 't' });
      h.sock().receive(g);
    });
    act(() => h.sock().receive({ ...g, view: { ...g.view, turn: 2 } }));
    expect(sound.play).toHaveBeenCalledWith('turn');
    const i = handOptions(g.view, g.legal).findIndex((o) => o.build);
    fireEvent.click(screen.getAllByTestId('card')[i]);
    expect(sound.play).toHaveBeenCalledWith('select');
    fireEvent.click(screen.getByRole('button', { name: /^Build/ }));
    expect(sound.play).toHaveBeenCalledWith('build');
  });
});
