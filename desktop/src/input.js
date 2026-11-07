const { clipboard, screen } = require('electron');
const { mouse, keyboard, Key, Button, Point, sleep } = require('@nut-tree-fork/nut-js');

mouse.config.autoDelayMs = 0;
mouse.config.mouseSpeed = 100000;
keyboard.config.autoDelayMs = 6;

const isMac = process.platform === 'darwin';
const isWindows = process.platform === 'win32';

// nut-js scroll units differ per system. These make one step about one wheel click.
const SCROLL_UNIT = isWindows ? 120 : isMac ? 12 : 1;
const PASTE_OVER_CHARS = 40;

const KEY_NAMES = {
  ctrl: Key.LeftControl, control: Key.LeftControl,
  shift: Key.LeftShift,
  alt: Key.LeftAlt, option: Key.LeftAlt,
  super: Key.LeftSuper, win: Key.LeftSuper, windows: Key.LeftSuper, cmd: Key.LeftSuper, command: Key.LeftSuper, meta: Key.LeftSuper,
  return: Key.Return, enter: Key.Return, kp_enter: Key.Return,
  escape: Key.Escape, esc: Key.Escape,
  tab: Key.Tab, space: Key.Space,
  backspace: Key.Backspace, delete: Key.Delete, insert: Key.Insert,
  up: Key.Up, down: Key.Down, left: Key.Left, right: Key.Right,
  arrowup: Key.Up, arrowdown: Key.Down, arrowleft: Key.Left, arrowright: Key.Right,
  home: Key.Home, end: Key.End,
  pageup: Key.PageUp, page_up: Key.PageUp, prior: Key.PageUp,
  pagedown: Key.PageDown, page_down: Key.PageDown, next: Key.PageDown,
  minus: Key.Minus, '-': Key.Minus,
  equal: Key.Equal, '=': Key.Equal, plus: Key.Equal,
  comma: Key.Comma, ',': Key.Comma,
  period: Key.Period, '.': Key.Period,
  slash: Key.Slash, '/': Key.Slash,
  backslash: Key.Backslash, '\\': Key.Backslash,
  semicolon: Key.Semicolon, ';': Key.Semicolon,
  quote: Key.Quote, apostrophe: Key.Quote, "'": Key.Quote,
  grave: Key.Grave, '`': Key.Grave,
  bracketleft: Key.LeftBracket, '[': Key.LeftBracket,
  bracketright: Key.RightBracket, ']': Key.RightBracket,
};

function keyFromName(name) {
  const lower = name.toLowerCase();
  if (KEY_NAMES[lower] !== undefined) return KEY_NAMES[lower];
  if (/^[a-z]$/.test(lower)) return Key[lower.toUpperCase()];
  if (/^[0-9]$/.test(lower)) return Key[`Num${lower}`];
  if (/^f([1-9]|1\d|2[0-4])$/.test(lower)) return Key[lower.toUpperCase()];
  throw new Error(`Unknown key: ${name}`);
}

/** Turns "ctrl+shift+t" into key codes. */
function parseChord(chord) {
  return chord.split(/[+ ]/).filter(Boolean).map(keyFromName);
}

// Electron works in scaled pixels, while nut-js on Windows works in physical pixels.
const toNative = ({ x, y }) => {
  const point = isWindows ? screen.dipToScreenPoint({ x, y }) : { x, y };
  return new Point(Math.round(point.x), Math.round(point.y));
};

const BUTTONS = { left: Button.LEFT, right: Button.RIGHT, middle: Button.MIDDLE };

const input = {
  async moveTo(point) {
    await mouse.setPosition(toNative(point));
  },

  async nativePosition() {
    return mouse.getPosition();
  },

  async restore(native) {
    await mouse.setPosition(native);
  },

  async click(button = 'left', count = 1) {
    for (let i = 0; i < count; i++) {
      await mouse.click(BUTTONS[button]);
      if (i < count - 1) await sleep(40);
    }
  },

  async press(button = 'left') {
    await mouse.pressButton(BUTTONS[button]);
  },

  async release(button = 'left') {
    await mouse.releaseButton(BUTTONS[button]);
  },

  async scroll(direction, steps) {
    const amount = Math.max(1, Math.round(steps)) * SCROLL_UNIT;
    const scrolls = { up: 'scrollUp', down: 'scrollDown', left: 'scrollLeft', right: 'scrollRight' };
    await mouse[scrolls[direction]](amount);
  },

  async chord(text, repeat = 1) {
    const keys = parseChord(text);
    for (let i = 0; i < repeat; i++) {
      await keyboard.pressKey(...keys);
      await keyboard.releaseKey(...keys);
    }
  },

  async keyDown(text) {
    await keyboard.pressKey(...parseChord(text));
  },

  async keyUp(text) {
    await keyboard.releaseKey(...parseChord(text));
  },

  async hold(text, seconds) {
    const keys = parseChord(text);
    await keyboard.pressKey(...keys);
    await sleep(seconds * 1000);
    await keyboard.releaseKey(...keys);
  },

  async withModifiers(text, action) {
    const keys = text ? parseChord(text) : [];
    if (keys.length) await keyboard.pressKey(...keys);
    try {
      return await action();
    } finally {
      if (keys.length) await keyboard.releaseKey(...keys);
    }
  },

  /** Long or non-English text goes through the clipboard, which is faster and more reliable. */
  async type(text) {
    // eslint-disable-next-line no-control-regex
    if (text.length <= PASTE_OVER_CHARS && /^[\x20-\x7e\n]*$/.test(text)) {
      await keyboard.type(text);
      return;
    }
    const saved = clipboard.readText();
    clipboard.writeText(text);
    await input.chord(isMac ? 'super+v' : 'ctrl+v');
    await sleep(150);
    clipboard.writeText(saved);
  },

  async openLauncher(name) {
    await input.chord(isMac ? 'super+space' : 'super');
    await sleep(600);
    await input.type(name);
    await sleep(800);
    await input.chord('return');
  },
};

module.exports = { input, parseChord };
