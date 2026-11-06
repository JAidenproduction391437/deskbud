import { randomInt } from 'node:crypto';
import { newId } from './tokens.js';

// No 0/O, 1/I/L: these codes get read off a phone and typed by hand.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_LENGTH = 6;
export const CODE_TTL_MS = 5 * 60_000;
const HANDOFF_TTL_MS = 10 * 60_000;
const PAIRED_TTL_MS = 2 * 60_000;

export const normalizeCode = (code) =>
  String(code ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');

function makeCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

/**
 * The pairing handshake, held in memory because it only lasts a few minutes.
 *
 *   phone    start()  -> shows the code, then polls status()
 *   computer claim()  -> trades the code for a one-time handoff
 *   app      redeem() -> trades the handoff for its token; the phone gets its own
 */
export class PairingStore {
  constructor(tokens, now = () => Date.now()) {
    this.tokens = tokens;
    this.now = now;
    this.byId = new Map();
    this.byCode = new Map();
    this.byHandoff = new Map();
  }

  sweep() {
    const t = this.now();
    for (const [id, p] of this.byId) {
      if (p.expiresAt <= t) {
        this.byId.delete(id);
        if (p.code) this.byCode.delete(p.code);
        if (p.handoff) this.byHandoff.delete(p.handoff);
      }
    }
  }

  start() {
    this.sweep();
    let code = makeCode();
    while (this.byCode.has(code)) code = makeCode();
    const pairing = {
      id: newId(12),
      pollSecret: newId(),
      code,
      state: 'waiting',
      expiresAt: this.now() + CODE_TTL_MS,
    };
    this.byId.set(pairing.id, pairing);
    this.byCode.set(code, pairing);
    return pairing;
  }

  /** Each code works once. Returns { handoff } or null. */
  claim(rawCode, device = {}) {
    this.sweep();
    const code = normalizeCode(rawCode);
    const pairing = this.byCode.get(code);
    if (!pairing || pairing.state !== 'waiting') return null;
    this.byCode.delete(code);
    pairing.code = null;
    pairing.state = 'claimed';
    pairing.handoff = newId();
    pairing.device = {
      os: String(device.os ?? 'computer').slice(0, 20),
      name: String(device.name ?? 'Computer').slice(0, 60),
    };
    pairing.expiresAt = this.now() + HANDOFF_TTL_MS;
    this.byHandoff.set(pairing.handoff, pairing);
    return { handoff: pairing.handoff };
  }

  /** Each handoff works once. Returns { token, pairId } or null. */
  redeem(handoff) {
    this.sweep();
    const pairing = this.byHandoff.get(handoff);
    if (!pairing || pairing.state !== 'claimed') return null;
    this.byHandoff.delete(handoff);
    pairing.handoff = null;
    pairing.state = 'paired';
    pairing.pairId = newId(16);
    pairing.expiresAt = this.now() + PAIRED_TTL_MS;
    return { token: this.tokens.issue(pairing.pairId, 'desktop'), pairId: pairing.pairId };
  }

  status(id, pollSecret) {
    this.sweep();
    const pairing = this.byId.get(id);
    if (!pairing || pairing.pollSecret !== pollSecret) return { state: 'expired' };
    if (pairing.state !== 'paired') return { state: pairing.state };
    this.byId.delete(id);
    return {
      state: 'paired',
      token: this.tokens.issue(pairing.pairId, 'phone'),
      device: pairing.device,
    };
  }
}

/** Fixed-window counter. */
export class RateLimiter {
  constructor(limit, windowMs, now = () => Date.now()) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
    this.hits = new Map();
  }

  allow(key) {
    const t = this.now();
    let entry = this.hits.get(key);
    if (!entry || entry.resetAt <= t) {
      if (this.hits.size > 10_000) this.hits.clear();
      entry = { count: 0, resetAt: t + this.windowMs };
      this.hits.set(key, entry);
    }
    entry.count += 1;
    return entry.count <= this.limit;
  }
}
