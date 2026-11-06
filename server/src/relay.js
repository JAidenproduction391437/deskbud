import { WebSocketServer } from 'ws';

// Only these message types may cross, in each direction.
const ALLOWED = {
  phone: new Set(['command', 'stop', 'confirm-reply', 'screen', 'pointer']),
  desktop: new Set(['info', 'status', 'mouse', 'frame', 'confirm']),
};

const HELLO_TIMEOUT_MS = 10_000;
const HEARTBEAT_MS = 25_000;
const MAX_MESSAGE_BYTES = 2 * 1024 * 1024; // room for one screen frame
const MAX_MESSAGES_PER_10S = 400;

export const CLOSE_BAD_TOKEN = 4401;
export const CLOSE_REPLACED = 4409;

/** Attaches the /ws relay. Each pair is a room holding at most one phone and one desktop. */
export function attachRelay(httpServer, tokens) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  const rooms = new Map();

  httpServer.on('upgrade', (req, socket, head) => {
    if (new URL(req.url, 'http://x').pathname !== '/ws') return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws));
  });

  const send = (ws, msg) => {
    if (ws?.readyState === 1) ws.send(JSON.stringify(msg));
  };

  function join(ws, identity) {
    const { pairId, role } = identity;
    const room = rooms.get(pairId) ?? {};
    rooms.set(pairId, room);
    if (room[role]) room[role].close(CLOSE_REPLACED, 'replaced');
    room[role] = ws;
    ws.identity = identity;
    const other = role === 'phone' ? room.desktop : room.phone;
    send(ws, { type: 'ready', peerOnline: Boolean(other) });
    send(other, { type: 'peer', online: true });
  }

  function leave(ws) {
    if (!ws.identity) return;
    const { pairId, role } = ws.identity;
    const room = rooms.get(pairId);
    if (!room || room[role] !== ws) return;
    delete room[role];
    const other = role === 'phone' ? room.desktop : room.phone;
    send(other, { type: 'peer', online: false });
    if (!room.phone && !room.desktop) rooms.delete(pairId);
  }

  function onConnection(ws) {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('error', () => ws.terminate());
    ws.on('close', () => leave(ws));

    // The token travels in the first message so it stays out of URLs and logs.
    const helloTimer = setTimeout(() => ws.close(CLOSE_BAD_TOKEN, 'no hello'), HELLO_TIMEOUT_MS);
    let windowStart = Date.now();
    let windowCount = 0;

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (typeof msg?.type !== 'string') return;

      if (!ws.identity) {
        clearTimeout(helloTimer);
        const identity = msg.type === 'hello' ? tokens.verify(msg.token) : null;
        if (!identity) return ws.close(CLOSE_BAD_TOKEN, 'bad token');
        return join(ws, identity);
      }

      if (Date.now() - windowStart > 10_000) { windowStart = Date.now(); windowCount = 0; }
      if (++windowCount > MAX_MESSAGES_PER_10S) return;

      const { pairId, role } = ws.identity;
      if (!ALLOWED[role].has(msg.type)) return;
      const room = rooms.get(pairId);
      send(role === 'phone' ? room?.desktop : room?.phone, msg);
    });
  }

  // Keeps connections alive through Render's proxy and drops dead ones.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  return { wss, close: () => { clearInterval(heartbeat); wss.close(); } };
}
