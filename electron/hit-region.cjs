// Pure geometry for the island overlay.
// The BrowserWindow is a rectangle; the visible island is a rounded rect
// inside a transparent shadow gutter. Hit-testing has to use the rounded
// shape, or the gutter and the corner pixels become a dead click zone.

/**
 * Point-in-rounded-rect. Coordinates are the same space (DIP screen pixels
 * or CSS pixels); they just have to match each other.
 */
function pointInRoundedRect(px, py, x, y, w, h, radius) {
  if (!(w > 0) || !(h > 0)) return false;
  const r = Math.max(0, Math.min(Number(radius) || 0, w / 2, h / 2));
  const left = x;
  const top = y;
  const right = x + w;
  const bottom = y + h;
  if (px < left || px > right || py < top || py > bottom) return false;
  const cx = Math.max(left + r, Math.min(px, right - r));
  const cy = Math.max(top + r, Math.min(py, bottom - r));
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= r * r + 1e-6;
}

/**
 * Window bounds that keep the island's top-center on `anchor` and leave
 * `pad` pixels of transparent gutter on every side for the CSS shadow.
 */
function overlayBounds(anchor, islandW, islandH, pad) {
  const w = Math.max(1, Math.round(islandW));
  const h = Math.max(1, Math.round(islandH));
  const p = Math.max(0, Math.round(pad));
  return {
    x: Math.round(anchor.x - w / 2 - p),
    y: Math.round(anchor.y - p),
    width: w + p * 2,
    height: h + p * 2,
  };
}

/**
 * Visible island rectangle when the island is centered in the content area
 * (the renderer uses flex centering, so the gutter is even on every side).
 */
function centeredIslandRect(contentBounds, islandW, islandH, radius) {
  const w = Math.round(islandW);
  const h = Math.round(islandH);
  return {
    x: contentBounds.x + (contentBounds.width - w) / 2,
    y: contentBounds.y + (contentBounds.height - h) / 2,
    w,
    h,
    r: Math.max(0, Number(radius) || 0),
  };
}

module.exports = {
  pointInRoundedRect,
  overlayBounds,
  centeredIslandRect,
};
