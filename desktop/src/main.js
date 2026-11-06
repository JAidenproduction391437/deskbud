const os = require('node:os');
const path = require('node:path');
const {
  app, BrowserWindow, Menu, Tray, dialog, globalShortcut, ipcMain, nativeImage, screen, shell, systemPreferences,
} = require('electron');

// Lets a test run keep its data apart from your real settings.
if (process.env.DESKBUD_USER_DATA) app.setPath('userData', process.env.DESKBUD_USER_DATA);

const config = require('./config.js');
const { Relay, checkServer, postJson } = require('./relay.js');
const { BlueMouse } = require('./blue-mouse.js');
const { captureScreen } = require('./capture.js');
const { parseCommand } = require('./quick.js');
const { runQuick } = require('./actions.js');
const { Agent, explainError } = require('./agent.js');

const KILL_SWITCH = 'Control+Alt+Escape';
const SCREEN_FRAME_MS = 800;
const CONFIRM_TIMEOUT_MS = 120_000;

const asset = (...parts) => path.join(__dirname, '..', ...parts);

let settings;
let overlay;
let homeWindow;
let tray;
let blue;
let agent;
let current = null; // the running request: { id, controller }
let paused = false;
let screenTimer = null;
const pendingConfirms = new Map();
const relay = new Relay();

/* ---------- Windows ---------- */

function createOverlay() {
  const display = screen.getPrimaryDisplay();
  overlay = new BrowserWindow({
    ...display.bounds,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'overlay-preload.js') },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.setIgnoreMouseEvents(true); // every click goes straight through
  // Keeps Desk Bud out of its own screenshots, so it doesn't get in the way of what Claude sees.
  overlay.setContentProtection(!process.env.DESKBUD_SHOW_IN_CAPTURE);
  overlay.loadFile(asset('ui', 'overlay.html'));
  overlay.once('ready-to-show', () => {
    sendLayout();
    if (settings.showBuddy) overlay.showInactive();
  });
}

function sendLayout() {
  const display = screen.getPrimaryDisplay();
  sendOverlay('layout', {
    origin: { x: display.bounds.x, y: display.bounds.y },
    bottomGap: display.bounds.y + display.bounds.height - (display.workArea.y + display.workArea.height),
  });
}

function sendOverlay(event, data) {
  if (overlay && !overlay.isDestroyed()) overlay.webContents.send('overlay', event, data);
}

function showHome() {
  if (homeWindow && !homeWindow.isDestroyed()) {
    homeWindow.show();
    homeWindow.focus();
    return;
  }
  homeWindow = new BrowserWindow({
    width: 440,
    height: 680,
    title: 'Desk Bud',
    icon: asset('assets', 'icon.png'),
    autoHideMenuBar: true,
    resizable: false,
    fullscreenable: false,
    backgroundColor: '#f3f7ff',
    webPreferences: { preload: path.join(__dirname, 'home-preload.js') },
  });
  homeWindow.loadFile(asset('ui', 'home.html'));
  // Closing the window keeps Desk Bud running in the tray.
  homeWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      homeWindow.hide();
    }
  });
}

function buildTray() {
  const image = nativeImage.createFromPath(asset('assets', 'tray.png')).resize({ width: 18, height: 18 });
  tray = new Tray(image);
  tray.setToolTip('Desk Bud');
  tray.on('click', showHome);
  refreshTray();
}

function refreshTray() {
  tray?.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Desk Bud', click: showHome },
    { label: paused ? 'Resume Desk Bud' : 'Pause Desk Bud', click: () => setPaused(!paused) },
    { label: `Stop what it's doing (${KILL_SWITCH.replaceAll('Control', 'Ctrl')})`, click: () => stopEverything('Stopped from the computer.') },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
  ]));
}

function publicState() {
  return {
    paired: Boolean(settings.token),
    server: settings.server,
    online: relay.online,
    phoneOnline: relay.peerOnline,
    hasApiKey: Boolean(settings.apiKey),
    model: settings.model,
    allowCommands: settings.allowCommands,
    showBuddy: settings.showBuddy,
    paused,
    busy: Boolean(current),
    openAtLogin: app.getLoginItemSettings().openAtLogin,
    platform: process.platform,
    version: app.getVersion(),
  };
}

function pushState() {
  if (homeWindow && !homeWindow.isDestroyed()) homeWindow.webContents.send('state', publicState());
}

/* ---------- Doing what the phone asks ---------- */

function setPaused(value) {
  paused = value;
  if (paused) stopEverything();
  sendOverlay('mood', { mood: paused ? 'paused' : 'idle' });
  refreshTray();
  pushState();
}

function report(id, state, say) {
  relay.send({ type: 'status', id, state, say });
  sendOverlay('say', { text: say ?? '' });
}

function stopEverything(say) {
  stopScreenView();
  for (const finish of pendingConfirms.values()) finish(false);
  if (current) {
    current.stopMessage = say;
    current.controller.abort(new Error('stopped'));
  }
}

function askPhone(text, signal) {
  if (!relay.peerOnline) return Promise.resolve(false);
  const id = `confirm-${Date.now()}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish(false), CONFIRM_TIMEOUT_MS);
    const finish = (approved) => {
      clearTimeout(timer);
      pendingConfirms.delete(id);
      resolve(approved);
    };
    pendingConfirms.set(id, finish);
    signal.addEventListener('abort', () => finish(false), { once: true });
    relay.send({ type: 'confirm', id, text });
  });
}

async function handleCommand({ id, text }) {
  if (typeof text !== 'string' || !text.trim()) return;
  if (paused) return report(id, 'done', "I'm paused on your computer right now.");
  if (current) return report(id, 'done', "I'm still working on the last thing. Say stop first if you want me to switch.");

  const controller = new AbortController();
  current = { id, controller };
  sendOverlay('mood', { mood: 'working' });
  pushState();

  try {
    const intent = parseCommand(text);
    let reply;
    if (intent) {
      report(id, 'working', 'On it!');
      reply = await runQuick(intent, blue);
    } else if (settings.apiKey) {
      report(id, 'working', 'Let me work on that…');
      reply = await agent.run(text, controller.signal);
    } else {
      reply = 'I can only do simple things until you add a Claude API key in the Desk Bud app.';
    }
    report(id, 'done', reply);
  } catch (error) {
    if (!controller.signal.aborted) {
      console.error(error);
      report(id, 'done', explainError(error));
    } else {
      report(id, 'done', current.stopMessage ?? 'Okay, I stopped.');
    }
  } finally {
    current = null;
    blue.rest();
    sendOverlay('mood', { mood: paused ? 'paused' : 'idle' });
    pushState();
  }
}

/* ---------- Remote view ---------- */

function stopScreenView() {
  if (!screenTimer) return;
  clearTimeout(screenTimer);
  screenTimer = null;
  sendOverlay('viewing', { on: false });
}

function startScreenView() {
  if (screenTimer || paused) return;
  sendOverlay('viewing', { on: true });
  const tick = async () => {
    try {
      const shot = await captureScreen(960, 55);
      relay.send({ type: 'frame', data: shot.base64 });
    } catch (error) {
      console.error(error);
    }
    if (screenTimer) screenTimer = setTimeout(tick, SCREEN_FRAME_MS);
  };
  screenTimer = setTimeout(tick, 0);
}

async function handlePointer({ action, x, y }) {
  if (paused || current || action !== 'click') return;
  if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) return;
  const { bounds } = screen.getPrimaryDisplay();
  await blue.click({ x: bounds.x + x * bounds.width, y: bounds.y + y * bounds.height });
  blue.rest();
}

relay.on('message', (msg) => {
  switch (msg.type) {
    case 'command':
      handleCommand(msg);
      break;
    case 'stop':
      stopEverything('Okay, I stopped.');
      break;
    case 'confirm-reply':
      pendingConfirms.get(msg.id)?.(msg.approved === true);
      break;
    case 'screen':
      if (msg.on) startScreenView(); else stopScreenView();
      break;
    case 'pointer':
      handlePointer(msg).catch(console.error);
      break;
    default:
  }
});

relay.on('peer', (online) => {
  if (online) relay.send({ type: 'info', name: os.hostname(), os: process.platform });
  else stopScreenView();
});
relay.on('change', pushState);
relay.on('rejected', () => forgetPairing());

/* ---------- Eyes ---------- */

function watchMouse() {
  let lastSent = null;
  let lastSentAt = 0;
  setInterval(() => {
    const point = screen.getCursorScreenPoint();
    sendOverlay('look', point);

    const now = Date.now();
    if (!relay.peerOnline || now - lastSentAt < 120) return;
    const { bounds } = screen.getPrimaryDisplay();
    const clamp = (value) => Math.min(1, Math.max(0, value));
    const x = Math.round(clamp((point.x - bounds.x) / bounds.width) * 1000) / 1000;
    const y = Math.round(clamp((point.y - bounds.y) / bounds.height) * 1000) / 1000;
    if (lastSent?.x === x && lastSent?.y === y) return;
    lastSent = { x, y };
    lastSentAt = now;
    relay.send({ type: 'mouse', x, y });
  }, 33);
}

/* ---------- Pairing ---------- */

function forgetPairing() {
  relay.stop();
  settings.token = '';
  settings.server = '';
  config.save(settings);
  pushState();
}

async function finishPairing(server, handoff) {
  const { token } = await postJson(server, '/api/pair/redeem', { handoff });
  settings.server = server;
  settings.token = token;
  config.save(settings);
  relay.start(server, token);
  pushState();
  if (process.platform === 'darwin') systemPreferences.isTrustedAccessibilityClient(true);
}

/**
 * Handles deskbud://pair links. Any website can try to open one, and pairing gives that
 * server control of this computer, so nothing happens until you say yes here.
 */
async function handleDeepLink(raw) {
  let url;
  try { url = new URL(raw); } catch { return; }
  if (url.protocol !== 'deskbud:' || url.hostname !== 'pair') return;

  const server = checkServer(url.searchParams.get('server'));
  const handoff = url.searchParams.get('handoff');
  if (!server || !handoff) return;

  showHome();
  const replacing = settings.token ? `\n\nThis replaces your current connection to ${settings.server}.` : '';
  const { response } = await dialog.showMessageBox(homeWindow, {
    type: 'warning',
    title: 'Connect Desk Bud?',
    message: `Let ${new URL(server).host} control this computer?`,
    detail: `Only press Connect if you just typed your phone's code on your own Desk Bud website. If you didn't, press Cancel.${replacing}`,
    buttons: ['Cancel', 'Connect'],
    defaultId: 0,
    cancelId: 0,
  });
  if (response !== 1) return;

  try {
    await finishPairing(server, handoff);
  } catch (error) {
    dialog.showErrorBox('Desk Bud could not connect', error.message);
  }
}

function registerIpc() {
  ipcMain.handle('get-state', publicState);

  ipcMain.handle('pair', async (_event, { server: rawServer, code }) => {
    const server = checkServer(rawServer);
    if (!server) throw new Error('Enter your website address, starting with https://');
    const { handoff } = await postJson(server, '/api/pair/claim', {
      code,
      device: { os: { win32: 'windows', darwin: 'mac' }[process.platform] ?? 'other', name: os.hostname() },
    });
    await finishPairing(server, handoff);
  });

  ipcMain.handle('unpair', () => forgetPairing());

  ipcMain.handle('save', (_event, changes) => {
    if (typeof changes.apiKey === 'string') settings.apiKey = changes.apiKey.trim();
    if (['claude-opus-5-5', 'claude-sonnet-5-5'].includes(changes.model)) settings.model = changes.model;
    if (typeof changes.allowCommands === 'boolean') settings.allowCommands = changes.allowCommands;
    if (typeof changes.showBuddy === 'boolean') {
      settings.showBuddy = changes.showBuddy;
      if (changes.showBuddy) overlay.showInactive(); else overlay.hide();
    }
    if (typeof changes.openAtLogin === 'boolean') app.setLoginItemSettings({ openAtLogin: changes.openAtLogin });
    config.save(settings);
    agent.reset();
    pushState();
  });

  ipcMain.handle('set-paused', (_event, value) => setPaused(Boolean(value)));
  ipcMain.handle('stop', () => stopEverything('Stopped from the computer.'));
  ipcMain.handle('open-keys-page', () => shell.openExternal('https://platform.claude.com/settings/keys'));
}

/* ---------- Start up ---------- */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  if (process.defaultApp) {
    app.setAsDefaultProtocolClient('deskbud', process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient('deskbud');
  }

  // Windows delivers links as a second launch, macOS as an event.
  app.on('second-instance', (_event, argv) => {
    const link = argv.find((arg) => arg.startsWith('deskbud://'));
    if (link) handleDeepLink(link);
    else showHome();
  });
  app.on('open-url', (event, link) => {
    event.preventDefault();
    app.whenReady().then(() => handleDeepLink(link));
  });

  app.whenReady().then(() => {
    settings = config.load();
    registerIpc();
    createOverlay();
    blue = new BlueMouse({ send: sendOverlay });
    agent = new Agent({
      blue,
      getConfig: () => settings,
      ask: askPhone,
      progress: (text) => {
        if (current) report(current.id, 'working', text);
      },
    });

    buildTray();
    watchMouse();
    globalShortcut.register(KILL_SWITCH, () => stopEverything('Stopped from the computer.'));

    if (settings.token) relay.start(settings.server, settings.token);
    const openedAtLogin = app.getLoginItemSettings().wasOpenedAtLogin;
    if (!settings.token || !openedAtLogin) showHome();

    const link = process.argv.find((arg) => arg.startsWith('deskbud://'));
    if (link) handleDeepLink(link);

    screen.on('display-metrics-changed', sendLayout);
    app.on('activate', showHome);
  });

  app.on('window-all-closed', (event) => event?.preventDefault?.());
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('before-quit', () => { app.isQuitting = true; });
}
