import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createTokens } from './tokens.js';
import { CODE_TTL_MS, PairingStore, RateLimiter } from './pairing.js';
import { attachRelay } from './relay.js';

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

function securityHeaders(req) {
  const host = /^[\w.:-]+$/.test(req.headers.host ?? '') ? req.headers.host : '';
  return {
    'Content-Security-Policy': [
      "default-src 'self'",
      `connect-src 'self' wss://${host} ws://${host}`,
      "img-src 'self' data:",
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'microphone=(self), camera=()',
  };
}

function downloadLinks(env) {
  const repo = env.GITHUB_REPO?.trim();
  const release = repo ? `https://github.com/${repo}/releases/latest/download` : null;
  return {
    windows: env.DOWNLOAD_WINDOWS_URL || (release && `${release}/DeskBud-Setup.exe`),
    macArm: env.DOWNLOAD_MAC_ARM_URL || (release && `${release}/DeskBud-mac-arm64.dmg`),
    macIntel: env.DOWNLOAD_MAC_INTEL_URL || (release && `${release}/DeskBud-mac-x64.dmg`),
  };
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4096) throw new Error('too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}

const clientIp = (req) =>
  req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';

export function createApp({ env = process.env } = {}) {
  let secret = env.SERVER_SECRET;
  if (!secret) {
    secret = randomBytes(32).toString('hex');
    console.warn('SERVER_SECRET is not set: paired devices will need to pair again after every restart.');
  }

  const tokens = createTokens(secret);
  const pairings = new PairingStore(tokens);
  const startLimit = new RateLimiter(20, 60_000);
  const claimLimit = new RateLimiter(10, 60_000);
  // Caps guessing across all addresses, so spreading it over many IPs doesn't help.
  const failedClaimsEverywhere = new RateLimiter(120, 60_000);

  const api = {
    'POST /api/pair/start': (body, req) => {
      if (!startLimit.allow(clientIp(req))) return [429, { error: 'Too many tries. Wait a minute.' }];
      const pairing = pairings.start();
      return [200, {
        id: pairing.id,
        pollSecret: pairing.pollSecret,
        code: pairing.code,
        expiresInMs: CODE_TTL_MS,
      }];
    },
    'POST /api/pair/status': (body) => [200, pairings.status(body.id, body.pollSecret)],
    'POST /api/pair/claim': (body, req) => {
      if (!claimLimit.allow(clientIp(req))) return [429, { error: 'Too many tries. Wait a minute.' }];
      const claimed = pairings.claim(body.code, body.device);
      if (claimed) return [200, claimed];
      if (!failedClaimsEverywhere.allow('all')) return [429, { error: 'Too many tries. Wait a minute.' }];
      return [404, { error: "That code didn't work. Check your phone and try again." }];
    },
    'POST /api/pair/redeem': (body) => {
      const redeemed = pairings.redeem(body.handoff);
      return redeemed ? [200, redeemed] : [404, { error: 'That pairing link has expired. Start again from your phone.' }];
    },
    'GET /api/config': () => [200, { downloads: downloadLinks(env) }],
    'GET /healthz': () => [200, { ok: true }],
  };

  async function serveStatic(req, res, pathname) {
    const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
    const filePath = normalize(join(PUBLIC_DIR, relative));
    if (!filePath.startsWith(PUBLIC_DIR + sep)) return false;
    try {
      if (!(await stat(filePath)).isFile()) return false;
      const body = await readFile(filePath);
      res.writeHead(200, {
        ...securityHeaders(req),
        'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(req.method === 'HEAD' ? undefined : body);
      return true;
    } catch {
      return false;
    }
  }

  const server = createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://x');
    const handler = api[`${req.method} ${pathname}`];
    const reply = (status, body) => {
      res.writeHead(status, {
        ...securityHeaders(req),
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(body));
    };

    if (handler) {
      try {
        const body = req.method === 'POST' ? await readJson(req) : {};
        const [status, payload] = handler(body, req);
        return reply(status, payload);
      } catch {
        return reply(400, { error: 'Bad request' });
      }
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && (await serveStatic(req, res, pathname))) return;
    reply(404, { error: 'Not found' });
  });

  const relay = attachRelay(server, tokens);
  server.on('close', () => relay.close());
  return server;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, '0.0.0.0', () => console.log(`Desk Bud is listening on port ${port}`));
}
