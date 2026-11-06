import test from 'node:test';
import assert from 'node:assert/strict';
import { detectDevice } from '../public/device.js';
import { findWake, WakeListener } from '../public/wake.js';

const UA = {
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36',
};

test('detects each device', () => {
  assert.deepEqual(detectDevice({ userAgent: UA.windows, platform: 'Win32' }), { kind: 'computer', os: 'windows' });
  assert.deepEqual(detectDevice({ userAgent: UA.mac, platform: 'MacIntel' }), { kind: 'computer', os: 'mac' });
  assert.deepEqual(detectDevice({ userAgent: UA.iphone, platform: 'iPhone', maxTouchPoints: 5 }), { kind: 'phone', os: 'ios' });
  assert.deepEqual(detectDevice({ userAgent: UA.android, platform: 'Linux armv8l', maxTouchPoints: 5 }), { kind: 'phone', os: 'android' });
  assert.deepEqual(detectDevice({ userAgent: UA.linux, platform: 'Linux x86_64' }), { kind: 'computer', os: 'linux' });
});

test('an iPad pretending to be a Mac counts as a phone', () => {
  assert.deepEqual(detectDevice({ userAgent: UA.mac, platform: 'MacIntel', maxTouchPoints: 5 }), { kind: 'phone', os: 'ios' });
});

test('a Windows laptop with a touch screen is still a computer', () => {
  assert.deepEqual(detectDevice({ userAgent: UA.windows, platform: 'Win32', maxTouchPoints: 10 }), { kind: 'computer', os: 'windows' });
});

test('hears the wake phrase and its usual mishearings', () => {
  for (const phrase of [
    'Hey Desk Bud', 'hey, desk bud', 'Hey deskbud', 'hey desk-bud', 'hey desk bird',
    'okay disk bud', 'hey desk buddy', 'hi dusk bud', 'Hey Desk Bud!',
  ]) {
    assert.equal(findWake(phrase).heard, true, phrase);
  }
});

test('ignores ordinary speech', () => {
  for (const phrase of [
    'I put the bud vase on my desk', 'hey what is for dinner', 'the desk is messy',
    'hey deskbuddies', 'they desk bud',
  ]) {
    assert.equal(findWake(phrase).heard, false, phrase);
  }
});

test('finds what was said after the name', () => {
  assert.equal(findWake('Hey Desk Bud, open YouTube').rest, 'open youtube');
  assert.equal(findWake('so um hey desk bud search for cats').rest, 'search for cats');
});

test('command in the same breath', () => {
  const ears = new WakeListener();
  assert.equal(ears.feed('hey desk bud open', false), 'wake');
  assert.equal(ears.feed('hey desk bud open youtube', false), null);
  assert.deepEqual(ears.feed('hey desk bud open youtube', true), { command: 'open youtube' });
  assert.equal(ears.awake, false);
});

test('command after a pause', () => {
  const ears = new WakeListener();
  assert.equal(ears.feed('hey desk bud', true), 'wake');
  assert.equal(ears.feed('open', false), null);
  assert.deepEqual(ears.feed('Open YouTube.', true), { command: 'open youtube' });
});

test('a final result that arrives all at once', () => {
  const ears = new WakeListener();
  assert.deepEqual(ears.feed('hey desk bud open gmail', true), { woke: true, command: 'open gmail' });
});

test('repeating the name keeps it waiting', () => {
  const ears = new WakeListener();
  ears.feed('hey desk bud', true);
  assert.equal(ears.feed('hey desk bud', true), null);
  assert.equal(ears.awake, true);
});

test('stays asleep through other talk', () => {
  const ears = new WakeListener();
  assert.equal(ears.feed('open youtube', true), null);
  assert.equal(ears.awake, false);
});
