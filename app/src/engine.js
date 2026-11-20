// Neon Coast cover engine — original code written for the gta6-cover-art-01 entry.
// Draws a multi-panel poster-style cover on a 2D canvas from the user's photos,
// a bold caption and a neon script subtitle, with a sunset / neon colour grade.
// Vanilla ES modules only, no libraries, no network: every asset lives under app/.

/** The six panel layouts the editor offers. */
export const LAYOUTS = {
  hero: { name: 'Hero + three', panels: 4 },
  grid: { name: 'Four-panel grid', panels: 4 },
  single: { name: 'Full bleed', panels: 1 },
  nine: { name: 'Nine-panel grid', panels: 9 },
  snaps: { name: 'Snapshots', panels: 3 },
  strips: { name: 'Vertical strips', panels: 3 },
};

/** The four export sizes, in pixels. */
export const SIZES = {
  square: { w: 1080, h: 1080, label: '1080 × 1080' },
  portrait: { w: 1080, h: 1350, label: '1080 × 1350' },
  wide: { w: 1920, h: 1080, label: '1920 × 1080' },
  story: { w: 1080, h: 1920, label: '1080 × 1920' },
};

/**
 * Colour grades. Each grade tints the photos with a gradient overlay (drawn
 * with a blend mode inside the panel clip) and a canvas filter on the photo
 * itself, so the grade is baked into every exported PNG. Stops are
 * [position, red, green, blue, alpha]; the alpha is scaled by grade strength.
 * Filter parts are numbers so the strength slider can scale them too.
 * A grade with `grayscale: 1` is drawn grey first, so its wash lands as a
 * true duotone even on bright daylight photos.
 */
export const GRADES = {
  vice: {
    name: 'Vice Sunset',
    saturate: 1.3, contrast: 1.1, brightness: 1.03,
    blend: 'overlay',
    // Warm sunset: orange at the top, magenta at the bottom.
    stops: [
      [0, 255, 150, 60, 0.5],
      [0.55, 255, 90, 120, 0.36],
      [1, 160, 40, 160, 0.55],
    ],
  },
  neon: {
    name: 'Neon Nights',
    saturate: 1.45, contrast: 1.14, brightness: 0.98,
    blend: 'overlay',
    // Cool teal shadows, hot pink highlights — a night street after rain.
    stops: [
      [0, 0, 220, 220, 0.45],
      [0.5, 120, 60, 220, 0.28],
      [1, 255, 45, 150, 0.55],
    ],
  },
  gold: {
    name: 'Golden Hour',
    saturate: 1.22, contrast: 1.06, brightness: 1.06,
    blend: 'soft-light',
    // Low amber sun: honey at the top, deep amber at the bottom.
    stops: [
      [0, 255, 210, 110, 0.62],
      [0.6, 255, 160, 60, 0.42],
      [1, 140, 70, 20, 0.55],
    ],
  },
  duotone: {
    name: 'Sunset Duotone',
    saturate: 1, contrast: 1.25, brightness: 1.06, grayscale: 1,
    blend: 'multiply',
    // Heavy poster duotone: the photo goes grey, then a hot orange-to-violet
    // wash multiplies over it, so the grade reads on any photo, even bright noon.
    stops: [
      [0, 255, 140, 60, 0.95],
      [0.55, 255, 90, 110, 0.95],
      [1, 110, 30, 160, 0.95],
    ],
  },
  midnight: {
    name: 'Midnight Neon',
    saturate: 1.7, contrast: 1.22, brightness: 0.95,
    blend: 'overlay',
    // Strong night grade: electric teal at the top, hot pink at the bottom.
    stops: [
      [0, 0, 230, 200, 0.6],
      [0.5, 90, 60, 230, 0.5],
      [1, 255, 45, 160, 0.7],
    ],
  },
};

/**
 * Distinct crop framings, one per panel slot. A panel that shows the same
 * photo as another panel always gets a different framing, so no two panels
 * ever look like copies of each other.
 */
export const FRAMINGS = [
  { zoom: 1, dx: 0, dy: 0 },
  { zoom: 1.7, dx: -0.22, dy: 0.08 },
  { zoom: 1.7, dx: 0.22, dy: -0.08 },
  { zoom: 2.1, dx: 0, dy: -0.18 },
  { zoom: 1.5, dx: -0.15, dy: -0.15 },
  { zoom: 2.4, dx: 0.12, dy: 0.12 },
  { zoom: 1.9, dx: -0.2, dy: 0.18 },
  { zoom: 1.6, dx: 0.18, dy: 0.15 },
  { zoom: 2.6, dx: 0, dy: 0.1 },
];

/** A fresh, empty editor state. Nine panel slots; a layout uses as many as it needs. */
export function createState() {
  return {
    layout: 'hero',
    grade: 'vice',
    gradeStrength: 0.8,
    titlePos: 'bottom',
    letterSpacing: 0,
    glow: 1,
    caption: 'Sunset Heist',
    subtitle: 'Neon Coast nights',
    size: SIZES.square,
    grain: false,
    halftone: false,
    vignette: 0.3,
    badgeOn: false,
    badgeText: 'EST. 2026',
    panels: Array.from({ length: 9 }, () => ({ photo: null, zoom: 1, dx: 0, dy: 0 })),
  };
}

/** Height of the title band at the foot (or head) of the cover, as a share of the height. */
export function titleBandHeight(h) {
  return Math.round(h * 0.2);
}

/** Rotation (radians) of a panel in a layout — the snapshots layout tilts its small panels. */
export function layoutRotation(layout, i) {
  if (layout === 'snaps') return [-0, -0.07, 0.05][i] ?? 0;
  return 0;
}

/**
 * Panel rectangles for a layout at a given cover size. Every rect is
 * { x, y, w, h } in canvas pixels; the title band sits below (or above) them.
 */
export function layoutRects(w, h, layout, titlePos = 'bottom') {
  const bandH = titleBandHeight(h);
  const y0 = titlePos === 'top' ? bandH : 0;
  const ph = h - bandH;
  const g = Math.max(4, Math.round(w * 0.008));
  if (layout === 'grid') {
    const cw = (w - g) / 2;
    const ch = (ph - g) / 2;
    return [
      { x: 0, y: y0, w: cw, h: ch },
      { x: cw + g, y: y0, w: cw, h: ch },
      { x: 0, y: y0 + ch + g, w: cw, h: ch },
      { x: cw + g, y: y0 + ch + g, w: cw, h: ch },
    ];
  }
  if (layout === 'nine') {
    const cw = (w - 2 * g) / 3;
    const ch = (ph - 2 * g) / 3;
    const rects = [];
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        rects.push({ x: col * (cw + g), y: y0 + row * (ch + g), w: cw, h: ch });
      }
    }
    return rects;
  }
  if (layout === 'strips') {
    const cw = (w - 2 * g) / 3;
    return [
      { x: 0, y: y0, w: cw, h: ph },
      { x: cw + g, y: y0, w: cw, h: ph },
      { x: 2 * (cw + g), y: y0, w: cw, h: ph },
    ];
  }
  if (layout === 'snaps') {
    // One large panel on the left, two smaller tilted ones stacked on the right.
    // The small panels are inset so their tilt and polaroid frame never
    // overlap a neighbour or the title band.
    const heroW = Math.round(w * 0.62);
    const sideX = heroW + g;
    const sideW = w - sideX;
    const smallH = (ph - g) / 2;
    const ix = Math.round(sideW * 0.07);
    const iy = Math.round(smallH * 0.05);
    return [
      { x: 0, y: y0, w: heroW, h: ph },
      { x: sideX + ix, y: y0 + iy, w: sideW - 2 * ix, h: smallH - 2 * iy },
      { x: sideX + ix, y: y0 + smallH + g + iy, w: sideW - 2 * ix, h: smallH - 2 * iy },
    ];
  }
  if (layout === 'single') {
    return [{ x: 0, y: y0, w, h: ph }];
  }
  // hero: one big panel on the left, three small ones stacked on the right.
  const heroW = Math.round(w * 0.6);
  const sideX = heroW + g;
  const sideW = w - sideX;
  const smallH = (ph - 2 * g) / 3;
  return [
    { x: 0, y: y0, w: heroW, h: ph },
    { x: sideX, y: y0, w: sideW, h: smallH },
    { x: sideX, y: y0 + smallH + g, w: sideW, h: smallH },
    { x: sideX, y: y0 + 2 * (smallH + g), w: sideW, h: smallH },
  ];
}

/** Which panel (index, or -1) the canvas point (x, y) falls in. */
export function panelAt(state, x, y) {
  const rects = layoutRects(state.size.w, state.size.h, state.layout, state.titlePos);
  const count = LAYOUTS[state.layout].panels;
  for (let i = 0; i < count; i += 1) {
    const r = rects[i];
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return i;
  }
  return -1;
}

/**
 * Cover-fit geometry for a photo in a rect at a given zoom: the scale that
 * covers the rect, the drawn size, and the pan limits as shares of the rect.
 * Single source for clampPan, shuffleCrops and drawPanelPhoto.
 */
export function coverFit(rect, photo, zoom) {
  const cover = Math.max(rect.w / photo.naturalWidth, rect.h / photo.naturalHeight);
  const dw = photo.naturalWidth * cover * zoom;
  const dh = photo.naturalHeight * cover * zoom;
  const maxDx = dw > rect.w ? (dw - rect.w) / 2 / rect.w : 0;
  const maxDy = dh > rect.h ? (dh - rect.h) / 2 / rect.h : 0;
  return { cover, dw, dh, maxDx, maxDy };
}

/** Keep a panel's pan offsets inside the photo so no empty edge shows. */
function clampPan(panel, rect, photo) {
  const { maxDx, maxDy } = coverFit(rect, photo, panel.zoom);
  panel.dx = Math.max(-maxDx, Math.min(maxDx, panel.dx));
  panel.dy = Math.max(-maxDy, Math.min(maxDy, panel.dy));
}

/** Give every panel with a photo a fresh random crop inside its clamped range. */
export function shuffleCrops(state) {
  const rects = layoutRects(state.size.w, state.size.h, state.layout, state.titlePos);
  const count = LAYOUTS[state.layout].panels;
  for (let i = 0; i < count; i += 1) {
    const panel = state.panels[i];
    if (!panel.photo) continue;
    const rect = rects[i];
    panel.zoom = 1 + Math.random() * 1.5;
    // The random offsets are already inside the range by construction, so
    // there is nothing to clamp after picking them.
    const { maxDx, maxDy } = coverFit(rect, panel.photo, panel.zoom);
    panel.dx = (Math.random() * 2 - 1) * maxDx;
    panel.dy = (Math.random() * 2 - 1) * maxDy;
  }
}

/** The canvas filter for a grade at a given strength (0–1): 0 leaves the photo untouched. */
export function gradeFilter(grade, strength) {
  const sat = 1 + (grade.saturate - 1) * strength;
  const con = 1 + (grade.contrast - 1) * strength;
  const bri = 1 + (grade.brightness - 1) * strength;
  const grey = (grade.grayscale ?? 0) * strength;
  const parts = [
    `saturate(${sat.toFixed(3)})`,
    `contrast(${con.toFixed(3)})`,
    `brightness(${bri.toFixed(3)})`,
  ];
  if (grey > 0) parts.push(`grayscale(${grey.toFixed(2)})`);
  return parts.join(' ');
}

/** Small seeded PRNG (mulberry32) so the grain tile is identical on every render and export. */
function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The film-grain tile: 128x128 of grey noise, built once from a fixed seed. */
let grainTile = null;
function getGrainTile() {
  if (grainTile) return grainTile;
  const tile = document.createElement('canvas');
  tile.width = 128;
  tile.height = 128;
  const tctx = tile.getContext('2d');
  const img = tctx.createImageData(128, 128);
  const rand = seededRandom(20261119);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 96 + Math.floor(rand() * 64);
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  tctx.putImageData(img, 0, 0);
  grainTile = tile;
  return tile;
}

/** The halftone tile: a single dark dot on a 12x12 transparent cell. */
let halftoneTile = null;
function getHalftoneTile() {
  if (halftoneTile) return halftoneTile;
  const tile = document.createElement('canvas');
  tile.width = 12;
  tile.height = 12;
  const tctx = tile.getContext('2d');
  tctx.fillStyle = '#000000';
  tctx.beginPath();
  tctx.arc(6, 6, 2.6, 0, Math.PI * 2);
  tctx.fill();
  halftoneTile = tile;
  return tile;
}

/** A rounded-rectangle path (ctx.roundRect is not in every headless build). */
function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/**
 * Draw one photo into its panel rect, cover-fit, with the panel's zoom and pan.
 * `rotation` tilts the panel around its centre; `frame` draws a white
 * polaroid-style border around it (snapshots layout). `halftone` adds a print
 * dot pattern over the photo.
 */
function drawPanelPhoto(ctx, rect, panel, grade, strength, halftone, rotation = 0, frame = false) {
  ctx.save();
  if (rotation) {
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    ctx.translate(cx, cy);
    ctx.rotate(rotation);
    ctx.translate(-cx, -cy);
  }
  // The rect the photo itself is drawn into; a polaroid frame shrinks it.
  let drawRect = rect;
  if (frame) {
    // Polaroid border drawn INSIDE the panel rect: thin on the sides and top,
    // deep at the bottom. The photo is drawn into the inner rect, so the
    // frame can never bleed into a neighbour or the title band.
    const pad = Math.max(4, Math.round(rect.w * 0.03));
    const foot = Math.max(10, Math.round(rect.h * 0.11));
    ctx.fillStyle = '#fdfbf6';
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
    ctx.fillRect(rect.x, rect.y + rect.h - 2, rect.w, 2);
    drawRect = { x: rect.x + pad, y: rect.y + pad, w: rect.w - 2 * pad, h: rect.h - pad - foot };
  }
  const photo = panel.photo;
  if (!photo) {
    // Empty slot: a dusk gradient, a low sun and a hint of what goes here.
    const sky = ctx.createLinearGradient(drawRect.x, drawRect.y, drawRect.x, drawRect.y + drawRect.h);
    sky.addColorStop(0, '#3a1c5e');
    sky.addColorStop(1, '#12081f');
    ctx.fillStyle = sky;
    ctx.fillRect(drawRect.x, drawRect.y, drawRect.w, drawRect.h);
    const sunR = Math.min(drawRect.w, drawRect.h) * 0.2;
    const sun = ctx.createRadialGradient(
      drawRect.x + drawRect.w * 0.72, drawRect.y + drawRect.h * 0.34, 2,
      drawRect.x + drawRect.w * 0.72, drawRect.y + drawRect.h * 0.34, sunR,
    );
    sun.addColorStop(0, 'rgba(255, 190, 90, 0.95)');
    sun.addColorStop(1, 'rgba(255, 90, 140, 0)');
    ctx.fillStyle = sun;
    ctx.beginPath();
    ctx.arc(drawRect.x + drawRect.w * 0.72, drawRect.y + drawRect.h * 0.34, sunR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.font = `bold ${Math.max(12, Math.round(drawRect.h * 0.07))}px Anton, 'Arial Narrow', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ADD A PHOTO', drawRect.x + drawRect.w / 2, drawRect.y + drawRect.h * 0.82);
    ctx.restore();
    return;
  }
  clampPan(panel, drawRect, photo);
  const { dw, dh } = coverFit(drawRect, photo, panel.zoom);
  const dx = drawRect.x + (drawRect.w - dw) / 2 + panel.dx * drawRect.w;
  const dy = drawRect.y + (drawRect.h - dh) / 2 + panel.dy * drawRect.h;
  ctx.beginPath();
  ctx.rect(drawRect.x, drawRect.y, drawRect.w, drawRect.h);
  ctx.clip();
  ctx.filter = gradeFilter(grade, strength);
  ctx.drawImage(photo, dx, dy, dw, dh);
  ctx.filter = 'none';
  ctx.globalCompositeOperation = grade.blend;
  const wash = ctx.createLinearGradient(drawRect.x, drawRect.y, drawRect.x, drawRect.y + drawRect.h);
  for (const [pos, r, g, b, a] of grade.stops) {
    wash.addColorStop(pos, `rgba(${r}, ${g}, ${b}, ${(a * strength).toFixed(3)})`);
  }
  ctx.fillStyle = wash;
  ctx.fillRect(drawRect.x, drawRect.y, drawRect.w, drawRect.h);
  ctx.globalCompositeOperation = 'source-over';
  if (halftone) {
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = ctx.createPattern(getHalftoneTile(), 'repeat');
    ctx.fillRect(drawRect.x, drawRect.y, drawRect.w, drawRect.h);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

/** The bold caption + neon script subtitle in the title band. */
function drawTitleBlock(ctx, w, h, state) {
  const bandH = titleBandHeight(h);
  const y0 = state.titlePos === 'top' ? 0 : h - bandH;
  // Band: deep plum, with a neon accent stripe along its inner edge, facing the photo.
  const band = ctx.createLinearGradient(0, y0, 0, y0 + bandH);
  band.addColorStop(0, '#241040');
  band.addColorStop(1, '#0d0518');
  ctx.fillStyle = band;
  ctx.fillRect(0, y0, w, bandH);
  const stripeH = Math.max(4, Math.round(bandH * 0.045));
  const stripe = ctx.createLinearGradient(0, 0, w, 0);
  stripe.addColorStop(0, '#ff2d96');
  stripe.addColorStop(0.5, '#ff8a3d');
  stripe.addColorStop(1, '#00e5d4');
  ctx.fillStyle = stripe;
  ctx.fillRect(0, state.titlePos === 'top' ? y0 + bandH - stripeH : y0, w, stripeH);
  // Caption: condensed capitals, auto-shrunk to fit, white-to-blush gradient.
  const text = state.caption.trim().toUpperCase();
  if (text) {
    let size = Math.round(bandH * 0.52);
    ctx.font = `${size}px Anton, 'Arial Narrow', sans-serif`;
    ctx.letterSpacing = `${state.letterSpacing}px`;
    while (ctx.measureText(text).width > w * 0.94 && size > 12) {
      size -= 2;
      ctx.font = `${size}px Anton, 'Arial Narrow', sans-serif`;
    }
    const fill = ctx.createLinearGradient(0, y0 + bandH * 0.12, 0, y0 + bandH * 0.62);
    fill.addColorStop(0, '#ffffff');
    fill.addColorStop(1, '#ffd9ec');
    ctx.fillStyle = fill;
    ctx.strokeStyle = 'rgba(16, 4, 28, 0.85)';
    ctx.lineWidth = Math.max(2, size * 0.055);
    ctx.lineJoin = 'round';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const cy = y0 + bandH * 0.42;
    ctx.strokeText(text, w / 2, cy);
    ctx.fillText(text, w / 2, cy);
    ctx.letterSpacing = '0px';
  }
  // Subtitle: glowing neon script beneath the caption.
  const sub = state.subtitle.trim();
  if (sub) {
    const size = Math.round(bandH * 0.2);
    ctx.font = `${size}px Pacifico, cursive`;
    ctx.fillStyle = '#ff5da2';
    ctx.shadowColor = '#ff2d78';
    ctx.shadowBlur = Math.max(6, size * 0.45) * state.glow;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(sub, w / 2, y0 + bandH * 0.83);
    ctx.shadowBlur = 0;
  }
}

/** The small corner badge: a neon-outlined pill with a star and the badge text. */
function drawBadge(ctx, w, h, state) {
  const text = state.badgeText.trim();
  if (!state.badgeOn || !text) return;
  const bandH = titleBandHeight(h);
  const pad = Math.round(w * 0.02);
  const y = (state.titlePos === 'top' ? bandH : 0) + pad;
  const fontSize = Math.max(14, Math.round(h * 0.022));
  ctx.font = `${fontSize}px Anton, 'Arial Narrow', sans-serif`;
  const label = `★ ${text.toUpperCase()}`;
  const pillW = ctx.measureText(label).width + fontSize * 1.6;
  const pillH = fontSize * 2;
  const x = w - pad - pillW;
  ctx.fillStyle = 'rgba(13, 5, 24, 0.88)';
  roundRectPath(ctx, x, y, pillW, pillH, pillH / 2);
  ctx.fill();
  ctx.strokeStyle = '#ff2d96';
  ctx.lineWidth = Math.max(2, Math.round(fontSize * 0.09));
  ctx.stroke();
  ctx.fillStyle = '#ffd9ec';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + pillW / 2, y + pillH / 2 + 1);
}

/**
 * Draw the whole cover onto `canvas` from `state`.
 * options.highlight: panel index to outline (editor selection), or -1 for a clean export.
 */
export function drawCover(canvas, state, options = {}) {
  const { w, h } = state.size;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d');
  const grade = GRADES[state.grade] ?? GRADES.vice;
  const strength = state.gradeStrength ?? 0.8;
  // White poster gutters: the panels sit on a white sheet.
  ctx.fillStyle = '#f5f0f7';
  ctx.fillRect(0, 0, w, h);
  const rects = layoutRects(w, h, state.layout, state.titlePos);
  const count = LAYOUTS[state.layout].panels;
  for (let i = 0; i < count; i += 1) {
    const rotation = layoutRotation(state.layout, i);
    const frame = state.layout === 'snaps';
    drawPanelPhoto(ctx, rects[i], state.panels[i], grade, strength, state.halftone, rotation, frame);
  }
  // Thin white frame around each panel, so the grid reads as a poster
  // (the snapshots layout already has its polaroid borders).
  if (state.layout !== 'snaps') {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = Math.max(2, Math.round(w * 0.003));
    for (let i = 0; i < count; i += 1) {
      const r = rects[i];
      ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    }
  }
  // Vignette over the photo area, strength from the slider (0 = off).
  // Drawn BEFORE the title band, so the caption and subtitle stay clean —
  // the band paints over the vignette where they overlap.
  const vigStrength = state.vignette ?? 0.3;
  if (vigStrength > 0) {
    const vig = ctx.createRadialGradient(
      w / 2, h * 0.42, Math.min(w, h) * 0.35,
      w / 2, h / 2, Math.max(w, h) * 0.75,
    );
    vig.addColorStop(0, 'rgba(10, 4, 20, 0)');
    vig.addColorStop(1, `rgba(10, 4, 20, ${(0.9 * vigStrength).toFixed(3)})`);
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);
  }
  drawTitleBlock(ctx, w, h, state);
  // Film grain over the whole cover (seeded tile, so every render matches).
  if (state.grain) {
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.09;
    ctx.fillStyle = ctx.createPattern(getGrainTile(), 'repeat');
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
  drawBadge(ctx, w, h, state);
  // Editor selection outline, never on an export. It follows the panel's
  // own rotation, so it stays square on the tilted snapshots panels.
  const highlight = options.highlight ?? -1;
  if (highlight >= 0 && highlight < count) {
    const r = rects[highlight];
    const rotation = layoutRotation(state.layout, highlight);
    ctx.save();
    if (rotation) {
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      ctx.translate(cx, cy);
      ctx.rotate(rotation);
      ctx.translate(-cx, -cy);
    }
    ctx.strokeStyle = '#00e5d4';
    ctx.lineWidth = Math.max(3, Math.round(w * 0.005));
    ctx.setLineDash([Math.round(w * 0.02), Math.round(w * 0.012)]);
    ctx.strokeRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4);
    ctx.setLineDash([]);
    ctx.restore();
  }
}
