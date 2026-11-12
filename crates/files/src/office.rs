//! Word (.docx) and PowerPoint (.pptx) files to text. Both are zip archives of XML; the text is
//! pulled out with the same patterns the TypeScript uses (no layout, no images). Slides come in
//! presentation order, headed "--- Slide N ---" like PDF pages, with each slide's notes after it.

use std::path::Path;
use std::sync::LazyLock;

use gs_base::posix;
use gs_base::re::Re;
use gs_base::text::trim;
use gs_json::lone;

use crate::ioerr::read_file;
use crate::zipfile::{NOT_OFFICE, Zip};

static ENTITY: LazyLock<Re> = LazyLock::new(|| Re::new(r"&(#x[0-9a-f]+|#\d+|\w+);", "gi"));
static WORD_RUN: LazyLock<Re> = LazyLock::new(|| Re::new(r"<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:(?:br|cr)\b[^>]*>|<\/w:p>", "g"));
static SLIDE_RUN: LazyLock<Re> = LazyLock::new(|| Re::new(r"<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>|<a:br\b[^>]*>|<\/a:p>", "g"));
static BLANK_BEFORE_BREAK: LazyLock<Re> = LazyLock::new(|| Re::new(r"[ \t]+\n", "g"));
static BLANK_LINES: LazyLock<Re> = LazyLock::new(|| Re::new(r"\n{3,}", "g"));
static RELATIONSHIP: LazyLock<Re> = LazyLock::new(|| Re::new(r"<Relationship\b[^>]*>", "g"));
static REL_ID: LazyLock<Re> = LazyLock::new(|| Re::new(r#"\bId="([^"]+)""#, ""));
static REL_TARGET: LazyLock<Re> = LazyLock::new(|| Re::new(r#"\bTarget="([^"]+)""#, ""));
static SLIDE_ID: LazyLock<Re> = LazyLock::new(|| Re::new(r#"<p:sldId\b[^>]*\br:id="([^"]+)""#, "g"));
static SLIDE_FILE: LazyLock<Re> = LazyLock::new(|| Re::new(r"^ppt\/slides\/slide\d+\.xml$", ""));
static SLIDE_NUMBER: LazyLock<Re> = LazyLock::new(|| Re::new(r"slide(\d+)\.xml$", ""));
static FIELD: LazyLock<Re> = LazyLock::new(|| Re::new(r"<a:fld\b[\s\S]*?<\/a:fld>", "g"));

/// The TypeScript looks entities up on a plain object, so names that live on `Object.prototype`
/// answer with that function's source text.
fn entity_text(name: &str) -> Option<&'static str> {
	Some(match name {
		"amp" => "&",
		"lt" => "<",
		"gt" => ">",
		"quot" => "\"",
		"apos" => "'",
		"__proto__" => "[object Object]",
		"constructor" => "function Object() { [native code] }",
		"__defineGetter__" => "function __defineGetter__() { [native code] }",
		"__defineSetter__" => "function __defineSetter__() { [native code] }",
		"hasOwnProperty" => "function hasOwnProperty() { [native code] }",
		"__lookupGetter__" => "function __lookupGetter__() { [native code] }",
		"__lookupSetter__" => "function __lookupSetter__() { [native code] }",
		"isPrototypeOf" => "function isPrototypeOf() { [native code] }",
		"propertyIsEnumerable" => "function propertyIsEnumerable() { [native code] }",
		"toString" => "function toString() { [native code] }",
		"valueOf" => "function valueOf() { [native code] }",
		"toLocaleString" => "function toLocaleString() { [native code] }",
		_ => return None,
	})
}

/// The code point a numeric reference names, or None past U+10FFFF.
fn code_point(code: &str) -> Option<u32> {
	let (digits, radix) = match code.as_bytes()[1] {
		b'x' | b'X' => (&code[2..], 16),
		_ => (&code[1..], 10),
	};
	u32::from_str_radix(digits, radix).ok().filter(|&n| n <= 0x10ffff)
}

/// A character reference, or the text as it was when it is not one we know.
fn decode_xml(text: &str) -> String {
	ENTITY.replace_with(text, |m| {
		let whole = m.get(0).unwrap_or_default();
		let code = m.get(1).unwrap_or_default();
		if code.starts_with('#') {
			return match code_point(&code) {
				Some(n) => char::from_u32(n).map_or_else(|| lone::from_utf16(&[n as u16]), String::from),
				None => whole,
			};
		}
		entity_text(&code).map_or(whole, str::to_owned)
	})
}

/// Text runs in reading order: breaks and tabs keep their spacing, paragraphs end a line.
fn xml_text(xml: &str, run: &Re) -> String {
	let mut out = String::new();
	for m in run.captures_iter(xml) {
		if let Some(text) = m.get(1) {
			out.push_str(&decode_xml(&text));
		} else if m.as_string().contains("tab") {
			out.push('\t');
		} else {
			out.push('\n');
		}
	}
	let out = BLANK_BEFORE_BREAK.replace(&out, "\n");
	trim(&BLANK_LINES.replace(&out, "\n\n")).to_owned()
}

fn docx_text(zip: &Zip) -> Result<String, String> {
	let doc = zip.read_text("word/document.xml")?.ok_or(NOT_OFFICE)?;
	Ok(xml_text(&doc, &WORD_RUN))
}

/// Relationship targets by id, resolved against the part's folder (an id keeps its first place).
fn rel_targets(zip: &Zip, part: &str) -> Result<Vec<(String, String)>, String> {
	let folder = posix::dirname(part);
	let rels = zip.read_text(&posix::join(&[&folder, "_rels", &format!("{}.rels", posix::basename(part))]))?;
	let mut out: Vec<(String, String)> = Vec::new();
	for m in RELATIONSHIP.captures_iter(&rels.unwrap_or_default()) {
		let tag = m.as_string();
		let (Some(id), Some(target)) = (REL_ID.captures(&tag).and_then(|c| c.get(1)), REL_TARGET.captures(&tag).and_then(|c| c.get(1))) else { continue };
		let target = posix::normalize(&posix::join(&[&folder, &target]));
		match out.iter_mut().find(|(known, _)| *known == id) {
			Some(slot) => slot.1 = target,
			None => out.push((id, target)),
		}
	}
	Ok(out)
}

/// `Number(...)` of the digits in a slide file's name, 0 when there are none.
fn slide_number(name: &str) -> f64 {
	SLIDE_NUMBER.captures(name).and_then(|c| c.get(1)).and_then(|n| n.parse().ok()).unwrap_or(0.0)
}

/// The slide parts in presentation order (file-number order when the presentation doesn't list them).
fn slide_parts(zip: &Zip) -> Result<Vec<String>, String> {
	let presentation = zip.read_text("ppt/presentation.xml")?.unwrap_or_default();
	let targets = rel_targets(zip, "ppt/presentation.xml")?;
	let listed: Vec<String> = SLIDE_ID
		.captures_iter(&presentation)
		.into_iter()
		.filter_map(|m| {
			let id = m.get(1)?;
			targets.iter().find(|(known, _)| *known == id).map(|(_, target)| target.clone())
		})
		.filter(|target| !target.is_empty() && zip.has(target))
		.collect();
	if !listed.is_empty() {
		return Ok(listed);
	}
	let mut files: Vec<&str> = zip.names().filter(|name| SLIDE_FILE.test(name)).collect();
	files.sort_by(|a, b| slide_number(a).total_cmp(&slide_number(b)));
	Ok(files.into_iter().map(str::to_owned).collect())
}

fn pptx_text(zip: &Zip) -> Result<String, String> {
	let slides = slide_parts(zip)?;
	if slides.is_empty() && !zip.has("ppt/presentation.xml") {
		return Err(NOT_OFFICE.to_owned());
	}
	let mut texts = Vec::new();
	for (i, part) in slides.iter().enumerate() {
		let body = xml_text(&zip.read_text(part)?.unwrap_or_default(), &SLIDE_RUN);
		let notes_part = rel_targets(zip, part)?.into_iter().map(|(_, target)| target).find(|target| target.contains("/notesSlides/"));
		let notes = match notes_part {
			// The notes page repeats the slide number as a field: leave it out.
			Some(notes_part) => xml_text(&FIELD.replace(&zip.read_text(&notes_part)?.unwrap_or_default(), ""), &SLIDE_RUN),
			None => String::new(),
		};
		let notes = if notes.is_empty() { notes } else { format!("Notes:\n{notes}") };
		let lines = [format!("--- Slide {} ---", i + 1), body, notes];
		texts.push(lines.into_iter().filter(|l| !l.is_empty()).collect::<Vec<_>>().join("\n"));
	}
	Ok(texts.join("\n\n"))
}

/// A .docx or .pptx file's text. The error is a plain message for files that aren't really
/// Word/PowerPoint files or are password-protected.
pub fn office_text(file: &Path) -> Result<String, String> {
	let zip = Zip::open(read_file(file)?)?;
	let name = file.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
	if posix::extname(&name).to_lowercase() == ".pptx" { pptx_text(&zip) } else { docx_text(&zip) }
}
