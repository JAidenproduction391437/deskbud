const fs = require('node:fs');
const path = require('node:path');
const { app, safeStorage } = require('electron');

const SECRET_FIELDS = ['token', 'apiKey'];

const DEFAULTS = {
  server: '',
  token: '',
  deviceName: '',
  apiKey: '',
  model: 'claude-opus-5-5',
  allowCommands: false,
  showBuddy: true,
};

const file = () => path.join(app.getPath('userData'), 'deskbud.json');

function reveal(value) {
  if (!value?.startsWith?.('enc:')) return value;
  try {
    return safeStorage.decryptString(Buffer.from(value.slice(4), 'base64'));
  } catch {
    return '';
  }
}

function conceal(value) {
  if (!value || !safeStorage.isEncryptionAvailable()) return value;
  return `enc:${safeStorage.encryptString(value).toString('base64')}`;
}

function load() {
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch { /* first run */ }
  const config = { ...DEFAULTS, ...saved };
  for (const field of SECRET_FIELDS) config[field] = reveal(config[field]);
  return config;
}

function save(config) {
  const stored = { ...config };
  for (const field of SECRET_FIELDS) stored[field] = conceal(stored[field]);
  fs.writeFileSync(file(), JSON.stringify(stored, null, 2), { mode: 0o600 });
}

module.exports = { load, save };
