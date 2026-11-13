import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import type { ClientState } from '../net/client';
import { useClientState, usePrefs } from '../ui/context';
import { cuesFor, type Cue } from './cues';
import type { SoundBoard } from './sounds';

const SoundContext = createContext<SoundBoard | null>(null);

/** Connects the sound board to the app: Settings, the first touch, music, and cues from state changes. */
export function SoundProvider(props: { board: SoundBoard; children: ReactNode }) {
  const { board } = props;
  const [prefs] = usePrefs();
  const state = useClientState();
  const prev = useRef<ClientState | null>(null);

  useEffect(() => board.setPrefs({ music: prefs.music, sfx: prefs.sfx, haptics: prefs.haptics }), [board, prefs.music, prefs.sfx, prefs.haptics]);

  useEffect(() => {
    board.music(true);
    const unlock = () => board.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [board]);

  useEffect(() => {
    for (const cue of cuesFor(prev.current, state)) board.play(cue);
    prev.current = state;
  }, [board, state]);

  return <SoundContext.Provider value={board}>{props.children}</SoundContext.Provider>;
}

const silent = () => {};

/** Returns a function that plays a cue; silent without a SoundProvider. */
export function useSound(): (cue: Cue) => void {
  const board = useContext(SoundContext);
  return board ? board.play : silent;
}
