import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CARDS, cardDef, submitAction } from '@arcane/engine';
import { handOptions } from '../src/game/derive';
import { renderApp } from './render';
import { gameMsg, makeGame, type GameMsg } from './views';

afterEach(cleanup);

function inGame(msg: GameMsg) {
  const h = renderApp();
  act(() => {
    h.sock().receive({ t: 'joined', code: 'WAND-42', seatId: 's1', token: 't' });
    h.sock().receive(msg);
  });
  h.sock().sent.length = 0;
  return h;
}

const acts = (h: ReturnType<typeof inGame>) => h.sock().sent.filter((m) => m.t === 'act');

describe('Game screen', () => {
  const s = makeGame(['Ana', 'Bob', 'Cleo']);

  it('shows term, turn and coins', () => {
    inGame(gameMsg(s, 0));
    expect(screen.getByText('Term I')).toBeTruthy();
    expect(screen.getByText('Turn 1/6')).toBeTruthy();
    expect(document.querySelector('.game-head .coins')!.textContent).toContain('3');
  });

  it('renders one card per hand card', () => {
    inGame(gameMsg(s, 0));
    expect(screen.getAllByTestId('card')).toHaveLength(7);
  });

  it('build sends the legal action unchanged', () => {
    const g = gameMsg(s, 0);
    const opts = handOptions(g.view, g.legal);
    const i = opts.findIndex((o) => o.build);
    const h = inGame(g);
    fireEvent.click(screen.getAllByTestId('card')[i]);
    fireEvent.click(screen.getByRole('button', { name: /^Build/ }));
    expect(acts(h)).toEqual([{ t: 'act', action: opts[i].build }]);
  });

  it('sell sends the sell action', () => {
    const g = gameMsg(s, 0);
    const opts = handOptions(g.view, g.legal);
    const h = inGame(g);
    fireEvent.click(screen.getAllByTestId('card')[2]);
    fireEvent.click(screen.getByRole('button', { name: 'Sell +3' }));
    expect(acts(h)).toEqual([{ t: 'act', action: opts[2].sell }]);
  });

  it('sends one act per turn', () => {
    const h = inGame(gameMsg(s, 0));
    fireEvent.click(screen.getAllByTestId('card')[0]);
    const sell = screen.getByRole('button', { name: 'Sell +3' });
    fireEvent.click(sell);
    fireEvent.click(sell);
    expect(acts(h)).toHaveLength(1);
    expect(sell).toHaveProperty('disabled', true);
  });

  it('waiting seat with empty legal shows waiting names and no action bar', () => {
    const g0 = gameMsg(s, 0);
    const after = submitAction(s, 0, g0.legal.find((a) => a.type === 'sell')!);
    inGame(gameMsg(after, 0));
    expect(screen.getByText('Waiting for Bob, Cleo…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sell +3' })).toBeNull();
  });

  it('bonus phase shows the kept card as the hand', () => {
    const g = gameMsg(s, 0);
    const kept = g.view.players[0].hand![0];
    const view = { ...g.view, phase: 'bonus' as const, players: g.view.players.map((p, i) => (i === 0 ? { ...p, hand: [], kept } : p)) };
    inGame({ ...g, view, legal: [{ type: 'sell', cardUid: kept.uid }] });
    expect(screen.getAllByTestId('card')).toHaveLength(1);
    expect(screen.getByText('Bonus turn: play your kept card.')).toBeTruthy();
  });

  it('bonus phase without a kept card just waits', () => {
    const g = gameMsg(s, 1);
    inGame({ ...g, view: { ...g.view, phase: 'bonus' }, legal: [] });
    expect(screen.getByText('Waiting for the bonus turn…')).toBeTruthy();
  });

  it('tapping a neighbor opens their panel', () => {
    inGame(gameMsg(s, 0));
    fireEvent.click(screen.getByRole('button', { name: /Cleo/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Cleo')).toBeTruthy();
    expect(within(dialog).getByText('Duel power')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the next tower level cost in my area', () => {
    inGame(gameMsg(s, 0));
    const row = screen.getByText('Next level:').closest('.glyphs') as HTMLElement;
    expect(within(row).getAllByRole('img', { name: 'Moonstone' })).toHaveLength(2);
  });

  it('my panel lists all three tower levels with cost and reward', () => {
    inGame(gameMsg(s, 0));
    fireEvent.click(screen.getByText('Next level:'));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Level 1')).toBeTruthy();
    expect(within(dialog).getByText('Level 2')).toBeTruthy();
    expect(within(dialog).getByText('Level 3')).toBeTruthy();
    const levels = dialog.querySelectorAll('.levels li');
    expect(within(levels[0] as HTMLElement).getAllByRole('img', { name: 'Moonstone' })).toHaveLength(2);
    expect(within(levels[1] as HTMLElement).getAllByRole('img', { name: 'Herbs' })).toHaveLength(2);
    expect(within(levels[1] as HTMLElement).getAllByRole('img', { name: 'Essence' })).toHaveLength(1);
    expect(levels[0].textContent).toContain('+3');
    expect(levels[2].textContent).toContain('+7');
    expect(within(dialog).getByText('Each duel you win gives +1 extra Renown.')).toBeTruthy();
  });

  it('the info button explains a card without selecting it', () => {
    const g = gameMsg(s, 0);
    const h = inGame(g);
    const name = cardDef(g.view.players[0].hand![0].defId).name;
    fireEvent.click(screen.getByRole('button', { name: 'About ' + name }));
    const dialog = screen.getByRole('dialog', { name });
    expect(within(dialog).getByText(/Free to build.|Cost: /)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(h.sock().sent).toEqual([]);
    expect(screen.getAllByTestId('card')[0].getAttribute('aria-pressed')).toBe('false');
  });

  it('Tower works with a card that cannot be built when the tower level is affordable', () => {
    // Find a real position: a hand card with no build action but a tower action.
    let found: { g: GameMsg; uid: string } | null = null;
    for (let seed = 1; seed < 200 && !found; seed++) {
      let st = makeGame(['Ana', 'Bob', 'Cleo'], seed);
      // Seat 0 (Pyromancy, tower level 1 = 2 Moonstone) owns two Moonstone cards and has no coins.
      const moonCard = CARDS.find((c) => c.family === 'basic' && c.effects.some((e) => e.kind === 'produce' && e.options.length === 1 && e.options[0] === 'moonstone'))!;
      st = { ...st, players: st.players.map((p, i) => (i === 0 ? { ...p, coins: 0, built: [{ uid: 'x-m1', defId: moonCard.id }, { uid: 'x-m2', defId: moonCard.id }] } : p)) };
      for (const seat of [0]) {
        const g = gameMsg(st, seat);
        const opt = handOptions(g.view, g.legal).find((o) => !o.build && o.tower);
        if (opt) {
          found = { g, uid: opt.cardUid };
          break;
        }
      }
    }
    expect(found).not.toBeNull();
    const { g, uid } = found!;
    const h = inGame(g);
    const card = screen.getAllByTestId('card').find((c) => c.getAttribute('data-uid') === uid)!;
    expect(card.textContent).toContain("Can't build");
    fireEvent.click(card);
    expect(screen.getByRole('button', { name: /^Build/ })).toHaveProperty('disabled', true);
    const tower = screen.getByRole('button', { name: 'Tower' });
    expect(tower).toHaveProperty('disabled', false);
    fireEvent.click(tower);
    expect(acts(h)).toEqual([{ t: 'act', action: g.legal.find((a) => a.type === 'tower' && a.cardUid === uid) }]);
  });

  it('shows the deadline countdown', () => {
    inGame(gameMsg(s, 0, { deadline: Date.now() + 30_000 }));
    expect(screen.getByText(/^(29|30) s left$/)).toBeTruthy();
  });

  it('uses view.me', () => {
    const two = makeGame(['Ana', 'Bob']);
    const g = gameMsg(two, 2);
    inGame(g);
    const names = screen.getAllByTestId('card').map((c) => c.getAttribute('data-uid'));
    expect(names).toEqual(g.view.players[2].hand!.map((c) => c.uid));
    expect(screen.getByRole('button', { name: /Rival Archmage/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Ana/ })).toBeTruthy();
  });
});
