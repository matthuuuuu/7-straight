// Scenario tests that check the engine against the official Flip 7 rulebook
// (Ruleset Edition 3.1). The app calls the Flip 7 bonus "lucky".
//
// How scenarios are built:
//   - `midRound()` creates a real game (newGame/addPlayer/startGame) and then
//     overwrites the round to a known position: every player's line and
//     status, whose turn it is, and the exact cards on top of the deck.
//   - `dealRound()` does the same but stops just before a new round is dealt,
//     then deals it through the public `act(..., { type: 'next' })` call, so the
//     real deal logic runs on a crafted deck.
// Cards are drawn with deck.pop(), so the helpers take the deck top in DRAW
// order ("first card drawn first") and reverse it for you. Every card that is
// not placed explicitly goes under the crafted cards (or into the discard pile
// when asked), so the full 94-card deck is always accounted for.
//
// Card specs: '0'..'12' number, '+2'..'+10' modifier, 'x2', 'FZ' Freeze,
// 'F3' Flip Three, 'SC' Second Chance.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, addPlayer, startGame, act, cardLocations, targetOptions } from '../src/engine/engine.js';
import { CARDS, ALL_IDS, DECK_SIZE, isNumber, isSecondChance, scoreLine } from '../src/engine/cards.js';

// ---------------------------------------------------------------------------
// Helpers

function specPredicate(spec) {
  if (spec === 'FZ') return (c) => c.kind === 'act' && c.act === 'freeze';
  if (spec === 'F3') return (c) => c.kind === 'act' && c.act === 'flip3';
  if (spec === 'SC') return (c) => c.kind === 'act' && c.act === 'second';
  if (spec === 'x2') return (c) => c.kind === 'mod' && c.op === 'times';
  const plus = /^\+(\d+)$/.exec(spec);
  if (plus) return (c) => c.kind === 'mod' && c.op === 'plus' && c.value === Number(plus[1]);
  if (/^\d+$/.test(spec)) return (c) => c.kind === 'num' && c.value === Number(spec);
  throw new Error(`bad card spec "${spec}"`);
}

/** Returns k(spec) -> an unused card id matching the spec. */
function picker() {
  const used = new Set();
  const k = (spec) => {
    const pred = specPredicate(spec);
    const c = CARDS.find((x) => !used.has(x.id) && pred(x));
    if (!c) throw new Error(`no unused card left for "${spec}"`);
    used.add(c.id);
    return c.id;
  };
  k.used = used;
  return k;
}

function lab(id) {
  const c = CARDS[id];
  if (c.kind === 'num') return String(c.value);
  if (c.kind === 'mod') return c.op === 'times' ? 'x2' : `+${c.value}`;
  return { freeze: 'FZ', flip3: 'F3', second: 'SC' }[c.act];
}
const labs = (ids) => ids.map(lab);
const lineOf = (g, seat) => labs(g.players[seat].line);
const topOfDeck = (g) => lab(g.deck[g.deck.length - 1]);

/**
 * Filler for the rest of the deck, in draw order: numbers cycling through the
 * values (12, 11, ..., 0, 12, 11, ...) so consecutive draws differ, then
 * modifiers, then action cards last.
 */
function fillerDrawOrder(used) {
  const free = ALL_IDS.filter((id) => !used.has(id));
  const byValue = new Map();
  for (const id of free.filter(isNumber)) {
    const v = CARDS[id].value;
    if (!byValue.has(v)) byValue.set(v, []);
    byValue.get(v).push(id);
  }
  const order = [];
  for (let added = true; added; ) {
    added = false;
    for (let v = 12; v >= 0; v--) {
      const l = byValue.get(v);
      if (l && l.length) {
        order.push(l.shift());
        added = true;
      }
    }
  }
  order.push(...free.filter((id) => CARDS[id].kind === 'mod'));
  order.push(...free.filter((id) => CARDS[id].kind === 'act'));
  return order;
}

/** Deck array from cards in draw order (first element is drawn first). */
const deckFrom = (drawOrder) => [...drawOrder].reverse();

function conserve(g, msg = 'every card is in exactly one place') {
  const loc = cardLocations(g); // throws if a card is in two places
  assert.equal(loc.size, DECK_SIZE, msg);
}

function ok(g, seat, action) {
  const err = act(g, seat, action);
  assert.equal(err, null, `action ${JSON.stringify(action)} by seat ${seat} should be legal`);
  conserve(g);
}

function table(n, { seed = 1, target } = {}) {
  const g = newGame({ seed, target });
  for (let i = 0; i < n; i++) assert.equal(addPlayer(g, { id: `p${i}`, name: `P${i}`, avatar: 'fox' }), null);
  assert.equal(startGame(g, { seed }), null);
  return g;
}

/**
 * A round in progress during the turn phase, waiting on `turn` to Hit/Stay.
 * `rest: 'discard'` puts every unplaced card in the discard pile instead of
 * under the crafted deck top.
 */
function midRound({
  n = 3, lines = [], status = [], totals = [], turn = 0, dealer, top = [], discard = [], rest = 'deck', target, seed,
} = {}) {
  const g = table(n, { target, seed });
  const k = picker();
  const lineIds = Array.from({ length: n }, (_, i) => (lines[i] || []).map(k));
  const topIds = top.map(k);
  const discardIds = discard.map(k);
  const filler = fillerDrawOrder(k.used);
  g.players.forEach((p, i) => {
    p.line = lineIds[i];
    p.status = status[i] || 'active';
    p.total = totals[i] || 0;
    p.roundScore = null;
  });
  g.deck = rest === 'deck' ? deckFrom([...topIds, ...filler]) : deckFrom(topIds);
  g.discard = rest === 'deck' ? discardIds : [...discardIds, ...filler];
  Object.assign(g, {
    phase: 'playing', stage: 'turns', stack: [], lucky: -1, outOfCards: false,
    round: 1, history: [], winners: [], events: [],
    dealer: dealer ?? (turn - 1 + n) % n, dealPos: n, turn, turnDone: false,
  });
  g.dealOrder = Array.from({ length: n }, (_, j) => (g.dealer + 1 + j) % n);
  assert.equal(g.players[turn].status, 'active', 'test setup: the turn player must be active');
  g.pending = { kind: 'turn', seat: turn, canStay: lineIds[turn].length > 0, since: g.clock };
  conserve(g, 'test setup keeps all 94 cards');
  return { g, k, ids: { lines: lineIds, top: topIds, discard: discardIds } };
}

/** Deal a fresh round (through the engine) with `dealer` and a crafted deck top. */
function dealRound({ n = 3, dealer = 0, top = [], totals = [], target, seed } = {}) {
  const g = table(n, { target, seed });
  const k = picker();
  const topIds = top.map(k);
  g.players.forEach((p, i) => {
    p.line = [];
    p.status = 'active';
    p.total = totals[i] || 0;
    p.roundScore = null;
  });
  g.deck = deckFrom([...topIds, ...fillerDrawOrder(k.used)]);
  Object.assign(g, {
    discard: [], phase: 'roundOver', stack: [], pending: null, round: 0, history: [], winners: [],
    lucky: -1, events: [], dealer: (dealer - 1 + n) % n,
  });
  conserve(g, 'test setup keeps all 94 cards');
  ok(g, 0, { type: 'next' });
  return { g, k, ids: { top: topIds } };
}

/** Play out the rest of the round: Stay when allowed, otherwise Hit; first target option. */
function finishRound(g) {
  for (let i = 0; i < 1000 && g.phase === 'playing'; i++) {
    const P = g.pending;
    if (P.kind === 'turn') ok(g, P.seat, { type: P.canStay ? 'stay' : 'hit' });
    else ok(g, P.seat, { type: 'target', target: P.options[0] });
  }
  assert.notEqual(g.phase, 'playing', 'round should have finished');
}

const scores = (g) => g.players.map((p) => p.roundScore);
const totals = (g) => g.players.map((p) => p.total);
const chose = (g) => g.events.some((e) => e.t === 'choose');

// ---------------------------------------------------------------------------
// Deck composition

test('deck: 94 cards = twelve 12s ... one 1, one 0, +2/+4/+6/+8/+10/x2 once each, 3 of each Action', () => {
  assert.equal(DECK_SIZE, 94);
  assert.equal(CARDS.length, 94);
  assert.deepEqual([...ALL_IDS], Array.from({ length: 94 }, (_, i) => i));
  const count = (pred) => CARDS.filter(pred).length;
  for (let v = 1; v <= 12; v++) assert.equal(count((c) => c.kind === 'num' && c.value === v), v, `copies of ${v}`);
  assert.equal(count((c) => c.kind === 'num' && c.value === 0), 1, 'one 0');
  assert.equal(count((c) => c.kind === 'num'), 79);
  for (const v of [2, 4, 6, 8, 10]) assert.equal(count((c) => c.kind === 'mod' && c.op === 'plus' && c.value === v), 1, `+${v}`);
  assert.equal(count((c) => c.kind === 'mod' && c.op === 'times' && c.value === 2), 1, 'x2');
  assert.equal(count((c) => c.kind === 'mod'), 6);
  for (const a of ['freeze', 'flip3', 'second']) assert.equal(count((c) => c.kind === 'act' && c.act === a), 3, a);
  assert.equal(count((c) => c.kind === 'act'), 9);
});

test('deck: a new game uses all 94 cards, shuffled reproducibly from the seed', () => {
  const g1 = table(3, { seed: 42 });
  const g2 = table(3, { seed: 42 });
  const g3 = table(3, { seed: 43 });
  conserve(g1);
  const everywhere = [...cardLocations(g1).keys()].sort((a, b) => a - b);
  assert.deepEqual(everywhere, [...ALL_IDS]);
  assert.deepEqual(g1.deck, g2.deck);
  assert.deepEqual(g1.players.map((p) => p.line), g2.players.map((p) => p.line));
  assert.equal(g1.dealer, g2.dealer);
  assert.notDeepEqual(g1.deck, g3.deck);
});

// ---------------------------------------------------------------------------
// Dealer and deal order

test('deal: starts left of the Dealer, ends with the Dealer, one card each; first turn is left of the Dealer', () => {
  const { g } = dealRound({ n: 4, dealer: 1, top: ['1', '2', '3', '4'] });
  assert.equal(g.dealer, 1);
  assert.deepEqual(g.dealOrder, [2, 3, 0, 1]);
  assert.deepEqual(lineOf(g, 2), ['1']);
  assert.deepEqual(lineOf(g, 3), ['2']);
  assert.deepEqual(lineOf(g, 0), ['3']);
  assert.deepEqual(lineOf(g, 1), ['4'], 'the Dealer deals to themself last');
  assert.equal(g.deck.length, 90);
  assert.equal(g.stage, 'turns');
  assert.deepEqual(g.pending, { kind: 'turn', seat: 2, canStay: true, since: g.clock });
});

test('deal: the very first Dealer is chosen at random (design)', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 60; seed++) {
    const g = newGame({ seed });
    for (let i = 0; i < 4; i++) addPlayer(g, { id: `p${i}`, name: `P${i}`, avatar: 'fox' });
    startGame(g, { seed });
    assert.equal(g.round, 1);
    assert.ok(g.dealer >= 0 && g.dealer < 4);
    seen.add(g.dealer);
  }
  assert.equal(seen.size, 4, 'every seat is sometimes the first Dealer');
});

test('deal: each new round the deal passes one seat to the left and the deal order follows it', () => {
  const { g } = dealRound({ n: 3, dealer: 0, top: ['1', '2', '3'] });
  assert.equal(g.dealer, 0);
  assert.equal(g.pending.seat, 1);
  const dealers = [g.dealer];
  for (let r = 0; r < 5; r++) {
    finishRound(g);
    assert.equal(g.phase, 'roundOver');
    const before = [...g.deck];
    const d = (g.dealer + 1) % 3;
    ok(g, 0, { type: 'next' });
    assert.equal(g.dealer, d);
    dealers.push(g.dealer);
    // Filler cards are distinct numbers, so each player gets exactly one card.
    assert.deepEqual(g.players[(d + 1) % 3].line, [before.at(-1)]);
    assert.deepEqual(g.players[(d + 2) % 3].line, [before.at(-2)]);
    assert.deepEqual(g.players[d].line, [before.at(-3)], 'the Dealer is dealt last');
    assert.equal(g.pending.seat, (d + 1) % 3, 'the player left of the Dealer goes first');
  }
  assert.deepEqual(dealers, [0, 1, 2, 0, 1, 2]);
});

// ---------------------------------------------------------------------------
// Action cards during the deal

test('deal: an Action card pauses the deal until it is resolved; a player frozen before their deal card is skipped (design)', () => {
  const { g } = dealRound({ n: 3, dealer: 2, top: ['FZ', '5', '6'] });
  assert.equal(g.stage, 'deal');
  assert.equal(g.pending.kind, 'target');
  assert.equal(g.pending.seat, 0);
  assert.equal(lab(g.pending.card), 'FZ');
  assert.deepEqual(g.pending.options, [0, 1, 2], 'any active player including yourself');
  assert.deepEqual(lineOf(g, 1), [], 'dealing paused: nobody else has been dealt yet');
  assert.deepEqual(lineOf(g, 2), []);
  assert.equal(g.deck.length, 93);

  ok(g, 0, { type: 'target', target: 1 });
  assert.equal(g.players[1].status, 'frozen');
  assert.deepEqual(lineOf(g, 1), ['FZ'], 'frozen before their deal card, so no card');
  assert.deepEqual(lineOf(g, 2), ['5'], 'the deal continued');
  assert.deepEqual(lineOf(g, 0), []);
  assert.equal(topOfDeck(g), '6');
  assert.equal(g.stage, 'turns');
  assert.deepEqual(g.pending, { kind: 'turn', seat: 0, canStay: false, since: g.clock });

  assert.match(act(g, 0, { type: 'stay' }), /card/i, 'no cards in front of you: you cannot stay');
  ok(g, 0, { type: 'hit' });
  assert.deepEqual(lineOf(g, 0), ['6']);
  assert.equal(g.pending.seat, 2, 'the frozen player is skipped');
});

test('deal: a Freeze dealt to yourself banks what you have (nothing) and the first turn skips you', () => {
  const { g } = dealRound({ n: 3, dealer: 2, top: ['FZ', '5', '6'] });
  ok(g, 0, { type: 'target', target: 0 });
  assert.equal(g.players[0].status, 'frozen');
  assert.deepEqual(lineOf(g, 0), ['FZ']);
  assert.deepEqual(lineOf(g, 1), ['5']);
  assert.deepEqual(lineOf(g, 2), ['6']);
  assert.equal(g.pending.seat, 1, 'left of the Dealer is frozen, so the next active player starts');
  finishRound(g);
  assert.deepEqual(scores(g), [0, 5, 6]);
});

test('deal: a Flip Three dealt is resolved at once; its target still gets their normal deal card (design)', () => {
  const { g } = dealRound({ n: 3, dealer: 2, top: ['F3', '1', '2', '3', '4', '5'] });
  assert.equal(g.pending.kind, 'target');
  assert.equal(lab(g.pending.card), 'F3');
  ok(g, 0, { type: 'target', target: 2 });
  assert.deepEqual(lineOf(g, 0), [], 'the dealt Flip Three went to seat 2');
  assert.deepEqual(lineOf(g, 1), ['4']);
  assert.deepEqual(lineOf(g, 2), ['F3', '1', '2', '3', '5'], 'three flipped cards, then the deal card');
  assert.deepEqual(g.pending, { kind: 'turn', seat: 0, canStay: false, since: g.clock });
});

test('deal: a player who busts during a Flip Three in the deal is skipped for the rest of the deal (design)', () => {
  const { g } = dealRound({ n: 3, dealer: 2, top: ['7', 'F3', '5', '5', '9'] });
  ok(g, 1, { type: 'target', target: 2 });
  assert.equal(g.players[2].status, 'busted');
  assert.deepEqual(lineOf(g, 2), ['F3', '5', '5'], 'stopped after the bust, no deal card');
  assert.equal(topOfDeck(g), '9', 'the third Flip Three card was never flipped');
  assert.deepEqual(lineOf(g, 0), ['7']);
  assert.deepEqual(lineOf(g, 1), []);
  assert.equal(g.pending.seat, 0);
});

test('deal: a Second Chance dealt is kept, and it counts as a card for Staying (design)', () => {
  const { g } = dealRound({ n: 3, dealer: 2, top: ['SC', '3', '4'] });
  assert.deepEqual(lineOf(g, 0), ['SC']);
  assert.deepEqual(g.pending, { kind: 'turn', seat: 0, canStay: true, since: g.clock });
  assert.equal(chose(g), false);
});

test('deal: with one player, a dealt Action card is played on yourself automatically', () => {
  const { g } = dealRound({ n: 1, dealer: 0, top: ['F3', '1', '2', '3', '12'] });
  assert.equal(chose(g), false, 'no choice was offered');
  assert.deepEqual(lineOf(g, 0), ['F3', '1', '2', '3']);
  assert.equal(topOfDeck(g), '12', 'the Flip Three was this player\'s deal card, so no further deal card');
  assert.deepEqual(g.pending, { kind: 'turn', seat: 0, canStay: true, since: g.clock });
});

// ---------------------------------------------------------------------------
// Freeze

test('Freeze on another player: they bank their points and are out; the turn passes on', () => {
  const { g } = midRound({ lines: [['5'], ['8', '+4'], ['3']], turn: 0, top: ['FZ'] });
  ok(g, 0, { type: 'hit' });
  assert.equal(g.pending.kind, 'target');
  assert.deepEqual(g.pending.options, [0, 1, 2]);
  ok(g, 0, { type: 'target', target: 1 });
  assert.equal(g.players[1].status, 'frozen');
  assert.deepEqual(lineOf(g, 1), ['8', '+4', 'FZ']);
  assert.deepEqual(lineOf(g, 0), ['5']);
  assert.equal(g.pending.seat, 2, 'the frozen player is skipped');
  ok(g, 2, { type: 'stay' });
  assert.equal(g.pending.seat, 0);
  ok(g, 0, { type: 'stay' });
  assert.equal(g.phase, 'roundOver');
  assert.deepEqual(scores(g), [5, 12, 3], 'the frozen player banked 8 + 4');
});

test('Freeze on yourself banks your own points', () => {
  const { g } = midRound({ lines: [['10', 'x2'], ['2'], ['3']], turn: 0, top: ['FZ'] });
  ok(g, 0, { type: 'hit' });
  ok(g, 0, { type: 'target', target: 0 });
  assert.equal(g.players[0].status, 'frozen');
  assert.equal(g.pending.seat, 1);
  finishRound(g);
  assert.deepEqual(scores(g), [20, 2, 3]);
});

test('Freeze drawn by the only active player must be played on themself (automatic) and ends the round', () => {
  const { g } = midRound({ lines: [['6'], ['9'], ['4']], status: ['active', 'stayed', 'stayed'], turn: 0, top: ['FZ'] });
  ok(g, 0, { type: 'hit' });
  assert.equal(chose(g), false);
  assert.equal(g.players[0].status, 'frozen');
  assert.equal(g.phase, 'roundOver');
  assert.deepEqual(scores(g), [6, 9, 4]);
});

test('Action cards can target any ACTIVE player including yourself, never a stayed/frozen/busted one', () => {
  const { g } = midRound({
    n: 5,
    lines: [['5'], ['6'], ['7', '7'], ['8', 'FZ'], ['9']],
    status: ['active', 'stayed', 'busted', 'frozen', 'active'],
    turn: 0,
    top: ['F3', '1', '2', '3'],
  });
  ok(g, 0, { type: 'hit' });
  assert.deepEqual(g.pending.options, [0, 4]);
  for (const bad of [1, 2, 3, 9]) {
    assert.equal(typeof act(g, 0, { type: 'target', target: bad }), 'string', `seat ${bad} cannot be targeted`);
  }
  assert.equal(typeof act(g, 4, { type: 'target', target: 4 }), 'string', 'only the player who drew it chooses');
  ok(g, 0, { type: 'target', target: 4 });
  assert.deepEqual(lineOf(g, 4), ['9', 'F3', '1', '2', '3']);
});

// ---------------------------------------------------------------------------
// Flip Three

test('Flip Three: the target flips exactly three cards (numbers and modifiers count); play continues after the player who hit', () => {
  const { g } = midRound({ lines: [['9'], ['2'], ['4']], turn: 1, top: ['F3', '5', '+6', '1', '12'] });
  ok(g, 1, { type: 'hit' });
  assert.equal(g.pending.kind, 'target');
  assert.equal(g.pending.seat, 1);
  assert.deepEqual(g.pending.options, [0, 1, 2]);
  ok(g, 1, { type: 'target', target: 0 });
  assert.deepEqual(lineOf(g, 0), ['9', 'F3', '5', '+6', '1']);
  assert.deepEqual(lineOf(g, 1), ['2']);
  assert.equal(topOfDeck(g), '12', 'no fourth card');
  assert.equal(g.pending.kind, 'turn');
  assert.equal(g.pending.seat, 2, 'turn passes left of the player who hit (not to the Flip Three target)');
});

test('Flip Three: stops early when the target busts', () => {
  const { g } = midRound({ lines: [['2'], ['9'], ['4']], turn: 0, top: ['F3', '5', '9', '7'] });
  ok(g, 0, { type: 'hit' });
  ok(g, 0, { type: 'target', target: 1 });
  assert.equal(g.players[1].status, 'busted');
  assert.deepEqual(lineOf(g, 1), ['9', 'F3', '5', '9']);
  assert.equal(topOfDeck(g), '7', 'the third card is not flipped');
  assert.equal(g.pending.seat, 2);
});

test('Flip Three: stops early on seven unique numbers, which ends the round with the +15 bonus', () => {
  const { g } = midRound({ lines: [['2'], ['0', '1', '3', '4', '5'], ['6']], turn: 0, top: ['F3', '8', '9', '10'] });
  ok(g, 0, { type: 'hit' });
  ok(g, 0, { type: 'target', target: 1 });
  assert.deepEqual(lineOf(g, 1), ['0', '1', '3', '4', '5', 'F3', '8', '9']);
  assert.equal(topOfDeck(g), '10', 'the third card is not flipped');
  assert.equal(g.lucky, 1);
  assert.equal(g.phase, 'roundOver');
  assert.deepEqual(scores(g), [2, 30 + 15, 6], 'round ends for everyone; non-busted players score (design)');
  assert.equal(g.history.at(-1).lucky, 1);
});

test('Flip Three: a Freeze revealed is set aside and resolved only after all three cards, by the target', () => {
  const { g, ids } = midRound({ lines: [['2'], ['9'], ['4']], turn: 0, top: ['F3', 'FZ', '5', '6', '11'] });
  ok(g, 0, { type: 'hit' });
  const mark = g.seq;
  ok(g, 0, { type: 'target', target: 1 });
  assert.deepEqual(lineOf(g, 1), ['9', 'F3', '5', '6'], 'all three cards flipped; Freeze not yet placed');
  assert.equal(g.pending.kind, 'target');
  assert.equal(g.pending.seat, 1, 'the player who revealed it plays it');
  assert.equal(g.pending.card, ids.top[1]);
  assert.deepEqual(g.pending.options, [0, 1, 2]);
  // (Only draw/aside/choose events are used here; see the ENGINE BUG todo about 'play' events.)
  const seq = g.events
    .filter((e) => e.seq > mark && ['draw', 'aside', 'choose'].includes(e.t))
    .map((e) => `${e.t}:${lab(e.c)}`);
  assert.deepEqual(seq, ['draw:FZ', 'aside:FZ', 'draw:5', 'draw:6', 'choose:FZ'], 'Freeze set aside, then two more cards, then played');
  ok(g, 1, { type: 'target', target: 2 });
  assert.equal(g.players[2].status, 'frozen');
  assert.deepEqual(lineOf(g, 2), ['4', 'FZ']);
  assert.equal(topOfDeck(g), '11');
  assert.equal(g.pending.kind, 'turn');
  assert.equal(g.pending.seat, 1);
});

test('Flip Three: a set-aside Freeze is discarded if the target busts', () => {
  const { g, ids } = midRound({ lines: [['2'], ['9'], ['4']], turn: 0, top: ['F3', 'FZ', '9', '7'] });
  ok(g, 0, { type: 'hit' });
  ok(g, 0, { type: 'target', target: 1 });
  assert.equal(g.players[1].status, 'busted');
  assert.deepEqual(lineOf(g, 1), ['9', 'F3', '9']);
  assert.ok(g.discard.includes(ids.top[1]), 'the Freeze went to the discard pile');
  assert.equal(g.pending.kind, 'turn');
  assert.equal(g.pending.seat, 2);
  assert.equal(g.players[0].status, 'active');
  assert.equal(g.players[2].status, 'active');
  assert.equal(topOfDeck(g), '7');
});

test('Flip Three: a set-aside card is discarded when a Flip 7 ends the round first', () => {
  const { g, ids } = midRound({ lines: [['2'], ['0', '1', '3', '4', '5', '6'], ['4']], turn: 0, top: ['F3', 'FZ', '8', '9'] });
  ok(g, 0, { type: 'hit' });
  ok(g, 0, { type: 'target', target: 1 });
  assert.equal(g.lucky, 1);
  assert.equal(g.phase, 'roundOver');
  assert.ok(g.discard.includes(ids.top[1]), 'the set-aside Freeze was discarded');
  assert.equal(topOfDeck(g), '9');
  assert.deepEqual(scores(g), [2, 27 + 15, 4]);
});

test('Flip Three: a Flip Three revealed inside a Flip Three is resolved afterwards (nested)', () => {
  const { g } = midRound({ lines: [['2'], ['9'], ['4']], turn: 0, top: ['F3', 'F3', '5', '6', '1', '3', '8', '12'] });
  ok(g, 0, { type: 'hit' });
  ok(g, 0, { type: 'target', target: 1 });
  assert.deepEqual(lineOf(g, 1), ['9', 'F3', '5', '6']);
  assert.equal(g.pending.kind, 'target');
  assert.equal(lab(g.pending.card), 'F3');
  assert.equal(g.pending.seat, 1);
  ok(g, 1, { type: 'target', target: 2 });
  assert.deepEqual(lineOf(g, 2), ['4', 'F3', '1', '3', '8']);
  assert.equal(topOfDeck(g), '12');
  assert.equal(g.pending.kind, 'turn');
  assert.equal(g.pending.seat, 1);
});

test('Flip Three: several set-aside cards are resolved one by one in the order they were revealed', () => {
  const { g } = midRound({ lines: [['2'], ['9'], ['4']], turn: 0, top: ['F3', 'FZ', 'F3', '5', '1', '6', '8', '12'] });
  ok(g, 0, { type: 'hit' });
  ok(g, 0, { type: 'target', target: 1 });
  assert.deepEqual(lineOf(g, 1), ['9', 'F3', '5'], 'Freeze and Flip Three both set aside; they count toward the three');
  assert.equal(lab(g.pending.card), 'FZ', 'the Freeze was revealed first');
  ok(g, 1, { type: 'target', target: 0 });
  assert.equal(g.players[0].status, 'frozen');
  assert.equal(lab(g.pending.card), 'F3');
  assert.deepEqual(g.pending.options, [1, 2]);
  ok(g, 1, { type: 'target', target: 2 });
  assert.deepEqual(lineOf(g, 2), ['4', 'F3', '1', '6', '8']);
  assert.equal(topOfDeck(g), '12');
  assert.equal(g.pending.seat, 1);
});

test('Flip Three: set-aside cards are still played by their revealer after that player froze themself (design)', () => {
  const { g } = midRound({ lines: [['2'], ['9'], ['4']], turn: 0, top: ['F3', 'FZ', 'F3', '5', '1', '6', '8', '12'] });
  ok(g, 0, { type: 'hit' });
  ok(g, 0, { type: 'target', target: 1 });
  ok(g, 1, { type: 'target', target: 1 });
  assert.equal(g.players[1].status, 'frozen');
  assert.deepEqual(lineOf(g, 1), ['9', 'F3', '5', 'FZ']);
  assert.equal(g.pending.kind, 'target');
  assert.equal(g.pending.seat, 1);
  assert.deepEqual(g.pending.options, [0, 2], 'a frozen player can no longer be targeted');
  ok(g, 1, { type: 'target', target: 0 });
  assert.deepEqual(lineOf(g, 0), ['2', 'F3', '1', '6', '8']);
  assert.equal(g.pending.kind, 'turn');
  assert.equal(g.pending.seat, 2);
});

test('Flip Three: set-aside cards are discarded when nobody is left active to receive them (design)', () => {
  const { g, ids } = midRound({
    lines: [['2'], ['9'], ['4']], status: ['active', 'stayed', 'stayed'], turn: 0, top: ['F3', 'FZ', 'F3', '5', '12'],
  });
  ok(g, 0, { type: 'hit' });
  assert.equal(chose(g), false, 'only active player: everything is played on yourself automatically');
  assert.equal(g.players[0].status, 'frozen');
  assert.deepEqual(lineOf(g, 0), ['2', 'F3', '5', 'FZ']);
  assert.equal(g.phase, 'roundOver');
  assert.ok(g.discard.includes(ids.top[2]), 'the second Flip Three was discarded');
  assert.equal(topOfDeck(g), '12');
  assert.deepEqual(scores(g), [7, 9, 4]);
});

test('Flip Three: a Second Chance revealed is kept at once and can save the target later in the same Flip Three', () => {
  const { g, ids } = midRound({ lines: [['2'], ['9'], ['4']], turn: 0, top: ['F3', 'SC', '9', '6', '11'] });
  ok(g, 0, { type: 'hit' });
  ok(g, 0, { type: 'target', target: 1 });
  assert.equal(g.players[1].status, 'active');
  assert.deepEqual(lineOf(g, 1), ['9', 'F3', '6']);
  assert.ok(g.discard.includes(ids.top[1]) && g.discard.includes(ids.top[2]), 'Second Chance and the duplicate 9 discarded');
  assert.equal(topOfDeck(g), '11', 'the saved duplicate counted as one of the three cards');
  assert.equal(g.pending.seat, 1);
});

test('Flip Three: a Second Chance already held protects the target; the saved duplicate counts toward the three', () => {
  const { g } = midRound({ lines: [['2'], ['9', 'SC'], ['4']], turn: 0, top: ['F3', '9', '6', '7', '11'] });
  ok(g, 0, { type: 'hit' });
  ok(g, 0, { type: 'target', target: 1 });
  assert.equal(g.players[1].status, 'active');
  assert.deepEqual(lineOf(g, 1), ['9', 'F3', '6', '7']);
  assert.equal(topOfDeck(g), '11');
});

test('Flip Three: an extra Second Chance revealed is given away right away (design) and the Flip Three continues', () => {
  const { g, ids } = midRound({ lines: [['2'], ['9', 'SC'], ['4']], turn: 0, top: ['F3', 'SC', '6', '7', '11'] });
  ok(g, 0, { type: 'hit' });
  ok(g, 0, { type: 'target', target: 1 });
  assert.equal(g.pending.kind, 'target');
  assert.equal(g.pending.seat, 1);
  assert.equal(g.pending.card, ids.top[1]);
  assert.deepEqual(g.pending.options, [0, 2]);
  assert.equal(typeof act(g, 1, { type: 'target', target: 1 }), 'string', 'cannot keep a second one');
  ok(g, 1, { type: 'target', target: 2 });
  assert.deepEqual(lineOf(g, 2), ['4', 'SC']);
  assert.deepEqual(lineOf(g, 1), ['9', 'SC', 'F3', '6', '7']);
  assert.equal(topOfDeck(g), '11');
  assert.equal(g.pending.kind, 'turn');
  assert.equal(g.pending.seat, 1);
});

test('Flip Three: the only active player must play it on themself (automatic)', () => {
  const { g } = midRound({
    lines: [['12'], ['9'], ['4']], status: ['active', 'stayed', 'stayed'], turn: 0, top: ['F3', '1', '2', '3', '11'],
  });
  ok(g, 0, { type: 'hit' });
  assert.equal(chose(g), false);
  assert.deepEqual(lineOf(g, 0), ['12', 'F3', '1', '2', '3']);
  assert.equal(topOfDeck(g), '11');
  assert.deepEqual(g.pending, { kind: 'turn', seat: 0, canStay: true, since: g.clock });
});

// ---------------------------------------------------------------------------
// Second Chance

test('Second Chance: a duplicate number is cancelled; Second Chance and the duplicate are both discarded', () => {
  const { g, ids } = midRound({ lines: [['5', 'SC'], ['8'], ['3']], turn: 0, top: ['5', '11'] });
  ok(g, 0, { type: 'hit' });
  assert.equal(g.players[0].status, 'active');
  assert.deepEqual(lineOf(g, 0), ['5']);
  assert.ok(g.discard.includes(ids.lines[0][1]), 'Second Chance discarded');
  assert.ok(g.discard.includes(ids.top[0]), 'duplicate 5 discarded');
  assert.equal(g.pending.seat, 1);
});

test('Second Chance: it is used up, so the next duplicate busts (0 points)', () => {
  const { g } = midRound({ lines: [['5', 'SC'], ['8'], ['3']], status: ['active', 'stayed', 'stayed'], turn: 0, top: ['5', '5'] });
  ok(g, 0, { type: 'hit' });
  assert.equal(g.players[0].status, 'active');
  assert.equal(g.pending.seat, 0);
  ok(g, 0, { type: 'hit' });
  assert.equal(g.players[0].status, 'busted');
  assert.equal(g.phase, 'roundOver');
  assert.deepEqual(scores(g), [0, 8, 3]);
});

test('Second Chance: only one at a time; an extra one must go to another active player who has none', () => {
  const { g, ids } = midRound({ n: 4, lines: [['5', 'SC'], ['8', 'SC'], ['3'], ['4']], turn: 0, top: ['SC'] });
  ok(g, 0, { type: 'hit' });
  assert.equal(g.pending.kind, 'target');
  assert.equal(g.pending.card, ids.top[0]);
  assert.deepEqual(g.pending.options, [2, 3]);
  assert.deepEqual(targetOptions(g, 0, ids.top[0]), [2, 3]);
  assert.equal(typeof act(g, 0, { type: 'target', target: 0 }), 'string', 'cannot keep it');
  assert.equal(typeof act(g, 0, { type: 'target', target: 1 }), 'string', 'seat 1 already has one');
  ok(g, 0, { type: 'target', target: 2 });
  assert.deepEqual(lineOf(g, 2), ['3', 'SC']);
  assert.deepEqual(lineOf(g, 0), ['5', 'SC']);
  assert.equal(g.pending.kind, 'turn');
  assert.equal(g.pending.seat, 1);
});

test('Second Chance: with exactly one eligible player the extra one goes to them automatically (design)', () => {
  const { g } = midRound({ lines: [['5', 'SC'], ['8', 'SC'], ['3']], turn: 0, top: ['SC'] });
  ok(g, 0, { type: 'hit' });
  assert.equal(chose(g), false);
  assert.deepEqual(lineOf(g, 2), ['3', 'SC']);
  assert.equal(g.pending.seat, 1);
});

test('Second Chance: an extra one is discarded if every other active player has one', () => {
  const { g, ids } = midRound({
    lines: [['5', 'SC'], ['8', 'SC'], ['3']], status: ['active', 'active', 'stayed'], turn: 0, top: ['SC'],
  });
  ok(g, 0, { type: 'hit' });
  assert.ok(g.discard.includes(ids.top[0]));
  assert.deepEqual(lineOf(g, 0), ['5', 'SC']);
  assert.deepEqual(lineOf(g, 2), ['3'], 'a stayed player cannot receive it');
  assert.equal(g.pending.seat, 1);
});

test('Second Chance: an extra one is discarded if there are no other active players', () => {
  const { g, ids } = midRound({
    lines: [['5', 'SC'], ['8'], ['3']], status: ['active', 'stayed', 'frozen'], turn: 0, top: ['SC'],
  });
  ok(g, 0, { type: 'hit' });
  assert.ok(g.discard.includes(ids.top[0]));
  assert.deepEqual(lineOf(g, 0), ['5', 'SC']);
  assert.equal(g.pending.seat, 0);
});

test('Second Chance: unused ones are discarded at the end of the round (worth no points)', () => {
  const { g, ids } = midRound({
    lines: [['5', 'SC'], ['8'], ['3']], status: ['active', 'stayed', 'stayed'], turn: 0, top: ['1', '2', '4'],
  });
  ok(g, 0, { type: 'stay' });
  assert.equal(g.phase, 'roundOver');
  assert.deepEqual(scores(g), [5, 8, 3]);
  ok(g, 0, { type: 'next' });
  assert.ok(g.discard.includes(ids.lines[0][1]), 'the unused Second Chance is in the discard pile');
  assert.ok(g.players.every((p) => !p.line.some(isSecondChance)));
});

// ---------------------------------------------------------------------------
// Stay

test('Stay: not allowed with no cards in front of you; Hit still is', () => {
  const { g } = midRound({ lines: [[], ['8'], ['3']], turn: 0, top: ['6'] });
  assert.equal(g.pending.canStay, false);
  const before = JSON.stringify(g);
  assert.equal(typeof act(g, 0, { type: 'stay' }), 'string');
  assert.equal(JSON.stringify(g), before, 'a rejected action changes nothing');
  ok(g, 0, { type: 'hit' });
  assert.deepEqual(lineOf(g, 0), ['6']);
  assert.equal(g.pending.seat, 1);
});

test('Stay: allowed with only a modifier, or only an Action card, in front of you (design: any card)', () => {
  const { g } = midRound({ lines: [['+4'], ['SC'], ['3']], turn: 0 });
  assert.equal(g.pending.canStay, true);
  ok(g, 0, { type: 'stay' });
  assert.deepEqual(g.pending, { kind: 'turn', seat: 1, canStay: true, since: g.clock });
  ok(g, 1, { type: 'stay' });
  ok(g, 2, { type: 'stay' });
  assert.equal(g.phase, 'roundOver');
  assert.deepEqual(scores(g), [4, 0, 3]);
});

test('Stay: banks points at the end of the round and takes you out of the turn order', () => {
  const { g } = midRound({ lines: [['7', '+2'], ['8'], ['3']], turn: 0, top: ['11', '12'] });
  ok(g, 0, { type: 'stay' });
  assert.equal(g.players[0].status, 'stayed');
  assert.equal(g.players[0].total, 0, 'banked at the end of the round, not immediately');
  ok(g, 1, { type: 'hit' });
  ok(g, 2, { type: 'hit' });
  assert.equal(g.pending.seat, 1, 'the stayed player is skipped');
  ok(g, 1, { type: 'stay' });
  ok(g, 2, { type: 'stay' });
  assert.deepEqual(scores(g), [9, 19, 15]);
  assert.deepEqual(totals(g), [9, 19, 15]);
});

// ---------------------------------------------------------------------------
// Turn order

test('Turns go left around the table, skipping players who stayed, froze or busted', () => {
  const { g } = midRound({
    n: 5,
    lines: [['1'], ['2'], ['3', 'FZ'], ['4', '4'], ['5']],
    status: ['active', 'stayed', 'frozen', 'busted', 'active'],
    turn: 0,
    top: ['6', '7', '8'],
  });
  ok(g, 0, { type: 'hit' });
  assert.equal(g.pending.seat, 4);
  ok(g, 4, { type: 'hit' });
  assert.equal(g.pending.seat, 0, 'wraps around');
  ok(g, 0, { type: 'hit' });
  assert.equal(g.pending.seat, 4);
  assert.deepEqual(lineOf(g, 0), ['1', '6', '8']);
  assert.deepEqual(lineOf(g, 4), ['5', '7']);
});

test('Turns: only the player being asked may act, and only with a fitting action', () => {
  const { g } = midRound({ lines: [['1'], ['2'], ['3']], turn: 0 });
  const before = JSON.stringify(g);
  for (const [seat, action] of [
    [1, { type: 'hit' }], [2, { type: 'stay' }], [0, { type: 'target', target: 1 }], [0, { type: 'next' }],
    [0, { type: 'dance' }], [7, { type: 'hit' }], [0, undefined],
  ]) {
    assert.equal(typeof act(g, seat, action), 'string', `seat ${seat} ${JSON.stringify(action)} must be rejected`);
  }
  assert.equal(JSON.stringify(g), before);
});

test('Turns: a player who busts on a Hit is out, scores 0, and gets no more turns', () => {
  const { g } = midRound({ lines: [['5', '+10'], ['8'], ['3']], turn: 0, top: ['5'] });
  ok(g, 0, { type: 'hit' });
  assert.equal(g.players[0].status, 'busted');
  assert.equal(g.pending.seat, 1);
  ok(g, 1, { type: 'stay' });
  assert.equal(g.pending.seat, 2);
  ok(g, 2, { type: 'stay' });
  assert.equal(g.phase, 'roundOver');
  assert.deepEqual(scores(g), [0, 8, 3], 'busted: 0 even with a modifier');
});

// ---------------------------------------------------------------------------
// Scoring

function score(...specs) {
  const k = picker();
  return scoreLine(specs.map(k));
}

test('Scoring: the rulebook examples (pages 5, 10, 11)', () => {
  assert.equal(score('11', '5', '12', '+4').total, 32, 'page 5: 11+5+12 = 28, +4 = 32');
  assert.equal(score('3', '11', '5', '7', '10').total, 36, 'step 1: numbers');
  assert.equal(score('3', '11', '5', '7', '10', 'x2').total, 72, 'step 2: x2');
  assert.equal(score('3', '11', '5', '7', '10', '+10').total, 46, 'step 3: bonus points');
  assert.equal(score('3', '11', '5', '7', '10', '9', '4').total, 64, 'step 4: Flip 7 = 49 + 15');
});

test('Scoring: x2 doubles only the Number cards, before +modifiers and before the +15', () => {
  assert.equal(score('3', '11', '5', '7', '10', 'x2', '+10').total, 82, '36 x2 = 72, +10 = 82 (not 92)');
  assert.equal(score('3', '11', '5', '7', '10', '9', '4', 'x2').total, 113, '49 x2 = 98, +15 = 113 (not 128)');
  assert.equal(score('3', '11', '5', '7', '10', '9', '4', 'x2', '+10').total, 123);
  assert.equal(score('1', '2', 'x2', '+2', '+4', '+6', '+8', '+10').total, 36, '3 x2 = 6, +30');
});

test('Scoring: modifier-only lines score their bonus points, except x2 (nothing to double)', () => {
  assert.equal(score('+4').total, 4);
  assert.equal(score('+2', '+4', '+6', '+8', '+10').total, 30);
  assert.equal(score('x2').total, 0);
  assert.equal(score('x2', '+6').total, 6);
  assert.equal(score().total, 0);
});

test('Scoring: Action cards are worth nothing; 0 counts toward Flip 7; modifiers do not', () => {
  assert.equal(score('5', 'SC', 'F3', 'FZ').total, 5);
  const z = score('0', '1', '2', '3', '4', '5', '6');
  assert.equal(z.lucky, true);
  assert.equal(z.total, 21 + 15);
  const m = score('1', '2', '3', '4', '5', '6', '+2', 'x2');
  assert.equal(m.lucky, false, 'six numbers plus modifiers is not a Flip 7');
  assert.equal(m.total, 44);
});

test('Scoring: at round end busted players get 0, stayed/frozen/active players score their line, totals add up', () => {
  const { g } = midRound({
    n: 4,
    lines: [['3', '11', 'x2', '+10'], ['7', '7', '+8'], ['12', 'FZ'], ['5']],
    status: ['active', 'busted', 'frozen', 'active'],
    totals: [50, 40, 30, 20],
    turn: 0,
  });
  ok(g, 0, { type: 'stay' });
  assert.equal(g.phase, 'playing');
  assert.equal(g.pending.seat, 3);
  ok(g, 3, { type: 'stay' });
  assert.equal(g.phase, 'roundOver');
  assert.deepEqual(scores(g), [38, 0, 12, 5]);
  assert.deepEqual(totals(g), [88, 40, 42, 25]);
  assert.deepEqual(g.history.at(-1), { round: 1, scores: [38, 0, 12, 5], lucky: -1 });
});

test('Flip 7 on a Hit ends the round immediately for everyone; the others keep what they have (design)', () => {
  const { g } = midRound({
    lines: [['0', '1', '2', '3', '4', '5'], ['9', '+4'], ['7', '7']],
    status: ['active', 'active', 'busted'],
    turn: 0,
    top: ['6', '12'],
  });
  ok(g, 0, { type: 'hit' });
  assert.equal(g.lucky, 0);
  assert.equal(g.phase, 'roundOver');
  assert.equal(topOfDeck(g), '12');
  assert.deepEqual(scores(g), [21 + 15, 13, 0]);
});

test('Flip 7: modifier cards do not count toward the seven', () => {
  const { g } = midRound({ lines: [['1', '2', '3', '4', '5', '+2', 'x2'], ['9'], ['4']], turn: 0, top: ['6'] });
  ok(g, 0, { type: 'hit' });
  assert.equal(g.lucky, -1);
  assert.equal(g.phase, 'playing');
  assert.equal(g.pending.seat, 1);
});

// ---------------------------------------------------------------------------
// End of the game

test('Game end: only at the end of a round, even if someone passes 200 mid-round', () => {
  const { g } = midRound({ lines: [['12'], ['2'], ['3']], totals: [190, 0, 0], turn: 0, top: ['6'] });
  ok(g, 0, { type: 'stay' });
  assert.equal(g.phase, 'playing');
  assert.equal(g.players[0].total, 190);
  ok(g, 1, { type: 'hit' });
  assert.equal(g.phase, 'playing');
  ok(g, 2, { type: 'stay' });
  ok(g, 1, { type: 'stay' });
  assert.equal(g.phase, 'gameOver');
  assert.deepEqual(totals(g), [202, 8, 3]);
  assert.deepEqual(g.winners, [0]);
});

test('Game end: the player with the most points wins, not the first to reach 200', () => {
  const { g } = midRound({ lines: [['10'], ['12'], ['1']], totals: [195, 199, 0], turn: 0 });
  finishRound(g);
  assert.equal(g.phase, 'gameOver');
  assert.deepEqual(totals(g), [205, 211, 1]);
  assert.deepEqual(g.winners, [1]);
});

test('Game end: a tie for the most points is a shared win (design)', () => {
  const { g } = midRound({ lines: [['10'], ['5'], ['1']], totals: [190, 195, 0], turn: 0 });
  finishRound(g);
  assert.equal(g.phase, 'gameOver');
  assert.deepEqual(g.winners, [0, 1]);
});

test('Game end: below the target the game goes on; after game over no further round can be dealt', () => {
  const a = midRound({ lines: [['10'], ['5'], ['1']], totals: [189, 150, 0], turn: 0 }).g;
  finishRound(a);
  assert.equal(a.phase, 'roundOver');
  assert.deepEqual(a.winners, []);
  ok(a, 0, { type: 'next' });
  assert.equal(a.phase, 'playing');
  assert.equal(a.round, 2);

  const b = midRound({ lines: [['10'], ['5'], ['1']], totals: [195, 0, 0], turn: 0 }).g;
  finishRound(b);
  assert.equal(b.phase, 'gameOver');
  assert.equal(typeof act(b, 0, { type: 'next' }), 'string');
});

test('Game end: the Flip 7 bonus can carry a player over 200 and the game ends with that round', () => {
  const { g } = midRound({
    lines: [['0', '1', '2', '3', '4', '5'], ['9'], ['4']], totals: [170, 190, 0], turn: 0, top: ['6'],
  });
  ok(g, 0, { type: 'hit' });
  assert.equal(g.phase, 'gameOver');
  assert.deepEqual(totals(g), [206, 199, 4]);
  assert.deepEqual(g.winners, [0]);
});

test('Game end: the shorter 100-point game option ends at 100', () => {
  const { g } = midRound({ lines: [['10'], ['5'], ['1']], totals: [90, 0, 0], turn: 0, target: 100 });
  finishRound(g);
  assert.equal(g.phase, 'gameOver');
  assert.deepEqual(g.winners, [0]);
});

// ---------------------------------------------------------------------------
// Deck running out, discard pile between rounds

test('Reshuffle: when the deck runs out mid-round the discard pile becomes the new deck; cards on the table stay, even busted ones', () => {
  const { g } = midRound({
    lines: [['5'], ['8', '8'], ['3']], status: ['active', 'busted', 'active'], turn: 0, top: ['4'], rest: 'discard',
  });
  assert.equal(g.deck.length, 1);
  ok(g, 0, { type: 'hit' });
  assert.deepEqual(lineOf(g, 0), ['5', '4']);
  assert.equal(g.deck.length, 0);
  assert.equal(g.pending.seat, 2);

  const oldDiscard = new Set(g.discard);
  const tableBefore = g.players.map((p) => [...p.line]);
  const mark = g.seq;
  ok(g, 2, { type: 'hit' });
  const reshuffles = g.events.filter((e) => e.seq > mark && e.t === 'reshuffle');
  assert.equal(reshuffles.length, 1);
  assert.equal(reshuffles[0].n, oldDiscard.size);
  assert.deepEqual(g.players[0].line, tableBefore[0]);
  assert.deepEqual(g.players[1].line, tableBefore[1], "the busted player's cards stay where they are");
  assert.deepEqual(g.players[2].line.slice(0, 1), tableBefore[2]);
  assert.equal(g.discard.length, 0);
  assert.equal(g.deck.length, oldDiscard.size - 1, 'one card was drawn from the new deck');
  for (const id of g.deck) assert.ok(oldDiscard.has(id), 'the new deck is made only of discarded cards');
  const drawn = [...g.players[2].line.slice(1), ...(g.pending.kind === 'target' ? [g.pending.card] : [])];
  assert.equal(drawn.length, 1);
  assert.ok(oldDiscard.has(drawn[0]));
});

test('Between rounds: all cards from the round go to the discard pile, not back into the deck; the deck is not reshuffled', () => {
  const { g, ids } = midRound({
    lines: [['5', 'SC'], ['8', '+4'], ['3', 'FZ']],
    status: ['active', 'stayed', 'frozen'],
    turn: 0,
    dealer: 2,
    top: ['1', '2', '4'],
  });
  ok(g, 0, { type: 'stay' });
  assert.equal(g.phase, 'roundOver');
  assert.deepEqual(scores(g), [5, 12, 3]);
  const deckBefore = [...g.deck];
  const tableCards = ids.lines.flat();
  ok(g, 0, { type: 'next' });
  assert.equal(g.round, 2);
  assert.equal(g.dealer, 0);
  assert.deepEqual([...g.discard].sort((a, b) => a - b), [...tableCards].sort((a, b) => a - b));
  assert.deepEqual(g.deck, deckBefore.slice(0, deckBefore.length - 3), 'the remaining deck is passed on unchanged');
  assert.deepEqual(lineOf(g, 1), ['1']);
  assert.deepEqual(lineOf(g, 2), ['2']);
  assert.deepEqual(lineOf(g, 0), ['4']);
  assert.ok(g.players.every((p) => p.status === 'active' && p.roundScore === null));
  assert.equal(g.pending.seat, 1);
});

test('Between rounds: if the deck is empty, the next deal reshuffles the discards, including the last round\'s cards', () => {
  const { g } = midRound({ lines: [['5'], ['8'], ['3']], turn: 0, rest: 'discard' });
  assert.equal(g.deck.length, 0);
  finishRound(g);
  const mark = g.seq;
  ok(g, 0, { type: 'next' });
  const r = g.events.filter((e) => e.seq > mark && e.t === 'reshuffle');
  assert.equal(r.length, 1);
  assert.equal(r[0].n, DECK_SIZE, 'all 94 cards were in the discard pile and got shuffled');
});

test('Robustness: if every card is on the table (deck and discard empty) the round ends instead of hanging', () => {
  // Not covered by the rulebook; seat 1 (busted) holds almost every card.
  const k = picker();
  const g = table(2);
  const p0 = [k('5')];
  const top = [k('6')];
  const restIds = ALL_IDS.filter((id) => !k.used.has(id));
  g.players[0].line = p0;
  g.players[0].status = 'active';
  g.players[1].line = restIds;
  g.players[1].status = 'busted';
  g.players.forEach((p) => { p.total = 0; p.roundScore = null; });
  Object.assign(g, {
    deck: top, discard: [], phase: 'playing', stage: 'turns', stack: [], lucky: -1, outOfCards: false,
    history: [], winners: [], turn: 0, turnDone: false,
    pending: { kind: 'turn', seat: 0, canStay: true, since: 0 },
  });
  conserve(g);
  ok(g, 0, { type: 'hit' });
  assert.deepEqual(lineOf(g, 0), ['5', '6']);
  assert.equal(g.pending.seat, 0);
  ok(g, 0, { type: 'hit' });
  assert.equal(g.phase, 'roundOver');
  assert.deepEqual(scores(g), [11, 0]);
});

// ---------------------------------------------------------------------------
// Event log (not a rulebook rule, but the UI replays these events)

// Regression: the target seat once overwrote the event type ('play' events
// arrived as { t: <seat> }), so the screen never animated played Action cards.
test('playing an Action card on a player emits a "play" event naming the target', () => {
  const { g } = midRound({ lines: [['5'], ['8'], ['3']], turn: 0, top: ['FZ'] });
  ok(g, 0, { type: 'hit' });
  const mark = g.seq;
  ok(g, 0, { type: 'target', target: 1 });
  const e = g.events.find((x) => x.seq === mark + 1);
  assert.equal(e.t, 'play');
  assert.equal(e.p, 0);
  assert.equal(e.to, 1);
});

// ---------------------------------------------------------------------------
// Card conservation and rule invariants under random play

function checkPlaying(g) {
  conserve(g);
  const P = g.pending;
  assert.ok(P, 'a game in progress always waits on someone');
  g.players.forEach((p) => {
    const nums = p.line.filter(isNumber).map((id) => CARDS[id].value);
    const unique = new Set(nums).size;
    assert.ok(p.line.filter(isSecondChance).length <= 1, 'at most one Second Chance in front of a player');
    if (p.status === 'busted') {
      assert.equal(nums.length, unique + 1, 'a busted line has exactly one duplicate');
      assert.ok(!p.line.some(isSecondChance), 'a Second Chance would have saved them');
    } else {
      assert.equal(nums.length, unique, 'no duplicate numbers unless busted');
    }
    if (p.status === 'active') assert.ok(nums.length < 7, 'seven numbers ends the round');
    if (p.status === 'stayed') assert.ok(p.line.length > 0, 'stayed with at least one card');
  });
  if (P.kind === 'turn') {
    assert.equal(P.seat, g.turn);
    assert.equal(g.players[P.seat].status, 'active');
    assert.equal(P.canStay, g.players[P.seat].line.length > 0);
    assert.equal(g.stack.length, 0, 'no Flip Three left unfinished when a turn is offered');
    assert.equal(g.stage, 'turns');
  } else {
    assert.equal(P.kind, 'target');
    assert.ok(P.options.length >= 2, 'a single legal target is resolved automatically');
    for (const o of P.options) assert.equal(g.players[o].status, 'active', 'only active players can be targeted');
    if (isSecondChance(P.card)) {
      assert.ok(!P.options.includes(P.seat));
      for (const o of P.options) assert.ok(!g.players[o].line.some(isSecondChance));
    }
  }
}

function checkRoundOver(g, prevTotals) {
  conserve(g);
  assert.equal(g.pending, null);
  assert.equal(g.stack.length, 0);
  const h = g.history.at(-1);
  assert.equal(h.round, g.round);
  g.players.forEach((p, i) => {
    const expect = p.status === 'busted' ? 0 : scoreLine(p.line).total;
    assert.equal(p.roundScore, expect);
    assert.equal(h.scores[i], expect);
    assert.equal(p.total, prevTotals[i] + expect);
  });
  if (g.lucky >= 0) {
    const p = g.players[g.lucky];
    assert.notEqual(p.status, 'busted');
    assert.equal(new Set(p.line.filter(isNumber).map((id) => CARDS[id].value)).size, 7);
  } else {
    assert.ok(g.outOfCards || g.players.every((p) => p.status !== 'active'), 'round ended with nobody active');
  }
  const best = Math.max(...totals(g));
  if (best >= g.settings.target) {
    assert.equal(g.phase, 'gameOver');
    assert.deepEqual(g.winners, g.players.flatMap((p, i) => (p.total === best ? [i] : [])));
  } else {
    assert.equal(g.phase, 'roundOver');
  }
}

test('Fuzz: random legal play keeps every card accounted for and every rule invariant', () => {
  for (let seed = 1; seed <= 150; seed++) {
    const n = 1 + (seed % 6);
    const g = newGame({ seed, target: seed % 2 ? 200 : 100 });
    for (let i = 0; i < n; i++) addPlayer(g, { id: `p${i}`, name: `P${i}`, avatar: 'fox' });
    assert.equal(startGame(g, { seed }), null);
    let r = seed * 2654435761;
    const rand = () => {
      r = (Math.imul(r, 1664525) + 1013904223) >>> 0;
      return r / 4294967296;
    };
    let prevTotals = totals(g).map(() => 0);
    let steps = 0;
    for (;;) {
      if (++steps > 50000) throw new Error(`seed ${seed}: game did not finish`);
      if (g.phase === 'playing') {
        checkPlaying(g);
        const P = g.pending;
        if (n > 1 && rand() < 0.1) {
          const other = (P.seat + 1 + Math.floor(rand() * (n - 1))) % n;
          const before = JSON.stringify(g);
          assert.equal(typeof act(g, other, { type: P.kind === 'turn' ? 'hit' : 'target', target: P.seat }), 'string');
          assert.equal(JSON.stringify(g), before, 'an out-of-turn action is rejected without side effects');
        }
        if (P.kind === 'turn') ok(g, P.seat, { type: !P.canStay || rand() < 0.65 ? 'hit' : 'stay' });
        else ok(g, P.seat, { type: 'target', target: P.options[Math.floor(rand() * P.options.length)] });
        continue;
      }
      checkRoundOver(g, prevTotals);
      if (g.phase === 'gameOver') break;
      prevTotals = totals(g);
      const deckBefore = [...g.deck];
      const tableCards = g.players.flatMap((p) => p.line);
      const dealer = g.dealer;
      const mark = g.seq;
      ok(g, 0, { type: 'next' });
      assert.equal(g.dealer, (dealer + 1) % n, 'the deal passes to the left');
      const reshuffled = g.events.some((e) => e.seq > mark && e.t === 'reshuffle');
      if (!reshuffled) {
        const discard = new Set(g.discard);
        for (const id of tableCards) assert.ok(discard.has(id), 'last round\'s cards wait in the discard pile');
        assert.deepEqual(g.deck, deckBefore.slice(0, g.deck.length), 'the deck is only drawn from, never reshuffled');
      }
    }
  }
});
