import { render } from '@testing-library/react';
import { App } from '../src/ui/App';
import { ClientProvider } from '../src/ui/context';
import { harness, memoryStorage } from './fakeSocket';

/** Render the whole app over a fake, already open socket. */
export function renderApp(opts: { initialRoom?: string; storage?: ReturnType<typeof memoryStorage> } = {}) {
  const storage = opts.storage ?? memoryStorage();
  const h = harness(storage);
  h.client.start();
  h.sock().open();
  const utils = render(
    <ClientProvider client={h.client} storage={storage}>
      <App initialRoom={opts.initialRoom} />
    </ClientProvider>,
  );
  return { ...h, ...utils };
}
