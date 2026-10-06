// Small seeded random number generator (mulberry32). The seed lives inside
// the game state, so a game can be saved, loaded and replayed exactly.
//
// Online games use rng = 'secure' instead: every shuffle then comes from the
// platform's cryptographic random source, so nobody can work out the deck
// order from the cards they've seen.

export function random(state) {
  if (state.rng === 'secure') {
    const b = new Uint32Array(2);
    globalThis.crypto.getRandomValues(b);
    return (b[0] * 2 ** 21 + (b[1] >>> 11)) / 2 ** 53;
  }
  let t = (state.rng = (state.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randomInt(state, n) {
  return Math.floor(random(state) * n);
}

/** Fisher-Yates shuffle, in place. */
export function shuffle(arr, state) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(state, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** A seed as stored in the state: a 32-bit number, or 'secure'. */
export const normalizeSeed = (seed) => (seed === 'secure' ? 'secure' : seed >>> 0);

/** A fresh 32-bit seed from the platform's secure random source. */
export function freshSeed() {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return buf[0];
}
