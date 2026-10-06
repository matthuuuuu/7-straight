// Tiny wrapper around localStorage that never throws (private browsing,
// blocked storage, etc. just mean nothing is remembered).

const PREFIX = 'lucky7.';

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export function remove(key) {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

// Seats we hold in online rooms, so a reload (or a phone that went to sleep)
// drops you straight back into your game.
const CREDS_MAX_AGE = 864e5; // rooms don't live longer than a day

export function roomCreds(code) {
  const r = load('rooms', {})[code];
  return r && Date.now() - (r.at || 0) <= CREDS_MAX_AGE ? r : null;
}

export function saveRoomCreds(code, creds) {
  const rooms = load('rooms', {});
  rooms[code] = { ...creds, at: Date.now() };
  // Forget rooms older than a day.
  for (const [c, r] of Object.entries(rooms)) if (Date.now() - (r.at || 0) > CREDS_MAX_AGE) delete rooms[c];
  save('rooms', rooms);
  save('lastRoom', code);
}

export function forgetRoom(code) {
  const rooms = load('rooms', {});
  delete rooms[code];
  save('rooms', rooms);
  if (load('lastRoom', null) === code) remove('lastRoom');
}
