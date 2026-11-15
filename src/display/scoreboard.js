// Comparison scoreboard (focus view) and per-panel stat strips (grid view). Reads snapshots only.
import { bestIndex } from './demo-rules.js';

/** Scoreboard rows. value() is what gets compared; null means "no data yet". Only the em-vehicle is shown. */
const ROWS = [
  {
    key: 'amb', label: 'Em-vehicle journey', short: 'Em-vehicle',
    value: m => (m.ambulance.state === 'none' ? null : m.ambulance.journey),
    text: (v, m) => (v === null ? '—' : `${v.toFixed(1)} s${m.ambulance.state === 'driving' ? ' …' : ''}`),
    sub: m => (m.ambulance.state === 'none' ? 'not dispatched' : `stopped ${m.ambulance.stopped.toFixed(1)} s`),
  },
];

// Only touch the DOM when something changed (this runs every animation frame).
function setText(el, t) { if (el.textContent !== t) el.textContent = t; }
function setClass(el, c) { if (el.className !== c) el.className = c; }

function valueClass(row, v, isBest, base) {
  return isBest ? `${base} best` : base;
}

/** For each panel, which rows it is best at. */
function bestByPanel(metrics) {
  const flags = metrics.map(() => ({}));
  for (const row of ROWS) {
    const vals = metrics.map(m => row.value(m));
    const present = vals.filter(v => v !== null);
    if (present.length > 1 && present.every(v => v === present[0])) continue;   // all tied: no winner
    const i = bestIndex(vals);
    if (i === null) continue;
    const shown = v => (v === null ? null : v.toFixed(1));                        // ties as displayed all win
    vals.forEach((v, k) => { if (shown(v) === shown(vals[i])) flags[k][row.key] = true; });
  }
  return flags;
}

/** Focus view: one tall card per panel, stacked to fill the column beside the map. */
export function renderScoreboard(el, snapshots, labels) {
  const row = ROWS[0];
  if (!el.dataset.built) {
    el.innerHTML = `<div class="sb-title">${row.label}</div>` + labels.map((l, i) =>
      `<div class="sb-card${i === 2 ? ' gw' : ''}"><span class="sb-name">${l}</span><div class="sb-val"></div><div class="sb-sub"></div></div>`).join('');
    el.dataset.built = '1';
  }
  const metrics = snapshots.map(s => s.metrics);
  const best = bestByPanel(metrics);
  el.querySelectorAll('.sb-card').forEach((card, i) => {
    const m = metrics[i], v = row.value(m), isBest = !!best[i][row.key];
    setText(card.children[1], row.text(v, m));
    setClass(card.children[1], valueClass(row, v, isBest, 'sb-val num'));
    setText(card.children[2], row.sub(m));
    card.classList.toggle('is-best', isBest);
  });
}

/** Grid view: one strip per panel. `allSnapshots` lets each strip highlight where its panel is best. */
export function renderStatStrips(stripEls, allSnapshots) {
  const metrics = allSnapshots.map(s => s.metrics);
  const best = bestByPanel(metrics);
  stripEls.forEach((el, i) => {
    if (!el.dataset.built) {
      el.innerHTML = ROWS.map(r => `<div class="stat" data-row="${r.key}"><small>${r.short}</small><b></b><i></i></div>`).join('');
      el.dataset.built = '1';
    }
    const m = metrics[i];
    for (const row of ROWS) {
      const box = el.querySelector(`[data-row="${row.key}"]`);
      const v = row.value(m);
      setText(box.children[1], row.text(v, m));
      setClass(box.children[1], valueClass(row, v, !!best[i][row.key], ''));
      setText(box.children[2], row.sub(m));
    }
  });
}
