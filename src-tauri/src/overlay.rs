//! Sizes the always-on-top window to the visible island and hit-tests the cursor.
//!
//! Windows stops delivering mouse-move events once `WS_EX_TRANSPARENT` is set,
//! so the overlay polls `GetCursorPos` itself. The hit target is the rounded
//! island in physical pixels, not the window rectangle.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use tauri::{LogicalPosition, LogicalSize, WebviewWindow};
use winsur_core::hit_region::{overlay_bounds, point_in_rounded_rect, IslandRect};

use crate::win32::{self, cursor_physical};

const PAD: f64 = 56.0;

#[derive(Clone, Copy)]
struct Measured {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    r: f64,
}

struct Inner {
    anchor: Option<(f64, f64)>,
    island_w: f64,
    island_h: f64,
    island_r: f64,
    measured: Option<Measured>,
    dragging: bool,
    drag_offset: Option<(f64, f64)>,
    ignoring: bool,
    drag_gen: u64,
}

pub struct Overlay {
    inner: Mutex<Inner>,
    poll_stop: AtomicBool,
    armed: AtomicBool,
    painted: AtomicBool,
}

impl Default for Overlay {
    fn default() -> Self {
        Self::new()
    }
}

impl Overlay {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(Inner {
                anchor: None,
                island_w: 240.0,
                island_h: 38.0,
                island_r: 19.0,
                measured: None,
                dragging: false,
                drag_offset: None,
                ignoring: true,
                drag_gen: 0,
            }),
            poll_stop: AtomicBool::new(false),
            armed: AtomicBool::new(false),
            painted: AtomicBool::new(false),
        }
    }

    /// Move the island onto the primary work area. Click-through stays off until
    /// [`Self::arm`] so the first paint is not a layered window that was never shown.
    pub fn place(&self, window: &WebviewWindow) {
        self.apply_bounds(window);
        if !win32::center_on_virtual_screen(window) {
            self.inner.lock().expect("overlay").anchor = Some((800.0, 8.0));
            self.apply_bounds(window);
        }
    }

    pub fn has_painted(&self) -> bool {
        self.painted.load(Ordering::SeqCst)
    }

    /// Latest island box in CSS pixels, relative to the webview viewport.
    pub fn measured_box(&self) -> Option<(f64, f64, f64, f64)> {
        let inner = self.inner.lock().expect("overlay");
        inner.measured.map(|m| (m.x, m.y, m.w, m.h))
    }

    /// Start cursor polling. Safe to call once; later calls only reapply hit testing.
    pub fn arm(self: &std::sync::Arc<Self>, window: &WebviewWindow) {
        self.apply_ignore(window, true, true);
        win32::strip_thick_frame(window);
        if self.armed.swap(true, Ordering::SeqCst) {
            return;
        }
        let this = std::sync::Arc::clone(self);
        let window = window.clone();
        thread::spawn(move || {
            while !this.poll_stop.load(Ordering::SeqCst) {
                this.sync_pointer(&window, false);
                thread::sleep(Duration::from_millis(16));
            }
        });
    }

    pub fn stop(&self) {
        self.poll_stop.store(true, Ordering::SeqCst);
        let mut inner = self.inner.lock().expect("overlay");
        inner.dragging = false;
        inner.drag_gen = inner.drag_gen.wrapping_add(1);
    }

    /// Returns true the first time the renderer reports a real island box.
    pub fn note_metrics(
        &self,
        window: &WebviewWindow,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        radius: f64,
    ) -> bool {
        if !width.is_finite() || !height.is_finite() || width < 8.0 || height < 8.0 {
            return false;
        }
        let first = !self.painted.swap(true, Ordering::SeqCst);
        let next_r = if radius.is_finite() {
            radius.round().max(0.0)
        } else {
            self.inner.lock().expect("overlay").island_r
        };
        let next_w = width.round();
        let next_h = height.round();
        let changed = {
            let mut inner = self.inner.lock().expect("overlay");
            let changed =
                next_w != inner.island_w || next_h != inner.island_h || next_r != inner.island_r;
            inner.measured = Some(Measured {
                x: if x.is_finite() { x } else { 0.0 },
                y: if y.is_finite() { y } else { 0.0 },
                w: next_w,
                h: next_h,
                r: next_r,
            });
            inner.island_w = next_w;
            inner.island_h = next_h;
            inner.island_r = next_r;
            changed
        };
        if !changed {
            self.sync_pointer(window, false);
            return first;
        }
        let dragging = self.inner.lock().expect("overlay").dragging;
        self.apply_bounds(window);
        if dragging {
            if let (Some((cx, cy)), Some((ox, oy))) =
                (cursor_logical(window), logical_outer_pos(window))
            {
                self.inner.lock().expect("overlay").drag_offset = Some((cx - ox, cy - oy));
            }
        }
        self.sync_pointer(window, false);
        first
    }

    pub fn begin_drag(self: &std::sync::Arc<Self>, window: WebviewWindow) {
        let gen = {
            let mut inner = self.inner.lock().expect("overlay");
            inner.dragging = true;
            inner.drag_gen = inner.drag_gen.wrapping_add(1);
            inner.drag_offset = match (cursor_logical(&window), logical_outer_pos(&window)) {
                (Some((cx, cy)), Some((ox, oy))) => Some((cx - ox, cy - oy)),
                _ => Some((0.0, 0.0)),
            };
            inner.drag_gen
        };
        self.apply_ignore(&window, false, false);
        let this = std::sync::Arc::clone(self);
        thread::spawn(move || {
            let started = Instant::now();
            while started.elapsed() < Duration::from_secs(15) {
                {
                    let inner = this.inner.lock().expect("overlay");
                    if !inner.dragging || inner.drag_gen != gen {
                        return;
                    }
                }
                this.drag_step(&window);
                thread::sleep(Duration::from_millis(8));
            }
            let still = {
                let inner = this.inner.lock().expect("overlay");
                inner.dragging && inner.drag_gen == gen
            };
            if still {
                this.end_drag(&window);
            }
        });
    }

    pub fn end_drag(&self, window: &WebviewWindow) {
        {
            let mut inner = self.inner.lock().expect("overlay");
            inner.dragging = false;
            inner.drag_offset = None;
            inner.drag_gen = inner.drag_gen.wrapping_add(1);
        }
        self.remember_anchor(window);
        self.apply_bounds(window);
        self.sync_pointer(window, false);
    }

    pub fn force_ignore(&self, window: &WebviewWindow, ignore: bool) {
        self.apply_ignore(window, ignore, true);
    }

    pub fn sync_pointer(&self, window: &WebviewWindow, force: bool) {
        if window.is_visible().ok() != Some(true) {
            return;
        }
        let dragging = self.inner.lock().expect("overlay").dragging;
        if dragging {
            self.apply_ignore(window, false, force);
            return;
        }
        let Some((px, py)) = cursor_physical() else {
            return;
        };
        let Some(island) = self.island_physical(window) else {
            return;
        };
        let inside =
            point_in_rounded_rect(px, py, island.x, island.y, island.w, island.h, island.r);
        self.apply_ignore(window, !inside, force);
    }

    fn drag_step(&self, window: &WebviewWindow) {
        let (offset, island_w, island_h) = {
            let inner = self.inner.lock().expect("overlay");
            if !inner.dragging {
                return;
            }
            let Some(offset) = inner.drag_offset else {
                return;
            };
            (offset, inner.island_w, inner.island_h)
        };
        let Some((cx, cy)) = cursor_logical(window) else {
            return;
        };
        let x = (cx - offset.0).round();
        let y = (cy - offset.1).round();
        let size = overlay_bounds(0.0, 0.0, island_w, island_h, PAD);
        let _ = window.set_position(LogicalPosition::new(x, y));
        {
            let mut inner = self.inner.lock().expect("overlay");
            inner.anchor = Some((x + f64::from(size.width) / 2.0, y + PAD));
        }
        let ignoring = self.inner.lock().expect("overlay").ignoring;
        self.apply_ignore(window, ignoring, true);
        win32::strip_thick_frame(window);
    }

    fn remember_anchor(&self, window: &WebviewWindow) {
        let scale = scale_of(window);
        let Some(island) = self.island_physical(window) else {
            return;
        };
        self.inner.lock().expect("overlay").anchor = Some((
            ((island.x + island.w / 2.0) / scale).round(),
            (island.y / scale).round(),
        ));
    }

    fn apply_bounds(&self, window: &WebviewWindow) {
        let bounds = {
            let mut inner = self.inner.lock().expect("overlay");
            let anchor = ensure_anchor(&mut inner, window);
            overlay_bounds(anchor.0, anchor.1, inner.island_w, inner.island_h, PAD)
        };
        let scale = scale_of(window);
        if let (Ok(pos), Ok(size)) = (window.outer_position(), window.outer_size()) {
            let x = (pos.x as f64 / scale).round() as i32;
            let y = (pos.y as f64 / scale).round() as i32;
            let w = (size.width as f64 / scale).round() as i32;
            let h = (size.height as f64 / scale).round() as i32;
            if x == bounds.x && y == bounds.y && w == bounds.width && h == bounds.height {
                return;
            }
        }
        let _ = window.set_position(LogicalPosition::new(
            f64::from(bounds.x),
            f64::from(bounds.y),
        ));
        let _ = window.set_size(LogicalSize::new(
            f64::from(bounds.width),
            f64::from(bounds.height),
        ));
        win32::strip_thick_frame(window);
        if self.armed.load(Ordering::SeqCst) {
            let ignoring = self.inner.lock().expect("overlay").ignoring;
            self.apply_ignore(window, ignoring, true);
        }
    }

    fn apply_ignore(&self, window: &WebviewWindow, ignore: bool, force: bool) {
        {
            let mut inner = self.inner.lock().expect("overlay");
            if !force && inner.ignoring == ignore {
                return;
            }
            inner.ignoring = ignore;
        }
        let _ = window.set_ignore_cursor_events(ignore);
    }

    /// Visible island in physical pixels. Cursor points from `GetCursorPos` are physical.
    fn island_physical(&self, window: &WebviewWindow) -> Option<IslandRect> {
        let (measured, island_w, island_h, island_r) = {
            let inner = self.inner.lock().expect("overlay");
            (
                inner.measured,
                inner.island_w,
                inner.island_h,
                inner.island_r,
            )
        };
        let scale = scale_of(window);
        let inner_pos = window.inner_position().ok()?;
        if let Some(measured) = measured {
            return Some(IslandRect {
                x: inner_pos.x as f64 + measured.x * scale,
                y: inner_pos.y as f64 + measured.y * scale,
                w: measured.w * scale,
                h: measured.h * scale,
                r: measured.r * scale,
            });
        }
        let size = window.inner_size().ok()?;
        let w = island_w * scale;
        let h = island_h * scale;
        Some(IslandRect {
            x: inner_pos.x as f64 + (size.width as f64 - w) / 2.0,
            y: inner_pos.y as f64 + (size.height as f64 - h) / 2.0,
            w,
            h,
            r: island_r * scale,
        })
    }
}

fn scale_of(window: &WebviewWindow) -> f64 {
    match window.scale_factor() {
        Ok(scale) if scale > 0.0 => scale,
        _ => 1.0,
    }
}

fn cursor_logical(window: &WebviewWindow) -> Option<(f64, f64)> {
    let (x, y) = cursor_physical()?;
    let scale = scale_of(window);
    Some((x / scale, y / scale))
}

fn logical_outer_pos(window: &WebviewWindow) -> Option<(f64, f64)> {
    let scale = scale_of(window);
    let pos = window.outer_position().ok()?;
    Some((pos.x as f64 / scale, pos.y as f64 / scale))
}

fn ensure_anchor(inner: &mut Inner, window: &WebviewWindow) -> (f64, f64) {
    if let Some(anchor) = inner.anchor {
        return anchor;
    }
    let anchor = primary_anchor(window).unwrap_or((800.0, 8.0));
    inner.anchor = Some(anchor);
    anchor
}

fn primary_anchor(window: &WebviewWindow) -> Option<(f64, f64)> {
    let monitor = window.primary_monitor().ok().flatten()?;
    let scale = monitor.scale_factor().max(0.01);
    let area = monitor.work_area();
    let origin_x = area.position.x as f64 / scale;
    let origin_y = area.position.y as f64 / scale;
    let width = area.size.width as f64 / scale;
    let height = area.size.height as f64 / scale;
    if width < 64.0 || height < 64.0 {
        return None;
    }
    let mut x = origin_x + width / 2.0;
    let min_x = origin_x + 120.0;
    let max_x = origin_x + width - 120.0;
    if max_x > min_x {
        x = x.clamp(min_x, max_x);
    }
    let y = origin_y + 8.0;
    Some((x.round(), y.round()))
}
