const { EventEmitter } = require('node:events');
const WebSocket = require('ws');

const CLOSE_BAD_TOKEN = 4401;
const CLOSE_REPLACED = 4409;

/** The connection to the Desk Bud server. Keeps reconnecting until stopped. */
class Relay extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.stopped = true;
    this.retryMs = 1000;
    this.online = false;
    this.peerOnline = false;
  }

  start(server, token) {
    this.stop();
    this.server = server;
    this.token = token;
    this.stopped = false;
    this.connect();
  }

  connect() {
    const url = new URL('/ws', this.server);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', token: this.token })));

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.type === 'ready') {
        this.retryMs = 1000;
        this.online = true;
        this.setPeer(msg.peerOnline);
        this.emit('change');
      } else if (msg.type === 'peer') {
        this.setPeer(msg.online);
      } else {
        this.emit('message', msg);
      }
    });

    ws.on('error', () => { /* 'close' follows and handles the retry */ });

    ws.on('close', (code) => {
      if (this.ws !== ws) return;
      this.online = false;
      this.setPeer(false);
      this.emit('change');
      if (code === CLOSE_BAD_TOKEN) {
        this.stopped = true;
        this.emit('rejected');
        return;
      }
      if (this.stopped || code === CLOSE_REPLACED) return;
      setTimeout(() => { if (!this.stopped) this.connect(); }, this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 30000);
    });
  }

  setPeer(online) {
    if (online === this.peerOnline) return;
    this.peerOnline = online;
    this.emit('peer', online);
    this.emit('change');
  }

  send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  stop() {
    this.stopped = true;
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.online = false;
    this.peerOnline = false;
  }
}

/** A server the app is willing to connect to: https anywhere, http only on this machine. */
function checkServer(raw) {
  let url;
  try { url = new URL(String(raw).trim()); } catch { return null; }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol === 'https:' || (url.protocol === 'http:' && local)) return url.origin;
  return null;
}

async function postJson(server, path, body) {
  const res = await fetch(new URL(path, server), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90000), // a sleeping Render server takes a while to wake
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `The server said ${res.status}.`);
  return data;
}

module.exports = { Relay, checkServer, postJson };
