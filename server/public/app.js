import { detectDevice } from './device.js';

// Put the face into every slot on the page.
const faceTemplate = document.getElementById('face-template');
for (const slot of document.querySelectorAll('.face-slot')) {
  slot.append(faceTemplate.content.cloneNode(true));
}

const device = detectDevice({
  userAgent: navigator.userAgent,
  platform: navigator.platform,
  maxTouchPoints: navigator.maxTouchPoints,
});

// ?as=phone or ?as=computer forces a view, which is handy for testing.
const forced = new URLSearchParams(location.search).get('as');
const kind = forced === 'phone' || forced === 'computer' ? forced : device.kind;

if (kind === 'phone') {
  const { startPhone } = await import('./phone.js');
  startPhone();
} else {
  const { startComputer } = await import('./computer.js');
  startComputer(device);
}
