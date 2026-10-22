// Sizes the always-on-top window to the visible island and decides
// click-through from the cursor's screen position.
//
// On Windows, setIgnoreMouseEvents(true, { forward: true }) is not a reliable
// hit test. After the first hover the forward hook stops delivering moves, the
// renderer never flips ignore back on, and the whole BrowserWindow (previously
// a fixed 500x600) eats clicks around the notch. Polling the cursor in the
// main process does not depend on that hook. The window is also shrunk to the
// island plus a shadow gutter, and thickFrame is left off so the invisible
// resize border is not a second dead zone.

const { pointInRoundedRect, overlayBounds, centeredIslandRect } = require("./hit-region.cjs");

const PAD = 56;
const DEFAULT_ISLAND = { w: 240, h: 38, r: 19 };

function createOverlayController(screen) {
  let anchor = null;
  let island = { ...DEFAULT_ISLAND };
  // Last visual box in viewport CSS pixels. Hit-testing uses this, not a
  // guessed center, so the shape tracks the expand/collapse animation.
  let measured = null;
  let dragging = false;
  let dragOffset = null;
  let ignoring = true;
  let timer = null;
  let winRef = null;

  function win() {
    return winRef && !winRef.isDestroyed() ? winRef : null;
  }

  function ensureAnchor() {
    if (anchor) return anchor;
    const area = screen.getPrimaryDisplay().workArea;
    anchor = {
      x: Math.round(area.x + area.width / 2),
      y: Math.round(area.y + 8),
    };
    return anchor;
  }

  function contentBox(w) {
    try {
      return w.getContentBounds();
    } catch {
      return w.getBounds();
    }
  }

  function islandRect(w) {
    const box = contentBox(w);
    if (measured && measured.w > 0 && measured.h > 0) {
      return {
        x: box.x + measured.x,
        y: box.y + measured.y,
        w: measured.w,
        h: measured.h,
        r: measured.r,
      };
    }
    return centeredIslandRect(box, island.w, island.h, island.r);
  }

  function applyIgnore(w, ignore, force) {
    if (!force && ignore === ignoring) return;
    ignoring = ignore;
    try {
      if (ignore) w.setIgnoreMouseEvents(true, { forward: true });
      else w.setIgnoreMouseEvents(false);
    } catch {
      /* ignore */
    }
  }

  function applyBounds(w) {
    const b = overlayBounds(ensureAnchor(), island.w, island.h, PAD);
    let cur;
    try {
      cur = w.getBounds();
    } catch {
      return;
    }
    if (cur.x === b.x && cur.y === b.y && cur.width === b.width && cur.height === b.height) {
      return;
    }
    try {
      w.setBounds(b);
    } catch {
      /* ignore */
    }
    // setBounds on Windows can drop WS_EX_TRANSPARENT. Put it back.
    applyIgnore(w, ignoring, true);
  }

  function rememberAnchorFromWindow(w) {
    const rect = islandRect(w);
    anchor = {
      x: Math.round(rect.x + rect.w / 2),
      y: Math.round(rect.y),
    };
  }

  function syncPointer(force) {
    const w = win();
    if (!w || !w.isVisible()) return;
    if (dragging) {
      applyIgnore(w, false, !!force);
      return;
    }
    const rect = islandRect(w);
    let p;
    try {
      p = screen.getCursorScreenPoint();
    } catch {
      return;
    }
    const inside = pointInRoundedRect(p.x, p.y, rect.x, rect.y, rect.w, rect.h, rect.r);
    applyIgnore(w, !inside, !!force);
  }

  return {
    pad: PAD,
    initialBounds() {
      return overlayBounds(ensureAnchor(), island.w, island.h, PAD);
    },
    attach(next) {
      winRef = next;
      applyBounds(next);
      applyIgnore(next, true, true);
      if (timer) clearInterval(timer);
      timer = setInterval(syncPointer, 16);
    },
    noteMetrics(metrics) {
      const w = win();
      if (!w || !metrics) return;
      const width = Number(metrics.width);
      const height = Number(metrics.height);
      const radius = Number(metrics.radius);
      if (!Number.isFinite(width) || !Number.isFinite(height) || width < 8 || height < 8) return;
      const next = {
        w: Math.round(width),
        h: Math.round(height),
        r: Number.isFinite(radius) ? Math.max(0, Math.round(radius)) : island.r,
      };
      const ox = Number(metrics.x);
      const oy = Number(metrics.y);
      measured = {
        x: Number.isFinite(ox) ? ox : 0,
        y: Number.isFinite(oy) ? oy : 0,
        w: next.w,
        h: next.h,
        r: next.r,
      };
      const changed = next.w !== island.w || next.h !== island.h || next.r !== island.r;
      island = next;
      if (!changed) {
        syncPointer();
        return;
      }
      if (dragging) {
        applyBounds(w);
        try {
          const b = w.getBounds();
          const p = screen.getCursorScreenPoint();
          dragOffset = { x: p.x - b.x, y: p.y - b.y };
        } catch {
          /* ignore */
        }
      } else {
        applyBounds(w);
      }
      syncPointer();
    },
    beginDrag(screenPoint) {
      const w = win();
      if (!w) return;
      dragging = true;
      try {
        const b = w.getBounds();
        dragOffset = {
          x: screenPoint.x - b.x,
          y: screenPoint.y - b.y,
        };
      } catch {
        dragOffset = { x: 0, y: 0 };
      }
      applyIgnore(w, false);
    },
    dragTo(screenPoint) {
      const w = win();
      if (!w || !dragging || !dragOffset) return;
      const x = Math.round(screenPoint.x - dragOffset.x);
      const y = Math.round(screenPoint.y - dragOffset.y);
      const size = overlayBounds({ x: 0, y: 0 }, island.w, island.h, PAD);
      try {
        w.setBounds({ x, y, width: size.width, height: size.height });
      } catch {
        /* ignore */
      }
      anchor = {
        x: Math.round(x + size.width / 2),
        y: Math.round(y + PAD),
      };
    },
    endDrag() {
      const w = win();
      dragging = false;
      dragOffset = null;
      if (!w) return;
      rememberAnchorFromWindow(w);
      applyBounds(w);
      syncPointer();
    },
    isDragging() {
      return dragging;
    },
    syncPointer,
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

module.exports = { createOverlayController, PAD };
