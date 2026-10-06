// Games on one device: pass-and-play with friends and/or computer players.
// Runs the same rules engine as the server, right in the browser, and saves
// after every move so a refresh doesn't lose the game.

import {
  newGame, addPlayer, removePlayer, setTarget, startGame, backToLobby, act,
} from '../engine/engine.js';
import { tick } from '../engine/autoplay.js';
import { freshSeed } from '../engine/rng.js';
import { AVATARS, BOT_NAMES } from '../config.js';
import { cleanName, uniqueName } from '../names.js';
import { load, save, remove } from './storage.js';

const SAVE_KEY = 'localGame';
let nextId = 1;
const localId = (prefix) => `${prefix}-${Date.now().toString(36)}-${nextId++}`;

/** When the saved game on this device was last played, or 0 if there's none worth resuming. */
export function savedLocalGameAt() {
  const g = load(SAVE_KEY, null);
  if (!g || g.phase === 'lobby' || g.phase === 'gameOver') return 0;
  return load('localSavedAt', 1);
}

export function hasSavedLocalGame() {
  return savedLocalGameAt() > 0;
}

export function newLocalRoom(profile, target) {
  const game = newGame({ seed: freshSeed(), target, now: Date.now() });
  addPlayer(game, { id: localId('human'), name: cleanName(profile.name) || 'Player 1', avatar: profile.avatar });
  return new LocalRoom(game);
}

export function resumeLocalRoom() {
  const game = load(SAVE_KEY, null);
  return game ? new LocalRoom(game) : null;
}

export class LocalRoom {
  constructor(game) {
    this.mode = 'local';
    this.game = game;
    this.listeners = new Set();
    this.snap = null;
    this.publish();
    this.timer = setInterval(() => this.runBots(), 50);
  }

  subscribe = (fn) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = () => this.snap;

  serverNow() {
    return Date.now();
  }

  publish() {
    const g = this.game;
    const { deck, ...pub } = g;
    const view = {
      code: null, v: g.seq, hostId: null, youId: null, you: -1, away: [], now: Date.now(),
      game: { ...pub, deckCount: deck.length },
    };
    this.snap = {
      mode: 'local', status: 'live', error: null, notice: null, view,
      controllable: g.players.flatMap((p, i) => (p.bot ? [] : [i])),
      isHost: true,
    };
    save(SAVE_KEY, g);
    save('localSavedAt', Date.now());
    for (const fn of this.listeners) fn();
  }

  /** Apply a change to a copy of the game; keep it only if it worked. */
  change(fn) {
    const g = structuredClone(this.game);
    const err = fn(g);
    if (err) return err;
    this.game = g;
    this.publish();
    return null;
  }

  runBots() {
    const g = this.game;
    if (g.phase !== 'playing' || !g.pending || !g.players[g.pending.seat].bot) return;
    const copy = structuredClone(g);
    if (tick(copy, Date.now())) {
      this.game = copy;
      this.publish();
    }
  }

  async send(action, seat) {
    const now = Date.now();
    switch (action.type) {
      case 'hit':
      case 'stay':
      case 'target':
        return this.change((g) => act(g, seat >= 0 ? seat : g.pending?.seat ?? 0, action, now));
      case 'next':
        // Anyone at the device can deal the next round (even in a bots-only game).
        return this.change((g) => act(g, 0, action, now));
      case 'start':
      case 'again':
        return this.change((g) => startGame(g, { seed: freshSeed(), now }));
      case 'lobby':
        return this.change((g) => backToLobby(g));
      case 'setTarget':
        return this.change((g) => setTarget(g, action.target));
      case 'kick':
        return this.change((g) => removePlayer(g, action.id));
      case 'addBot':
        return this.change((g) => {
          const names = new Set(g.players.map((p) => p.name));
          const faces = new Set(g.players.map((p) => p.avatar));
          return addPlayer(g, {
            id: localId('bot'),
            name: BOT_NAMES.find((n) => !names.has(n)) || `Bot ${g.players.length + 1}`,
            avatar: AVATARS.find((a) => !faces.has(a)) || AVATARS[0],
            bot: true,
          });
        });
      case 'addHuman':
        return this.change((g) => {
          const name = cleanName(action.name);
          if (!name) return 'Type a name first.';
          return addPlayer(g, {
            id: localId('human'),
            name: uniqueName(name, g.players),
            avatar: AVATARS.includes(action.avatar) ? action.avatar : AVATARS[g.players.length % AVATARS.length],
          });
        });
      case 'leave':
        this.close();
        remove(SAVE_KEY);
        return null;
      default:
        return 'Unknown action.';
    }
  }

  close() {
    clearInterval(this.timer);
  }
}
