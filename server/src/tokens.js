import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Device tokens are signed, not stored. The server keeps no database, so a
 * restart on Render does not unpair anyone, as long as SERVER_SECRET stays the same.
 *
 * Format: v1.<pairId>.<role>.<signature>
 */
export function createTokens(secret) {
  const sign = (pairId, role) =>
    createHmac('sha256', secret).update(`v1.${pairId}.${role}`).digest('base64url');

  return {
    issue(pairId, role) {
      return `v1.${pairId}.${role}.${sign(pairId, role)}`;
    },

    /** Returns { pairId, role } for a valid token, otherwise null. */
    verify(token) {
      if (typeof token !== 'string' || token.length > 200) return null;
      const [version, pairId, role, signature, extra] = token.split('.');
      if (version !== 'v1' || !pairId || !signature || extra !== undefined) return null;
      if (role !== 'phone' && role !== 'desktop') return null;
      const expected = Buffer.from(sign(pairId, role));
      const actual = Buffer.from(signature);
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
      return { pairId, role };
    },
  };
}

export const newId = (bytes = 24) => randomBytes(bytes).toString('base64url');
