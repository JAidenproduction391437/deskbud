const $ = (id) => document.getElementById(id);
const api = window.deskbud;

function statusLine(state) {
  if (state.paused) return 'Paused';
  if (!state.paired) return 'Not connected';
  if (!state.online) return 'Connecting to your website…';
  if (state.busy) return 'Working on something';
  return state.phoneOnline ? 'Connected to your phone' : 'Waiting for your phone';
}

function render(state) {
  const status = $('status');
  status.textContent = statusLine(state);
  status.classList.toggle('online', state.online && state.phoneOnline && !state.paused);

  $('pair-section').hidden = state.paired;
  $('control-section').hidden = !state.paired;
  $('unpair').hidden = !state.paired;

  $('pause').textContent = state.paused ? 'Resume Desk Bud' : 'Pause Desk Bud';
  $('stop').disabled = !state.busy;

  const saved = [state.hasApiKey && 'Claude', state.hasGeminiKey && 'Gemini'].filter(Boolean).join(' and ');
  $('key-note').textContent = saved ? `Saved and encrypted on this computer: ${saved} key.` : '';
  $('model').value = state.model;
  $('show-buddy').checked = state.showBuddy;
  $('open-at-login').checked = state.openAtLogin;
  $('allow-commands').checked = state.allowCommands;
  if (state.server) $('server').value = state.server;

  render.paused = state.paused;
}

$('pair-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const error = $('pair-error');
  error.textContent = '';
  try {
    await api.pair({ server: $('server').value, code: $('code').value });
    $('code').value = '';
  } catch (failure) {
    error.textContent = failure.message.replace(/^Error invoking remote method 'pair': (Error: )?/, '');
  }
});

$('key-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  await api.save({ apiKey: $('api-key').value });
  $('api-key').value = '';
});

$('gemini-key-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  await api.save({ geminiKey: $('gemini-key').value });
  $('gemini-key').value = '';
});

$('keys-link').addEventListener('click', () => api.openKeysPage());
$('gemini-keys-link').addEventListener('click', () => api.openGeminiKeysPage());
$('pause').addEventListener('click', () => api.setPaused(!render.paused));
$('stop').addEventListener('click', () => api.stop());
$('unpair').addEventListener('click', () => api.unpair());

$('model').addEventListener('change', (event) => api.save({ model: event.target.value }));
$('show-buddy').addEventListener('change', (event) => api.save({ showBuddy: event.target.checked }));
$('open-at-login').addEventListener('change', (event) => api.save({ openAtLogin: event.target.checked }));
$('allow-commands').addEventListener('change', (event) => api.save({ allowCommands: event.target.checked }));

api.onState(render);
api.getState().then(render);
