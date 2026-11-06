const { screen } = require('electron');
const { input } = require('./input.js');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const MIN_GLIDE_MS = 180;
const MAX_GLIDE_MS = 650;
const SETTLE_MS = 25; // lets apps notice the pointer before the click lands

/**
 * Desk Bud's own mouse.
 *
 * Windows and macOS only have one real pointer, so the blue mouse is drawn on a
 * see-through layer and does all its travelling there. When it needs to click, the
 * real pointer hops to the spot, clicks, and hops back in a few milliseconds.
 * Your pointer stays where you left it.
 */
class BlueMouse {
  constructor(overlay) {
    this.overlay = overlay;
    const { bounds } = screen.getPrimaryDisplay();
    this.position = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  }

  async glide(point) {
    const distance = Math.hypot(point.x - this.position.x, point.y - this.position.y);
    const ms = Math.round(Math.min(MAX_GLIDE_MS, Math.max(MIN_GLIDE_MS, distance * 0.7)));
    this.overlay.send('glide', { ...point, ms });
    await sleep(ms);
    this.position = point;
  }

  /** Runs an action with the real pointer at this spot, then puts your pointer back. */
  async atPoint(point, action) {
    const home = await input.nativePosition();
    try {
      await input.moveTo(point);
      await sleep(SETTLE_MS);
      return await action();
    } finally {
      await sleep(SETTLE_MS);
      await input.restore(home);
    }
  }

  async click(point = this.position, { button = 'left', count = 1, modifiers } = {}) {
    await this.glide(point);
    this.overlay.send('tap', { count });
    await this.atPoint(point, () =>
      input.withModifiers(modifiers, () => input.click(button, count)));
  }

  async scroll(point = this.position, direction, steps, modifiers) {
    await this.glide(point);
    await this.atPoint(point, () =>
      input.withModifiers(modifiers, () => input.scroll(direction, steps)));
  }

  async drag(from, to, modifiers) {
    await this.glide(from);
    await this.atPoint(from, () => input.withModifiers(modifiers, async () => {
      await input.press('left');
      try {
        const steps = 12;
        this.overlay.send('glide', { ...to, ms: steps * 25 });
        for (let i = 1; i <= steps; i++) {
          await input.moveTo({
            x: from.x + ((to.x - from.x) * i) / steps,
            y: from.y + ((to.y - from.y) * i) / steps,
          });
          await sleep(25);
        }
      } finally {
        await input.release('left');
      }
    }));
    this.position = to;
  }

  /** Hovering only works with the real pointer, so this is the one action that leaves it there. */
  async hover(point) {
    await this.glide(point);
    await input.moveTo(point);
  }

  /** A little hop so you can see which way it went, for actions that need no clicking. */
  async wave() {
    const { bounds } = screen.getPrimaryDisplay();
    await this.glide({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
    this.overlay.send('tap', { count: 1 });
  }

  rest() {
    this.overlay.send('rest', {});
  }
}

module.exports = { BlueMouse };
