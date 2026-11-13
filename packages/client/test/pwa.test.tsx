import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConnectivity, createInstall, createUpdate } from '../src/pwa/install';
import { fakeEnv, installPrompt } from './fakePwa';
import { memoryStorage } from './fakeSocket';
import { renderApp } from './render';

afterEach(cleanup);

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/126.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) Version/17.4 Mobile/15E148 Safari/604.1';

function pwaFor(env: ReturnType<typeof fakeEnv>) {
  return { install: createInstall(env, memoryStorage()), update: createUpdate(), online: createConnectivity(env) };
}

describe('installing the app', () => {
  it('Home shows Install app on Android once the browser allows it', async () => {
    const env = fakeEnv({ userAgent: ANDROID });
    const pwa = pwaFor(env);
    renderApp({ pwa });
    expect(screen.queryByRole('button', { name: 'Install app' })).toBeNull();
    const e = installPrompt('accepted');
    act(() => {
      env.dispatchEvent(e);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Install app' }));
    });
    expect(e.prompt).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Install app' })).toBeNull();
  });

  it('Home shows the Add to Home Screen hint on iOS until dismissed', () => {
    renderApp({ pwa: pwaFor(fakeEnv({ userAgent: IPHONE })) });
    expect(screen.getByText(/Add to Home Screen/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.queryByText(/Add to Home Screen/)).toBeNull();
  });

  it('nothing is offered inside the installed app', () => {
    const env = fakeEnv({ userAgent: IPHONE, navigatorStandalone: true });
    renderApp({ pwa: pwaFor(env) });
    act(() => {
      env.dispatchEvent(installPrompt('accepted'));
    });
    expect(screen.queryByText(/Add to Home Screen/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Install app' })).toBeNull();
  });
});

describe('updates and offline', () => {
  it('offers a reload when a new version is ready', () => {
    const pwa = pwaFor(fakeEnv({ userAgent: ANDROID }));
    renderApp({ pwa });
    const reload = vi.fn();
    act(() => pwa.update.ready(reload));
    expect(screen.getByText('A new version is ready.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalledOnce();
  });

  it("says you're offline instead of Reconnecting", () => {
    const env = fakeEnv({ userAgent: ANDROID });
    const h = renderApp({ pwa: pwaFor(env) });
    act(() => {
      env.navigator.onLine = false;
      env.dispatchEvent(new Event('offline'));
      h.sock().serverClose(1006);
    });
    expect(screen.getByText("You're offline. Check your connection to keep playing.")).toBeTruthy();
    expect(screen.queryByText('Reconnecting…')).toBeNull();
  });
});
