/**
 * Crash reports to our own server (POST /api/client-error), so problems show up in the server log
 * without a third-party service. A report holds the error text, a trimmed stack, the app version and
 * the page path: no names, no tokens, no query strings.
 */

export interface ErrorReport {
  message: string;
  stack?: string;
  version: string;
  page: string;
}

/** The report endpoint, next to the server's WebSocket address. */
export function reportUrl(serverUrl: string): string {
  const u = new URL(serverUrl);
  u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:';
  u.pathname = '/api/client-error';
  u.search = '';
  return u.toString();
}

/** Drops query strings and fragments (they could carry a room code) and keeps the text short. */
export function scrub(text: string, max: number): string {
  return text.replace(/[?#][^\s)'"]*/g, '').slice(0, max);
}

export interface ReporterOptions {
  url: string;
  version: string;
  page: () => string;
  send: (url: string, body: string) => void;
  /** Reports sent per page load at most; a crash loop must not flood the server. */
  max?: number;
}

export function createReporter(opts: ReporterOptions) {
  const seen = new Set<string>();
  let sent = 0;
  return (err: unknown): void => {
    try {
      const e = err instanceof Error ? err : new Error(typeof err === 'string' ? err : 'Non-error thrown');
      const message = scrub(e.message || e.name || 'Error', 500);
      if (seen.has(message) || sent >= (opts.max ?? 5)) return;
      seen.add(message);
      sent++;
      const report: ErrorReport = { message, version: opts.version.slice(0, 32), page: scrub(opts.page(), 200) || '/' };
      if (e.stack) report.stack = scrub(e.stack, 1500);
      opts.send(opts.url, JSON.stringify(report));
    } catch {
      // Reporting must never cause another error.
    }
  };
}

/** Listens for uncaught errors and unhandled promise rejections on the page. */
export function installErrorReporting(win: Pick<Window, 'addEventListener'>, report: (err: unknown) => void): void {
  win.addEventListener('error', (ev) => report((ev as ErrorEvent).error ?? (ev as ErrorEvent).message));
  win.addEventListener('unhandledrejection', (ev) => report((ev as PromiseRejectionEvent).reason));
}

/** Sends with keepalive so a report still goes out while the page reloads. */
export function beaconSend(url: string, body: string): void {
  void fetch(url, { method: 'POST', body, keepalive: true, headers: { 'content-type': 'application/json' } }).catch(() => {});
}
