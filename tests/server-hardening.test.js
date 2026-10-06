// Regression tests for the issues found in the app review: stuck hosts,
// stale taps, kicks, fake tokens, names, room-creation spam, secure shuffles.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../server/rooms.js';
import { AWAY_MS } from '../src/engine/autoplay.js';
import { random, shuffle } from '../src/engine/rng.js';
import { cleanName, uniqueName } from '../src/names.js';

let clock = 1_800_000_000_000;
let ipCounter = 0;
const call = async (body, advance = 50, ip = 'test-ip') => {
  clock += advance;
  return handle(body, clock, { ip });
};

async function room(names) {
  const c = await call({ op: 'create', name: names[0], avatar: '🦊' }, 50, `ip-${ipCounter++}`);
  assert.equal(c.status, 200);
  const seats = [c.json.you];
  for (const n of names.slice(1)) seats.push((await call({ op: 'join', code: c.json.code, name: n })).json.you);
  return { code: c.json.code, seats };
}

test('a host who leaves an empty lobby hands the room to the next person in', async () => {
  const { code, seats } = await room(['Ava']);
  await call({ op: 'act', code, token: seats[0].token, action: { type: 'leave' } });
  const friend = await call({ op: 'join', code, name: 'Ben' });
  assert.equal(friend.json.view.hostId, friend.json.you.id);
  const start = await call({ op: 'act', code, token: friend.json.you.token, action: { type: 'start' } });
  assert.equal(start.status, 200);
});

test('if everyone else left mid-game, the returning player becomes host', async () => {
  const { code, seats } = await room(['Ava', 'Ben']);
  await call({ op: 'act', code, token: seats[0].token, action: { type: 'start' } });
  await call({ op: 'act', code, token: seats[1].token, action: { type: 'leave' } });
  await call({ op: 'act', code, token: seats[0].token, action: { type: 'leave' } });
  const back = await call({ op: 'join', code, token: seats[1].token });
  assert.equal(back.json.view.hostId, seats[1].id);
  const lobby = await call({ op: 'act', code, token: seats[1].token, action: { type: 'lobby' } });
  assert.equal(lobby.status, 200);
});

test('a host whose phone died can be replaced by pressing a host button', async () => {
  const { code, seats } = await room(['Ava', 'Ben']);
  const early = await call({ op: 'act', code, token: seats[1].token, action: { type: 'addBot' } });
  assert.equal(early.status, 400, 'not while the host is still around');
  for (let i = 0; i < 10; i++) await call({ op: 'poll', code, token: seats[1].token, v: 0 }, AWAY_MS / 4);
  const late = await call({ op: 'act', code, token: seats[1].token, action: { type: 'addBot' } });
  assert.equal(late.status, 200);
  assert.equal(late.json.view.hostId, seats[1].id);
});

test('a tap based on an old screen is ignored, not applied to the new state', async () => {
  const { code, seats } = await room(['Ava', 'Ben']);
  let res = await call({ op: 'act', code, token: seats[0].token, action: { type: 'start' } });
  // Resolve any action cards from the deal until someone has to Hit or Stay.
  while (res.json.view.game.pending?.kind === 'target') {
    const p = res.json.view.game.pending;
    const s = seats.find((x) => x.id === res.json.view.game.players[p.seat].id);
    res = await call({ op: 'act', code, token: s.token, action: { type: 'target', target: p.options[0] } });
  }
  const g = res.json.view.game;
  if (g.phase !== 'playing') return; // the deal alone ended the round (very rare)
  const who = seats.find((s) => s.id === g.players[g.pending.seat].id);
  // This device saw everything up to g.seq, and hits.
  const hit = await call({ op: 'act', code, token: who.token, action: { type: 'hit' }, since: g.seq });
  assert.equal(hit.status, 200);
  const after = hit.json.view.game;
  // The same tap arrives again (e.g. a retry after a timeout) with the old `since`.
  const again = await call({ op: 'act', code, token: who.token, action: { type: 'hit' }, since: g.seq });
  assert.equal(again.status, 200);
  assert.equal(again.json.view.game.seq, after.seq, 'the repeated tap changed nothing');
});

test('two players pressing "Deal next round" deal only one round', async () => {
  const { code, seats } = await room(['Ava', 'Ben']);
  let res = await call({ op: 'act', code, token: seats[0].token, action: { type: 'start' } });
  // Play until the round is over.
  for (let i = 0; i < 400 && res.json.view.game.phase === 'playing'; i++) {
    const g = res.json.view.game;
    const who = seats.find((s) => s.id === g.players[g.pending.seat].id);
    const action = g.pending.kind === 'turn'
      ? { type: g.pending.canStay ? 'stay' : 'hit' }
      : { type: 'target', target: g.pending.options[0] };
    res = await call({ op: 'act', code, token: who.token, action, since: g.seq });
  }
  const g = res.json.view.game;
  assert.equal(g.phase, 'roundOver');
  const first = await call({ op: 'act', code, token: seats[0].token, action: { type: 'next' }, since: g.seq });
  const second = await call({ op: 'act', code, token: seats[1].token, action: { type: 'next' }, since: g.seq });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200, 'no confusing error for the slower player');
  assert.equal(second.json.view.game.round, 2);
});

test('kicked players stay kicked, and are told so', async () => {
  const { code, seats } = await room(['Ava', 'Ben']);
  await call({ op: 'act', code, token: seats[0].token, action: { type: 'kick', id: seats[1].id } });
  const rejoin = await call({ op: 'join', code, token: seats[1].token, name: 'Ben' });
  assert.equal(rejoin.status, 403);
  const poll = await call({ op: 'poll', code, token: seats[1].token, v: 0 });
  assert.equal(poll.status, 403);
  assert.match(poll.json.error, /removed/);
});

test('made-up tokens like "constructor" are not a seat', async () => {
  const { code } = await room(['Ava']);
  for (const token of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    const r = await call({ op: 'act', code, token, action: { type: 'leave' } });
    assert.equal(r.status, 403, token);
  }
  const weird = await call(['not', 'an', 'object']);
  assert.equal(weird.status, 400);
});

test('names lose invisible characters, and look-alikes get numbered', () => {
  assert.equal(cleanName('Ava​'), 'Ava');
  assert.equal(cleanName('‮evA'), 'evA');
  assert.equal(cleanName('​​'), null);
  assert.equal(cleanName('   '), null);
  assert.equal(cleanName('👩‍🚀 Sam'), '👩‍🚀 Sam', 'emoji made with joiners survive');
  assert.equal(uniqueName('AVA', [{ name: 'ava' }]), 'AVA 2');
});

test('one network can’t make endless rooms', async () => {
  let last;
  for (let i = 0; i < 31; i++) last = await call({ op: 'create', name: 'Spam' }, 10, 'spammer');
  assert.equal(last.status, 429);
  const other = await call({ op: 'create', name: 'Real' }, 10, 'someone-else');
  assert.equal(other.status, 200);
});

test('online shuffles use the secure random source', () => {
  const state = { rng: 'secure' };
  for (let i = 0; i < 1000; i++) {
    const x = random(state);
    assert.ok(x >= 0 && x < 1);
  }
  const deck = shuffle(Array.from({ length: 94 }, (_, i) => i), state);
  assert.deepEqual([...deck].sort((a, b) => a - b), Array.from({ length: 94 }, (_, i) => i));
  assert.equal(state.rng, 'secure');
});
