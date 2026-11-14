// Short event banners so a room can follow what just happened. At most 3 visible; each lasts 3 s.
const MAX = 3;
const LIFE_MS = 3000;
const FADE_MS = 300;

/** kind: 'stop' (failures, cuts), 'go' (restores, arrivals), 'data' (messaging). */
export function showToast(text, { kind = 'data', reducedMotion = false } = {}) {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast kind-${kind}${reducedMotion ? '' : ' enter'}`;
  el.textContent = text;
  box.append(el);
  while (box.children.length > MAX) box.firstElementChild.remove();
  if (!reducedMotion) requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('enter')));
  setTimeout(() => {
    if (reducedMotion) { el.remove(); return; }
    el.classList.add('leave');
    setTimeout(() => el.remove(), FADE_MS);
  }, LIFE_MS);
}
