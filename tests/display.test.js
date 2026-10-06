// The screen replays the event log step by step (src/game/display.js).
// These tests prove that replaying the events always lands on exactly the
// same table as the real game state, so animations can never show a wrong
// card or status.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, addPlayer, startGame, act } from '../src/engine/engine.js';
import { botAction } from '../src/engine/bot.js';
import { toDisplay, applyEvent, eventMessage } from '../src/game/display.js';

function snapshot(d) {
  return {
    turn: d.turn,
    actor: d.actor,
    players: d.players.map((p) => ({ line: p.line, hand: p.hand, aside: p.aside, status: p.status, lucky: p.lucky })),
  };
}

function randomChoice(g, seed) {
  const P = g.pending;
  if (P.kind === 'turn') return { type: P.canStay && seed % 3 === 0 ? 'stay' : 'hit' };
  return { type: 'target', target: P.options[seed % P.options.length] };
}

test('replaying events always matches the real table', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const g = newGame({ seed });
    const n = (seed % 8) + 1;
    for (let i = 0; i < n; i++) addPlayer(g, { id: `p${i}`, name: `P${i}`, avatar: 'x', bot: true });
    let d = toDisplay(g);
    let seq = g.seq;
    startGame(g);
    let steps = 0;
    for (;;) {
      const fresh = g.events.filter((e) => e.seq > seq);
      for (const e of fresh) {
        d = applyEvent(d, e);
        // every event can be described without crashing
        eventMessage(e, (i) => `P${i}`, () => false);
      }
      seq = g.seq;
      if (g.phase === 'playing') {
        assert.deepEqual(snapshot(d), snapshot(toDisplay(g)), `seed ${seed} step ${steps}`);
      }
      if (g.phase === 'gameOver') break;
      if (g.phase === 'roundOver') act(g, 0, { type: 'next' });
      else {
        const seat = g.pending.seat;
        const a = seed % 2 ? botAction(g, seat) : randomChoice(g, seed + steps);
        assert.equal(act(g, seat, a), null);
      }
      if (++steps > 20000) throw new Error('game did not finish');
    }
  }
});
