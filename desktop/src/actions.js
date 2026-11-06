const { execFile, spawn } = require('node:child_process');
const { shell } = require('electron');
const { input } = require('./input.js');

const isMac = process.platform === 'darwin';

// Common apps start directly. Anything else goes through the Start menu or Spotlight.
const APPS = {
  notepad: { win: 'notepad.exe', mac: 'TextEdit' },
  textedit: { win: 'notepad.exe', mac: 'TextEdit' },
  calculator: { win: 'calc.exe', mac: 'Calculator' },
  paint: { win: 'mspaint.exe' },
  'file explorer': { win: 'explorer.exe', mac: 'Finder' },
  explorer: { win: 'explorer.exe', mac: 'Finder' },
  files: { win: 'explorer.exe', mac: 'Finder' },
  finder: { win: 'explorer.exe', mac: 'Finder' },
  terminal: { win: 'wt.exe', mac: 'Terminal' },
  safari: { mac: 'Safari' },
};

function launch(name) {
  const app = APPS[name];
  if (isMac && app?.mac) {
    execFile('open', ['-a', app.mac]);
    return true;
  }
  if (!isMac && app?.win) {
    const child = spawn(app.win, [], { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
    return true;
  }
  return false;
}

const HELP = 'Try open YouTube, search for cats, open Notepad, type hello, or scroll down. With a Claude API key I can do much bigger jobs too.';

/** Carries out something the quick parser understood. Returns the sentence to say. */
async function runQuick(intent, blue) {
  switch (intent.kind) {
    case 'help':
      return HELP;
    case 'open-url':
      await blue.wave();
      await shell.openExternal(intent.url);
      return `${intent.searching ? 'Here are' : 'Opening'} ${intent.label}.`;
    case 'open-app':
      await blue.wave();
      if (!launch(intent.name)) await input.openLauncher(intent.name);
      return `Opening ${intent.label}.`;
    case 'type':
      await input.type(intent.text);
      return 'Typed it.';
    case 'press':
      await input.chord(intent.keys);
      return 'Done.';
    case 'scroll':
      await blue.scroll(undefined, intent.direction, 5);
      return `Scrolled ${intent.direction}.`;
    case 'click':
      await blue.click(undefined, {
        button: intent.style === 'right' ? 'right' : 'left',
        count: intent.style === 'double' ? 2 : 1,
      });
      return 'Clicked.';
    default:
      throw new Error(`Unknown request: ${intent.kind}`);
  }
}

module.exports = { runQuick };
