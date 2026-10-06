// Where online rooms are saved.
//
// On Vercel this is Upstash Redis (free tier), reached over its REST API with
// plain fetch, so there are no extra packages. Vercel's Upstash integration
// sets KV_REST_API_URL / KV_REST_API_TOKEN (older setups use the
// UPSTASH_REDIS_REST_* names; both work).
//
// Without those variables (e.g. `npm run dev` on your computer) rooms live in
// memory, which is perfect for local testing but resets when the server
// restarts.

const KEY = (code) => `lucky7:room:${code}`;
const REV = (code) => `lucky7:rev:${code}`;
const COUNTER = (name) => `lucky7:count:${name}`;

/** The database couldn't be reached or refused the request. */
export class StoreError extends Error {}

// Save only if nobody else saved in the meantime (compare-and-set on rev).
const CAS_SCRIPT = `
if (redis.call('GET', KEYS[2]) or '0') == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[4])
  redis.call('SET', KEYS[2], ARGV[3], 'EX', ARGV[4])
  return 1
end
return 0`;

function redisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

function redisStore({ url, token }) {
  async function command(...args) {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(args.map(String)),
        signal: AbortSignal.timeout(6000),
      });
    } catch (err) {
      throw new StoreError(`Redis unreachable: ${err.message}`);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new StoreError(`Redis: ${data.error || res.status}`);
    return data.result;
  }
  return {
    kind: 'redis',
    async load(code) {
      const raw = await command('GET', KEY(code));
      return raw ? JSON.parse(raw) : null;
    },
    /** Save a brand-new room; false if the code is already taken. */
    async create(code, room, ttl) {
      const ok = await command('SET', REV(code), room.rev, 'NX', 'EX', ttl);
      if (ok !== 'OK') return false;
      await command('SET', KEY(code), JSON.stringify(room), 'EX', ttl);
      return true;
    },
    /** Save if the stored rev is still `expectedRev`. */
    async save(code, room, expectedRev, ttl) {
      const ok = await command('EVAL', CAS_SCRIPT, 2, KEY(code), REV(code),
        expectedRev, JSON.stringify(room), room.rev, ttl);
      return ok === 1;
    },
    /** Count an event in a time window; returns the count so far. */
    async hit(name, windowSeconds) {
      const n = await command('INCR', COUNTER(name));
      if (n === 1) await command('EXPIRE', COUNTER(name), windowSeconds);
      return n;
    },
  };
}

function memoryStore() {
  const rooms = (globalThis.__lucky7Rooms ??= new Map());
  const counters = (globalThis.__lucky7Counters ??= new Map());
  const alive = (entry) => entry && entry.expires > Date.now();
  const put = (code, room, ttl) =>
    rooms.set(code, { json: JSON.stringify(room), rev: room.rev, expires: Date.now() + ttl * 1000 });
  return {
    kind: 'memory',
    async load(code) {
      const e = rooms.get(code);
      return alive(e) ? JSON.parse(e.json) : null;
    },
    async create(code, room, ttl) {
      if (alive(rooms.get(code))) return false;
      put(code, room, ttl);
      return true;
    },
    async save(code, room, expectedRev, ttl) {
      const e = rooms.get(code);
      if (!alive(e) || e.rev !== expectedRev) return false;
      put(code, room, ttl);
      return true;
    },
    async hit(name, windowSeconds) {
      const e = counters.get(name);
      if (!alive(e)) {
        counters.set(name, { n: 1, expires: Date.now() + windowSeconds * 1000 });
        return 1;
      }
      e.n += 1;
      return e.n;
    },
  };
}

export function getStore() {
  const cfg = redisConfig();
  if (cfg) return redisStore(cfg);
  if (process.env.VERCEL) {
    // Deployed, but no database connected: rooms would randomly vanish, so
    // refuse clearly instead.
    return null;
  }
  return memoryStore();
}
