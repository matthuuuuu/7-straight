// Moves that happen without a human tapping anything: computer players, and
// "autopilot" for people whose phone went to sleep or who left mid-game.

import { act } from './engine.js';
import { botAction, botBoldness } from './bot.js';
import { eventDelay, replaySpeed } from '../game/display.js';

// Bots "think" this long after the previous move's animation ends. With the
// usual card-flip animation that makes about 1.9 s between bot moves.
export const BOT_TURN_MS = 1250; // before Hit/Stay
export const BOT_TARGET_MS = 1250; // before choosing who gets an action card
export const AWAY_MS = 30000; // a human gone this long gets autopilot

const isAsk = (e) => e.t === 'turn' || e.t === 'choose';

/**
 * About how long screens spend animating the moves that led up to the
 * current decision (the cards flipping, the deal...). Bots only start
 * "thinking" once that's done, so nobody's move gets lost in the animation.
 */
export function replayMs(game) {
  const ev = game.events;
  let end = ev.length - 1;
  while (end >= 0 && !isAsk(ev[end])) end--;
  let start = end - 1;
  while (start >= 0 && !isAsk(ev[start])) start--;
  const batch = ev.slice(start + 1, end + 1);
  let ms = 0;
  batch.forEach((e, i) => {
    ms += eventDelay(e) * replaySpeed(batch.length - i - 1);
  });
  return Math.min(ms, 15000);
}

/**
 * When (timestamp) the pending decision should be made automatically, or
 * Infinity if we should keep waiting for a human.
 * `lastSeen(id)` returns when that player's device last checked in
 * (return Infinity for players that are always considered present).
 */
export function autoMoveAt(game, lastSeen = () => Infinity) {
  const P = game.pending;
  if (game.phase !== 'playing' || !P) return Infinity;
  const p = game.players[P.seat];
  const delay = replayMs(game) + (P.kind === 'turn' ? BOT_TURN_MS : BOT_TARGET_MS);
  if (p.bot || p.left) return P.since + delay;
  const seen = lastSeen(p.id);
  if (!Number.isFinite(seen)) return Infinity;
  return Math.max(P.since + delay, seen + AWAY_MS);
}

/**
 * Make any automatic moves that are due. Returns true if the game changed.
 */
export function tick(game, now, lastSeen) {
  let changed = false;
  for (let i = 0; i < 20; i++) {
    const at = autoMoveAt(game, lastSeen);
    if (now < at) break;
    const seat = game.pending.seat;
    const p = game.players[seat];
    const boldness = p.bot ? botBoldness(p.id) : 0.8; // autopilot plays it safe
    const action = botAction(game, seat, { boldness });
    if (!action || act(game, seat, action, now)) break;
    changed = true;
  }
  return changed;
}
