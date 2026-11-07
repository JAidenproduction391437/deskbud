const { Agent, SYSTEM, CUSTOM_TOOLS } = require('./agent.js');
const { captureScreen } = require('./capture.js');
const { input } = require('./input.js');

const API_URL = process.env.DESKBUD_GEMINI_URL ?? 'https://generativelanguage.googleapis.com/v1beta/interactions';
const FALLBACK_MODEL = 'gemini-3.5-flash-lite';
const MAX_TURNS = 60;
const BUSY_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 120_000;
const SETTLE_MS = 500; // lets the screen update before the next screenshot
const SCREENSHOT_LONG_EDGE = 1280;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class GeminiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const asFunction = ({ name, description, input_schema: { type, properties, required } }) => ({
  type: 'function',
  name,
  description,
  parameters: { type, properties, required },
});

/** The same helper as Agent, with Gemini's computer use format in place of Claude's. */
class GeminiAgent extends Agent {
  reset() {
    super.reset();
    this.interactionId = null;
    this.activeModel = null;
  }

  tools() {
    return [
      { type: 'computer_use', environment: 'desktop', enable_prompt_injection_detection: true },
      ...super.tools().filter((tool) => tool.name).map(asFunction),
    ];
  }

  async request(model, inputs, signal) {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.getConfig().geminiKey },
      body: JSON.stringify({
        model,
        input: inputs,
        system_instruction: SYSTEM,
        tools: this.tools(),
        ...(this.interactionId ? { previous_interaction_id: this.interactionId } : {}),
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new GeminiError(res.status, body.error?.message ?? `Gemini said ${res.status}.`);
    return body;
  }

  /** Gemini's popular models are often busy, so this waits and then tries the lighter one. */
  async send(inputs, signal) {
    const preferred = this.activeModel ?? this.getConfig().model;
    // An interaction chain has to stay on the model that started it.
    const models = this.interactionId || preferred === FALLBACK_MODEL ? [preferred] : [preferred, FALLBACK_MODEL];
    let lastError;

    for (const model of models) {
      for (let attempt = 0; attempt < BUSY_RETRIES; attempt++) {
        try {
          const response = await this.request(model, inputs, signal);
          this.activeModel = model;
          return response;
        } catch (error) {
          if (![429, 500, 503].includes(error.status)) throw error;
          lastError = error;
          await sleep(1500 * 2 ** attempt);
          signal.throwIfAborted();
        }
      }
    }
    throw lastError;
  }

  async run(text, signal) {
    if (Date.now() - this.lastUsed > 10 * 60_000) this.reset();

    try {
      const shot = await this.screenshot();
      let inputs = [{ type: 'text', text }, this.imagePart(shot)];

      for (let turn = 0; turn < MAX_TURNS; turn++) {
        signal.throwIfAborted();
        const response = await this.send(inputs, signal);
        this.interactionId = response.id;

        const calls = (response.steps ?? []).filter((step) => step.type === 'function_call');
        if (!calls.length) {
          this.lastUsed = Date.now();
          return finalText(response) || 'All done!';
        }

        const results = await this.runCalls(calls, signal);
        if (!results) {
          this.reset();
          return "Okay, I won't do that.";
        }
        inputs = results;
      }
      this.reset();
      return 'That was taking too many steps, so I stopped.';
    } catch (error) {
      this.reset();
      throw error;
    }
  }

  async screenshot() {
    this.shot = await captureScreen(SCREENSHOT_LONG_EDGE, 'png');
    return this.shot;
  }

  /** Gemini's computer use only accepts PNG. */
  imagePart(shot) {
    return { type: 'image', data: shot.base64, mime_type: 'image/png' };
  }

  /** Runs the calls in order. Returns the results, or null if the owner refused one. */
  async runCalls(calls, signal) {
    const results = [];
    let failed = false;

    for (const call of calls) {
      const { safety_decision: safety, intent, ...args } = call.arguments ?? {};
      if (intent) this.progress(intent);

      const outcome = {};
      if (safety?.decision === 'require_confirmation') {
        if (!(await this.ask(safety.explanation ?? `Allow this? ${intent ?? call.name}`, signal))) return null;
        outcome.safety_acknowledgement = true;
      }

      if (failed) {
        outcome.error = 'Not run, because an earlier action failed.';
      } else {
        try {
          signal.throwIfAborted();
          const isCustom = CUSTOM_TOOLS.some((tool) => tool.name === call.name);
          outcome.output = isCustom
            ? await this.customTool(call.name, args, signal)
            : await this.computer(call.name, args, signal);
        } catch (error) {
          if (signal.aborted) throw error;
          failed = true;
          outcome.error = error.message;
        }
      }

      results.push({
        type: 'function_result',
        name: call.name,
        call_id: call.id,
        result: [{ type: 'text', text: JSON.stringify({ url: '', ...outcome }) }],
      });
    }

    await sleep(SETTLE_MS);
    results.at(-1).result.push(this.imagePart(await this.screenshot()));
    return results;
  }

  /** Gemini's grid runs from 0 to 999 across the whole screen. */
  toScreen(x, y) {
    if (!(x >= 0 && x <= 1000 && y >= 0 && y <= 1000)) throw new Error(`[${x}, ${y}] is off the 0-999 grid.`);
    const { bounds } = this.shot;
    return { x: bounds.x + (x / 1000) * bounds.width, y: bounds.y + (y / 1000) * bounds.height };
  }

  async computer(name, args, signal) {
    const clicks = {
      click: { button: 'left' },
      right_click: { button: 'right' },
      middle_click: { button: 'middle' },
      double_click: { button: 'left', count: 2 },
      triple_click: { button: 'left', count: 3 },
    };

    if (clicks[name]) {
      await this.blue.click(this.toScreen(args.x, args.y), clicks[name]);
      return 'OK';
    }

    switch (name) {
      case 'take_screenshot':
        return 'OK';
      case 'move':
        await this.blue.hover(this.toScreen(args.x, args.y));
        return 'OK';
      case 'mouse_down':
        await input.moveTo(this.toScreen(args.x, args.y));
        await input.press('left');
        return 'OK';
      case 'mouse_up':
        await input.moveTo(this.toScreen(args.x, args.y));
        await input.release('left');
        return 'OK';
      case 'drag_and_drop':
        await this.blue.drag(this.toScreen(args.start_x, args.start_y), this.toScreen(args.end_x, args.end_y));
        return 'OK';
      case 'type':
        await input.type(args.text);
        if (args.press_enter) await input.chord('return');
        return 'OK';
      case 'press_key':
        await input.chord(args.key);
        return 'OK';
      case 'key_down':
        await input.keyDown(args.key);
        return 'OK';
      case 'key_up':
        await input.keyUp(args.key);
        return 'OK';
      case 'hotkey':
        await input.chord(args.keys.join('+'));
        return 'OK';
      case 'scroll':
        await this.blue.scroll(
          this.toScreen(args.x, args.y),
          args.direction,
          Math.max(1, Math.round((args.magnitude_in_pixels ?? 300) / 100)),
        );
        return 'OK';
      case 'wait':
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, Math.min(args.seconds ?? 1, 60) * 1000);
          signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
        });
        return 'OK';
      default:
        throw new Error(`Unknown action: ${name}`);
    }
  }
}

/** Picks the words out of Gemini's final steps. */
function finalText(response) {
  const words = [];
  const collect = (value) => {
    if (Array.isArray(value)) value.forEach(collect);
    else if (value?.type === 'text' && typeof value.text === 'string') words.push(value.text);
    else if (value?.content) collect(value.content);
  };
  (response.steps ?? []).filter((step) => step.type !== 'thought').forEach(collect);
  return words.join(' ').trim();
}

function explainGeminiError(error) {
  if (error.status === 400 && /api.?key/i.test(error.message)) return "My Gemini key didn't work. Check it in the Desk Bud settings on your computer.";
  if (error.status === 401 || error.status === 403) return "My Gemini key didn't work. Check it in the Desk Bud settings on your computer.";
  if (error.status === 429) return 'Gemini says we hit its limit. Try again in a little while.';
  if (error.status === 500 || error.status === 503) return 'Gemini is too busy right now. Try again in a minute.';
  if (error.status) return `Gemini couldn't take that request: ${error.message}`;
  return null;
}

module.exports = { GeminiAgent, explainGeminiError, finalText };
