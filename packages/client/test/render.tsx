import { fireEvent, render, screen, within } from '@testing-library/react';

/** Tap a slot of the bottom bar: 'Leaderboards' | 'Rooms' | 'Play' | 'More'. */
export function goTab(name: 'Leaderboards' | 'Rooms' | 'Play' | 'More') {
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Main menu' })).getByRole('button', { name }));
}

/** Open a row of the More tab, e.g. 'Settings', 'Account settings', 'Friends', 'Privacy'. */
export function openMore(row: string) {
  goTab('More');
  fireEvent.click(screen.getByRole('button', { name: row }));
}
import { SoundProvider } from '../src/audio/context';
import type { Api } from '../src/net/api';
import type { SoundBoard } from '../src/audio/sounds';
import { PwaProvider, type Pwa } from '../src/pwa/context';
import { App } from '../src/ui/App';
import { ClientProvider } from '../src/ui/context';
import { harness, memoryStorage } from './fakeSocket';

/** Render the whole app over a fake, already open socket. */
export function renderApp(opts: { initialRoom?: string; storage?: ReturnType<typeof memoryStorage>; pwa?: Pwa; sound?: SoundBoard; api?: Api } = {}) {
  const storage = opts.storage ?? memoryStorage();
  const h = harness(storage, opts.api ? { api: opts.api } : {});
  h.client.start();
  h.sock().open();
  const app = (
    <ClientProvider client={h.client} storage={storage}>
      {opts.sound ? (
        <SoundProvider board={opts.sound}>
          <App initialRoom={opts.initialRoom} />
        </SoundProvider>
      ) : (
        <App initialRoom={opts.initialRoom} />
      )}
    </ClientProvider>
  );
  const utils = render(opts.pwa ? <PwaProvider pwa={opts.pwa}>{app}</PwaProvider> : app);
  return { ...h, ...utils };
}
