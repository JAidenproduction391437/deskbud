import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createApp } from '../src/index.js';
import { createTokens } from '../src/tokens.js';
import { PairingStore, RateLimiter, CODE_TTL_MS } from '../src/pairing.js';

const SECRET = 'test-secret';

test('tokens reject tampering and other secrets', () => {
  const tokens = createTokens(SECRET);
  const token = tokens.issue('abc', 'phone');
  assert.deepEqual(tokens.verify(token), { pairId: 'abc', role: 'phone' });
  assert.equal(tokens.verify(token.replace('phone', 'desktop')), null);
  assert.equal(tokens.verify(token.replace('abc', 'abd')), null);
  assert.equal(createTokens('other').verify(token), null);
  assert.equal(tokens.verify('nonsense'), null);
  assert.equal(tokens.verify(undefined), null);
});

test('a code works once, and a handoff works once', () => {
  const store = new PairingStore(createTokens(SECRET));
  const pairing = store.start();
  assert.match(pairing.code, /^[2-9A-HJKMNP-Z]{6}$/);
  const claimed = store.claim(pairing.code.toLowerCase());
  assert.ok(claimed.handoff);
  assert.equal(store.claim(pairing.code), null);
  assert.ok(store.redeem(claimed.handoff).token);
  assert.equal(store.redeem(claimed.handoff), null);
});

test('codes expire', () => {
  let now = 1000;
  const store = new PairingStore(createTokens(SECRET), () => now);
  const pairing = store.start();
  now += CODE_TTL_MS + 1;
  assert.equal(store.claim(pairing.code), null);
  assert.deepEqual(store.status(pairing.id, pairing.pollSecret), { state: 'expired' });
});

test('status needs the poll secret, so nobody else can collect the phone token', () => {
  const store = new PairingStore(createTokens(SECRET));
  const pairing = store.start();
  store.redeem(store.claim(pairing.code).handoff);
  assert.deepEqual(store.status(pairing.id, 'wrong'), { state: 'expired' });
  assert.equal(store.status(pairing.id, pairing.pollSecret).state, 'paired');
});

test('rate limiter resets after its window', () => {
  let now = 0;
  const limiter = new RateLimiter(2, 100, () => now);
  assert.ok(limiter.allow('a'));
  assert.ok(limiter.allow('a'));
  assert.ok(!limiter.allow('a'));
  assert.ok(limiter.allow('b'));
  now = 101;
  assert.ok(limiter.allow('a'));
});

async function withServer(fn) {
  const server = createApp({ env: { SERVER_SECRET: SECRET, GITHUB_REPO: 'me/desk-bud' } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const open = new Set();
  const connect = (token) => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    open.add(ws);
    ws.inbox = [];
    ws.waiters = [];
    ws.on('message', (data) => {
      const msg = JSON.parse(data);
      const waiter = ws.waiters.shift();
      if (waiter) waiter(msg); else ws.inbox.push(msg);
    });
    ws.next = () => new Promise((r) => {
      if (ws.inbox.length) r(ws.inbox.shift()); else ws.waiters.push(r);
    });
    ws.on('open', () => { ws.send(JSON.stringify({ type: 'hello', token })); resolve(ws); });
    ws.on('error', reject);
  });
  const post = async (path, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  try {
    await fn({ port, connect, post });
  } finally {
    for (const ws of open) ws.terminate();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function pair(post) {
  const { body: start } = await post('/api/pair/start', {});
  const { body: claim } = await post('/api/pair/claim', {
    code: start.code,
    device: { os: 'windows', name: 'Test PC' },
  });
  const { body: redeem } = await post('/api/pair/redeem', { handoff: claim.handoff });
  const { body: status } = await post('/api/pair/status', { id: start.id, pollSecret: start.pollSecret });
  return { desktopToken: redeem.token, phoneToken: status.token, status };
}

test('a full pairing lets the phone and desktop talk', async () => {
  await withServer(async ({ connect, post }) => {
    const { desktopToken, phoneToken, status } = await pair(post);
    assert.equal(status.device.os, 'windows');

    const desktop = await connect(desktopToken);
    assert.deepEqual(await desktop.next(), { type: 'ready', peerOnline: false });
    const phone = await connect(phoneToken);
    assert.deepEqual(await phone.next(), { type: 'ready', peerOnline: true });
    assert.deepEqual(await desktop.next(), { type: 'peer', online: true });

    phone.send(JSON.stringify({ type: 'command', id: '1', text: 'open youtube' }));
    assert.equal((await desktop.next()).text, 'open youtube');
    desktop.send(JSON.stringify({ type: 'status', id: '1', state: 'done', say: 'Done' }));
    assert.equal((await phone.next()).say, 'Done');
  });
});

test('the relay drops message types a role may not send', async () => {
  await withServer(async ({ connect, post }) => {
    const { desktopToken, phoneToken } = await pair(post);
    const desktop = await connect(desktopToken);
    await desktop.next();
    const phone = await connect(phoneToken);
    await phone.next();
    await desktop.next();

    desktop.send(JSON.stringify({ type: 'command', text: 'from the wrong side' }));
    phone.send(JSON.stringify({ type: 'frame', data: 'nope' }));
    phone.send(JSON.stringify({ type: 'stop' }));
    assert.equal((await desktop.next()).type, 'stop');
    assert.equal(phone.inbox.length, 0);
  });
});

test('a bad token gets disconnected', async () => {
  await withServer(async ({ connect }) => {
    const ws = await connect('v1.abc.phone.forged');
    const code = await new Promise((resolve) => ws.on('close', resolve));
    assert.equal(code, 4401);
  });
});

test('two pairs stay separate', async () => {
  await withServer(async ({ connect, post }) => {
    const a = await pair(post);
    const b = await pair(post);
    const desktopA = await connect(a.desktopToken);
    await desktopA.next();
    const desktopB = await connect(b.desktopToken);
    await desktopB.next();
    const phoneB = await connect(b.phoneToken);
    await phoneB.next();
    await desktopB.next();
    phoneB.send(JSON.stringify({ type: 'command', text: 'only for B' }));
    assert.equal((await desktopB.next()).text, 'only for B');
    assert.equal(desktopA.inbox.length, 0);
  });
});

test('wrong codes are refused, then rate limited', async () => {
  await withServer(async ({ post }) => {
    let last;
    for (let i = 0; i < 11; i++) last = await post('/api/pair/claim', { code: 'AAAAAA' });
    assert.equal(last.status, 429);
  });
});

test('website headers and config', async () => {
  await withServer(async ({ port }) => {
    const config = await (await fetch(`http://127.0.0.1:${port}/api/config`)).json();
    assert.equal(config.downloads.windows, 'https://github.com/me/desk-bud/releases/latest/download/DeskBud-Setup.exe');
    const page = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
    const traversal = await fetch(`http://127.0.0.1:${port}/..%2f..%2fpackage.json`);
    assert.equal(traversal.status, 404);
  });
});
