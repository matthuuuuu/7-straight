// Vercel serverless function: https://your-site.vercel.app/api/room
// All the real work is in server/rooms.js (also used by `npm run dev`).

import { handle } from '../server/rooms.js';

// A loose safety net against scripts hammering the site. It's generous on
// purpose: a whole classroom on one Wi-Fi shares a single address.
const PER_MINUTE = 3000;
const recent = new Map();

function tooMany(ip) {
  const minute = Math.floor(Date.now() / 60000);
  const e = recent.get(ip);
  if (!e || e.minute !== minute) {
    if (recent.size > 5000) recent.clear();
    recent.set(ip, { minute, n: 1 });
    return false;
  }
  e.n += 1;
  return e.n > PER_MINUTE;
}

function clientIp(headers, socket) {
  const fwd = String(headers['x-forwarded-for'] || '').split(',')[0].trim();
  return String(headers['x-real-ip'] || fwd || socket?.remoteAddress || '');
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST' });
    return;
  }
  const ip = clientIp(req.headers, req.socket);
  if (ip && tooMany(ip)) {
    res.status(429).json({ error: 'Too many requests. Wait a moment and try again.' });
    return;
  }
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body || '{}');
    } catch {
      body = null;
    }
  }
  const out = await handle(body, Date.now(), { ip });
  res.status(out.status).json(out.json);
}
