// What the table looks like on screen.
//
// The game state jumps straight to "after everything happened" (a Flip Three
// can flip three cards, bust someone and end the round in one move). To let
// people follow along, the screen replays the game's event log one step at a
// time using applyEvent(), then snaps to the real state when it's done.

import { CARDS, cardLabel, ACTION_NAMES } from '../engine/cards.js';

export function toDisplay(game) {
  const players = game.players.map((p, i) => ({
    line: [...p.line],
    hand: [],
    aside: [],
    status: p.status,
    lucky: game.lucky === i,
    flash: null,
  }));
  if (game.pending?.kind === 'target') players[game.pending.seat].hand.push(game.pending.card);
  for (const f of game.stack || []) players[f.t].aside.push(...f.deferred);
  return {
    seq: game.seq,
    phase: game.phase,
    round: game.round,
    dealer: game.dealer,
    turn: game.pending?.kind === 'turn' ? game.pending.seat : -1,
    actor: game.pending ? game.pending.seat : -1,
    focus: -1,
    players,
  };
}

function without(list, ids) {
  return list.filter((x) => !ids.includes(x));
}

/** `seats` is how many players the real game has (it can differ from `d` right after the lobby). */
export function applyEvent(d, e, seats = d.players.length) {
  const n = {
    ...d,
    seq: e.seq,
    players: d.players.map((p) => ({ ...p, line: [...p.line], hand: [...p.hand], aside: [...p.aside] })),
  };
  const P = (i) => n.players[i] || { line: [], hand: [], aside: [] };
  const take = (p, id) => {
    p.line = without(p.line, [id]);
    p.hand = without(p.hand, [id]);
    p.aside = without(p.aside, [id]);
  };
  const flash = (i, kind) => {
    if (n.players[i]) n.players[i].flash = { kind, seq: e.seq };
  };

  switch (e.t) {
    case 'roundStart':
      n.round = e.round;
      n.dealer = e.dealer;
      n.phase = 'playing';
      n.turn = -1;
      n.actor = -1;
      n.focus = -1;
      n.players = Array.from({ length: seats }, () => ({ line: [], hand: [], aside: [], status: 'active', lucky: false, flash: null }));
      break;
    case 'draw': {
      const p = P(e.p);
      if (CARDS[e.c].kind === 'act') p.hand.push(e.c);
      else p.line.push(e.c);
      n.focus = e.p;
      if (e.via === 'hit') n.turn = -1;
      if (e.via !== 'deal') n.actor = e.p;
      break;
    }
    case 'keep':
      take(P(e.p), e.c);
      P(e.p).line.push(e.c);
      flash(e.p, 'second');
      break;
    case 'aside':
      take(P(e.p), e.c);
      P(e.p).aside.push(e.c);
      break;
    case 'choose':
      take(P(e.p), e.c);
      P(e.p).hand.push(e.c);
      n.turn = -1;
      n.actor = e.p;
      break;
    case 'play': {
      take(P(e.p), e.c);
      const t = P(e.to);
      t.line.push(e.c);
      const act = CARDS[e.c].act;
      if (act === 'freeze') t.status = 'frozen';
      flash(e.to, act);
      n.focus = e.to;
      break;
    }
    case 'fizzle':
      take(P(e.p), e.c);
      break;
    case 'dropAside':
      P(e.p).aside = without(P(e.p).aside, e.cards);
      break;
    case 'saved': {
      const p = P(e.p);
      p.line = without(p.line, [e.c, e.sc]);
      flash(e.p, 'saved');
      break;
    }
    case 'bust':
      P(e.p).status = 'busted';
      flash(e.p, 'bust');
      break;
    case 'stay':
      P(e.p).status = 'stayed';
      n.turn = -1;
      break;
    case 'lucky':
      P(e.p).lucky = true;
      flash(e.p, 'lucky');
      break;
    case 'turn':
      n.turn = e.p;
      n.actor = e.p;
      n.focus = -1;
      break;
    default:
      break;
  }
  return n;
}

/** When lots of steps are waiting (e.g. a big deal), play them a bit faster. */
export function replaySpeed(stepsLeft) {
  return stepsLeft > 14 ? 0.5 : stepsLeft > 8 ? 0.75 : 1;
}

/** How long to hold each step on screen (ms). */
export function eventDelay(e) {
  switch (e.t) {
    case 'draw':
      return e.via === 'deal' ? 420 : e.via === 'flip3' ? 750 : 500;
    case 'bust':
    case 'saved':
      return 1200;
    case 'lucky':
      return 2000;
    case 'play':
      return 900;
    case 'keep':
    case 'aside':
    case 'fizzle':
    case 'dropAside':
      return 650;
    case 'stay':
      return 450;
    case 'roundStart':
      return 700;
    case 'roundEnd':
      return 1300;
    case 'reshuffle':
      return 1000;
    case 'turn':
    case 'choose':
      return 120;
    default:
      return 200;
  }
}

/**
 * A short sentence for the event ticker, or null for events that speak for
 * themselves. `name(seat)` gives a display name ("You" for yourself).
 */
export function eventMessage(e, name, isSelf) {
  const who = (i) => name(i);
  const whom = (i) => (isSelf(i) ? 'you' : name(i)); // mid-sentence
  const label = (id) => cardLabel(id);
  switch (e.t) {
    case 'roundStart':
      return { text: `Round ${e.round} · ${who(e.dealer)} ${isSelf(e.dealer) ? 'deal' : 'deals'}`, tone: 'info' };
    case 'bust':
      return { text: `${who(e.p)} busted on a ${label(e.c)}!`, tone: 'bad', icon: 'bust' };
    case 'saved':
      return { text: `Second Chance! ${who(e.p)} tossed a duplicate ${label(e.c)}`, tone: 'good', icon: 'second' };
    case 'lucky':
      return { text: `${who(e.p)} flipped 7 unique numbers! +15`, tone: 'great', icon: 'lucky' };
    case 'play': {
      const act = CARDS[e.c].act;
      const self = e.p === e.to;
      if (act === 'freeze') {
        return { text: self ? `${who(e.p)} froze ${isSelf(e.p) ? 'yourself' : 'themselves'} and banked` : `${who(e.p)} froze ${whom(e.to)}`, tone: 'info', icon: 'freeze' };
      }
      if (act === 'flip3') {
        return { text: self ? `${who(e.p)} must flip three!` : `${who(e.p)} made ${whom(e.to)} flip three`, tone: 'info', icon: 'flip3' };
      }
      return { text: `${who(e.p)} gave ${whom(e.to)} a Second Chance`, tone: 'good', icon: 'second' };
    }
    case 'keep':
      return { text: `${who(e.p)} got a Second Chance`, tone: 'good', icon: 'second' };
    case 'aside':
      return { text: `${ACTION_NAMES[CARDS[e.c].act]} set aside until the Flip Three is done`, tone: 'info' };
    case 'fizzle':
      return { text: `${label(e.c)} discarded — nobody could take it`, tone: 'info' };
    case 'dropAside':
      return { text: 'The set-aside action cards are discarded', tone: 'info' };
    case 'stay':
      return { text: `${who(e.p)} ${isSelf(e.p) ? 'stay' : 'stays'} with ${e.score}`, tone: 'info', icon: 'stay' };
    case 'reshuffle':
      return { text: `Deck ran out: ${e.n} discarded cards reshuffled`, tone: 'info' };
    case 'empty':
      return { text: 'Every card is on the table! The round ends.', tone: 'info' };
    default:
      return null;
  }
}
