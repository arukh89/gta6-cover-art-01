// Neon Coast editor — wires the page: photo loading, layout and grade buttons,
// caption editing, per-panel drag-to-pan and wheel-to-zoom, PNG export,
// undo/redo history, print effects (grain, halftone, vignette), corner badge.
// A `?shot=` query sets up a fixed scene for a screenshot instead (see shots.js).

import { drawCover, createState, layoutRects, panelAt, LAYOUTS, GRADES, SIZES, FRAMINGS, shuffleCrops } from './engine.js';
import { runShot } from './shots.js';

const canvas = document.getElementById('cover');
const captionInput = document.getElementById('caption');
const subtitleInput = document.getElementById('subtitle');
const statusEl = document.getElementById('status');
const zoomSlider = document.getElementById('zoom');
const zoomValue = document.getElementById('zoom-value');
const gradeStrengthSlider = document.getElementById('grade-strength');
const gradeStrengthValue = document.getElementById('grade-strength-value');
const letterSpacingSlider = document.getElementById('letter-spacing');
const letterSpacingValue = document.getElementById('letter-spacing-value');
const glowSlider = document.getElementById('glow');
const glowValue = document.getElementById('glow-value');
const grainCheckbox = document.getElementById('grain');
const halftoneCheckbox = document.getElementById('halftone');
const vignetteSlider = document.getElementById('vignette');
const vignetteValue = document.getElementById('vignette-value');
const badgeCheckbox = document.getElementById('badge');
const badgeTextInput = document.getElementById('badge-text');
const undoButton = document.getElementById('undo');
const redoButton = document.getElementById('redo');
const compareButton = document.getElementById('compare');

const state = createState();
let selected = 0;
/** While the compare button is held, the cover shows with no grade and no effects. */
let comparing = false;

function redraw() {
  if (comparing) {
    drawCover(canvas, { ...state, gradeStrength: 0, grain: false, halftone: false, vignette: 0 }, { highlight: selected });
  } else {
    drawCover(canvas, state, { highlight: selected });
  }
}

/** Loads an image from a URL, resolving once it can be drawn. */
export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

// --- Undo / redo ------------------------------------------------------------
// A snapshot is a plain copy of every undoable field; panel photos are kept
// by reference (the Image objects never change, only their crop does).
const HISTORY_LIMIT = 25;
const undoStack = [];
const redoStack = [];

function snapshotState() {
  return {
    layout: state.layout,
    grade: state.grade,
    gradeStrength: state.gradeStrength,
    titlePos: state.titlePos,
    letterSpacing: state.letterSpacing,
    glow: state.glow,
    caption: state.caption,
    subtitle: state.subtitle,
    sizeKey: Object.keys(SIZES).find((k) => SIZES[k] === state.size) ?? 'square',
    grain: state.grain,
    halftone: state.halftone,
    vignette: state.vignette,
    badgeOn: state.badgeOn,
    badgeText: state.badgeText,
    panels: state.panels.map((p) => ({ ...p })),
    selected,
  };
}

function restoreState(snap) {
  state.layout = snap.layout;
  state.grade = snap.grade;
  state.gradeStrength = snap.gradeStrength;
  state.titlePos = snap.titlePos;
  state.letterSpacing = snap.letterSpacing;
  state.glow = snap.glow;
  state.caption = snap.caption;
  state.subtitle = snap.subtitle;
  state.size = SIZES[snap.sizeKey] ?? SIZES.square;
  state.grain = snap.grain;
  state.halftone = snap.halftone;
  state.vignette = snap.vignette;
  state.badgeOn = snap.badgeOn;
  state.badgeText = snap.badgeText;
  state.panels = snap.panels.map((p) => ({ ...p }));
  selected = snap.selected;
  syncAllControls();
  redraw();
}

/** Record the current state so the next change can be undone. Call BEFORE mutating. */
function pushHistory() {
  undoStack.push(snapshotState());
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  redoStack.length = 0;
  syncHistoryButtons();
}

function syncHistoryButtons() {
  undoButton.disabled = undoStack.length === 0;
  redoButton.disabled = redoStack.length === 0;
}

function doUndo() {
  if (!undoStack.length) return;
  redoStack.push(snapshotState());
  restoreState(undoStack.pop());
  syncHistoryButtons();
}

function doRedo() {
  if (!redoStack.length) return;
  undoStack.push(snapshotState());
  restoreState(redoStack.pop());
  syncHistoryButtons();
}

undoButton.addEventListener('click', doUndo);
redoButton.addEventListener('click', doRedo);
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  // A text field keeps the browser's own undo: app-undo must not steal
  // Ctrl+Z / Ctrl+Y while the user is typing a caption, subtitle or badge.
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  const key = e.key.toLowerCase();
  if (key === 'z' && !e.shiftKey) {
    e.preventDefault();
    doUndo();
  } else if ((key === 'z' && e.shiftKey) || key === 'y') {
    e.preventDefault();
    doRedo();
  }
});

/** Push one history entry per slider gesture (pointer down / arrow keys). */
function armSliderCommit(el) {
  el.addEventListener('pointerdown', () => {
    if (!el._armed) {
      pushHistory();
      el._armed = true;
    }
  });
  el.addEventListener('keydown', () => {
    if (!el._armed) {
      pushHistory();
      el._armed = true;
    }
  });
  const disarm = () => { el._armed = false; };
  el.addEventListener('pointerup', disarm);
  el.addEventListener('change', disarm);
}

/**
 * Push one history entry for a text edit: on the first input after focus,
 * not on focus itself — focusing (and blurring) without typing must not
 * fill the undo stack with identical snapshots. The snapshot is taken
 * before the edit lands: this listener is registered before the input
 * handler that writes the new value into state, so it still sees the
 * pre-edit state.
 */
function armTextCommit(el) {
  el.addEventListener('focus', () => { el._armed = true; });
  el.addEventListener('input', () => {
    if (!el._armed) return;
    pushHistory();
    el._armed = false;
  });
  const disarm = () => { el._armed = false; };
  el.addEventListener('blur', disarm);
  el.addEventListener('change', disarm);
}

// --- Control sync -----------------------------------------------------------

function syncChoiceButtons(containerId, current) {
  document.querySelectorAll(`#${containerId} button`).forEach((button) => {
    button.classList.toggle('active', button.dataset.value === current);
  });
}

function syncAllControls() {
  captionInput.value = state.caption;
  subtitleInput.value = state.subtitle;
  syncChoiceButtons('layout-buttons', state.layout);
  syncChoiceButtons('grade-buttons', state.grade);
  syncChoiceButtons('size-buttons', Object.keys(SIZES).find((k) => SIZES[k] === state.size) ?? 'square');
  syncChoiceButtons('titlepos-buttons', state.titlePos);
  gradeStrengthSlider.value = String(Math.round(state.gradeStrength * 100));
  gradeStrengthValue.textContent = `${Math.round(state.gradeStrength * 100)}%`;
  letterSpacingSlider.value = String(state.letterSpacing);
  letterSpacingValue.textContent = `${state.letterSpacing}px`;
  glowSlider.value = String(state.glow);
  glowValue.textContent = `${Number(state.glow).toFixed(1)}×`;
  vignetteSlider.value = String(Math.round(state.vignette * 100));
  vignetteValue.textContent = `${Math.round(state.vignette * 100)}%`;
  grainCheckbox.checked = state.grain;
  halftoneCheckbox.checked = state.halftone;
  badgeCheckbox.checked = state.badgeOn;
  badgeTextInput.value = state.badgeText;
  syncZoomControl();
}

/**
 * Blob URLs of uploaded photos, one per panel slot. Sample photos are plain
 * paths (./samples/…), never blobs, so they are never tracked or revoked.
 * (Kept beside state, not in it: undo snapshots copy the photo by reference,
 * and a revoked blob URL stays drawable once its image has loaded.)
 */
const panelBlobUrls = Array.from({ length: 9 }, () => null);

/** Remember that panel `i`'s photo came from blob URL `url`. */
function trackBlobUrl(i, url) {
  panelBlobUrls[i] = url;
}

/** Put `photo` into panel `i` with a distinct framing (never a copy of another panel). */
function setPanelPhoto(i, photo, framing = FRAMINGS[i % FRAMINGS.length]) {
  // Replacing a panel drops its old uploaded photo: revoke its blob URL so
  // long sessions do not accumulate one URL per upload.
  const oldUrl = panelBlobUrls[i];
  if (oldUrl) {
    URL.revokeObjectURL(oldUrl);
    panelBlobUrls[i] = null;
  }
  state.panels[i] = { photo, zoom: framing.zoom, dx: framing.dx, dy: framing.dy };
}

/**
 * Fill every panel slot with the given photos, alternating them and giving
 * each slot its own framing — so two panels never show the same photo the
 * same way. `photos` is a list of loaded images, used round-robin.
 */
function fillAllPanels(photos) {
  for (let i = 0; i < state.panels.length; i += 1) {
    setPanelPhoto(i, photos[i % photos.length]);
  }
}

/** Load the two built-in sample photos into all nine panel slots, distinctly framed. */
async function loadSamples() {
  try {
    const pier = await loadImage('./samples/pier.jpg');
    const boulevard = await loadImage('./samples/boulevard.jpg');
    fillAllPanels([pier, boulevard]);
  } catch (err) {
    statusEl.textContent = 'Could not load the sample photos.';
  }
  redraw();
}

// --- Controls: layout, grade, size, title ----------------------------------

function bindChoiceButtons(containerId, current, apply) {
  const container = document.getElementById(containerId);
  container.querySelectorAll('button').forEach((button) => {
    if (button.dataset.value === current) button.classList.add('active');
    button.addEventListener('click', () => {
      container.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
      button.classList.add('active');
      pushHistory();
      apply(button.dataset.value);
      redraw();
    });
  });
}

bindChoiceButtons('layout-buttons', state.layout, (value) => {
  state.layout = value;
  selected = 0;
  syncZoomControl();
});
bindChoiceButtons('grade-buttons', state.grade, (value) => {
  state.grade = value;
});
bindChoiceButtons('size-buttons', 'square', (value) => {
  state.size = SIZES[value];
  canvas.width = state.size.w;
  canvas.height = state.size.h;
});
bindChoiceButtons('titlepos-buttons', state.titlePos, (value) => {
  state.titlePos = value;
});

armSliderCommit(gradeStrengthSlider);
gradeStrengthSlider.addEventListener('input', () => {
  state.gradeStrength = Number(gradeStrengthSlider.value) / 100;
  gradeStrengthValue.textContent = `${gradeStrengthSlider.value}%`;
  redraw();
});
armSliderCommit(letterSpacingSlider);
letterSpacingSlider.addEventListener('input', () => {
  state.letterSpacing = Number(letterSpacingSlider.value);
  letterSpacingValue.textContent = `${letterSpacingSlider.value}px`;
  redraw();
});
armSliderCommit(glowSlider);
glowSlider.addEventListener('input', () => {
  state.glow = Number(glowSlider.value);
  glowValue.textContent = `${Number(glowSlider.value).toFixed(1)}×`;
  redraw();
});
armSliderCommit(vignetteSlider);
vignetteSlider.addEventListener('input', () => {
  state.vignette = Number(vignetteSlider.value) / 100;
  vignetteValue.textContent = `${vignetteSlider.value}%`;
  redraw();
});

// --- Effects ----------------------------------------------------------------

grainCheckbox.addEventListener('change', () => {
  pushHistory();
  state.grain = grainCheckbox.checked;
  redraw();
});
halftoneCheckbox.addEventListener('change', () => {
  pushHistory();
  state.halftone = halftoneCheckbox.checked;
  redraw();
});
badgeCheckbox.addEventListener('change', () => {
  pushHistory();
  state.badgeOn = badgeCheckbox.checked;
  redraw();
});
armTextCommit(badgeTextInput);
badgeTextInput.addEventListener('input', () => {
  state.badgeText = badgeTextInput.value;
  redraw();
});

// Hold-to-compare: while held, the cover shows with no grade and no effects.
compareButton.addEventListener('pointerdown', () => {
  comparing = true;
  redraw();
});
const endCompare = () => {
  if (!comparing) return;
  comparing = false;
  redraw();
};
compareButton.addEventListener('pointerup', endCompare);
compareButton.addEventListener('pointerleave', endCompare);
compareButton.addEventListener('pointercancel', endCompare);

// --- Caption ----------------------------------------------------------------

armTextCommit(captionInput);
captionInput.addEventListener('input', () => {
  state.caption = captionInput.value;
  redraw();
});
armTextCommit(subtitleInput);
subtitleInput.addEventListener('input', () => {
  state.subtitle = subtitleInput.value;
  redraw();
});

// --- Photos -----------------------------------------------------------------

document.getElementById('photo').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  // A cover scene has no selection: there is no panel to fill into.
  if (selected < 0) {
    e.target.value = '';
    return;
  }
  // Fill empty panels first, then cycle from the selected panel.
  const order = [];
  for (let i = 0; i < state.panels.length; i += 1) {
    if (!state.panels[i].photo) order.push(i);
  }
  for (let k = 0; k < state.panels.length; k += 1) {
    const i = (selected + k) % state.panels.length;
    if (!order.includes(i)) order.push(i);
  }
  pushHistory();
  for (const file of files) {
    const slot = order.length ? order.shift() : selected;
    const url = URL.createObjectURL(file);
    try {
      const photo = await loadImage(url);
      setPanelPhoto(slot, photo);
      trackBlobUrl(slot, url);
      selected = slot;
    } catch (err) {
      URL.revokeObjectURL(url);
      statusEl.textContent = `Could not read ${file.name}.`;
    }
  }
  syncZoomControl();
  redraw();
  e.target.value = '';
});

document.getElementById('replace').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  // A cover scene has no selection: there is no panel to replace.
  if (selected < 0) {
    e.target.value = '';
    return;
  }
  pushHistory();
  const url = URL.createObjectURL(file);
  try {
    setPanelPhoto(selected, await loadImage(url), { zoom: 1, dx: 0, dy: 0 });
    trackBlobUrl(selected, url);
  } catch (err) {
    URL.revokeObjectURL(url);
    statusEl.textContent = `Could not read ${file.name}.`;
  }
  redraw();
  e.target.value = '';
});

document.querySelectorAll('[data-sample]').forEach((button) => {
  button.addEventListener('click', async () => {
    if (selected < 0) return;
    pushHistory();
    try {
      setPanelPhoto(selected, await loadImage(`./samples/${button.dataset.sample}.jpg`));
      redraw();
    } catch (err) {
      statusEl.textContent = 'Could not load that sample photo.';
    }
  });
});

// --- Per-panel crop: drag to pan, wheel to zoom -----------------------------

function syncZoomControl() {
  if (selected < 0) {
    zoomSlider.value = '1';
    zoomValue.textContent = '—';
    return;
  }
  const panel = state.panels[selected];
  zoomSlider.value = String(panel.zoom);
  zoomValue.textContent = `${Math.round(panel.zoom * 100)}%`;
}

armSliderCommit(zoomSlider);
zoomSlider.addEventListener('input', () => {
  if (selected < 0) return;
  state.panels[selected].zoom = Number(zoomSlider.value);
  zoomValue.textContent = `${Math.round(state.panels[selected].zoom * 100)}%`;
  redraw();
});

document.getElementById('fit').addEventListener('click', () => {
  if (selected < 0) return;
  pushHistory();
  state.panels[selected] = { photo: state.panels[selected].photo, zoom: 1, dx: 0, dy: 0 };
  syncZoomControl();
  redraw();
});

document.getElementById('shuffle').addEventListener('click', () => {
  pushHistory();
  shuffleCrops(state);
  syncZoomControl();
  redraw();
});

function canvasPoint(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((e.clientX - rect.left) / rect.width) * state.size.w,
    y: ((e.clientY - rect.top) / rect.height) * state.size.h,
  };
}

let dragging = null;
let dragSnapshot = null;
canvas.addEventListener('pointerdown', (e) => {
  const p = canvasPoint(e);
  const i = panelAt(state, p.x, p.y);
  if (i < 0) return;
  selected = i;
  syncZoomControl();
  canvas.setPointerCapture(e.pointerId);
  dragSnapshot = snapshotState();
  dragging = { i, x: p.x, y: p.y, moved: false };
  redraw();
});
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const p = canvasPoint(e);
  const rects = layoutRects(state.size.w, state.size.h, state.layout, state.titlePos);
  const rect = rects[dragging.i];
  const panel = state.panels[dragging.i];
  panel.dx += (p.x - dragging.x) / rect.w;
  panel.dy += (p.y - dragging.y) / rect.h;
  if (Math.abs(p.x - dragging.x) + Math.abs(p.y - dragging.y) > 2) dragging.moved = true;
  dragging.x = p.x;
  dragging.y = p.y;
  redraw();
});
canvas.addEventListener('pointerup', () => {
  if (dragging && dragging.moved && dragSnapshot) {
    undoStack.push(dragSnapshot);
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    redoStack.length = 0;
    syncHistoryButtons();
  }
  dragging = null;
  dragSnapshot = null;
});
let lastWheelPush = 0;
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const p = canvasPoint(e);
  const i = panelAt(state, p.x, p.y);
  if (i < 0) return;
  // One history entry per wheel burst, not per tick.
  if (Date.now() - lastWheelPush > 800) {
    pushHistory();
    lastWheelPush = Date.now();
  }
  selected = i;
  const panel = state.panels[i];
  panel.zoom = Math.max(1, Math.min(3, panel.zoom * Math.exp(-e.deltaY * 0.001)));
  syncZoomControl();
  redraw();
}, { passive: false });

// --- Export ------------------------------------------------------------------

/** Load the vendored display fonts; the canvas falls back to its system-font stack on failure. */
async function ensureFonts() {
  try {
    await Promise.all([
      document.fonts.load('100px Anton'),
      document.fonts.load('60px Pacifico'),
    ]);
  } catch (err) {
    // Fall back to the system-font stack if the vendored fonts fail to load.
  }
}

async function exportCover(sizeKey) {
  const size = SIZES[sizeKey];
  await ensureFonts();
  const out = document.createElement('canvas');
  drawCover(out, { ...state, size }, { highlight: -1 });
  out.toBlob((blob) => {
    if (!blob) {
      statusEl.textContent = 'Export failed.';
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `neon-coast-cover-${size.w}x${size.h}.png`;
    a.click();
    URL.revokeObjectURL(a.href);
    statusEl.textContent = `Saved neon-coast-cover-${size.w}x${size.h}.png`;
  }, 'image/png');
}

document.querySelectorAll('[data-export]').forEach((button) => {
  button.addEventListener('click', () => exportCover(button.dataset.export));
});

// --- Start -------------------------------------------------------------------

async function start() {
  await ensureFonts();
  const params = new URLSearchParams(location.search);
  const shot = params.get('shot');
  const layoutParam = params.get('layout');
  if (layoutParam && LAYOUTS[layoutParam]) {
    state.layout = layoutParam;
  }
  const gradeParam = params.get('grade');
  if (gradeParam && GRADES[gradeParam]) {
    state.grade = gradeParam;
  }
  if (params.get('grain') === '1') state.grain = true;
  if (params.get('halftone') === '1') state.halftone = true;
  const vigParam = params.get('vignette');
  if (vigParam !== null) {
    // Math.min/max let NaN through, so an unparseable value needs its own
    // check — otherwise the label, slider and render disagree (NaN% / 50 / no vignette).
    const vig = Number(vigParam) / 100;
    state.vignette = Number.isFinite(vig) ? Math.max(0, Math.min(1, vig)) : 0.3;
  }
  if (params.get('badge') === '1') {
    state.badgeOn = true;
    const badgeText = params.get('badgetext');
    if (badgeText) state.badgeText = badgeText;
  }
  syncAllControls();
  try {
    if (shot) {
      await runShot(shot, params, async (sample, text) => {
        state.caption = text;
        captionInput.value = text;
        const main = await loadImage(sample);
        // Fill every slot: alternate the main photo with the other sample,
        // each with its own framing — no two panels ever match.
        const other = sample.includes('pier') ? 'boulevard' : 'pier';
        const extra = await loadImage(`./samples/${other}.jpg`);
        fillAllPanels([main, extra]);
        // A cover scene is a clean export view: no editor selection outline.
        if (shot === 'cover') selected = -1;
        redraw();
      });
    } else {
      await loadSamples();
    }
  } catch (err) {
    // A scene whose photo cannot load must still report ready, or a capture
    // harness waiting on __shotReady times out on a blank page.
    statusEl.textContent = 'Could not load the photo for this scene.';
  }
  syncZoomControl();
  redraw();
  requestAnimationFrame(() => requestAnimationFrame(() => { window.__shotReady = true; }));
}

start();
