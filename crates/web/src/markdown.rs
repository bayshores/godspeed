//! A web page's readable part as markdown (htmlToMarkdown in web.ts): Readability, then Turndown's
//! rules with atx headings and fenced code.

use dom_smoothie::Readability;
use gs_base::text;
use htmd::element_handler::{HandlerResult, Handlers};
use htmd::{Element, HtmlToMarkdown};

/// Shorter than this many characters is not worth returning.
pub const MIN_USEFUL_CONTENT: usize = 200;

pub struct Extracted {
	pub title: String,
	pub content: String,
}

pub fn html_to_markdown(html: &str) -> Option<Extracted> {
	let article = Readability::new(html, None, None).ok()?.parse().ok()?;
	if article.content.is_empty() {
		return None;
	}
	let content = turndown().convert(&article.content).ok()?;
	if text::len16(text::trim(&content)) < MIN_USEFUL_CONTENT {
		return None;
	}
	Some(Extracted { title: article.title, content })
}

/// htmd with Turndown's differences: `_` for emphasis, inline code with its outer spaces moved out,
/// paragraphs and Turndown's other block tags without spaces at their ends, the table family as
/// plain blocks (Turndown has no table rule without its GFM plugin), and `details` and `summary`
/// as plain text.
fn turndown() -> HtmlToMarkdown {
	HtmlToMarkdown::builder()
		.add_handler(vec!["i", "em"], emphasis)
		.add_handler(vec!["code"], code)
		.add_handler(vec!["p", "table", "caption", "thead", "tbody", "tfoot", "tr", "th", "td", "audio", "canvas", "hgroup", "noscript", "output", "address", "article", "aside", "center", "dd", "dir", "div", "dl", "dt", "fieldset", "figcaption", "figure", "footer", "form", "frameset", "header", "main", "menu", "nav", "noframes", "section"], block)
		.add_handler(vec!["details", "summary"], inline)
		.build()
}

fn emphasis(handlers: &dyn Handlers, element: Element) -> Option<HandlerResult> {
	let inner = handlers.walk_children(element.node).content;
	let content = inner.trim();
	if content.is_empty() {
		return None;
	}
	let lead = &inner[..inner.len() - inner.trim_start().len()];
	let tail = &inner[inner.trim_end().len()..];
	Some(format!("{lead}_{content}_{tail}").into())
}

/// Turndown's inline code: whitespace runs collapsed, the spaces at the ends moved outside the
/// backticks (so `<code>name </code>word` keeps its word break), and the shortest run of
/// backticks the code does not hold as the delimiter. Code blocks stay with htmd.
fn code(handlers: &dyn Handlers, element: Element) -> Option<HandlerResult> {
	let inner = handlers.walk_children(element.node).content;
	let printed = handlers.fallback(element)?;
	// Only a block's closing fence sits on a line of its own.
	if printed.content.trim_end_matches('`').ends_with('\n') {
		return Some(printed);
	}
	let mut collapsed = String::with_capacity(inner.len());
	for c in inner.chars() {
		if matches!(c, ' ' | '\t' | '\r' | '\n') {
			if !collapsed.ends_with(' ') {
				collapsed.push(' ');
			}
		} else {
			collapsed.push(c);
		}
	}
	let content = text::trim(&collapsed);
	let lead = &collapsed[..collapsed.len() - text::trim_start(&collapsed).len()];
	let tail = &collapsed[text::trim_end(&collapsed).len()..];
	if content.is_empty() {
		return Some(lead.to_owned().into());
	}
	let runs: Vec<&str> = content.split(|c| c != '`').filter(|run| !run.is_empty()).collect();
	let mut delimiter = "`".to_owned();
	while runs.contains(&delimiter.as_str()) {
		delimiter.push('`');
	}
	let pad = if content.starts_with('`') || content.ends_with('`') { " " } else { "" };
	Some(format!("{lead}{delimiter}{pad}{content}{pad}{delimiter}{tail}").into())
}

fn block(handlers: &dyn Handlers, element: Element) -> Option<HandlerResult> {
	let content = handlers.walk_children(element.node).content;
	Some(format!("\n\n{}\n\n", content.trim_matches(['\n', ' '])).into())
}

fn inline(handlers: &dyn Handlers, element: Element) -> Option<HandlerResult> {
	Some(handlers.walk_children(element.node))
}
