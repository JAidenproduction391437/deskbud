import { WakeListener } from './wake.js';

const TOKEN_KEY = 'deskbud.token';
const DEVICE_KEY = 'deskbud.device';
const AWAKE_TIMEOUT_MS = 8000;

const $ = (id) => document.getElementById(id);

const storage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* private mode */ } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* private mode */ } },
};

export function startPhone() {
  const token = storage.get(TOKEN_KEY);
  if (token) startBud(token);
  else startPairing();
}

/* ---------- Pairing ---------- */

const post = (path, body) => fetch(path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

async function startPairing() {
  $('phone-bud').hidden = true;
  $('phone-pair').hidden = false;
  $('site-address').textContent = location.host;

  const note = $('pair-note');
  const code = $('pair-code');
  let pairing;

  try {
    note.textContent = 'Getting your code… this can take a minute if the server was asleep.';
    const res = await post('/api/pair/start', {});
    if (!res.ok) throw new Error();
    pairing = await res.json();
  } catch {
    note.textContent = 'Couldn\'t reach the server. Trying again…';
    setTimeout(startPairing, 4000);
    return;
  }

  code.textContent = pairing.code;
  note.textContent = 'Waiting for your computer…';

  const poll = async () => {
    let status;
    try {
      status = await (await post('/api/pair/status', { id: pairing.id, pollSecret: pairing.pollSecret })).json();
    } catch {
      setTimeout(poll, 3000);
      return;
    }
    if (status.state === 'paired') {
      storage.set(TOKEN_KEY, status.token);
      storage.set(DEVICE_KEY, JSON.stringify(status.device));
      $('phone-pair').hidden = true;
      startBud(status.token);
    } else if (status.state === 'expired') {
      startPairing();
    } else {
      if (status.state === 'claimed') note.textContent = 'Right code! Finish connecting in the Desk Bud app.';
      setTimeout(poll, 1500);
    }
  };
  poll();
}

/* ---------- Connection to the computer ---------- */

class Link {
  constructor(token, handlers) {
    this.token = token;
    this.handlers = handlers;
    this.retryMs = 1000;
    this.closed = false;
    this.connect();
  }

  connect() {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${scheme}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', token: this.token }));
    ws.onmessage = (event) => {
      this.retryMs = 1000;
      this.handlers.message(JSON.parse(event.data));
    };
    ws.onclose = (event) => {
      this.handlers.down();
      if (event.code === 4401) return this.handlers.rejected();
      if (event.code === 4409 || this.closed) return undefined;
      setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 15000);
      return undefined;
    };
  }

  send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  close() {
    this.closed = true;
    this.ws?.close();
  }
}

/* ---------- Desk Bud ---------- */

function startBud(token) {
  const root = $('phone-bud');
  root.hidden = false;

  const caption = $('caption');
  const linkStatus = $('link-status');
  const stopButton = $('stop-button');
  const wakeButton = $('wake-button');

  let desktopOnline = false;
  let pendingConfirmId = null;
  let commandCount = 0;
  let idleTimer = null;

  const setState = (state) => { root.dataset.state = state; };
  const say = (text) => { caption.textContent = text; };

  function showLink(online, label) {
    linkStatus.classList.toggle('online', online);
    linkStatus.textContent = label;
  }

  function restingState() {
    setState(ears.on ? 'idle' : 'asleep');
    if (ears.on) say(desktopOnline ? 'Say "Hey Desk Bud"' : 'Waiting for your computer…');
  }

  // Keeps the eyes open and on your mouse for a while after any activity.
  function settle() {
    clearTimeout(idleTimer);
    restingState();
    idleTimer = setTimeout(() => {
      if (root.dataset.state === 'idle') setState('asleep');
    }, 30000);
  }

  const link = new Link(token, {
    message: onMessage,
    down() {
      desktopOnline = false;
      showLink(false, 'Reconnecting…');
    },
    rejected() {
      forget();
    },
  });

  function forget() {
    link.close();
    ears.stop();
    storage.remove(TOKEN_KEY);
    storage.remove(DEVICE_KEY);
    root.hidden = true;
    startPairing();
  }

  function onMessage(msg) {
    switch (msg.type) {
      case 'ready':
      case 'peer': {
        desktopOnline = msg.type === 'ready' ? msg.peerOnline : msg.online;
        showLink(desktopOnline, desktopOnline ? 'Connected to your computer' : 'Computer is offline');
        if (root.dataset.state !== 'working') restingState();
        if (msg.type === 'peer' && !msg.online) stopButton.hidden = true;
        break;
      }
      case 'info':
        showLink(true, `Connected to ${msg.name}`);
        break;
      case 'mouse':
        look(msg.x, msg.y);
        break;
      case 'status':
        onStatus(msg);
        break;
      case 'confirm':
        pendingConfirmId = msg.id;
        $('confirm-text').textContent = msg.text;
        $('confirm').showModal();
        speak(msg.text);
        break;
      case 'frame':
        $('screen-image').src = `data:image/jpeg;base64,${msg.data}`;
        break;
      default:
    }
  }

  function onStatus(msg) {
    if (msg.state === 'working') {
      setState('working');
      stopButton.hidden = false;
      if (msg.say) say(msg.say);
      return;
    }
    stopButton.hidden = true;
    if (msg.say) {
      say(msg.say);
      speak(msg.say);
    } else {
      settle();
    }
  }

  /* Eyes */

  function look(x, y) {
    root.style.setProperty('--look-x', `${(x - 0.5) * 30}px`);
    root.style.setProperty('--look-y', `${(y - 0.5) * 30}px`);
    // Moving the mouse opens the eyes, unless it's busy doing something else.
    if (root.dataset.state === 'asleep' && ears.on) settle();
  }

  /* Talking back */

  function speak(text) {
    if (!('speechSynthesis' in window)) {
      settle();
      return;
    }
    ears.pause(); // otherwise it hears itself
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.pitch = 1.25;
    utterance.rate = 1.05;
    setState('speaking');
    const finished = () => {
      ears.resume();
      if (root.dataset.state === 'speaking') settle();
    };
    utterance.onend = finished;
    utterance.onerror = finished;
    speechSynthesis.speak(utterance);
  }

  function chime() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      chime.ctx ??= new AudioContext();
      const ctx = chime.ctx;
      [[660, 0], [990, 0.09]].forEach(([freq, delay]) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const at = ctx.currentTime + delay;
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.18, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
        osc.connect(gain).connect(ctx.destination);
        osc.start(at);
        osc.stop(at + 0.18);
      });
    } catch { /* a chime isn't worth failing over */ }
  }

  /* Sending requests */

  function sendCommand(text) {
    if (/^(stop|cancel|never ?mind)\b/i.test(text.trim())) {
      link.send({ type: 'stop' });
      say('Okay, stopping.');
      return;
    }
    if (!desktopOnline) {
      say('Your computer is offline. Open the Desk Bud app on it.');
      speak('Your computer is offline.');
      return;
    }
    commandCount += 1;
    link.send({ type: 'command', id: String(commandCount), text });
    setState('working');
    say(`"${text}"`);
  }

  /* Listening */

  const ears = createEars({
    onWake() {
      chime();
      setState('listening');
      say('Yes?');
    },
    onCommand(command) {
      sendCommand(command);
    },
    onHearing(text) {
      if (root.dataset.state === 'listening') say(text);
    },
    onTimeout() {
      settle();
    },
    onProblem(message) {
      say(message);
      wakeButton.hidden = false;
      $('ears-button').textContent = 'Start listening';
      setState('asleep');
    },
  });

  wakeButton.addEventListener('click', async () => {
    // Browsers only allow the mic, sound and speech after a tap.
    chime();
    if ('speechSynthesis' in window) speechSynthesis.speak(new SpeechSynthesisUtterance(''));
    if (!ears.supported) {
      say('This browser can\'t listen. Type below, or use Chrome.');
      wakeButton.hidden = true;
      return;
    }
    ears.start();
    wakeButton.hidden = true;
    $('ears-button').textContent = 'Stop listening';
    keepScreenOn();
    settle();
  });

  /* Controls */

  stopButton.addEventListener('click', () => {
    link.send({ type: 'stop' });
    say('Okay, stopping.');
  });

  $('ask-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = $('ask-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.blur();
    sendCommand(text);
  });

  $('menu-button').addEventListener('click', () => $('menu').showModal());
  $('menu-close').addEventListener('click', () => $('menu').close());

  $('ears-button').addEventListener('click', () => {
    $('menu').close();
    if (ears.on) {
      ears.stop();
      $('ears-button').textContent = 'Start listening';
      wakeButton.hidden = false;
      setState('asleep');
      say('');
    } else {
      wakeButton.click();
    }
  });

  $('unpair-button').addEventListener('click', () => {
    $('menu').close();
    forget();
  });

  function replyToConfirm(approved) {
    if (pendingConfirmId === null) return;
    link.send({ type: 'confirm-reply', id: pendingConfirmId, approved });
    pendingConfirmId = null;
    $('confirm').close();
  }
  $('confirm-yes').addEventListener('click', () => replyToConfirm(true));
  $('confirm-no').addEventListener('click', () => replyToConfirm(false));
  $('confirm').addEventListener('cancel', (event) => {
    event.preventDefault();
    replyToConfirm(false);
  });

  /* Seeing the screen */

  function closeScreen() {
    $('screen-view').hidden = true;
    link.send({ type: 'screen', on: false });
  }
  $('screen-button').addEventListener('click', () => {
    $('menu').close();
    $('screen-view').hidden = false;
    link.send({ type: 'screen', on: true });
  });
  $('screen-close').addEventListener('click', closeScreen);
  $('screen-image').addEventListener('click', (event) => {
    const point = imagePoint($('screen-image'), event);
    if (point) link.send({ type: 'pointer', action: 'click', ...point });
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      keepScreenOn();
      ears.resume();
    } else if (!$('screen-view').hidden) {
      closeScreen();
    }
  });

  restingState();
  say('Tap below, then say "Hey Desk Bud"');
}

/** Maps a tap to 0..1 on the picture itself, skipping the letterbox bars. */
function imagePoint(img, event) {
  if (!img.naturalWidth) return null;
  const box = img.getBoundingClientRect();
  const scale = Math.min(box.width / img.naturalWidth, box.height / img.naturalHeight);
  const width = img.naturalWidth * scale;
  const height = img.naturalHeight * scale;
  const x = (event.clientX - box.left - (box.width - width) / 2) / width;
  const y = (event.clientY - box.top - (box.height - height) / 2) / height;
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
}

let wakeLock = null;
async function keepScreenOn() {
  try {
    if ('wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch { /* the phone may refuse, such as on low battery */ }
}

/** Continuous listening. Browsers keep ending recognition, so this keeps restarting it. */
function createEars({ onWake, onCommand, onHearing, onTimeout, onProblem }) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const wake = new WakeListener();
  let recognizer = null;
  let on = false;
  let paused = false;
  let running = false;
  let awakeTimer = null;
  let failures = 0;

  function armTimeout() {
    clearTimeout(awakeTimer);
    awakeTimer = setTimeout(() => {
      wake.sleep();
      onTimeout();
    }, AWAKE_TIMEOUT_MS);
  }

  function handle(transcript, isFinal) {
    const result = wake.feed(transcript, isFinal);
    if (wake.awake) onHearing(transcript);
    if (result === 'wake') {
      onWake();
      armTimeout();
    } else if (result?.command) {
      clearTimeout(awakeTimer);
      if (result.woke) onWake();
      onCommand(result.command);
    } else if (wake.awake) {
      armTimeout();
    }
  }

  function begin() {
    if (!on || paused || running) return;
    recognizer = new Recognition();
    recognizer.continuous = true;
    recognizer.interimResults = true;
    recognizer.lang = navigator.language || 'en-US';

    recognizer.onresult = (event) => {
      failures = 0;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        handle(event.results[i][0].transcript, event.results[i].isFinal);
      }
    };
    recognizer.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        on = false;
        onProblem('Desk Bud needs the microphone. Allow it in your browser settings, then tap again.');
      } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
        failures += 1;
      }
    };
    recognizer.onend = () => {
      running = false;
      if (failures > 8) {
        on = false;
        onProblem('Listening stopped working. Tap to try again, or type below.');
        return;
      }
      setTimeout(begin, 250 + failures * 500);
    };

    try {
      recognizer.start();
      running = true;
    } catch {
      running = false;
    }
  }

  return {
    supported: Boolean(Recognition),
    get on() { return on; },
    start() {
      on = true;
      paused = false;
      failures = 0;
      begin();
    },
    stop() {
      on = false;
      clearTimeout(awakeTimer);
      wake.sleep();
      recognizer?.abort();
    },
    pause() {
      paused = true;
      recognizer?.abort();
    },
    resume() {
      paused = false;
      begin();
    },
  };
}
