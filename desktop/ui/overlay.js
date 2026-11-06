const buddy = document.getElementById('buddy');
const face = document.getElementById('buddy-face');
const bubble = document.getElementById('bubble');
const cursor = document.getElementById('blue-mouse');
const viewing = document.getElementById('viewing');
const pupils = [...document.querySelectorAll('.pupil')];

const BUBBLE_MS = 6000;
const HIDE_AFTER_REST_MS = 1500;

let origin = { x: 0, y: 0 };
let position = { x: innerWidth / 2, y: innerHeight / 2 };
let animation = 0;
let bubbleTimer = 0;
let restTimer = 0;

const ease = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

function place({ x, y }) {
  cursor.style.transform = `translate(${x}px, ${y}px)`;
}

function glide(target, ms) {
  clearTimeout(restTimer);
  cancelAnimationFrame(animation);
  cursor.classList.add('visible');

  const start = { ...position };
  const end = { x: target.x - origin.x, y: target.y - origin.y };
  const began = performance.now();

  const step = (now) => {
    const t = Math.min(1, (now - began) / ms);
    const k = ease(t);
    position = { x: start.x + (end.x - start.x) * k, y: start.y + (end.y - start.y) * k };
    place(position);
    if (t < 1) animation = requestAnimationFrame(step);
  };
  animation = requestAnimationFrame(step);
}

function tap() {
  cursor.classList.remove('tapping');
  void cursor.offsetWidth; // restarts the animation
  cursor.classList.add('tapping');
}

function look({ x, y }) {
  const box = face.getBoundingClientRect();
  const dx = x - origin.x - (box.left + box.width / 2);
  const dy = y - origin.y - (box.top + box.height / 2);
  const distance = Math.hypot(dx, dy) || 1;
  const reach = Math.min(6.5, distance / 30);
  const shift = `translate(${(dx / distance) * reach}px, ${(dy / distance) * reach}px)`;
  for (const pupil of pupils) pupil.style.transform = shift;
}

function say(text) {
  clearTimeout(bubbleTimer);
  bubble.textContent = text;
  bubble.hidden = !text;
  if (text) bubbleTimer = setTimeout(() => { bubble.hidden = true; }, BUBBLE_MS);
}

window.overlay.on((name, data) => {
  switch (name) {
    case 'layout':
      origin = data.origin;
      document.documentElement.style.setProperty('--bottom-gap', `${data.bottomGap}px`);
      break;
    case 'look':
      look(data);
      break;
    case 'glide':
      glide(data, data.ms);
      break;
    case 'tap':
      tap();
      break;
    case 'rest':
      restTimer = setTimeout(() => cursor.classList.remove('visible'), HIDE_AFTER_REST_MS);
      break;
    case 'say':
      say(data.text);
      break;
    case 'mood':
      buddy.classList.toggle('working', data.mood === 'working');
      buddy.classList.toggle('paused', data.mood === 'paused');
      break;
    case 'viewing':
      viewing.hidden = !data.on;
      break;
    default:
  }
});

place(position);
