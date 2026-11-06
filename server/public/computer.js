const OS_NAMES = { windows: 'Windows', mac: 'Mac', linux: 'Linux', other: 'computer' };

function link(label, href) {
  const a = document.createElement('a');
  a.className = 'primary';
  a.textContent = label;
  a.href = href;
  return a;
}

async function showDownloads(os) {
  const note = document.getElementById('os-note');
  const box = document.getElementById('download-links');
  const { downloads } = await fetch('/api/config').then((r) => r.json());

  if (os === 'windows' && downloads.windows) {
    note.textContent = 'A website can\'t move your mouse, so Desk Bud needs its small app. Install it, then come back here.';
    box.append(link('Download for Windows', downloads.windows));
  } else if (os === 'mac' && downloads.macArm) {
    note.textContent = 'A website can\'t move your mouse, so Desk Bud needs its small app. Pick the one for your chip, install it, then come back here.';
    box.append(link('Apple chip (M1 or newer)', downloads.macArm), link('Intel Mac', downloads.macIntel));
  } else if (os === 'windows' || os === 'mac') {
    note.textContent = 'A website can\'t move your mouse, so Desk Bud needs its small app. The download isn\'t set up on this website yet.';
  } else {
    note.textContent = 'Desk Bud\'s app runs on Windows and Mac. Please open this page on one of those.';
  }
}

export function startComputer(device) {
  document.getElementById('computer').hidden = false;
  document.getElementById('computer-title').textContent = `Hi there, ${OS_NAMES[device.os] ?? 'computer'} friend!`;
  showDownloads(device.os).catch(() => {
    document.getElementById('os-note').textContent = 'Couldn\'t load the download links. Refresh to try again.';
  });

  const form = document.getElementById('code-form');
  const input = document.getElementById('code-input');
  const note = document.getElementById('code-note');
  const retry = document.getElementById('retry-link');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    note.textContent = 'Checking…';
    retry.hidden = true;
    try {
      const res = await fetch('/api/pair/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: input.value,
          device: { os: device.os, name: `${OS_NAMES[device.os] ?? 'My'} computer` },
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        note.textContent = body.error;
        return;
      }
      // Hands the one-time pass to the app. The app asks you to confirm before connecting.
      const deepLink = `deskbud://pair?server=${encodeURIComponent(location.origin)}&handoff=${encodeURIComponent(body.handoff)}`;
      retry.href = deepLink;
      retry.hidden = false;
      note.textContent = 'Right code! Your browser will ask to open Desk Bud. Say yes, then press Connect in the app.';
      input.value = '';
      location.href = deepLink;
    } catch {
      note.textContent = 'Couldn\'t reach the server. Check your internet and try again.';
    }
  });
}
