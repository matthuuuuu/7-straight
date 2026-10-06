// Online rooms, end to end, against the in-memory store.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../server/rooms.js';
import { AWAY_MS } from '../src/engine/autoplay.js';

let clock = 1_700_000_000_000;
const call = async (body, advance = 50) => {
  clock += advance;
  return handle(body, clock);
};

async function makeRoom(names = ['Ava', 'Ben', 'Cam']) {
  const created = await call({ op: 'create', name: names[0], avatar: '🦊', target: 200 });
  assert.equal(created.status, 200);
  const { code } = created.json;
  const seats = [created.json.you];
  for (const n of names.slice(1)) {
    const j = await call({ op: 'join', code, name: n, avatar: '🐙' });
    assert.equal(j.status, 200, JSON.stringify(j.json));
    seats.push(j.json.you);
  }
  return { code, seats };
}

test('create, join, start and play a whole online game', async () => {
  const { code, seats } = await makeRoom();
  const host = seats[0];

  // Only the host can start
  const notHost = await call({ op: 'act', code, token: seats[1].token, action: { type: 'start' } });
  assert.equal(notHost.status, 400);

  const add = await call({ op: 'act', code, token: host.token, action: { type: 'addBot' } });
  assert.equal(add.status, 200);
  assert.equal(add.json.view.game.players.length, 4);

  const start = await call({ op: 'act', code, token: host.token, action: { type: 'start' } });
  assert.equal(start.status, 200);
  assert.equal(start.json.view.game.phase, 'playing');
  assert.equal(start.json.view.game.deck, undefined, 'the deck order is never sent');

  // A late joiner becomes a spectator
  const late = await call({ op: 'join', code, name: 'Dee', avatar: '🐸' });
  assert.equal(late.status, 200);
  assert.equal(late.json.you, null);
  assert.equal(late.json.view.you, -1);

  // Play it out: humans act when it's their decision, bots act on their own
  // as time passes and devices poll.
  let v = 0;
  for (let step = 0; step < 5000; step++) {
    const p = await call({ op: 'poll', code, token: host.token, v }, 1200);
    assert.equal(p.status, 200);
    if (p.json.same) continue;
    const view = p.json.view;
    v = view.v;
    const g = view.game;
    if (g.phase === 'gameOver') {
      assert.ok(g.winners.length >= 1);
      return;
    }
    if (g.phase === 'roundOver') {
      await call({ op: 'act', code, token: seats[1].token, action: { type: 'next' } });
      continue;
    }
    const P = g.pending;
    const seatPlayer = g.players[P.seat];
    const who = seats.find((s) => s.id === seatPlayer.id);
    if (!who) continue; // the bot's turn
    const action = P.kind === 'turn'
      ? { type: P.canStay && scoreOf(seatPlayer) >= 15 ? 'stay' : 'hit' }
      : { type: 'target', target: P.options[0] };
    // Someone else can't act for them
    const other = seats.find((s) => s.id !== who.id);
    const wrong = await call({ op: 'act', code, token: other.token, action });
    assert.equal(wrong.status, 400);
    const res = await call({ op: 'act', code, token: who.token, action });
    assert.equal(res.status, 200, JSON.stringify(res.json));
  }
  assert.fail('game did not finish');
});

function scoreOf(p) {
  return p.line.length * 5;
}

test('poll returns a tiny reply when nothing changed', async () => {
  const { code, seats } = await makeRoom(['Ava']);
  const first = await call({ op: 'poll', code, token: seats[0].token, v: 0 });
  const v = first.json.view.v;
  const second = await call({ op: 'poll', code, token: seats[0].token, v });
  assert.equal(second.json.same, true);
});

test('away players get autopilot, present players never do', async () => {
  const { code, seats } = await makeRoom(['Ava', 'Ben']);
  await call({ op: 'act', code, token: seats[0].token, action: { type: 'start' } });
  // Find whose decision it is.
  let res = await call({ op: 'poll', code, token: seats[0].token, v: 0 });
  let g = res.json.view.game;
  const actorId = g.players[g.pending.seat].id;
  const actor = seats.find((s) => s.id === actorId);
  const other = seats.find((s) => s.id !== actorId);
  const seqBefore = g.seq;

  // The actor keeps polling: no autopilot even after a long time.
  for (let i = 0; i < 10; i++) await call({ op: 'poll', code, token: actor.token, v: 0 }, 5000);
  res = await call({ op: 'poll', code, token: other.token, v: 0 });
  assert.equal(res.json.view.game.seq, seqBefore, 'a present player is never auto-played');

  // The actor's phone goes to sleep; only the other device polls.
  for (let i = 0; i < 8; i++) res = await call({ op: 'poll', code, token: other.token, v: 0 }, 5000);
  g = res.json.view.game;
  assert.ok(g.seq > seqBefore || g.phase !== 'playing', 'autopilot moved for the away player');
  assert.ok(res.json.view.away.includes(actorId));
  assert.ok(AWAY_MS <= 40000);
});

test('rejoining with a saved token keeps your seat; bad codes are rejected', async () => {
  const { code, seats } = await makeRoom(['Ava', 'Ben']);
  const again = await call({ op: 'join', code, token: seats[1].token });
  assert.equal(again.status, 200);
  assert.equal(again.json.you.id, seats[1].id);
  assert.equal(again.json.view.game.players.length, 2);

  const missing = await call({ op: 'join', code: 'ZZZZ', name: 'X' });
  assert.equal(missing.status, 404);
  const bad = await call({ op: 'join', code: 'A1', name: 'X' });
  assert.equal(bad.status, 400);
});

test('names are cleaned and kept unique; the table holds 8', async () => {
  const created = await call({ op: 'create', name: '  <b>Ava</b>  ', avatar: 'not-an-emoji' });
  const { code } = created.json;
  const me = created.json.view.game.players[0];
  assert.equal(me.name, 'bAva/b');
  assert.equal(me.avatar, '🦊');
  const dup = await call({ op: 'join', code, name: 'bava/b' });
  assert.equal(dup.json.view.game.players[1].name, 'bava/b 2');
  for (let i = 0; i < 6; i++) await call({ op: 'join', code, name: `P${i}` });
  const full = await call({ op: 'join', code, name: 'Nine' });
  assert.equal(full.status, 400);
  const empty = await call({ op: 'create', name: '   ' });
  assert.equal(empty.status, 400);
});

test('host can kick in the lobby; leaving passes the host role on', async () => {
  const { code, seats } = await makeRoom(['Ava', 'Ben', 'Cam']);
  const kick = await call({ op: 'act', code, token: seats[0].token, action: { type: 'kick', id: seats[2].id } });
  assert.equal(kick.json.view.game.players.length, 2);
  const kicked = await call({ op: 'act', code, token: seats[2].token, action: { type: 'hit' } });
  assert.equal(kicked.status, 403);
  const leave = await call({ op: 'act', code, token: seats[0].token, action: { type: 'leave' } });
  assert.equal(leave.status, 200);
  const p = await call({ op: 'poll', code, token: seats[1].token, v: 0 });
  assert.equal(p.json.view.hostId, seats[1].id);
  assert.equal(p.json.view.game.players.length, 1);
});
