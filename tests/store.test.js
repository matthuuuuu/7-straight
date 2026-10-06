// The game finds the Upstash settings whatever Vercel named them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _redisConfigForTests as redisConfig } from '../server/store.js';

test('standard Upstash setting names', () => {
  assert.deepEqual(redisConfig({ KV_REST_API_URL: 'https://a.upstash.io/', KV_REST_API_TOKEN: 't' }), {
    url: 'https://a.upstash.io',
    token: 't',
  });
  assert.deepEqual(redisConfig({ UPSTASH_REDIS_REST_URL: 'https://b.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'u' }), {
    url: 'https://b.upstash.io',
    token: 'u',
  });
});

test('names with a Custom Prefix still work', () => {
  const env = {
    STORAGE_KV_REST_API_URL: 'https://c.upstash.io',
    STORAGE_KV_REST_API_TOKEN: 'v',
    STORAGE_KV_REST_API_READ_ONLY_TOKEN: 'read-only-must-not-be-used',
  };
  assert.deepEqual(redisConfig(env), { url: 'https://c.upstash.io', token: 'v' });
});

test('no database settings at all', () => {
  assert.equal(redisConfig({ PATH: '/bin', KV_REST_API_URL: 'https://x' }), null);
});
