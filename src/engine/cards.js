// The 94-card deck, exactly as listed in the rulebook:
//   Number cards: twelve 12s, eleven 11s ... one 1, plus a single 0   (79)
//   Score modifiers: +2, +4, +6, +8, +10 and x2, one of each            (6)
//   Action cards: 3 Freeze, 3 Flip Three, 3 Second Chance               (9)
// Every card has a stable id (its index), so game state only stores ids.

export const NUMBER_WORDS = [
  'ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX',
  'SEVEN', 'EIGHT', 'NINE', 'TEN', 'ELEVEN', 'TWELVE',
];

export const ACTION_NAMES = {
  freeze: 'Freeze',
  flip3: 'Flip Three',
  second: 'Second Chance',
};

function buildDeck() {
  const cards = [];
  const add = (c) => cards.push(Object.freeze({ id: cards.length, ...c }));
  for (let value = 12; value >= 1; value--) {
    for (let i = 0; i < value; i++) add({ kind: 'num', value });
  }
  add({ kind: 'num', value: 0 });
  for (const value of [2, 4, 6, 8, 10]) add({ kind: 'mod', op: 'plus', value });
  add({ kind: 'mod', op: 'times', value: 2 });
  for (const act of ['freeze', 'flip3', 'second']) {
    for (let i = 0; i < 3; i++) add({ kind: 'act', act });
  }
  return Object.freeze(cards);
}

export const CARDS = buildDeck();
export const DECK_SIZE = CARDS.length; // 94
export const ALL_IDS = Object.freeze(CARDS.map((c) => c.id));

export const isNumber = (id) => CARDS[id].kind === 'num';
export const isModifier = (id) => CARDS[id].kind === 'mod';
export const isAction = (id) => CARDS[id].kind === 'act';
export const isSecondChance = (id) => CARDS[id].act === 'second';

/** Short label for toasts and logs: "7", "+4", "x2", "Freeze" ... */
export function cardLabel(id) {
  const c = CARDS[id];
  if (c.kind === 'num') return String(c.value);
  if (c.kind === 'mod') return c.op === 'times' ? 'x2' : `+${c.value}`;
  return ACTION_NAMES[c.act];
}

/** The values of the number cards in a line. */
export function numberValues(line) {
  return line.filter(isNumber).map((id) => CARDS[id].value);
}

export const LUCKY_COUNT = 7;
export const LUCKY_BONUS = 15;

/**
 * Score a player's line, following "Calculate scores as follows":
 *   1. Add the value of Number cards.
 *   2. If you have the x2 multiplier, double that sum.
 *   3. Add any +2 ... +10 bonus points.
 *   4. Seven unique Number cards score an additional 15 points.
 * (A busted player scores 0; callers handle that.)
 */
export function scoreLine(line) {
  const numbers = numberValues(line);
  const sum = numbers.reduce((a, b) => a + b, 0);
  const doubled = line.some((id) => CARDS[id].kind === 'mod' && CARDS[id].op === 'times');
  const plus = line
    .filter((id) => CARDS[id].kind === 'mod' && CARDS[id].op === 'plus')
    .reduce((a, id) => a + CARDS[id].value, 0);
  const lucky = numbers.length >= LUCKY_COUNT;
  const total = sum * (doubled ? 2 : 1) + plus + (lucky ? LUCKY_BONUS : 0);
  return { numbers, sum, doubled, plus, lucky, total };
}
