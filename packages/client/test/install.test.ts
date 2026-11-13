import { describe, expect, it, vi } from 'vitest';
import { createConnectivity, createInstall, createUpdate, isIos } from '../src/pwa/install';
import { fakeEnv, installPrompt } from './fakePwa';
import { memoryStorage } from './fakeSocket';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';

describe('isIos', () => {
  it('knows iPhones and iPads that pretend to be Macs', () => {
    expect(isIos({ userAgent: IPHONE })).toBe(true);
    expect(isIos({ userAgent: IPAD_DESKTOP_UA, maxTouchPoints: 5 })).toBe(true);
    expect(isIos({ userAgent: IPAD_DESKTOP_UA, maxTouchPoints: 0 })).toBe(false);
    expect(isIos({ userAgent: ANDROID })).toBe(false);
  });
});

describe('install controller', () => {
  it('offers Install after the browser fires beforeinstallprompt, and prompts on install()', async () => {
    const env = fakeEnv({ userAgent: ANDROID });
    const ctl = createInstall(env, memoryStorage());
    expect(ctl.getState()).toEqual({ canInstall: false, iosHint: false });
    const listener = vi.fn();
    ctl.subscribe(listener);
    const e = installPrompt('accepted');
    env.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(ctl.getState().canInstall).toBe(true);
    expect(listener).toHaveBeenCalled();
    await ctl.install();
    expect(e.prompt).toHaveBeenCalledOnce();
    expect(ctl.getState().canInstall).toBe(false);
  });

  it('hides Install once the app is installed', () => {
    const env = fakeEnv({ userAgent: ANDROID });
    const ctl = createInstall(env, memoryStorage());
    env.dispatchEvent(installPrompt('accepted'));
    env.dispatchEvent(new Event('appinstalled'));
    expect(ctl.getState().canInstall).toBe(false);
  });

  it('offers nothing when already running as an installed app', () => {
    const android = fakeEnv({ userAgent: ANDROID, standaloneMedia: true });
    const ctl = createInstall(android, memoryStorage());
    android.dispatchEvent(installPrompt('accepted'));
    expect(ctl.getState()).toEqual({ canInstall: false, iosHint: false });
    const iphone = fakeEnv({ userAgent: IPHONE, navigatorStandalone: true });
    expect(createInstall(iphone, memoryStorage()).getState().iosHint).toBe(false);
  });

  it('shows the iOS hint once, until it is dismissed', () => {
    const storage = memoryStorage();
    const ctl = createInstall(fakeEnv({ userAgent: IPHONE }), storage);
    expect(ctl.getState().iosHint).toBe(true);
    ctl.dismissIosHint();
    expect(ctl.getState().iosHint).toBe(false);
    expect(createInstall(fakeEnv({ userAgent: IPHONE }), storage).getState().iosHint).toBe(false);
  });

  it('dispose stops listening', () => {
    const env = fakeEnv({ userAgent: ANDROID });
    const ctl = createInstall(env, memoryStorage());
    ctl.dispose();
    env.dispatchEvent(installPrompt('accepted'));
    expect(ctl.getState().canInstall).toBe(false);
  });
});

describe('update and connectivity', () => {
  it('update becomes ready and apply runs the given reload', () => {
    const upd = createUpdate();
    expect(upd.getState()).toBe(false);
    const reload = vi.fn();
    upd.ready(reload);
    expect(upd.getState()).toBe(true);
    upd.apply();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('connectivity follows online and offline events', () => {
    const env = fakeEnv({ userAgent: ANDROID, onLine: true });
    const net = createConnectivity(env);
    expect(net.getState()).toBe(true);
    env.navigator.onLine = false;
    env.dispatchEvent(new Event('offline'));
    expect(net.getState()).toBe(false);
    env.navigator.onLine = true;
    env.dispatchEvent(new Event('online'));
    expect(net.getState()).toBe(true);
  });
});
