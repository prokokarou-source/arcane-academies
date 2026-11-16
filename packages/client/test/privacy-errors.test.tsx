import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createReporter, installErrorReporting, reportUrl, scrub } from '../src/net/errors';
import { ErrorBoundary } from '../src/ui/ErrorBoundary';
import { ISSUES_URL } from '../src/ui/Privacy';
import { renderApp } from './render';

afterEach(cleanup);

describe('Privacy screen', () => {
  it('opens from the Home footer and goes back', () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Privacy' }));
    expect(screen.getByRole('heading', { name: 'Privacy' })).toBeTruthy();
    expect(screen.getByText(/No email address/)).toBeTruthy();
    expect(screen.getByText(/Neon/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'GitHub issues' }).getAttribute('href')).toBe(ISSUES_URL);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('button', { name: 'Create game' })).toBeTruthy();
  });

  it('is linked from the sign-up screen', () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Log in or create an account' }));
    expect(screen.queryByRole('button', { name: 'Privacy' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'New here? Create an account' }));
    fireEvent.click(screen.getByRole('button', { name: 'Privacy' }));
    expect(screen.getByRole('heading', { name: 'Privacy' })).toBeTruthy();
  });
});

function Boom(): never {
  throw new Error('render exploded');
}

describe('ErrorBoundary', () => {
  it('shows a friendly screen with Reload and reports the error', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onError = vi.fn();
    const onReload = vi.fn();
    render(
      <ErrorBoundary onError={onError} onReload={onReload}>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(onReload).toHaveBeenCalled();
    expect((onError.mock.calls[0]![0] as Error).message).toBe('render exploded');
    quiet.mockRestore();
  });

  it('renders children when nothing fails', () => {
    render(
      <ErrorBoundary>
        <p>fine</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('fine')).toBeTruthy();
  });
});

describe('error reporter', () => {
  const setup = (max?: number) => {
    const send = vi.fn();
    const report = createReporter({ url: 'http://x/api/client-error', version: '0.1.0', page: () => '/?room=WAND-42', send, ...(max ? { max } : {}) });
    return { send, report, body: (i = 0) => JSON.parse(send.mock.calls[i]![1] as string) };
  };

  it('sends message, trimmed stack, version and page without query strings', () => {
    const { send, report, body } = setup();
    const e = new Error('bad thing');
    e.stack = 'Error: bad thing\n at f (http://h/assets/app.js?v=1:1:2)\n' + 'x'.repeat(5000);
    report(e);
    expect(send).toHaveBeenCalledTimes(1);
    const b = body();
    expect(Object.keys(b).sort()).toEqual(['message', 'page', 'stack', 'version']);
    expect(b).toMatchObject({ message: 'bad thing', version: '0.1.0', page: '/' });
    expect(b.stack.length).toBeLessThanOrEqual(1500);
    expect(b.stack).not.toContain('?v=1');
  });

  it('skips duplicates and stops after the per-page limit', () => {
    const { send, report } = setup(2);
    report(new Error('a'));
    report(new Error('a'));
    report(new Error('b'));
    report(new Error('c'));
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('hooks uncaught errors and unhandled rejections', () => {
    const listeners: Record<string, (ev: unknown) => void> = {};
    const report = vi.fn();
    installErrorReporting({ addEventListener: ((t: string, fn: (ev: unknown) => void) => (listeners[t] = fn)) as never }, report);
    listeners.error!({ error: new Error('x') });
    listeners.unhandledrejection!({ reason: 'y' });
    expect(report.mock.calls.map((c) => c[0])).toEqual([new Error('x'), 'y']);
  });

  it('derives the endpoint and scrubs text', () => {
    expect(reportUrl('wss://arcane.onrender.com')).toBe('https://arcane.onrender.com/api/client-error');
    expect(reportUrl('ws://localhost:8787')).toBe('http://localhost:8787/api/client-error');
    expect(scrub('/x?token=abc#frag tail', 100)).toBe('/x tail');
  });
});
