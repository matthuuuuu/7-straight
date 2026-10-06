// Cleaning up display names (used by the server and by games on one device).

import { MAX_NAME_LENGTH } from './config.js';

// Invisible and text-direction characters that would let one player's name
// look exactly like another's (or look blank). The emoji joiner U+200D is
// kept so emoji like 👩‍🚀 still work.
const INVISIBLE = /[\p{Cc}­؜ᅟᅠ᠎​‌‎‏‪-‮⁠-⁤⁦-⁯⠀ㅤ﻿ﾠ]/gu;

/** A tidy name, or null if nothing readable is left. */
export function cleanName(raw) {
  let name = String(raw ?? '')
    .normalize('NFC')
    .replace(INVISIBLE, '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  name = Array.from(name).slice(0, MAX_NAME_LENGTH).join('').trim();
  if (!/[\p{L}\p{N}\p{Extended_Pictographic}]/u.test(name)) return null;
  return name;
}

/** Names that look the same compare equal. */
const nameKey = (s) => s.normalize('NFKC').replace(/[‍️]/g, '').toLowerCase();

/** Add " 2", " 3"... if someone at the table already has this name. */
export function uniqueName(name, players) {
  const taken = new Set((players || []).map((p) => nameKey(p.name)));
  let unique = name;
  for (let k = 2; taken.has(nameKey(unique)); k++) unique = `${name} ${k}`;
  return unique;
}
