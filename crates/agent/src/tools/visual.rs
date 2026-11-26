//! visual, the teacher's figure: the teacher writes the finished SVG, the server checks it, cuts
//! its view box to the drawing, draws it once and hands the render back, and the lesson shows it
//! under the reply. Every rule is checked before the drawing, so a refused call lists all its
//! problems at once. A figure never ends the turn: the teacher sees its render at once and ends
//! the turn itself.

use std::sync::Arc;

use gs_base::base64;
use gs_base::num::to_fixed;
use gs_core::session::schema::{object, string};
use gs_core::session::tool_switches::VISUAL_TOOL;
use gs_engine::turn::messages::text_block;
use gs_engine::turn::tool_execute::invalid_input_result;
use gs_json::{Json, json};
use gs_media::svg::drawn_box;

use super::fn_tool::FnTool;
use crate::subagents::headless::HeadlessApi;

/// The colors a figure may name. The window swaps in the theme's values, so a figure reads on
/// Graphite and on Paper.
pub const FIGURE_COLORS: [&str; 4] = ["var(--ink)", "var(--soft)", "var(--accent)", "var(--paper)"];

/// What the names are in the render the teacher gets back: dark on white.
const CHECK_COLORS: [&str; 4] = ["#24231f", "#6d6b62", "#3f6787", "#ffffff"];

const DESCRIPTION: &str = "Shows ONE figure under your reply; `svg` is the finished SVG. Draw whenever the idea has a layout, the first time it appears: a grid, a graph, a tree, a circuit, a molecule, a cell, a force diagram, a number line, a timeline, geometry. Never ask the learner to draw what you can show. Name in your text what to look at. A worked example: one figure, a numbered panel per step that changes the layout. A flow or hierarchy with no exact placement: mermaid in your text instead.\n\
Rules: root `viewBox=\"0 0 W H\"`, W at most 540 (wider is shrunk, text too), no width or height; the room around the drawing is cut off for you. Colors: only `var(--ink)` (lines, text), `var(--soft)` (grid, axes, quiet labels), `var(--accent)` (the one thing to look at), `var(--paper)` (a fill that hides what is under it) and `none`; a tint is `fill-opacity`. No background, no font-family. Text 16 or larger; a label is about 0.6 × its size per character wide. Keep it 6 clear of every line and outline, beside what it names, else a thin `var(--soft)` leader line to it. Work each angle and length out first (sin, cos): a stated 104.5° or 0.87 mg is drawn at that value, and a named angle gets an arc. Arrows: marker with `markerUnits=\"userSpaceOnUse\"`, head about 10 long, one marker per color, at least 20 of shaft showing outside any shape. `<title>` first, naming the figure. Labels in plain Unicode (x², θ), no LaTeX. Every count, coordinate and direction exact; draw nothing the idea doesn't have.\n\
The result carries the figure as the learner sees it. Look at it: wrong or hard to read, say so in one line and draw it again.";

const SHOWN_TEXT: &str = "Shown to the learner under your reply. The image is what they see (their colors follow their theme). Wrong or hard to read: say so in one line and draw it again.";

/// A figure over this is a drawing gone wrong, and it would ride every later delivery.
const MAX_CHARS: usize = 24_000;

/// The widest a figure is drawn, in CSS pixels: the lesson's text column.
const MAX_WIDTH: f64 = 720.0;

const COLOR_PROPERTIES: [&str; 6] = ["fill", "stroke", "color", "stop-color", "flood-color", "lighting-color"];

/// What the root tag gets when it does not say: the theme's ink for text and unfilled shapes, a
/// plain label font, soft line ends.
const ROOT_DEFAULTS: [(&str, &str); 6] = [
	("xmlns", "http://www.w3.org/2000/svg"),
	("fill", "var(--ink)"),
	("color", "var(--ink)"),
	("font-family", "system-ui, sans-serif"),
	("stroke-linecap", "round"),
	("stroke-linejoin", "round"),
];

/// Where a tag that opens at `tag`'s start ends: the index of its `>`, quoted values skipped.
fn tag_end(tag: &str) -> usize {
	let mut quote = None;
	for (i, c) in tag.char_indices() {
		match (quote, c) {
			(None, '"' | '\'') => quote = Some(c),
			(Some(q), _) if q == c => quote = None,
			(None, '>') => return i,
			_ => {}
		}
	}
	tag.len()
}

/// A start tag's attributes after its name, as (name, value).
fn attributes(mut rest: &str) -> Vec<(&str, &str)> {
	let mut out = Vec::new();
	loop {
		rest = rest.trim_start_matches(|c: char| c.is_whitespace() || c == '/');
		let name_len = rest.find(|c: char| c.is_whitespace() || c == '=' || c == '/').unwrap_or(rest.len());
		if name_len == 0 {
			return out;
		}
		let name = &rest[..name_len];
		rest = rest[name_len..].trim_start();
		let Some(after) = rest.strip_prefix('=') else {
			out.push((name, ""));
			continue;
		};
		let after = after.trim_start();
		let (value, left) = match after.chars().next() {
			Some(q @ ('"' | '\'')) => after[1..].split_once(q).unwrap_or((&after[1..], "")),
			_ => after.split_at(after.find(char::is_whitespace).unwrap_or(after.len())),
		};
		out.push((name, value));
		rest = left;
	}
}

/// Every start tag's attributes, and the text of each style element.
fn scan(svg: &str) -> (Vec<(&str, &str)>, Vec<&str>) {
	let (mut attrs, mut css) = (Vec::new(), Vec::new());
	let mut rest = svg;
	while let Some(at) = rest.find('<') {
		rest = &rest[at..];
		if let Some(comment) = rest.strip_prefix("<!--") {
			rest = comment.split_once("-->").map_or("", |(_, after)| after);
			continue;
		}
		let end = tag_end(rest);
		let tag = &rest[1..end];
		rest = rest.get(end + 1..).unwrap_or("");
		if tag.starts_with(['/', '!', '?']) {
			continue;
		}
		let name_len = tag.find(|c: char| c.is_whitespace() || c == '/').unwrap_or(tag.len());
		attrs.extend(attributes(&tag[name_len..]));
		if tag[..name_len].eq_ignore_ascii_case("style") && !tag.ends_with('/') {
			let (text, after) = rest.split_once("</style").unwrap_or((rest, ""));
			css.push(text);
			rest = after;
		}
	}
	(attrs, css)
}

/// The `property: value` pairs in a style attribute or a style element's text.
fn declarations(css: &str) -> impl Iterator<Item = (&str, &str)> {
	css.split([';', '{', '}']).filter_map(|d| d.split_once(':')).map(|(property, value)| (property.trim(), value.trim()))
}

/// The names are matched as written, since the window swaps them as text.
fn color_allowed(value: &str) -> bool {
	let value = value.trim();
	FIGURE_COLORS.contains(&value) || value.starts_with("url(#") || ["none", "currentcolor", "transparent", "inherit"].iter().any(|word| value.eq_ignore_ascii_case(word))
}

/// The colors the figure names that the window cannot swap for the theme's, each once.
fn foreign_colors(svg: &str) -> Vec<String> {
	let (attrs, css) = scan(svg);
	let styled = attrs.iter().filter(|(name, _)| name.eq_ignore_ascii_case("style")).flat_map(|(_, value)| declarations(value));
	let listed = css.iter().flat_map(|text| declarations(text));
	let mut found: Vec<String> = Vec::new();
	for (property, value) in attrs.iter().copied().chain(styled).chain(listed) {
		if COLOR_PROPERTIES.iter().any(|p| property.eq_ignore_ascii_case(p)) && !color_allowed(value) && !found.iter().any(|f| f == value) {
			found.push(value.to_owned());
		}
	}
	found
}

/// The view box as left, top, width and height, when the root names four numbers with a real size.
fn view_box(root: &[(&str, &str)]) -> Option<[f64; 4]> {
	let value = root.iter().find(|(name, _)| *name == "viewBox")?.1;
	let numbers: Vec<f64> = value.split(|c: char| c.is_whitespace() || c == ',').filter(|n| !n.is_empty()).map(str::parse).collect::<Result<_, _>>().ok()?;
	match numbers[..] {
		[left, top, width, height] if width > 0.0 && height > 0.0 => Some([left, top, width, height]),
		_ => None,
	}
}

/// The room left around a figure's drawing when its view box is cut to it. It also covers text
/// the window sets a little wider than the server measured it, in another font.
const MARGIN: f64 = 16.0;

/// The view box cut to the drawing (`drawn`, from the view box's corner) plus the margin, so
/// the figure brings no empty room into the lesson. Whole numbers, rounded outward.
fn trimmed([left, top, _, _]: [f64; 4], [x, y, width, height]: [f64; 4]) -> [f64; 4] {
	let (x0, y0) = ((left + x - MARGIN).floor(), (top + y - MARGIN).floor());
	let (x1, y1) = ((left + x + width + MARGIN).ceil(), (top + y + height + MARGIN).ceil());
	[x0, y0, x1 - x0, y1 - y0]
}

/// The figure, or every rule it breaks.
fn check(svg: &str) -> Result<&str, Vec<String>> {
	let svg = svg.trim();
	let mut problems = Vec::new();
	if !svg.starts_with("<svg") || !svg.ends_with("</svg>") {
		return Err(vec!["svg: one complete <svg>…</svg> document, nothing before or after it.".to_owned()]);
	}
	if svg.chars().count() > MAX_CHARS {
		problems.push(format!("svg: at most {MAX_CHARS} characters. Draw fewer, larger things."));
	}
	if view_box(&attributes(&svg[4..tag_end(svg)])).is_none() {
		problems.push("svg: the root needs viewBox=\"0 0 W H\".".to_owned());
	}
	let foreign = foreign_colors(svg);
	if !foreign.is_empty() {
		let shown: Vec<&str> = foreign.iter().take(4).map(String::as_str).collect();
		problems.push(format!("Colors: only {} and none. Found: {}.", FIGURE_COLORS.join(", "), shown.join(", ")));
	}
	if problems.is_empty() { Ok(svg) } else { Err(problems) }
}

/// A checked figure as it is stored. A root with no size of its own gets its view box cut to
/// the drawing (`drawn`, when the drawing could be measured) and a size from it, no wider than
/// the text column. The root gains each default it does not say.
fn stored(svg: &str, drawn: Option<[f64; 4]>) -> String {
	let end = tag_end(svg);
	let root = attributes(&svg[4..end]);
	let has = |name: &str| root.iter().any(|(n, _)| *n == name);
	let (mut tag, mut added) = (svg[4..end].to_owned(), String::new());
	if !has("width") && !has("height") && let Some(asked) = view_box(&root) {
		let [left, top, width, height] = drawn.map_or(asked, |drawn| trimmed(asked, drawn));
		let value = root.iter().find(|(name, _)| *name == "viewBox").map_or("", |(_, value)| value);
		// The value's place in the tag: both are slices of `svg`.
		let at = value.as_ptr() as usize - svg.as_ptr() as usize - 4;
		tag.replace_range(at..at + value.len(), &[left, top, width, height].map(|n| to_fixed(n, 0)).join(" "));
		let scale = (MAX_WIDTH / width).min(1.0);
		added = format!(" width=\"{}\" height=\"{}\"", to_fixed(width * scale, 0), to_fixed(height * scale, 0));
	}
	for (name, value) in ROOT_DEFAULTS.iter().filter(|(name, _)| !has(name)) {
		added.push_str(&format!(" {name}=\"{value}\""));
	}
	format!("<svg{added}{tag}{}", &svg[end..])
}

/// The figure with the color names as real colors, for the render the teacher looks at.
fn for_the_check(svg: &str) -> String {
	FIGURE_COLORS.iter().zip(CHECK_COLORS).fold(svg.to_owned(), |svg, (name, color)| svg.replace(name, color))
}

async fn draw(headless: &dyn HeadlessApi, args: &Json) -> Json {
	let svg = match check(args["svg"].str_or_empty()) {
		Ok(svg) => svg,
		Err(problems) => return invalid_input_result(VISUAL_TOOL, &problems),
	};
	// Measuring reads fonts and lays out text: off the async threads. A figure this renderer
	// cannot read keeps its view box, and the drawing below says why if nothing can draw it.
	let colored = for_the_check(svg);
	let drawn = match gs_base::tasks::spawn_blocking("figure", move || drawn_box(&colored)).await {
		Ok(Ok(None)) => return invalid_input_result(VISUAL_TOOL, &["The figure draws nothing.".to_owned()]),
		Ok(Ok(Some(drawn))) => Some(drawn),
		Ok(Err(_)) | Err(_) => None,
	};
	let svg = stored(svg, drawn);
	match headless.render_svg(&for_the_check(&svg)).await {
		Ok(png) => json!({
			"content": [text_block(SHOWN_TEXT), { "type": "image", "data": base64::encode(&png), "mimeType": "image/png" }],
			"details": { "svg": svg },
		}),
		Err(error) => invalid_input_result(VISUAL_TOOL, &[format!("The figure cannot be drawn: {error}")]),
	}
}

pub fn visual_tool(headless: &Arc<dyn HeadlessApi>) -> FnTool {
	let headless = headless.clone();
	let parameters = object(&["svg"], vec![("svg", string("The complete <svg viewBox=\"0 0 W H\">…</svg>."))]);
	FnTool::immediate_async(VISUAL_TOOL, DESCRIPTION, parameters, move |args| {
		let headless = headless.clone();
		async move { draw(headless.as_ref(), &args).await }
	})
}

#[cfg(test)]
mod tests {
	use gs_engine::turn::abort::Abort;
	use gs_engine::turn::tool::{Tool, ToolContext};

	use super::*;
	use crate::subagents::test_support::{FAKE_PNG, FakeHeadless};

	async fn call(svg: &str) -> Json {
		let headless: Arc<dyn HeadlessApi> = FakeHeadless::new(Err("no demo".to_owned()));
		visual_tool(&headless).execute(json!({ "svg": svg }), ToolContext { tool_call_id: "v1".to_owned(), abort: Abort::new() }).await.unwrap()
	}

	fn problems(result: &Json) -> Vec<String> {
		assert_eq!(result["isError"], json!(true), "{result:?}");
		result["details"]["problems"].items().iter().map(|p| p.str_or_empty().to_owned()).collect()
	}

	#[tokio::test]
	async fn a_figure_is_stored_with_its_size_and_defaults_and_leaves_the_turn_going() {
		let result = call(r#"<svg viewBox="0 0 640 400"><title>Grid</title><rect x="100" y="50" width="80" height="40" fill="none" stroke="var(--ink)" stroke-width="2"/></svg>"#).await;
		assert!(result.get("terminate").is_none(), "the teacher ends the turn itself");
		assert_eq!(result["content"][1], json!({ "type": "image", "data": base64::encode(FAKE_PNG), "mimeType": "image/png" }));
		let stored = result["details"]["svg"].str_or_empty();
		// The view box is cut to the rectangle, its stroke and the margin.
		assert!(stored.starts_with(r#"<svg width="114" height="74" xmlns="http://www.w3.org/2000/svg" fill="var(--ink)" color="var(--ink)" font-family="system-ui, sans-serif" stroke-linecap="round" stroke-linejoin="round" viewBox="83 33 114 74">"#), "{stored}");
	}

	#[test]
	fn a_wide_figure_is_no_wider_than_the_text_column() {
		let svg = r#"<svg viewBox="0 0 1440 720"><path d="M0 0H1440V720"/></svg>"#;
		assert!(stored(svg, None).starts_with(r#"<svg width="720" height="360" "#));
		assert!(stored(svg, Some([0.0, 0.0, 1440.0, 720.0])).contains(r#" width="720" height="368" "#), "the margin joins the box before it is scaled");
	}

	#[tokio::test]
	async fn a_figure_that_draws_nothing_is_refused() {
		let result = call(r#"<svg viewBox="0 0 100 100"><title>Empty</title><g stroke="var(--ink)"></g></svg>"#).await;
		assert_eq!(problems(&result), ["The figure draws nothing."]);
	}

	#[tokio::test]
	async fn what_the_root_says_is_kept() {
		let result = call(r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" width="320" height="200" fill="none"><path d="M0 0H50" stroke="var(--ink)"/></svg>"#).await;
		let stored = result["details"]["svg"].str_or_empty();
		assert!(stored.starts_with(r#"<svg color="var(--ink)" font-family="system-ui, sans-serif" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" width="320" height="200" "#), "{stored}");
	}

	#[tokio::test]
	async fn every_broken_rule_is_named_in_one_refusal() {
		let result = call(r##"<svg><style>.a { stroke: #333; fill: var(--accent) }</style><text fill="black" style="stroke: red; opacity: 1">a > b</text><circle fill="url(#g)" stroke="none"/></svg>"##).await;
		assert_eq!(problems(&result), ["svg: the root needs viewBox=\"0 0 W H\".", "Colors: only var(--ink), var(--soft), var(--accent), var(--paper) and none. Found: black, red, #333."]);
		assert_eq!(problems(&call("Here it is: <svg viewBox=\"0 0 1 1\"></svg>").await), ["svg: one complete <svg>…</svg> document, nothing before or after it."]);
	}

	#[tokio::test]
	async fn a_figure_that_cannot_be_drawn_is_refused_with_the_reason() {
		let result = call(r#"<svg viewBox="0 0 10 10"><broken></svg>"#).await;
		assert_eq!(problems(&result), ["The figure cannot be drawn: bad svg"]);
	}

	#[test]
	fn the_check_render_has_real_colors() {
		assert_eq!(for_the_check(r#"<g stroke="var(--ink)" fill="var(--paper)"/>"#), r##"<g stroke="#24231f" fill="#ffffff"/>"##);
	}
}
