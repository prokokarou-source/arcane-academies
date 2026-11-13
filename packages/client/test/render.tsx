import { render } from '@testing-library/react';
import { PwaProvider, type Pwa } from '../src/pwa/context';
import { App } from '../src/ui/App';
import { ClientProvider } from '../src/ui/context';
import { harness, memoryStorage } from './fakeSocket';

/** Render the whole app over a fake, already open socket. */
export function renderApp(opts: { initialRoom?: string; storage?: ReturnType<typeof memoryStorage>; pwa?: Pwa } = {}) {
  const storage = opts.storage ?? memoryStorage();
  const h = harness(storage);
  h.client.start();
  h.sock().open();
  const app = (
    <ClientProvider client={h.client} storage={storage}>
      <App initialRoom={opts.initialRoom} />
    </ClientProvider>
  );
  const utils = render(opts.pwa ? <PwaProvider pwa={opts.pwa}>{app}</PwaProvider> : app);
  return { ...h, ...utils };
}
