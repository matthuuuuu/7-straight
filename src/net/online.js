// Talking to the server for online rooms. The server is the referee; this
// just sends your moves and checks for everyone else's about once a second.

import { saveRoomCreds, forgetRoom } from './storage.js';

const EVENT_BUFFER = 150;

async function request(body, timeoutMs = 9000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch('/api/room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    let data;
    try {
      data = await res.json();
    } catch {
      // Not our server talking (a Wi-Fi login page, an error page...).
      return { status: 0, data: { error: 'The server sent a garbled reply. Check your connection.' } };
    }
    return { status: res.status, data: data || {} };
  } catch {
    return { status: 0, data: { error: 'Can’t reach the server. Check your connection.' } };
  } finally {
    clearTimeout(timer);
  }
}

export async function createOnlineRoom(profile, target) {
  const { status, data } = await request({ op: 'create', ...profile, target });
  if (status !== 200 || !data.view) return { error: data.error || 'Couldn’t make a room. Try again.' };
  saveRoomCreds(data.code, data.you);
  return { room: new OnlineRoom(data.code, data.you, data.view) };
}

export async function joinOnlineRoom(code, profile, creds) {
  const { status, data } = await request({ op: 'join', code, ...profile, token: creds?.token });
  if (status !== 200 || !data.view) {
    if (status === 404 || status === 403) forgetRoom(code);
    return { error: data.error || 'Couldn’t join. Try again.', status };
  }
  if (data.you) saveRoomCreds(code, data.you);
  return { room: new OnlineRoom(code, data.you, data.view, data.notice) };
}

// How often to check for news, by situation (ms).
const FAST = 1000; // a round is being played
const CALM = 1600; // lobby, round results, game over
const IDLE = [
  [2 * 60e3, 5000], // nothing new for 2 minutes: every 5 s
  [10 * 60e3, 15000], // 10 minutes: every 15 s
];
const HIDDEN = 5000; // tab in the background
const HIDDEN_LONG = 45000; // ...for more than 2 minutes (you'll show as away)

export class OnlineRoom {
  constructor(code, creds, view, notice = null) {
    this.mode = 'online';
    this.code = code;
    this.creds = creds || null;
    this.listeners = new Set();
    this.events = [];
    this.seq = 0;
    this.v = 0;
    this.failures = 0;
    this.closed = false;
    this.timer = null;
    this.skew = 0;
    this.lastNews = Date.now();
    this.hiddenSince = document.hidden ? Date.now() : null;
    this.snap = { mode: 'online', status: 'live', error: null, notice, view: null, controllable: [], isHost: false };
    if (view) this.ingest(view);
    this.onVisible = () => {
      this.hiddenSince = document.hidden ? Date.now() : null;
      if (!document.hidden) this.wake();
    };
    // Touching the screen after a quiet spell checks for news right away.
    this.onActivity = () => {
      const slow = Date.now() - this.lastNews > IDLE[0][0];
      this.lastNews = Date.now();
      if (slow) this.pollSoon(0);
    };
    document.addEventListener('visibilitychange', this.onVisible);
    window.addEventListener('pointerdown', this.onActivity);
    window.addEventListener('keydown', this.onActivity);
    this.pollSoon(900);
  }

  subscribe = (fn) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = () => this.snap;

  update(patch) {
    this.snap = { ...this.snap, ...patch };
    for (const fn of this.listeners) fn();
  }

  /** Server clock, corrected for this device's clock being off. */
  serverNow() {
    return Date.now() + this.skew;
  }

  ingest(view) {
    // A slow reply can arrive after a newer one; never go backwards.
    if (!view || view.v < this.v) return;
    const fresh = view.game.events.filter((e) => e.seq > this.seq);
    if (fresh.length || view.v !== this.v) this.lastNews = Date.now();
    this.events = [...this.events, ...fresh].slice(-EVENT_BUFFER);
    this.seq = Math.max(this.seq, view.game.seq);
    this.v = view.v;
    this.skew = view.now - Date.now();
    let notice = this.snap.notice;
    if (this.creds && !view.youId && !this.leaving) {
      // Our seat is gone (removed by the host, or left from another tab).
      forgetRoom(this.code);
      this.creds = null;
      notice = 'You no longer have a seat in this room, so you’re watching.';
    }
    const full = { ...view, game: { ...view.game, events: this.events } };
    this.update({
      status: 'live',
      error: null,
      notice,
      view: full,
      controllable: view.you >= 0 ? [view.you] : [],
      isHost: !!view.youId && view.hostId === view.youId,
    });
  }

  pollSoon(ms) {
    clearTimeout(this.timer);
    if (this.closed) return;
    this.timer = setTimeout(() => this.poll(), ms);
  }

  wake() {
    this.lastNews = Date.now();
    this.pollSoon(0);
  }

  nextDelay() {
    if (this.failures) return Math.min(1000 * 2 ** this.failures, 8000);
    if (document.hidden) {
      const hiddenFor = Date.now() - (this.hiddenSince ?? Date.now());
      return hiddenFor > 2 * 60e3 ? HIDDEN_LONG : HIDDEN;
    }
    const phase = this.snap.view?.game.phase;
    if (phase === 'playing') return FAST;
    const quiet = Date.now() - this.lastNews;
    let ms = CALM;
    for (const [after, every] of IDLE) if (quiet > after) ms = every;
    return ms;
  }

  async poll() {
    if (this.closed) return;
    let gone = false;
    try {
      const { status, data } = await request({
        op: 'poll', code: this.code, token: this.creds?.token, v: this.v, since: this.seq,
      });
      if (this.closed) return;
      if (status === 200 && (data.same || data.view)) {
        this.failures = 0;
        if (data.same) {
          this.skew = data.now - Date.now();
          const away = data.away || [];
          const prev = this.snap.view;
          if (prev && (prev.away.join() !== away.join() || this.snap.status !== 'live')) {
            this.update({ status: 'live', error: null, view: { ...prev, away } });
          }
        } else {
          this.ingest(data.view);
        }
      } else if (status === 404 || status === 403) {
        forgetRoom(this.code);
        this.update({ status: 'gone', error: data.error });
        gone = true;
      } else {
        this.failures += 1;
        if (this.failures >= 2) this.update({ status: 'reconnecting', error: data.error });
      }
    } catch {
      this.failures += 1;
    } finally {
      if (!gone && !this.closed) this.pollSoon(this.nextDelay());
    }
  }

  /** Send a move. Resolves to an error message, or null if it worked. */
  async send(action) {
    if (!this.creds) return action.type === 'leave' ? null : 'You’re watching this game.';
    if (action.type === 'leave') this.leaving = true;
    const { status, data } = await request({
      op: 'act', code: this.code, token: this.creds.token, action, since: this.seq,
    });
    if (status !== 200 || !data.view) {
      this.leaving = false;
      return data.error || 'That didn’t work. Try again.';
    }
    this.lastNews = Date.now();
    this.ingest(data.view);
    if (action.type === 'leave') this.close();
    return null;
  }

  /** Watching, but the next game hasn't started: sit down at the table. */
  async takeSeat(profile) {
    const { status, data } = await request({ op: 'join', code: this.code, ...profile, since: this.seq });
    if (status !== 200 || !data.view) return data.error || 'That didn’t work. Try again.';
    if (!data.you) return data.notice || 'The game has already started.';
    this.creds = data.you;
    saveRoomCreds(this.code, data.you);
    this.update({ notice: null });
    this.ingest(data.view);
    return null;
  }

  close() {
    this.closed = true;
    clearTimeout(this.timer);
    document.removeEventListener('visibilitychange', this.onVisible);
    window.removeEventListener('pointerdown', this.onActivity);
    window.removeEventListener('keydown', this.onActivity);
  }
}
