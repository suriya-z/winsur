//! Island overlay geometry. The window is a rectangle; the visible island is a
//! rounded rect inside a transparent shadow gutter.

/// Point-in-rounded-rect. `px/py` and the rect must share a coordinate space.
pub fn point_in_rounded_rect(
    px: f64,
    py: f64,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    radius: f64,
) -> bool {
    if w.partial_cmp(&0.0) != Some(std::cmp::Ordering::Greater)
        || h.partial_cmp(&0.0) != Some(std::cmp::Ordering::Greater)
    {
        return false;
    }
    let r = radius.max(0.0).min(w / 2.0).min(h / 2.0);
    let left = x;
    let top = y;
    let right = x + w;
    let bottom = y + h;
    if px < left || px > right || py < top || py > bottom {
        return false;
    }
    let cx = (left + r).max(px.min(right - r));
    let cy = (top + r).max(py.min(bottom - r));
    let dx = px - cx;
    let dy = py - cy;
    dx * dx + dy * dy <= r * r + 1e-6
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Bounds {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

/// Window bounds that keep the island's top-center on `anchor` and leave
/// `pad` pixels of transparent gutter on every side for the CSS shadow.
pub fn overlay_bounds(
    anchor_x: f64,
    anchor_y: f64,
    island_w: f64,
    island_h: f64,
    pad: f64,
) -> Bounds {
    let w = island_w.round().max(1.0) as i32;
    let h = island_h.round().max(1.0) as i32;
    let p = pad.round().max(0.0) as i32;
    Bounds {
        x: (anchor_x - f64::from(w) / 2.0 - f64::from(p)).round() as i32,
        y: (anchor_y - f64::from(p)).round() as i32,
        width: w + p * 2,
        height: h + p * 2,
    }
}

#[derive(Clone, Copy, Debug)]
pub struct IslandRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub r: f64,
}

/// Visible island rectangle when the island is centered in the content area.
pub fn centered_island_rect(
    content: Bounds,
    island_w: f64,
    island_h: f64,
    radius: f64,
) -> IslandRect {
    let w = island_w.round();
    let h = island_h.round();
    IslandRect {
        x: f64::from(content.x) + (f64::from(content.width) - w) / 2.0,
        y: f64::from(content.y) + (f64::from(content.height) - h) / 2.0,
        w,
        h,
        r: radius.max(0.0),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rounded_hit_target_ignores_corners_and_the_shadow_gutter() {
        let (x, y, w, h, r) = (100.0, 40.0, 200.0, 40.0, 20.0);
        assert!(point_in_rounded_rect(200.0, 60.0, x, y, w, h, r));
        assert!(!point_in_rounded_rect(100.0, 40.0, x, y, w, h, r));
        assert!(!point_in_rounded_rect(101.0, 41.0, x, y, w, h, r));
        assert!(point_in_rounded_rect(120.0, 60.0, x, y, w, h, r));
        assert!(!point_in_rounded_rect(102.0, 42.0, x, y, w, h, 20.0));
        assert!(!point_in_rounded_rect(200.0, 20.0, x, y, w, h, r));
    }

    #[test]
    fn overlay_bounds_keep_the_island_top_center_and_leave_an_even_gutter() {
        let bounds = overlay_bounds(800.0, 8.0, 240.0, 38.0, 56.0);
        assert_eq!(
            bounds,
            Bounds {
                x: 800 - 120 - 56,
                y: 8 - 56,
                width: 240 + 112,
                height: 38 + 112,
            }
        );
        let island = centered_island_rect(bounds, 240.0, 38.0, 19.0);
        assert_eq!(island.x + island.w / 2.0, 800.0);
        assert_eq!(island.y, 8.0);
        assert!(point_in_rounded_rect(
            800.0,
            8.0 + 19.0,
            island.x,
            island.y,
            island.w,
            island.h,
            island.r
        ));
        assert!(!point_in_rounded_rect(
            f64::from(bounds.x) + 4.0,
            f64::from(bounds.y) + 4.0,
            island.x,
            island.y,
            island.w,
            island.h,
            island.r
        ));
    }
}
