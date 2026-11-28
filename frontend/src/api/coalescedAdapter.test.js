import test from 'node:test';
import assert from 'node:assert/strict';
import { coalesceGets } from './coalescedAdapter.js';

const config = (extra = {}) => ({ method: 'get', url: '/staff/', headers: { Authorization: 'Token A' }, ...extra });
const gate = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

test('identical pending GETs share the network request but keep independent response objects', async () => {
  const pending = gate(); let calls = 0;
  const get = coalesceGets(() => { calls++; return pending.promise; }, (c) => c.url);
  const a = get(config()), b = get(config());
  await Promise.resolve(); assert.equal(calls, 1);
  pending.resolve({ data: '{"value":1}' });
  const [first, second] = await Promise.all([a, b]);
  assert.notEqual(first, second);
  first.data = { value: 2 };
  assert.equal(second.data, '{"value":1}');
});

test('different authenticated users, URLs or timeouts never share a request', async () => {
  let calls = 0;
  const get = coalesceGets(async () => { calls++; return { data: 'ok' }; }, (c) => c.url);
  await Promise.all([get(config()), get(config({ headers: { Authorization: 'Token B' } })),
    get(config({ url: '/patients/' })), get(config({ timeout: 500 }))]);
  assert.equal(calls, 4);
});

test('completed responses are not cached', async () => {
  let calls = 0;
  const get = coalesceGets(async () => ({ data: ++calls }), (c) => c.url);
  assert.equal((await get(config())).data, 1);
  assert.equal((await get(config())).data, 2);
});

test('failed requests do not prevent a later retry', async () => {
  let calls = 0;
  const get = coalesceGets(async () => { if (++calls === 1) throw new Error('offline'); return { data: 'ok' }; }, (c) => c.url);
  await assert.rejects(get(config()), /offline/);
  assert.equal((await get(config())).data, 'ok');
});

test('abortable callers retain separate requests', async () => {
  let calls = 0;
  const get = coalesceGets(async () => { calls++; return { data: 'ok' }; }, (c) => c.url);
  const controller = new AbortController();
  await Promise.all([get(config({ signal: controller.signal })), get(config({ signal: controller.signal }))]);
  assert.equal(calls, 2);
});

test('writes are not coalesced and invalidate older pending reads', async () => {
  const pending = gate(); let reads = 0, writes = 0;
  const get = coalesceGets((c) => c.method === 'get' ? (++reads, pending.promise)
    : (++writes, Promise.resolve({ data: 'saved' })), (c) => c.url);
  const old = get(config());
  await Promise.all([get(config({ method: 'post' })), get(config({ method: 'post' }))]);
  const fresh = get(config());
  await Promise.resolve();
  assert.equal(reads, 2); assert.equal(writes, 2);
  pending.resolve({ data: 'ok' });
  await Promise.all([old, fresh]);
});
