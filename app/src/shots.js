// Fixed scenes for screenshots: ?shot=editor shows the page with a sample photo;
// ?shot=cover shows the cover alone. `photo` picks the sample (samples/<photo>.jpg),
// `caption` the words, and `layout` one of the six layouts (default hero).
// Extra scene knobs: `grade` one of the five grades, `grain=1`, `halftone=1`,
// `vignette=0..100`, `badge=1` with `badgetext` for the corner badge.
// window.__shotReady is set once painted.
export async function runShot(shot, query, load) {
  if (shot === 'cover') document.body.classList.add('shot-cover');
  await load(`samples/${query.get('photo') ?? 'pier'}.jpg`, query.get('caption') ?? 'Sunset Heist');
  requestAnimationFrame(() => requestAnimationFrame(() => { window.__shotReady = true; }));
}
