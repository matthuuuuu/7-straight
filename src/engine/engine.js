// The rules of the game as a pure state machine.
//
// Everything here is plain data in, plain data out (the state object is
// mutated in place; callers clone it first when they need the old copy).
// The same code runs on the server for online rooms and in the browser for
// games on one device, so both always follow identical rules.
//
// Round flow (from the rulebook):
//   1. Deal: starting left of the Dealer and ending with the Dealer, each
//      player still in the round is dealt one card face up. Action cards
//      pause the deal and are resolved immediately.
//   2. Turns: starting left of the Dealer, each active player in turn
//      chooses Hit (take a card) or Stay (bank points and leave the round).
//      You may only Stay if you have at least one card in front of you.
//   3. The round ends when nobody is active, or instantly when someone has
//      seven unique Number cards (+15 bonus).
//   4. Scores are added. At the end of a round in which someone reaches the
//      target (200), the highest total wins.

import { CARDS, ALL_IDS, isNumber, isSecondChance, scoreLine, LUCKY_COUNT } from './cards.js';
import { randomInt, shuffle, normalizeSeed } from './rng.js';

export const MAX_PLAYERS = 8;
export const MAX_EVENTS = 150;
export const TARGETS = [200, 100];

// ---------------------------------------------------------------------------
// Creating a game and managing the lobby

export function newGame({ seed, target = 200, now = 0 } = {}) {
  return {
    phase: 'lobby', // lobby | playing | roundOver | gameOver
    settings: { target },
    players: [],
    round: 0,
    dealer: -1,
    deck: [],
    discard: [],
    stage: null, // deal | turns
    dealOrder: [],
    dealPos: 0,
    turn: -1,
    turnDone: false,
    // Flip Three cards being worked through. Each frame is
    // { t: seat, left: cards still to flip, deferred: [card ids set aside] }
    stack: [],
    // The decision the game is waiting on:
    //   { kind: 'turn', seat, canStay, since }
    //   { kind: 'target', seat, card, options: [seats], since }
    pending: null,
    lucky: -1, // seat that flipped seven unique numbers this round
    outOfCards: false,
    events: [],
    seq: 0,
    history: [], // [{ round, scores: [per seat], lucky }]
    winners: [],
    rng: normalizeSeed(seed),
    clock: now,
  };
}

export function addPlayer(state, { id, name, avatar, bot = false }) {
  if (state.phase !== 'lobby') return 'The game has already started';
  if (state.players.length >= MAX_PLAYERS) return `The table is full (${MAX_PLAYERS} players max)`;
  if (state.players.some((p) => p.id === id)) return 'Already at the table';
  state.players.push({
    id,
    name,
    avatar,
    bot,
    left: false,
    total: 0,
    line: [],
    status: 'active', // active | stayed | frozen | busted
    roundScore: null,
  });
  return null;
}

export function removePlayer(state, id) {
  if (state.phase !== 'lobby') return 'Players can only be removed in the lobby';
  const i = state.players.findIndex((p) => p.id === id);
  if (i < 0) return 'No such player';
  state.players.splice(i, 1);
  return null;
}

export function setTarget(state, target) {
  if (state.phase !== 'lobby') return 'The game has already started';
  if (!TARGETS.includes(target)) return 'Unknown game length';
  state.settings.target = target;
  return null;
}

/** Start (or restart) a game with the players currently seated. */
export function startGame(state, { seed, now } = {}) {
  if (state.players.length < 1) return 'Add at least one player';
  if (seed !== undefined) state.rng = normalizeSeed(seed);
  if (now !== undefined) state.clock = now;
  for (const p of state.players) {
    p.total = 0;
    p.line = [];
    p.status = 'active';
    p.roundScore = null;
  }
  state.round = 0;
  state.history = [];
  state.winners = [];
  state.deck = shuffle([...ALL_IDS], state);
  state.discard = [];
  const n = state.players.length;
  // Random first dealer; startRound moves the deal one seat to the left.
  state.dealer = (randomInt(state, n) + n - 1) % n;
  emit(state, 'gameStart', { target: state.settings.target });
  startRound(state);
  return null;
}

/** Everyone keeps their seat and goes back to the lobby. */
export function backToLobby(state) {
  state.phase = 'lobby';
  state.players = state.players.filter((p) => !p.left);
  for (const p of state.players) {
    p.total = 0;
    p.line = [];
    p.status = 'active';
    p.roundScore = null;
  }
  Object.assign(state, {
    round: 0, dealer: -1, deck: [], discard: [], stage: null, dealOrder: [], dealPos: 0,
    turn: -1, turnDone: false, stack: [], pending: null, lucky: -1, outOfCards: false,
    history: [], winners: [],
  });
  emit(state, 'lobby', {});
  return null;
}

// ---------------------------------------------------------------------------
// Player actions

/**
 * Apply an action by the player in `seat`. Returns an error message, or null
 * when the action was applied.
 *   { type: 'hit' } | { type: 'stay' } | { type: 'target', target: seat }
 *   { type: 'next' }  (deal the next round once a round is over)
 */
export function act(state, seat, action, now) {
  if (now !== undefined) state.clock = now;
  const P = state.pending;
  const p = state.players[seat];
  if (!p) return 'You are not playing in this game';
  switch (action?.type) {
    case 'hit': {
      if (state.phase !== 'playing' || P?.kind !== 'turn' || P.seat !== seat) return 'It is not your turn';
      state.pending = null;
      state.turnDone = true;
      drawFor(state, seat, 'hit', null);
      advance(state);
      return null;
    }
    case 'stay': {
      if (state.phase !== 'playing' || P?.kind !== 'turn' || P.seat !== seat) return 'It is not your turn';
      if (!P.canStay) return 'You need at least one card in front of you to stay';
      state.pending = null;
      state.turnDone = true;
      p.status = 'stayed';
      emit(state, 'stay', { p: seat, score: scoreLine(p.line).total });
      advance(state);
      return null;
    }
    case 'target': {
      if (state.phase !== 'playing' || P?.kind !== 'target' || P.seat !== seat) return 'There is nothing for you to choose';
      if (!P.options.includes(action.target)) return 'You can’t choose that player';
      state.pending = null;
      resolveTarget(state, seat, P.card, action.target, false);
      advance(state);
      return null;
    }
    case 'next': {
      if (state.phase !== 'roundOver') return 'The round is not over yet';
      startRound(state);
      return null;
    }
    default:
      return 'Unknown action';
  }
}

// ---------------------------------------------------------------------------
// Round mechanics

function emit(state, t, data) {
  state.seq += 1;
  state.events.push({ ...data, seq: state.seq, t }); // type last, so data can't overwrite it
  if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS);
}

export const isActive = (state, seat) => state.players[seat]?.status === 'active';

export function activeSeats(state) {
  const out = [];
  state.players.forEach((p, i) => {
    if (p.status === 'active') out.push(i);
  });
  return out;
}

function nextActiveFrom(state, start) {
  const n = state.players.length;
  for (let k = 0; k < n; k++) {
    const i = (((start + k) % n) + n) % n;
    if (isActive(state, i)) return i;
  }
  return -1;
}

export const hasSecondChance = (player) => player.line.some(isSecondChance);

function startRound(state) {
  // "Set all cards from the round to the side. Do not shuffle them back into
  // the deck." They wait in the discard pile until the deck runs out.
  for (const p of state.players) {
    state.discard.push(...p.line);
    p.line = [];
    p.status = 'active';
    p.roundScore = null;
  }
  const n = state.players.length;
  state.round += 1;
  state.dealer = (state.dealer + 1) % n; // the deal passes to the left
  state.dealOrder = Array.from({ length: n }, (_, k) => (state.dealer + 1 + k) % n);
  state.dealPos = 0;
  state.stage = 'deal';
  state.turn = -1;
  state.turnDone = false;
  state.stack = [];
  state.pending = null;
  state.lucky = -1;
  state.outOfCards = false;
  state.phase = 'playing';
  emit(state, 'roundStart', { round: state.round, dealer: state.dealer });
  advance(state);
}

/**
 * Keep the round moving until the game needs a decision from someone
 * (Hit/Stay, or choosing who gets an Action card) or the round ends.
 */
function advance(state) {
  for (let guard = 0; guard < 2000; guard++) {
    if (state.phase !== 'playing' || state.pending) return;

    if (state.lucky >= 0 || state.outOfCards || activeSeats(state).length === 0) {
      endRound(state);
      return;
    }

    if (state.stack.length) {
      stepFlipThree(state);
      continue;
    }

    if (state.stage === 'deal') {
      if (state.dealPos < state.dealOrder.length) {
        const seat = state.dealOrder[state.dealPos++];
        // Players knocked out earlier in the deal (Freeze, or a bust during a
        // Flip Three) are not dealt a card.
        if (isActive(state, seat)) drawFor(state, seat, 'deal', null);
        continue;
      }
      state.stage = 'turns';
      state.turn = nextActiveFrom(state, state.dealer + 1);
      state.turnDone = false;
    } else if (state.turnDone || !isActive(state, state.turn)) {
      state.turn = nextActiveFrom(state, state.turn + 1);
      state.turnDone = false;
    }

    const p = state.players[state.turn];
    state.pending = { kind: 'turn', seat: state.turn, canStay: p.line.length > 0, since: state.clock };
    emit(state, 'turn', { p: state.turn });
    return;
  }
  throw new Error('Game loop did not settle');
}

function drawCard(state) {
  if (state.deck.length === 0) {
    if (state.discard.length === 0) return null;
    // "When the deck runs out, shuffle all the discarded cards to form a new
    // deck." Cards in front of players stay where they are.
    state.deck = shuffle(state.discard, state);
    state.discard = [];
    emit(state, 'reshuffle', { n: state.deck.length });
  }
  return state.deck.pop();
}

/** Flip the top card of the deck to the player in `seat`. */
function drawFor(state, seat, via, frame) {
  const id = drawCard(state);
  if (id === null || id === undefined) {
    // Every card is on the table. Nothing more can happen this round.
    state.outOfCards = true;
    emit(state, 'empty', {});
    return;
  }
  const p = state.players[seat];
  const c = CARDS[id];
  emit(state, 'draw', { p: seat, c: id, via });

  if (c.kind === 'num') {
    const duplicate = p.line.some((x) => isNumber(x) && CARDS[x].value === c.value);
    if (!duplicate) {
      p.line.push(id);
      if (p.line.filter(isNumber).length >= LUCKY_COUNT) {
        state.lucky = seat;
        emit(state, 'lucky', { p: seat });
      }
      return;
    }
    const sc = p.line.find(isSecondChance);
    if (sc !== undefined) {
      // Second Chance: discard it together with the duplicate number.
      p.line = p.line.filter((x) => x !== sc);
      state.discard.push(sc, id);
      emit(state, 'saved', { p: seat, c: id, sc });
    } else {
      p.line.push(id);
      p.status = 'busted';
      emit(state, 'bust', { p: seat, c: id });
    }
    return;
  }

  if (c.kind === 'mod') {
    p.line.push(id);
    return;
  }

  // Action cards
  if (c.act === 'second') {
    // Keep it, unless you already have one; then it must be given away.
    if (!hasSecondChance(p)) {
      p.line.push(id);
      emit(state, 'keep', { p: seat, c: id });
    } else {
      requestTarget(state, seat, id);
    }
    return;
  }
  if (frame) {
    // Freeze / Flip Three revealed during a Flip Three wait until all three
    // cards have been flipped.
    frame.deferred.push(id);
    emit(state, 'aside', { p: seat, c: id });
    return;
  }
  requestTarget(state, seat, id);
}

/** Who may receive this Action card from the player in `seat`. */
export function targetOptions(state, seat, cardId) {
  const active = activeSeats(state);
  if (isSecondChance(cardId)) {
    return active.filter((i) => i !== seat && !hasSecondChance(state.players[i]));
  }
  return active;
}

function requestTarget(state, seat, cardId) {
  const options = targetOptions(state, seat, cardId);
  if (options.length === 0) {
    // No one can take it (e.g. every other active player already has a
    // Second Chance): the card is discarded.
    state.discard.push(cardId);
    emit(state, 'fizzle', { p: seat, c: cardId });
    return;
  }
  if (options.length === 1) {
    // Only one legal choice (for example, you are the only active player and
    // must play the card on yourself).
    resolveTarget(state, seat, cardId, options[0], true);
    return;
  }
  state.pending = { kind: 'target', seat, card: cardId, options, since: state.clock };
  emit(state, 'choose', { p: seat, c: cardId });
}

function resolveTarget(state, seat, cardId, target, forced) {
  const t = state.players[target];
  const c = CARDS[cardId];
  t.line.push(cardId); // the card sits in front of the player it was given to
  emit(state, 'play', { p: seat, to: target, c: cardId, forced });
  if (c.act === 'freeze') {
    t.status = 'frozen'; // banks their points and is out of the round
  } else if (c.act === 'flip3') {
    state.stack.push({ t: target, left: 3, deferred: [] });
  }
}

function stepFlipThree(state) {
  const f = state.stack[state.stack.length - 1];
  const t = state.players[f.t];
  if (t.status === 'busted') {
    // Set-aside Freeze / Flip Three cards are only resolved if the player
    // hasn't busted.
    if (f.deferred.length) {
      state.discard.push(...f.deferred);
      emit(state, 'dropAside', { p: f.t, cards: [...f.deferred] });
    }
    state.stack.pop();
    return;
  }
  if (f.left > 0 && t.status === 'active') {
    f.left -= 1;
    drawFor(state, f.t, 'flip3', f);
    return;
  }
  if (f.deferred.length) {
    const id = f.deferred.shift();
    requestTarget(state, f.t, id);
    return;
  }
  state.stack.pop();
}

function endRound(state) {
  // Anything still waiting to be resolved is discarded.
  for (const f of state.stack) {
    if (f.deferred.length) {
      state.discard.push(...f.deferred);
      emit(state, 'dropAside', { p: f.t, cards: [...f.deferred] });
    }
  }
  state.stack = [];
  if (state.pending?.kind === 'target') state.discard.push(state.pending.card);
  state.pending = null;
  state.stage = null;

  const scores = state.players.map((p) => {
    const s = p.status === 'busted' ? 0 : scoreLine(p.line).total;
    p.roundScore = s;
    p.total += s;
    return s;
  });
  state.history.push({ round: state.round, scores, lucky: state.lucky });
  emit(state, 'roundEnd', { round: state.round, scores, lucky: state.lucky });

  const best = Math.max(...state.players.map((p) => p.total));
  if (best >= state.settings.target) {
    state.phase = 'gameOver';
    state.winners = state.players.flatMap((p, i) => (p.total === best ? [i] : []));
    emit(state, 'gameOver', { winners: state.winners });
  } else {
    state.phase = 'roundOver';
  }
}

// ---------------------------------------------------------------------------
// Information helpers (used by the UI, bots and tests)

/** Card ids that are face up somewhere: in lines, set aside, or waiting. */
export function visibleIds(state) {
  const ids = [];
  for (const p of state.players) ids.push(...p.line);
  for (const f of state.stack) ids.push(...f.deferred);
  if (state.pending?.kind === 'target') ids.push(state.pending.card);
  return ids;
}

/**
 * The cards that can still come off the deck, worked out only from public
 * information (what is on the table and in the discard pile). This is the
 * "keep the card count in mind" math a sharp player does in their head.
 */
export function unseenIds(state) {
  const seen = new Set([...visibleIds(state), ...state.discard]);
  const unseen = ALL_IDS.filter((id) => !seen.has(id));
  // If the deck is empty the discard pile is about to be reshuffled.
  return unseen.length ? unseen : [...state.discard];
}

/** Chance that the next card busts this player (ignoring Second Chance). */
export function bustChance(state, seat) {
  const p = state.players[seat];
  const have = new Set(p.line.filter(isNumber).map((id) => CARDS[id].value));
  const pool = unseenIds(state);
  if (!pool.length || !have.size) return 0;
  const bad = pool.filter((id) => isNumber(id) && have.has(CARDS[id].value)).length;
  return bad / pool.length;
}

/** Where every card is right now; used by tests to prove none are lost. */
export function cardLocations(state) {
  const loc = new Map();
  const put = (id, where) => {
    if (loc.has(id)) throw new Error(`Card ${id} is in two places: ${loc.get(id)} and ${where}`);
    loc.set(id, where);
  };
  state.deck.forEach((id) => put(id, 'deck'));
  state.discard.forEach((id) => put(id, 'discard'));
  state.players.forEach((p, i) => p.line.forEach((id) => put(id, `line${i}`)));
  state.stack.forEach((f) => f.deferred.forEach((id) => put(id, 'aside')));
  if (state.pending?.kind === 'target') put(state.pending.card, 'pending');
  return loc;
}
