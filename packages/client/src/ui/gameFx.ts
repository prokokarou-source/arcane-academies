import { useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
import type { PlayerView } from '@arcane/engine';
import { passDirection } from '../game/derive';
import { usePrefs } from './context';

/** Motion is on unless the Animations setting or the system's reduced-motion asks otherwise. */
export function useMotion(): boolean {
  const [prefs] = usePrefs();
  const reduce = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return prefs.animations && !reduce;
}

/** Short one-off effects for what changed between two views. `id` changes each time, to restart CSS animations. */
export interface GameFx {
  id: number;
  /** Uids of cards that just appeared in someone's built area. */
  fresh: ReadonlySet<string>;
  towerUp: boolean;
  coinGain: number;
  /** The side the new hand slides in from, or null when no new hand arrived. */
  handFrom: 'left' | 'right' | null;
  termChanged: boolean;
}

const NONE: GameFx = { id: 0, fresh: new Set(), towerUp: false, coinGain: 0, handFrom: null, termChanged: false };

/** Where (centre, in viewport pixels) the card I chose to build was, so it can fly from there to my built row. */
export type Launch = { uid: string; x: number; y: number } | null;

let seq = 0;

export function useGameFx(view: PlayerView | undefined, motion: boolean, launch: MutableRefObject<Launch>): GameFx {
  const prev = useRef<PlayerView | null>(null);
  const [fx, setFx] = useState<GameFx>(NONE);
  useLayoutEffect(() => {
    if (!view || prev.current === view) return;
    const before = prev.current;
    prev.current = view;
    const flight = launch.current;
    launch.current = null;
    if (!before || !motion || before.players.length !== view.players.length || before.me !== view.me) {
      setFx(NONE);
      return;
    }
    const me = view.players[view.me];
    const was = before.players[view.me];
    const fresh = new Set<string>();
    for (const p of view.players) {
      const old = new Set(before.players[p.seat].built.map((c) => c.uid));
      for (const c of p.built) if (!old.has(c.uid) && !(p.seat === view.me && flight?.uid === c.uid)) fresh.add(c.uid);
    }
    const newHand = view.phase === 'picking' && (view.term !== before.term || view.turn !== before.turn);
    const next: GameFx = {
      id: ++seq,
      fresh,
      towerUp: me.towerStages > was.towerStages,
      coinGain: Math.max(0, me.coins - was.coins),
      handFrom: newHand ? (passDirection(view).side === 'left' ? 'right' : 'left') : null,
      termChanged: view.term !== before.term,
    };
    const changed = fresh.size > 0 || next.towerUp || next.coinGain > 0 || next.handFrom !== null || next.termChanged;
    setFx(changed ? next : NONE);
    if (flight) flyBuilt(flight);
  }, [view, motion, launch]);
  return fx;
}

/** Fly my just-built card from where it was in the hand into the "Built N" tally of my academy panel (CSS does the motion). */
function flyBuilt(from: NonNullable<Launch>): void {
  const el = document.querySelector<HTMLElement>('.me [data-fly-target]');
  if (!el) return;
  const r = el.getBoundingClientRect();
  el.style.setProperty('--fly-x', `${Math.round(from.x - (r.left + r.width / 2))}px`);
  el.style.setProperty('--fly-y', `${Math.round(from.y - (r.top + r.height / 2))}px`);
  el.classList.add('fly');
  el.addEventListener('animationend', () => el.classList.remove('fly'), { once: true });
}
