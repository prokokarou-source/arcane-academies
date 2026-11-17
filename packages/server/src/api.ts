/**
 * POST /api/feedback (logged-in players only) and POST /api/event (app opened, and the steps of
 * offline Bots games, which never reach the server otherwise). Games played on the server are
 * counted by the server itself, so the client cannot inflate them.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { FEEDBACK_KINDS, type FeedbackKind, type Insights } from './insights';
import { bearer, BodyError, clientIp, isObject, RateLimit, readJson, sendJson, str } from './http';
import { hashToken } from './passwords';
import type { Store, User } from './store';

export const FEEDBACK_PATH = '/api/feedback';
export const EVENT_PATH = '/api/event';
export const MAX_FEEDBACK_TEXT = 2000;
/** A downscaled JPEG screenshot is ~100-300 kB as a data URL. */
export const MAX_SCREENSHOT_CHARS = 900_000;
const MAX_FEEDBACK_BYTES = MAX_SCREENSHOT_CHARS + 16_384;
/** Feedback per account per hour. */
export const FEEDBACK_PER_HOUR = 5;

export const DEVICE_RE = /^[A-Za-z0-9_-]{16,64}$/;
const GAME_RE = /^[A-Za-z0-9_-]{8,64}$/;
const SCREENSHOT_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
/** Event kinds a client may send; the server records its own games, signups and logins. */
const CLIENT_EVENTS = ['open', 'game_start', 'term2', 'game_finish'] as const;

export interface FeedbackBody {
  kind: FeedbackKind;
  text: string;
  device: string;
  version: string;
  screen: string;
  screenshot: string | null;
}

/** Only known fields with sane sizes; anything else is rejected. */
export function parseFeedback(body: unknown): FeedbackBody | null {
  if (!isObject(body)) return null;
  const allowed = ['kind', 'text', 'device', 'version', 'screen', 'screenshot'];
  if (Object.keys(body).some((k) => !allowed.includes(k))) return null;
  const kind = body.kind as FeedbackKind;
  if (!FEEDBACK_KINDS.includes(kind)) return null;
  const text = str(body.text, MAX_FEEDBACK_TEXT);
  if (!text) return null;
  const device = str(body.device ?? '', 160);
  const version = str(body.version ?? '', 32);
  const screen = str(body.screen ?? '', 60);
  if (device === null || version === null || screen === null) return null;
  let screenshot: string | null = null;
  if (body.screenshot !== undefined && body.screenshot !== null) {
    if (typeof body.screenshot !== 'string' || body.screenshot.length > MAX_SCREENSHOT_CHARS || !SCREENSHOT_RE.test(body.screenshot)) return null;
    screenshot = body.screenshot;
  }
  return { kind, text, device, version, screen, screenshot };
}

export interface ApiOptions {
  store: Store;
  insights: Insights;
  now?: () => number;
}

export class Api {
  private readonly now: () => number;
  private readonly feedbackByUser: RateLimit;
  private readonly feedbackByIp: RateLimit;
  private readonly eventsByIp: RateLimit;

  constructor(private readonly opts: ApiOptions) {
    this.now = opts.now ?? Date.now;
    this.feedbackByUser = new RateLimit(FEEDBACK_PER_HOUR, 60 * 60_000, this.now);
    this.feedbackByIp = new RateLimit(20, 60 * 60_000, this.now);
    this.eventsByIp = new RateLimit(120, 10 * 60_000, this.now);
  }

  /** The account behind a Bearer login token, or null. */
  async userOf(req: IncomingMessage): Promise<User | null> {
    const token = bearer(req);
    return token ? this.opts.store.sessionUser(hashToken(token)) : null;
  }

  /** True when the request was one of these endpoints (answered or being answered). */
  handle(req: IncomingMessage, res: ServerResponse): boolean {
    const path = (req.url ?? '').split('?')[0];
    if (req.method !== 'POST' || (path !== FEEDBACK_PATH && path !== EVENT_PATH)) return false;
    const work = path === FEEDBACK_PATH ? this.feedback(req, res) : this.event(req, res);
    work.catch((e: unknown) => {
      if (e instanceof BodyError) return sendJson(res, e.status);
      console.error(`${path} failed:`, (e as Error).message);
      sendJson(res, 503);
    });
    return true;
  }

  private async feedback(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.feedbackByIp.allow(clientIp(req))) {
      req.resume();
      return sendJson(res, 429, { error: 'too_many' });
    }
    const user = await this.userOf(req);
    if (!user) {
      req.resume();
      return sendJson(res, 401, { error: 'not_logged_in' });
    }
    const body = parseFeedback(await readJson(req, MAX_FEEDBACK_BYTES));
    if (!body) return sendJson(res, 400, { error: 'bad_feedback' });
    if (!this.feedbackByUser.allow(user.id)) return sendJson(res, 429, { error: 'too_many' });
    await this.opts.insights.addFeedback({ ...body, userId: user.id, username: user.username, at: this.now() });
    sendJson(res, 201, { ok: true });
  }

  private async event(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.eventsByIp.allow(clientIp(req))) {
      req.resume();
      return sendJson(res, 429);
    }
    const body = await readJson(req, 1024);
    if (!isObject(body)) return sendJson(res, 400);
    const kind = body.kind as (typeof CLIENT_EVENTS)[number];
    const device = body.device;
    if (!CLIENT_EVENTS.includes(kind) || typeof device !== 'string' || !DEVICE_RE.test(device)) return sendJson(res, 400);
    // Only offline Bots games are reported by the client.
    const game = body.game;
    if (kind !== 'open' && (body.mode !== 'bots' || typeof game !== 'string' || !GAME_RE.test(game))) return sendJson(res, 400);
    const user = await this.userOf(req);
    await this.opts.insights.addEvent({
      kind,
      at: this.now(),
      device,
      userId: user?.id ?? null,
      ...(kind === 'open' ? {} : { mode: 'bots' as const, game: game as string }),
    });
    sendJson(res, 204);
  }
}
