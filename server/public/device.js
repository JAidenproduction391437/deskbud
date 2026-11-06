/**
 * Works out what kind of device opened the website.
 * Returns { kind: 'phone' | 'computer', os: 'windows' | 'mac' | 'linux' | 'ios' | 'android' | 'other' }.
 */
export function detectDevice({ userAgent = '', platform = '', maxTouchPoints = 0 } = {}) {
  const ua = userAgent.toLowerCase();

  if (/android/.test(ua)) return { kind: 'phone', os: 'android' };
  if (/iphone|ipod|ipad/.test(ua)) return { kind: 'phone', os: 'ios' };

  const looksLikeMac = /mac/.test(platform.toLowerCase()) || /macintosh/.test(ua);
  // iPads report themselves as Macs, but Macs have no touch screen.
  if (looksLikeMac && maxTouchPoints > 1) return { kind: 'phone', os: 'ios' };
  if (looksLikeMac) return { kind: 'computer', os: 'mac' };

  if (/windows/.test(ua)) return { kind: 'computer', os: 'windows' };
  if (/mobi/.test(ua)) return { kind: 'phone', os: 'other' };
  if (/linux|x11|cros/.test(ua)) return { kind: 'computer', os: 'linux' };
  return { kind: 'computer', os: 'other' };
}
