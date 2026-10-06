import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, addPlayer, startGame, act, cardLocations } from '../src/engine/engine.js';
import { botAction } from '../src/engine/bot.js';
import { DECK_SIZE } from '../src/engine/cards.js';

function playWholeGame(seed, players) {
  const g = newGame({ seed });
  for (let i = 0; i < players; i++) addPlayer(g, { id: `p${i}`, name: `P${i}`, avatar: 'fox', bot: true });
  assert.equal(startGame(g), null);
  let steps = 0;
  while (g.phase !== 'gameOver') {
    assert.equal(cardLocations(g).size, DECK_SIZE, 'every card is somewhere exactly once');
    if (g.phase === 'roundOver') {
      assert.equal(act(g, 0, { type: 'next' }), null);
    } else {
      const seat = g.pending.seat;
      const a = botAction(g, seat, { boldness: 1 + ((seed + steps) % 3) * 0.2 });
      assert.equal(act(g, seat, a), null, `action ${JSON.stringify(a)} should be legal`);
    }
    if (++steps > 20000) throw new Error('game did not finish');
  }
  return g;
}

test('whole games play to completion with 1-8 players', () => {
  for (let seed = 1; seed <= 400; seed++) {
    const n = (seed % 8) + 1;
    const g = playWholeGame(seed, n);
    const best = Math.max(...g.players.map((p) => p.total));
    assert.ok(best >= 200);
    assert.ok(g.winners.length >= 1);
    for (const w of g.winners) assert.equal(g.players[w].total, best);
  }
});
