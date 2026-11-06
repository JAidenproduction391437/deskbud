const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCommand } = require('../src/quick.js');

test('opens known sites', () => {
  assert.equal(parseCommand('open youtube').url, 'https://www.youtube.com');
  assert.equal(parseCommand('Please open up Gmail.').url, 'https://mail.google.com');
  assert.equal(parseCommand('go to reddit').url, 'https://www.reddit.com');
  assert.equal(parseCommand('open the website github').url, 'https://github.com');
});

test('opens spoken and typed addresses', () => {
  assert.equal(parseCommand('open example dot com').url, 'https://example.com');
  assert.equal(parseCommand('go to news.ycombinator.com').url, 'https://news.ycombinator.com');
  assert.equal(parseCommand('open https://example.com/a').url, 'https://example.com/a');
});

test('"open a website" opens the browser', () => {
  assert.equal(parseCommand('open a website').kind, 'open-url');
  assert.equal(parseCommand('open my browser').url, 'https://www.google.com');
  assert.equal(parseCommand('open a new tab').kind, 'open-url');
});

test('unknown names are treated as apps, but "go to" searches', () => {
  assert.deepEqual(parseCommand('open notepad'), { kind: 'open-app', name: 'notepad', label: 'Notepad' });
  assert.equal(parseCommand('launch visual studio code').name, 'visual studio code');
  assert.match(parseCommand('go to my favourite cafe').url, /google\.com\/search/);
});

test('searches', () => {
  assert.equal(parseCommand('search for cute cats').url, 'https://www.google.com/search?q=cute%20cats');
  assert.equal(parseCommand('search youtube for lofi beats').url, 'https://www.youtube.com/results?search_query=lofi%20beats');
  assert.equal(parseCommand('search for headphones on amazon').url, 'https://www.amazon.com/s?k=headphones');
  assert.equal(parseCommand('google salt and pepper').url, 'https://www.google.com/search?q=salt%20and%20pepper');
  assert.equal(parseCommand('search for a&b?c=1').url, 'https://www.google.com/search?q=a%26b%3Fc%3D1');
});

test('typing keeps the words as said', () => {
  assert.deepEqual(parseCommand('type Hello there'), { kind: 'type', text: 'Hello there' });
});

test('pressing keys', () => {
  assert.equal(parseCommand('press enter').keys, 'enter');
  assert.equal(parseCommand('press control c').keys, 'ctrl+c');
  assert.equal(parseCommand('hit the escape key').keys, 'escape');
  assert.equal(parseCommand('press command shift t').keys, 'super+shift+t');
  assert.equal(parseCommand('press the big red button'), null);
});

test('scrolling and clicking', () => {
  assert.deepEqual(parseCommand('scroll down'), { kind: 'scroll', direction: 'down' });
  assert.deepEqual(parseCommand('double click'), { kind: 'click', style: 'double' });
  assert.deepEqual(parseCommand('click'), { kind: 'click', style: 'left' });
});

test('complex requests go to Claude', () => {
  for (const request of [
    'open youtube and play some lofi',
    'search for flights then book the cheapest',
    'write a python script that renames my photos',
    'summarize this page',
    'click the sign in button',
    'fix the failing test in my project',
    'how much storage do I have left',
  ]) {
    assert.equal(parseCommand(request), null, request);
  }
});

test('empty input is ignored', () => {
  assert.equal(parseCommand(''), null);
  assert.equal(parseCommand(undefined), null);
});
