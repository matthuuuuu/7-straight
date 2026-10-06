// Computer players. They only use public information (the cards on the table
// and in the discard pile), the same card counting a sharp human would do.

import { CARDS, isNumber, scoreLine } from './cards.js';
import { bustChance, hasSecondChance, unseenIds } from './engine.js';

/** 0.8 (careful) ... 1.3 (bold), fixed per bot so each has a personality. */
export function botBoldness(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return 0.8 + (h % 1000) / 2000;
}

/** Decide what the player in `seat` does about the pending decision. */
export function botAction(state, seat, { boldness = 1 } = {}) {
  const P = state.pending;
  if (!P || P.seat !== seat) return null;
  if (P.kind === 'turn') return { type: shouldHit(state, seat, boldness) ? 'hit' : 'stay' };
  if (P.kind === 'target') return { type: 'target', target: chooseTarget(state, seat, P) };
  return null;
}

function roundPoints(p) {
  return p.status === 'busted' ? 0 : scoreLine(p.line).total;
}

/** Average points a card that doesn't bust would add. */
function expectedGain(state, seat) {
  const p = state.players[seat];
  const line = scoreLine(p.line);
  const have = new Set(line.numbers);
  const pool = unseenIds(state).filter((id) => !(isNumber(id) && have.has(CARDS[id].value)));
  if (!pool.length) return 0;
  let gain = 0;
  for (const id of pool) {
    const c = CARDS[id];
    if (c.kind === 'num') gain += c.value * (line.doubled ? 2 : 1);
    else if (c.kind === 'mod') gain += c.op === 'times' ? line.sum : c.value;
  }
  gain /= pool.length;
  // One more number away from the seven-card bonus
  if (line.numbers.length === 6) gain += 15 * (pool.filter(isNumber).length / pool.length);
  return gain;
}

function shouldHit(state, seat, boldness) {
  const P = state.pending;
  if (!P.canStay) return true;
  const p = state.players[seat];
  const target = state.settings.target;
  const points = roundPoints(p);
  const others = state.players.filter((_, i) => i !== seat);
  const bestOther = others.length ? Math.max(...others.map((o) => o.total + roundPoints(o))) : 0;

  // Banking now reaches the target and keeps the lead: take it.
  if (p.total + points >= target && p.total + points > bestOther) return false;

  if (hasSecondChance(p)) return true; // this card can't bust us
  const risk = bustChance(state, seat);
  if (risk === 0) return true;

  let bold = boldness;
  // Far behind a player who is close to winning: take more chances.
  const leader = others.length ? Math.max(...others.map((o) => o.total)) : 0;
  if (leader >= target * 0.75 && leader - p.total > target * 0.2) bold *= 1.35;

  const gain = expectedGain(state, seat);
  return (1 - risk) * gain * bold > risk * points;
}

function chooseTarget(state, seat, P) {
  const c = CARDS[P.card];
  const opts = P.options;
  const me = state.players[seat];
  const others = opts.filter((i) => i !== seat);
  const threat = (i) => state.players[i].total + roundPoints(state.players[i]);

  if (c.act === 'second') {
    // Give the spare Second Chance to whoever is least of a threat.
    return [...opts].sort((a, b) => threat(a) - threat(b))[0];
  }

  if (c.act === 'freeze') {
    // Freezing yourself banks a big round safely.
    if (opts.includes(seat) && roundPoints(me) >= 18 && bustChance(state, seat) >= 0.25) return seat;
    if (!others.length) return seat;
    // Otherwise stop the most dangerous opponent before they build a big round.
    const score = (i) => state.players[i].total - roundPoints(state.players[i]) * 3;
    return [...others].sort((a, b) => score(b) - score(a))[0];
  }

  // Flip Three: aim it at the opponent most likely to bust and lose the most.
  if (!others.length) return seat;
  const danger = (i) => {
    const risk = hasSecondChance(state.players[i]) ? 0 : bustChance(state, i);
    const bust3 = 1 - (1 - risk) ** 3;
    return bust3 * (roundPoints(state.players[i]) + 5) + state.players[i].total / 50;
  };
  return [...others].sort((a, b) => danger(b) - danger(a))[0];
}
