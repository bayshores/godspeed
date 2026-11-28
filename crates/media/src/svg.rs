use std::sync::{Arc, LazyLock};

use gs_base::re::Re;
use resvg::{tiny_skia, usvg};

use crate::png::provider_safe_png;

/// The viewport an agent asked for; unset (or zero) sides come from the SVG.
#[derive(Debug, Clone, Copy, Default)]
pub struct RenderSvgOptions {
	pub width: Option<f64>,
	pub height: Option<f64>,
}

fn truthy(n: f64) -> bool {
	n != 0.0 && !n.is_nan()
}

/// The size to render at: both options when set, else the root tag's own width and height
/// (900 and 700 where it has none), rounded up.
pub fn svg_viewport(svg: &str, opts: RenderSvgOptions) -> (f64, f64) {
	if let (Some(width), Some(height)) = (opts.width, opts.height)
		&& truthy(width)
		&& truthy(height)
	{
		return (width, height);
	}
	// The root tag's own size only: not stroke-width, a child's width, or a percentage.
	let root = Re::new(r"<svg\b[^>]*>", "i").captures(svg).map(|m| m.as_string()).unwrap_or_default();
	let attr = |name: &str| -> f64 {
		let pattern = format!(r#"(?<![\w-]){name}\s*=\s*["']?(\d+(?:\.\d+)?)(?![\d.]|%)"#);
		Re::new(&pattern, "").captures(&root).and_then(|m| m.get(1)).and_then(|n| n.parse().ok()).unwrap_or(f64::NAN)
	};
	let side = |value: f64, fallback: f64| if value.is_finite() && value > 0.0 { value } else { fallback };
	(side(attr("width"), 900.0).ceil(), side(attr("height"), 700.0).ceil())
}

/// Fonts for text in the figure: the machine's, with every generic family on the first one found.
/// Read once: listing the machine's fonts is the slow part of drawing a figure.
static FONTS: LazyLock<Arc<usvg::fontdb::Database>> = LazyLock::new(|| {
	let mut db = usvg::fontdb::Database::new();
	db.load_system_fonts();
	let first_family = db.faces().next().and_then(|face| face.families.first()).map(|(name, _)| name.clone());
	if let Some(family) = first_family {
		db.set_serif_family(family.clone());
		db.set_sans_serif_family(family.clone());
		db.set_cursive_family(family.clone());
		db.set_fantasy_family(family.clone());
		db.set_monospace_family(family);
	}
	Arc::new(db)
});

fn tree(svg: &str) -> Result<usvg::Tree, String> {
	let options = usvg::Options {
		font_family: String::new(),
		font_size: 12.0,
		languages: vec!["en".to_owned()],
		fontdb: FONTS.clone(),
		..usvg::Options::default()
	};
	usvg::Tree::from_str(svg, &options).map_err(|e| e.to_string())
}

/// The box an SVG's drawing takes, strokes included, as left, top, width and height from its
/// viewport's corner; None when it draws nothing. An Err means this renderer cannot read it.
pub fn drawn_box(svg: &str) -> Result<Option<[f64; 4]>, String> {
	let drawn = tree(svg)?.root().abs_stroke_bounding_box();
	let seen = drawn.width() > 0.0 || drawn.height() > 0.0;
	Ok(seen.then(|| [drawn.x(), drawn.y(), drawn.width(), drawn.height()].map(f64::from)))
}

/// An SVG as a PNG on white, scaled to the viewport's width. An Err means this renderer
/// could not draw it, and the caller falls back to a browser.
pub fn render_svg(svg: &str, opts: RenderSvgOptions) -> Result<Vec<u8>, String> {
	let (target_width, _) = svg_viewport(svg, opts);
	let tree = tree(svg)?;

	let size = tree.size();
	let scale = target_width as f32 / size.width();
	let width = (size.width() * scale).round().max(0.0) as u32;
	let height = (size.height() * scale).round().max(0.0) as u32;
	let mut pixmap = tiny_skia::Pixmap::new(width, height).ok_or("zero-sized image")?;
	pixmap.fill(tiny_skia::Color::WHITE);
	let transform = tiny_skia::Transform::from_scale(width as f32 / size.width(), height as f32 / size.height());
	resvg::render(&tree, transform, &mut pixmap.as_mut());
	Ok(provider_safe_png(&pixmap.encode_png().map_err(|e| e.to_string())?))
}
