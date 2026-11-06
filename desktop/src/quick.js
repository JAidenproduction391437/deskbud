// Understands simple requests without any AI, so they are instant and free.
// Anything this doesn't recognise goes to Claude, if an API key is set.

const SITES = {
  youtube: 'https://www.youtube.com',
  google: 'https://www.google.com',
  gmail: 'https://mail.google.com',
  'google docs': 'https://docs.google.com',
  'google drive': 'https://drive.google.com',
  'google maps': 'https://maps.google.com',
  maps: 'https://maps.google.com',
  github: 'https://github.com',
  reddit: 'https://www.reddit.com',
  wikipedia: 'https://www.wikipedia.org',
  amazon: 'https://www.amazon.com',
  netflix: 'https://www.netflix.com',
  spotify: 'https://open.spotify.com',
  twitch: 'https://www.twitch.tv',
  facebook: 'https://www.facebook.com',
  instagram: 'https://www.instagram.com',
  tiktok: 'https://www.tiktok.com',
  linkedin: 'https://www.linkedin.com',
  x: 'https://x.com',
  twitter: 'https://x.com',
  claude: 'https://claude.ai',
};

const SEARCH_ENGINES = {
  google: 'https://www.google.com/search?q=',
  youtube: 'https://www.youtube.com/results?search_query=',
  amazon: 'https://www.amazon.com/s?k=',
  wikipedia: 'https://en.wikipedia.org/w/index.php?search=',
  reddit: 'https://www.reddit.com/search/?q=',
  bing: 'https://www.bing.com/search?q=',
  github: 'https://github.com/search?q=',
};

const PRESSABLE = /^(enter|return|escape|esc|tab|space|backspace|delete|up|down|left|right|home|end|page ?up|page ?down|f\d{1,2}|[a-z0-9])$/;

const titleCase = (text) => text.replace(/\b\w/g, (letter) => letter.toUpperCase());

function tidy(text) {
  return text
    .trim()
    .replace(/[.!?]+$/, '')
    .replace(/^(please|can you|could you|would you|will you)\s+/i, '')
    .replace(/^(please)\s+/i, '')
    .replace(/\s+(please|for me|now)$/i, '')
    .trim();
}

const isCompound = (text) =>
  /\bthen\b/i.test(text) ||
  /\band\s+(open|click|play|type|write|send|go|search|find|close|save|download|make|create|tell|show|read|summari[sz]e|sign|log|buy|book|add|reply|watch)\b/i.test(text);

function parseKeys(raw) {
  const spoken = raw
    .toLowerCase()
    .replace(/\b(the|key|button)\b/g, '')
    .replace(/\bcontrol\b/g, 'ctrl')
    .replace(/\boption\b/g, 'alt')
    .replace(/\b(command|cmd|windows)\b/g, 'super')
    .replace(/\s*\+\s*|\s+plus\s+/g, ' ')
    .trim();
  const parts = spoken.split(/\s+/).filter(Boolean);
  const modifiers = parts.filter((part) => ['ctrl', 'alt', 'shift', 'super'].includes(part));
  const rest = parts.filter((part) => !modifiers.includes(part)).join(' ');
  if (rest && !PRESSABLE.test(rest)) return null;
  if (!rest && !modifiers.length) return null;
  return [...modifiers, ...(rest ? [rest.replace(/\s+/g, '')] : [])].join('+');
}

function parseOpen(verb, rawTarget) {
  const target = rawTarget
    .toLowerCase()
    .replace(/^(up|the|my|a|an|new)\s+/, '')
    .replace(/^(up|the|my|a|an|new)\s+/, '')
    .replace(/\s+dot\s+/g, '.')
    .trim();

  if (/^(web ?site|web browser|browser|internet|web|tab)$/.test(target)) {
    return { kind: 'open-url', url: SITES.google, label: 'your browser' };
  }
  if (SITES[target]) return { kind: 'open-url', url: SITES[target], label: titleCase(target) };

  const site = target.replace(/^(web ?site|site)\s+/, '');
  if (SITES[site]) return { kind: 'open-url', url: SITES[site], label: titleCase(site) };
  if (/^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/.test(site)) {
    return {
      kind: 'open-url',
      url: site.startsWith('http') ? site : `https://${site}`,
      label: site.replace(/^https?:\/\//, ''),
    };
  }

  if (/^(go to|visit)$/.test(verb) || site !== target) {
    return {
      kind: 'open-url',
      url: SEARCH_ENGINES.google + encodeURIComponent(site),
      label: `a search for ${site}`,
    };
  }
  return { kind: 'open-app', name: target, label: titleCase(target) };
}

function parseSearch(text) {
  const engines = Object.keys(SEARCH_ENGINES).join('|');
  let engine = 'google';
  let query = null;

  const named = new RegExp(`^(?:search|look up)\\s+(${engines})\\s+for\\s+(.+)$`, 'i').exec(text);
  const trailing = new RegExp(`^(?:search(?: for)?|look up|google)\\s+(.+?)\\s+(?:on|in)\\s+(${engines})$`, 'i').exec(text);
  const plain = /^(?:search(?: for)?|look up|google)\s+(.+)$/i.exec(text);

  if (named) [, engine, query] = named;
  else if (trailing) [, query, engine] = trailing;
  else if (plain) [, query] = plain;
  if (!query) return null;

  engine = engine.toLowerCase();
  return {
    kind: 'open-url',
    url: SEARCH_ENGINES[engine] + encodeURIComponent(query),
    label: `${titleCase(engine)} results for ${query}`,
    searching: true,
  };
}

/** Returns what to do, or null if this needs Claude. */
function parseCommand(input) {
  const text = tidy(String(input ?? ''));
  if (!text || isCompound(text)) return null;

  if (/^(what can you do|help)$/i.test(text)) return { kind: 'help' };

  const typing = /^type(?: out)?\s+(.+)$/i.exec(text);
  if (typing) return { kind: 'type', text: typing[1] };

  const pressing = /^(?:press|hit)\s+(.+)$/i.exec(text);
  if (pressing) {
    const keys = parseKeys(pressing[1]);
    return keys ? { kind: 'press', keys } : null;
  }

  const scrolling = /^scroll\s+(up|down|left|right)$/i.exec(text);
  if (scrolling) return { kind: 'scroll', direction: scrolling[1].toLowerCase() };

  const clicking = /^(double |right )?click$/i.exec(text);
  if (clicking) return { kind: 'click', style: clicking[1]?.trim().toLowerCase() ?? 'left' };

  const searching = parseSearch(text);
  if (searching) return searching;

  const opening = /^(open|launch|start|go to|visit|pull up|bring up)\s+(.+)$/i.exec(text);
  if (opening) return parseOpen(opening[1].toLowerCase(), opening[2]);

  return null;
}

module.exports = { parseCommand };
