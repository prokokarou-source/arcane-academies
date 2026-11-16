import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { REACTIONS, type ReactionId, type SeatId } from '@arcane/protocol';
import { useSound } from '../audio/context';
import type { Reaction } from '../net/client';
import { useClient, useClientState, usePrefs, useT, type T } from './context';

/** How long a bubble stays up. */
export const BUBBLE_MS = 3000;

const EMOJI: Partial<Record<ReactionId, string>> = { clap: '👏', wow: '😮', laugh: '😂', fire: '🔥', think: '🤔' };

/** What a reaction shows: its emoji, or its short phrase. */
export const reactionText = (t: T, id: ReactionId): string => EMOJI[id] ?? t(`react_${id}`);

export interface ShownReaction extends Reaction {
  /** Unique per bubble, so a repeated reaction restarts its fade. */
  n: number;
}

/**
 * The reactions to show right now, one per sender, each for BUBBLE_MS.
 * With Mute reactions on, only my own still show; other players' reactions play a soft cue.
 */
export function useReactions(): Map<SeatId, ShownReaction> {
  const client = useClient();
  const sound = useSound();
  const { seatId } = useClientState();
  const [prefs] = usePrefs();
  const [shown, setShown] = useState<Map<SeatId, ShownReaction>>(() => new Map());
  const live = useRef({ seatId, muted: prefs.muteReactions, sound });
  live.current = { seatId, muted: prefs.muteReactions, sound };

  useEffect(() => {
    let n = 0;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const off = client.onReaction((r) => {
      const mine = r.seatId === live.current.seatId;
      if (!mine && live.current.muted) return;
      if (!mine) live.current.sound('reaction');
      const item = { ...r, n: ++n };
      setShown((m) => new Map(m).set(r.seatId, item));
      const id = setTimeout(() => {
        timers.delete(id);
        setShown((m) => {
          if (m.get(r.seatId)?.n !== item.n) return m;
          const next = new Map(m);
          next.delete(r.seatId);
          return next;
        });
      }, BUBBLE_MS);
      timers.add(id);
    });
    return () => {
      off();
      timers.forEach(clearTimeout);
    };
  }, [client]);

  return shown;
}

/** A brief bubble next to a player's name. */
export function ReactionBubble(props: { reaction?: ShownReaction; name?: string }) {
  const t = useT();
  const r = props.reaction;
  if (!r) return null;
  const label = t(`react_${r.reaction}`);
  return (
    <span key={r.n} className={`react-bubble${EMOJI[r.reaction] ? ' emoji' : ''}`} role="status" aria-label={props.name ? `${props.name}: ${label}` : label}>
      {reactionText(t, r.reaction)}
    </span>
  );
}

/** A compact button that opens the fixed set of reactions. The picker is portalled: seat cards blur their backdrop, which would trap a fixed sheet. */
export function ReactionButton() {
  const client = useClient();
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="link small react-btn" aria-label={t('react')} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        😊
      </button>
      {open &&
        createPortal(
        <div className="sheet-backdrop" onClick={() => setOpen(false)}>
          <section className="sheet react-sheet" role="dialog" aria-label={t('react')} onClick={(e) => e.stopPropagation()}>
            <div className="react-grid">
              {REACTIONS.map((id) => (
                <button
                  key={id}
                  className={EMOJI[id] ? 'emoji' : 'phrase'}
                  aria-label={t(`react_${id}`)}
                  onClick={() => {
                    client.react(id);
                    setOpen(false);
                  }}
                >
                  {reactionText(t, id)}
                </button>
              ))}
            </div>
            <button className="link" onClick={() => setOpen(false)}>
              {t('close')}
            </button>
          </section>
        </div>,
          document.body,
        )}
    </>
  );
}
