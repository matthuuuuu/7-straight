// Online rooms: the server keeps the one true copy of each game, applies
// everyone's moves in order, and hides the order of the deck.
//
// Every request is a POST with JSON { op, ... }:
//   create { name, avatar, target }       -> { code, you: { id, token }, view }
//   join   { code, name, avatar, token? } -> { you, view }  (token = rejoin)
//   poll   { code, token?, v, since }     -> { same: true, away } | { view }
//   act    { code, token, action, since } -> { view }

import {
  newGame, addPlayer, removePlayer, setTarget, startGame, backToLobby, act, MAX_PLAYERS,
} from '../src/engine/engine.js';
import { tick, AWAY_MS } from '../src/engine/autoplay.js';
import { AVATARS, BOT_NAMES } from '../src/config.js';
import { cleanName, uniqueName } from '../src/names.js';
import { getStore, StoreError } from './store.js';

const CODE_LETTERS = 'BCDFGHJKLMNPQRSTVWXZ'; // no vowels, so codes never spell words
const SEEN_WRITE_MS = 8000; // how often a device's "still here" is saved
const LOBBY_TTL = 60 * 60; // a lobby nobody is looking at disappears after 1 hour
const GAME_TTL = 60 * 60 * 8; // a game nobody is looking at disappears after 8 hours
const CREATE_LIMIT = { max: 30, windowSeconds: 600 }; // new rooms per network per 10 min
const HOST_AWAY_MS = AWAY_MS * 2; // after this, anyone can take over the host's buttons
const SECURE = 'secure'; // shuffle with the crypto random source (see rng.js)

const ok = (json) => ({ status: 200, json });
const fail = (status, error) => ({ status, json: { error } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REMOVED = 'The host removed you from this room.';

function randomString(alphabet, n) {
  const buf = new Uint32Array(n);
  globalThis.crypto.getRandomValues(buf);
  return Array.from(buf, (x) => alphabet[x % alphabet.length]).join('');
}
const randomCode = () => randomString(CODE_LETTERS, 4);
const randomId = () => randomString('abcdefghijklmnopqrstuvwxyz0123456789', 10);
const randomToken = () => randomString('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 24);

function cleanCode(code) {
  const c = String(code || '').toUpperCase().replace(/[^A-Z]/g, '');
  return c.length === 4 ? c : null;
}

function cleanProfile(body, players) {
  const name = cleanName(body.name);
  if (!name) return null;
  const avatar = AVATARS.includes(body.avatar) ? body.avatar : AVATARS[0];
  return { name: uniqueName(name, players), avatar };
}

function botProfile(game) {
  const names = new Set(game.players.map((p) => p.name));
  const faces = new Set(game.players.map((p) => p.avatar));
  const name = BOT_NAMES.find((n) => !names.has(n)) || `Bot ${game.players.length + 1}`;
  const avatar = AVATARS.find((a) => !faces.has(a)) || AVATARS[0];
  return { id: `bot-${randomId()}`, name, avatar, bot: true };
}

/** The player id a token belongs to (only real tokens, never "constructor" etc). */
const seatIdFor = (room, token) =>
  typeof token === 'string' && Object.hasOwn(room.tokens, token) ? room.tokens[token] : null;

const wasKicked = (room, token) => typeof token === 'string' && (room.kicked || []).includes(token);

const lastSeenFn = (room) => (id) => room.seen[id] ?? 0;

const ttlFor = (room) => (room.game.phase === 'lobby' ? LOBBY_TTL : GAME_TTL);

function awayIds(room, now) {
  return room.game.players
    .filter((p) => !p.bot && (p.left || now - (room.seen[p.id] ?? 0) > AWAY_MS))
    .map((p) => p.id);
}

/** The seq of the latest event of one of these types (0 if none). */
function lastEventSeq(game, types) {
  for (let i = game.events.length - 1; i >= 0; i--) if (types.includes(game.events[i].t)) return game.events[i].seq;
  return 0;
}

/** What one device is allowed to see (never the order of the deck). */
function view(room, playerId, now, since = 0) {
  const { deck, rng, events, ...pub } = room.game;
  return {
    code: room.code,
    v: room.v,
    hostId: room.hostId,
    youId: playerId || null,
    you: playerId ? room.game.players.findIndex((p) => p.id === playerId) : -1,
    away: awayIds(room, now),
    now,
    game: { ...pub, deckCount: deck.length, events: events.filter((e) => e.seq > since) },
  };
}

const presentHuman = (room, id) => room.game.players.some((p) => p.id === id && !p.bot && !p.left);

/**
 * Make sure the room has a host who is actually here. If the host left (or
 * was never replaced), hand the role to `preferId` or the first person still
 * seated. Returns true if the host changed.
 */
function healHost(room, preferId) {
  if (presentHuman(room, room.hostId)) return false;
  const next = preferId && presentHuman(room, preferId)
    ? preferId
    : room.game.players.find((p) => !p.bot && !p.left)?.id;
  if (!next || next === room.hostId) return false;
  room.hostId = next;
  room.v += 1;
  return true;
}

/** Forget tokens and "last seen" times of people no longer at the table. */
function tidy(room) {
  const ids = new Set(room.game.players.map((p) => p.id));
  for (const [t, pid] of Object.entries(room.tokens)) if (!ids.has(pid)) delete room.tokens[t];
  for (const pid of Object.keys(room.seen)) if (!ids.has(pid)) delete room.seen[pid];
}

/**
 * Load a room, let `change(room)` edit it, and save it back. If someone else
 * saved first, start over with their version (so no move is ever lost).
 */
async function mutate(store, code, now, since, change) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const room = await store.load(code);
    if (!room) return fail(404, 'Room not found. It may have expired — start a new one.');
    const prevRev = room.rev;
    const out = change(room);
    if (out.error) return fail(out.status || 400, out.error);
    const viewer = out.you?.id ?? out.viewer ?? null;
    if (out.unchanged) return ok({ ...out, view: view(room, viewer, now, since) });
    room.rev = prevRev + 1;
    if (await store.save(code, room, prevRev, ttlFor(room))) {
      return ok({ you: out.you, notice: out.notice, view: view(room, viewer, now, since) });
    }
    await sleep(15 + Math.random() * 60);
  }
  return fail(409, 'The table is busy — try that again.');
}

async function create(store, body, now, meta) {
  const profile = cleanProfile(body);
  if (!profile) return fail(400, 'Type a display name first.');
  if (meta.ip) {
    const n = await store.hit(`create:${meta.ip}`, CREATE_LIMIT.windowSeconds);
    if (n > CREATE_LIMIT.max) return fail(429, 'Lots of new rooms from this network. Wait a few minutes and try again.');
  }
  const target = [100, 200].includes(body.target) ? body.target : 200;
  for (let tries = 0; tries < 10; tries++) {
    const code = randomCode();
    const id = randomId();
    const token = randomToken();
    const game = newGame({ seed: SECURE, target, now });
    addPlayer(game, { id, ...profile });
    const room = { code, rev: 1, v: 1, createdAt: now, hostId: id, tokens: { [token]: id }, seen: { [id]: now }, kicked: [], game };
    if (await store.create(code, room, LOBBY_TTL)) {
      return ok({ code, you: { id, token }, view: view(room, id, now) });
    }
  }
  return fail(503, 'Couldn’t make a room right now. Try again.');
}

function join(room, body, now) {
  const g = room.game;
  if (wasKicked(room, body.token)) return { error: REMOVED, status: 403 };
  const known = seatIdFor(room, body.token);
  const player = known && g.players.find((p) => p.id === known);
  if (player) {
    // Welcome back (same phone, or the page was reloaded).
    room.seen[known] = now;
    if (player.left) {
      player.left = false;
      room.v += 1;
    }
    healHost(room, known);
    return { you: { id: known, token: body.token } };
  }
  if (g.phase !== 'lobby') {
    return { unchanged: true, you: null, notice: 'This game has already started, so you’re watching. You can take a seat when the host starts the next one.' };
  }
  if (g.players.length >= MAX_PLAYERS) return { error: `That table is full (${MAX_PLAYERS} players max).` };
  const profile = cleanProfile(body, g.players);
  if (!profile) return { error: 'Type a display name first.' };
  const id = randomId();
  const token = randomToken();
  const err = addPlayer(g, { id, ...profile });
  if (err) return { error: err };
  room.tokens[token] = id;
  room.seen[id] = now;
  room.v += 1;
  healHost(room, id);
  return { you: { id, token } };
}

function applyAction(room, body, now) {
  const g = room.game;
  if (wasKicked(room, body.token)) return { error: REMOVED, status: 403 };
  const id = seatIdFor(room, body.token);
  if (!id) return { error: 'You’re not seated in this room.', status: 403 };
  room.seen[id] = now;
  healHost(room, id);
  const seat = g.players.findIndex((p) => p.id === id);
  const a = body.action && typeof body.action === 'object' ? body.action : {};
  // What this device had seen when the player tapped (to spot stale taps).
  const since = body.since === undefined ? null : Number(body.since);
  const saw = (types) => since === null || !Number.isFinite(since) || since >= lastEventSeq(g, types);

  const hostOnly = () => {
    if (room.hostId === id) return null;
    // A host whose phone died shouldn't block everyone: after a while,
    // whoever presses a host button becomes the host.
    if (seat >= 0 && now - (room.seen[room.hostId] ?? 0) > HOST_AWAY_MS) {
      room.hostId = id;
      return null;
    }
    return 'Only the host can do that.';
  };
  let error = null;

  switch (a.type) {
    case 'hit':
    case 'stay':
    case 'target':
      if (seat < 0) return { error: 'You’re watching this game.' };
      // The game moved on since this device last looked (autopilot, another
      // tab, a slow network): ignore the tap and send the latest table.
      if (g.phase === 'playing' && g.pending && !saw(['turn', 'choose'])) return { unchanged: true, viewer: id };
      error = act(g, seat, a, now);
      break;
    case 'next':
      if (seat < 0) return { error: 'You’re watching this game.' };
      // Someone else already dealt.
      if (g.phase !== 'roundOver' || !saw(['roundEnd'])) return { unchanged: true, viewer: id };
      error = act(g, seat, a, now);
      break;
    case 'start':
      error = hostOnly() || (g.phase !== 'lobby' ? 'The game already started.' : startGame(g, { seed: SECURE, now }));
      break;
    case 'again':
      error = hostOnly() || (g.phase !== 'gameOver' ? 'The game isn’t over.' : startGame(g, { seed: SECURE, now }));
      break;
    case 'lobby':
      error = hostOnly() || backToLobby(g);
      if (!error) tidy(room);
      break;
    case 'addBot':
      error = hostOnly() || addPlayer(g, botProfile(g));
      break;
    case 'kick': {
      error = hostOnly() || (a.id === id ? 'Use Leave to leave the room.' : removePlayer(g, a.id));
      if (!error) {
        for (const [t, pid] of Object.entries(room.tokens)) {
          if (pid === a.id) room.kicked = [...(room.kicked || []), t].slice(-50);
        }
        tidy(room);
      }
      break;
    }
    case 'setTarget':
      error = hostOnly() || setTarget(g, a.target);
      break;
    case 'leave': {
      if (seat < 0) return { unchanged: true, viewer: null };
      if (g.phase === 'lobby') {
        removePlayer(g, id);
        tidy(room);
      } else {
        g.players[seat].left = true; // autopilot finishes the game for them
      }
      healHost(room);
      break;
    }
    default:
      error = 'Unknown action.';
  }
  if (error) return { error };
  tick(g, now, lastSeenFn(room));
  room.v += 1;
  return { viewer: a.type === 'leave' ? null : id };
}

function poll(room, body, now) {
  if (wasKicked(room, body.token)) return { error: REMOVED, status: 403 };
  const id = seatIdFor(room, body.token);
  let changed = false;
  if (id && now - (room.seen[id] ?? 0) > SEEN_WRITE_MS) {
    room.seen[id] = now;
    changed = true;
  }
  if (healHost(room, id)) changed = true;
  if (tick(room.game, now, lastSeenFn(room))) {
    room.v += 1;
    changed = true;
  }
  if (!changed) return { unchanged: true, viewer: id || null };
  return { viewer: id || null };
}

export async function handle(body, now = Date.now(), meta = {}) {
  try {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(400, 'Bad request');
    const store = getStore();
    if (!store) {
      return fail(503, 'Online rooms aren’t switched on for this website yet. The owner needs to connect Upstash Redis in Vercel (see DEPLOY.md). You can still play on this device.');
    }
    if (body.op === 'create') return await create(store, body, now, meta);

    const code = cleanCode(body.code);
    if (!code) return fail(400, 'Room codes are 4 letters.');
    const since = Number(body.since) || 0;

    if (body.op === 'join') return await mutate(store, code, now, since, (room) => join(room, body, now));
    if (body.op === 'act') return await mutate(store, code, now, since, (room) => applyAction(room, body, now));
    if (body.op === 'poll') {
      const res = await mutate(store, code, now, since, (room) => poll(room, body, now));
      // Nothing new since this device last looked: send a tiny reply.
      if (res.status === 200 && res.json.view.v === Number(body.v)) {
        return ok({ same: true, away: res.json.view.away, now });
      }
      return res;
    }
    return fail(400, 'Unknown request');
  } catch (err) {
    console.error(err);
    if (err instanceof StoreError) {
      return fail(503, 'The online-rooms database isn’t answering. It may have used up its free monthly limit, or been paused after a month without use. (Owner: see “If online rooms stop working” in DEPLOY.md.) You can still play on this device.');
    }
    return fail(500, 'Something went wrong on the server. Try again in a moment.');
  }
}
