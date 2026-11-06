// Speech recognition often mishears a made-up name, so this accepts the usual
// near misses ("hey desk bird", "okay disc bud", "hey deskbud").
const GREETING = '(?:hey|hay|hi|ok|okay|yo)';
const DESK = '(?:desk|disk|disc|dusk|deck|dest|des)';
const BUD = '(?:bud|buds|bird|bug|bot|buddy|bub|but|butt)';
const WAKE = new RegExp(`(?:^|\\s)${GREETING}\\s+${DESK}\\s*${BUD}(?=\\s|$)`);

const clean = (text) =>
  text.toLowerCase().replace(/[.,!?;:"“”]/g, ' ').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();

/** Finds the wake phrase. Returns { heard: true, rest } or { heard: false }. */
export function findWake(text) {
  const spoken = clean(text);
  const match = WAKE.exec(spoken);
  if (!match) return { heard: false };
  return { heard: true, rest: spoken.slice(match.index + match[0].length).trim() };
}

/**
 * Follows the conversation: sleeping until it hears its name, then taking the next
 * thing said as the command. feed() takes each transcript and returns what happened:
 *   'wake'            it just heard its name
 *   { command }       a finished command
 *   null              nothing to do
 *
 * The name and the command can arrive together ("hey desk bud open youtube") or
 * separately ("hey desk bud" ... "open youtube").
 */
export class WakeListener {
  constructor() {
    this.awake = false;
  }

  feed(transcript, isFinal) {
    const wake = findWake(transcript);

    if (!this.awake) {
      if (!wake.heard) return null;
      this.awake = true;
      if (isFinal && wake.rest) {
        this.awake = false;
        return { woke: true, command: wake.rest };
      }
      return 'wake';
    }

    if (!isFinal) return null;
    const command = wake.heard ? wake.rest : clean(transcript);
    if (!command) return null;
    this.awake = false;
    return { command };
  }

  sleep() {
    this.awake = false;
  }
}
