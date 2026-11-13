import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { loadPrefs } from '../src/ui/prefs';
import { memoryStorage } from './fakeSocket';
import { renderApp } from './render';

afterEach(cleanup);

const stored = (v: object) => {
  const s = memoryStorage();
  s.setItem('arcane.prefs', JSON.stringify(v));
  return s;
};

describe('sound preferences', () => {
  it('music and sound effects are on by default', () => {
    expect(loadPrefs(memoryStorage())).toMatchObject({ music: true, sfx: true, haptics: true });
  });

  it('an old "sound off" turns both music and effects off', () => {
    expect(loadPrefs(stored({ sound: false }))).toMatchObject({ music: false, sfx: false });
  });

  it('music off keeps effects on', () => {
    expect(loadPrefs(stored({ music: false }))).toMatchObject({ music: false, sfx: true });
  });

  it('Settings has separate Music and Sound effects switches', () => {
    const storage = memoryStorage();
    renderApp({ storage });
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByLabelText('Music'));
    expect(JSON.parse(storage.data.get('arcane.prefs')!)).toMatchObject({ music: false, sfx: true });
    fireEvent.click(screen.getByLabelText('Sound effects'));
    expect(JSON.parse(storage.data.get('arcane.prefs')!)).toMatchObject({ music: false, sfx: false });
  });
});
