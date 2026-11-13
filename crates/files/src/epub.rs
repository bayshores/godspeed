//! EPUB books to text. An EPUB is a zip: `META-INF/container.xml` names the package file, whose
//! spine lists the chapters (XHTML) in reading order. Each chapter with text is headed
//! "--- Chapter N ---" like PDF pages, with its first heading as its first line. Headings,
//! paragraphs and list items are lines; scripts, styles and navigation are left out.

use std::path::Path;
use std::sync::LazyLock;

use gs_base::posix;
use gs_base::re::Re;
use gs_base::text::{from_utf8_lossy, trim, trim_end};

use crate::entities::decode_entities;
use crate::ioerr::read_file;
use crate::zipfile::Zip;

const NOT_EPUB: &str = "This file can't be opened as an EPUB book. Save it again as .epub or PDF.";
const COPY_PROTECTED: &str = "This book is copy-protected (DRM), so its text can't be read. Add a copy without DRM, or a PDF.";
/// Most all chapters together may unpack to: the zip reader caps one part, but a spine can list
/// the same big part again and again.
const MAX_BOOK_BYTES: usize = 128 * 1024 * 1024;
/// Font obfuscation (IDPF's and Adobe's) scrambles only the fonts; the text stays readable.
const FONT_OBFUSCATION: [&str; 2] = ["http://www.idpf.org/2008/embedding", "http://ns.adobe.com/pdf/enc#RC"];
/// Elements that hold no reading text.
const SKIPPED: [&str; 7] = ["head", "script", "style", "nav", "template", "annotation", "annotation-xml"];
/// Elements that start and end a line.
const BLOCKS: [&str; 24] = [
	"p", "div", "li", "dt", "dd", "blockquote", "tr", "td", "th", "table", "caption", "section", "article", "aside", "header", "footer", "figure", "figcaption", "ul", "ol", "dl", "hr", "br", "body",
];

static ROOTFILE: LazyLock<Re> = LazyLock::new(|| Re::new(r"<(?:\w+:)?rootfile\b[^>]*>", ""));
static ITEM: LazyLock<Re> = LazyLock::new(|| Re::new(r"<(?:\w+:)?item\b[^>]*>", "g"));
static ITEMREF: LazyLock<Re> = LazyLock::new(|| Re::new(r"<(?:\w+:)?itemref\b[^>]*>", "g"));
static ENCRYPTION_METHOD: LazyLock<Re> = LazyLock::new(|| Re::new(r"<(?:\w+:)?EncryptionMethod\b[^>]*>", "g"));

/// HTML's named characters that books use most. XML itself knows only the first five.
fn named_entity(name: &str) -> Option<&'static str> {
	Some(match name {
		"amp" => "&",
		"lt" => "<",
		"gt" => ">",
		"quot" => "\"",
		"apos" => "'",
		"nbsp" => " ",
		"shy" => "",
		"ndash" => "\u{2013}",
		"mdash" => "\u{2014}",
		"hellip" => "\u{2026}",
		"lsquo" => "\u{2018}",
		"rsquo" => "\u{2019}",
		"ldquo" => "\u{201c}",
		"rdquo" => "\u{201d}",
		"laquo" => "\u{ab}",
		"raquo" => "\u{bb}",
		"copy" => "\u{a9}",
		"reg" => "\u{ae}",
		"trade" => "\u{2122}",
		"deg" => "\u{b0}",
		"times" => "\u{d7}",
		"divide" => "\u{f7}",
		"minus" => "\u{2212}",
		"plusmn" => "\u{b1}",
		"middot" => "\u{b7}",
		"bull" => "\u{2022}",
		"sect" => "\u{a7}",
		"para" => "\u{b6}",
		"euro" => "\u{20ac}",
		"pound" => "\u{a3}",
		_ => return None,
	})
}

fn decode_html(text: &str) -> String {
	decode_entities(text, named_entity)
}

/// An attribute's value in a tag, entities decoded.
fn attr(tag: &str, name: &str) -> Option<String> {
	let m = Re::new(&format!(r#"\s{name}\s*=\s*(?:"([^"]*)"|'([^']*)')"#), "").captures(tag)?;
	m.get(1).or_else(|| m.get(2)).map(|value| decode_html(&value))
}

/// `%XX` escapes decoded (hrefs in the package are URLs).
fn percent_decoded(href: &str) -> String {
	let bytes = href.as_bytes();
	let mut out = Vec::with_capacity(bytes.len());
	let mut i = 0;
	while i < bytes.len() {
		let hex = href.get(i + 1..i + 3).filter(|h| h.bytes().all(|c| c.is_ascii_hexdigit()));
		match hex {
			Some(hex) if bytes[i] == b'%' => {
				out.push(u8::from_str_radix(hex, 16).unwrap_or_default());
				i += 3;
			}
			_ => {
				out.push(bytes[i]);
				i += 1;
			}
		}
	}
	from_utf8_lossy(&out)
}

/// An href from the package as a name inside the archive, without its #fragment; None when it
/// climbs out of the archive.
fn in_archive(folder: &str, href: &str) -> Option<String> {
	let href = href.split('#').next().unwrap_or_default();
	let name = posix::normalize(&posix::join(&[folder, &percent_decoded(href)]));
	(name != ".." && !name.starts_with("../")).then_some(name)
}

/// True when `META-INF/encryption.xml` locks more than fonts.
fn is_copy_protected(zip: &Zip) -> Result<bool, String> {
	let Some(xml) = zip.read_text("META-INF/encryption.xml")? else { return Ok(false) };
	Ok(ENCRYPTION_METHOD.captures_iter(&xml).iter().any(|m| attr(&m.as_string(), "Algorithm").is_none_or(|algorithm| !FONT_OBFUSCATION.contains(&algorithm.as_str()))))
}

/// The chapter parts in spine order, as names inside the archive.
fn spine_parts(zip: &Zip) -> Result<Vec<String>, String> {
	let container = zip.read_text("META-INF/container.xml")?.ok_or(NOT_EPUB)?;
	let package = ROOTFILE.captures(&container).and_then(|m| attr(&m.as_string(), "full-path")).and_then(|path| in_archive("", &path)).ok_or(NOT_EPUB)?;
	let opf = zip.read_text(&package)?.ok_or(NOT_EPUB)?;
	let folder = posix::dirname(&package);
	let pages: Vec<(String, String)> = ITEM
		.captures_iter(&opf)
		.iter()
		.filter_map(|m| {
			let tag = m.as_string();
			if !matches!(attr(&tag, "media-type")?.as_str(), "application/xhtml+xml" | "text/html") {
				return None;
			}
			Some((attr(&tag, "id")?, in_archive(&folder, &attr(&tag, "href")?)?))
		})
		.collect();
	let parts: Vec<String> = ITEMREF
		.captures_iter(&opf)
		.iter()
		.filter_map(|m| {
			let idref = attr(&m.as_string(), "idref")?;
			pages.iter().find(|(id, _)| *id == idref).map(|(_, name)| name.clone())
		})
		.filter(|name| zip.has(name))
		.collect();
	if parts.is_empty() { Err(NOT_EPUB.to_owned()) } else { Ok(parts) }
}

/// One chapter's lines as they are read.
#[derive(Default)]
struct Lines {
	lines: Vec<String>,
	line: String,
	/// Where the first heading's line is.
	title: Option<usize>,
	heading: usize,
	pre: usize,
}

impl Lines {
	/// Text as HTML shows it: runs of white space are one space, except inside <pre>.
	fn push(&mut self, text: &str) {
		if self.pre > 0 {
			let mut rows = text.split('\n');
			self.line.push_str(rows.next().unwrap_or_default());
			for row in rows {
				self.end_line();
				self.line.push_str(row);
			}
			return;
		}
		for c in text.chars() {
			if !c.is_whitespace() {
				self.line.push(c);
			} else if !self.line.ends_with(' ') {
				self.line.push(' ');
			}
		}
	}

	fn end_line(&mut self) {
		let line = if self.pre > 0 { trim_end(&self.line) } else { trim(&self.line) };
		if !line.is_empty() {
			if self.heading > 0 && self.title.is_none() {
				self.title = Some(self.lines.len());
			}
			self.lines.push(line.to_owned());
		}
		self.line.clear();
	}
}

/// Where the tag that `s` starts with ends (its '>'), past quoted attribute values.
fn tag_end(s: &str) -> usize {
	let mut quote = None;
	for (i, b) in s.bytes().enumerate().skip(1) {
		match (quote, b) {
			(Some(q), _) if b == q => quote = None,
			(Some(_), _) => {}
			(None, b'"' | b'\'') => quote = Some(b),
			(None, b'>') => return i,
			_ => {}
		}
	}
	s.len()
}

/// A tag's lower-case name without its namespace prefix ("m:math" is "math").
fn tag_name(tag: &str) -> String {
	let name = tag.trim_start_matches('/').split(|c: char| c.is_whitespace() || c == '/').next().unwrap_or_default();
	name.rsplit(':').next().unwrap_or_default().to_ascii_lowercase()
}

/// A chapter's XHTML as lines of text, its first heading first.
fn chapter_text(xhtml: &str) -> String {
	let doc = xhtml.replace("\r\n", "\n");
	let mut out = Lines::default();
	// The skipped element being passed over, and how deep in it we are.
	let mut skip: Option<(String, usize)> = None;
	let mut rest = doc.as_str();
	while let Some(lt) = rest.find('<') {
		if skip.is_none() {
			out.push(&decode_html(&rest[..lt]));
		}
		rest = &rest[lt..];
		if let Some(body) = rest.strip_prefix("<!--") {
			rest = body.find("-->").map_or("", |end| &body[end + 3..]);
			continue;
		}
		if let Some(body) = rest.strip_prefix("<![CDATA[") {
			let end = body.find("]]>").unwrap_or(body.len());
			if skip.is_none() {
				out.push(&body[..end]);
			}
			rest = body.get(end + 3..).unwrap_or_default();
			continue;
		}
		let end = tag_end(rest);
		let tag = &rest[1..end];
		rest = rest.get(end + 1..).unwrap_or_default();
		if tag.starts_with('!') || tag.starts_with('?') {
			continue;
		}
		let (name, closing, empty) = (tag_name(tag), tag.starts_with('/'), tag.ends_with('/'));
		if let Some((skipped, depth)) = &mut skip {
			if name == *skipped && !empty {
				*depth = if closing { *depth - 1 } else { *depth + 1 };
				if *depth == 0 {
					skip = None;
				}
			}
			continue;
		}
		if SKIPPED.contains(&name.as_str()) {
			if !closing && !empty {
				skip = Some((name, 1));
			}
			continue;
		}
		let heading = matches!(name.as_str(), "h1" | "h2" | "h3" | "h4" | "h5" | "h6");
		if heading || name == "pre" || BLOCKS.contains(&name.as_str()) {
			out.end_line();
		}
		let depth = if heading { &mut out.heading } else if name == "pre" { &mut out.pre } else { continue };
		if closing {
			*depth = depth.saturating_sub(1);
		} else if !empty {
			*depth += 1;
		}
	}
	if skip.is_none() {
		out.push(&decode_html(rest));
	}
	out.end_line();
	if let Some(at) = out.title {
		let title = out.lines.remove(at);
		out.lines.insert(0, title);
	}
	out.lines.join("\n")
}

fn book_text(buf: Vec<u8>) -> Result<String, String> {
	let zip = Zip::open(buf, NOT_EPUB)?;
	if is_copy_protected(&zip)? {
		return Err(COPY_PROTECTED.to_owned());
	}
	let mut unpacked = 0;
	let mut chapters = Vec::new();
	for part in spine_parts(&zip)? {
		let Some(xhtml) = zip.read_text(&part)? else { continue };
		unpacked += xhtml.len();
		if unpacked > MAX_BOOK_BYTES {
			return Err(NOT_EPUB.to_owned());
		}
		// A cover picture or an empty page is not a chapter.
		let text = chapter_text(&xhtml);
		if !text.is_empty() {
			chapters.push(format!("--- Chapter {} ---\n{text}", chapters.len() + 1));
		}
	}
	Ok(chapters.join("\n\n"))
}

/// An .epub file's text. The error is a plain message for files that aren't really EPUB books
/// or are copy-protected.
pub fn epub_text(file: &Path) -> Result<String, String> {
	book_text(read_file(file)?)
}

#[cfg(test)]
mod tests {
	use super::*;

	/// A zip of stored (not compressed) files, in this order.
	fn zip_of(files: &[(&str, &str)]) -> Vec<u8> {
		let (mut out, mut central) = (Vec::new(), Vec::new());
		for (name, body) in files {
			let (name, body) = (name.as_bytes(), body.as_bytes());
			let at = u32::try_from(out.len()).unwrap();
			let name_len = u16::try_from(name.len()).unwrap().to_le_bytes();
			out.extend(b"PK\x03\x04");
			out.extend([0; 22]);
			out.extend(name_len);
			out.extend([0; 2]);
			out.extend(name);
			out.extend(body);
			central.extend(b"PK\x01\x02");
			central.extend([0; 16]);
			central.extend(u32::try_from(body.len()).unwrap().to_le_bytes());
			central.extend([0; 4]);
			central.extend(name_len);
			central.extend([0; 12]);
			central.extend(at.to_le_bytes());
			central.extend(name);
		}
		let count = u16::try_from(files.len()).unwrap().to_le_bytes();
		let (central_at, central_len) = (u32::try_from(out.len()).unwrap(), u32::try_from(central.len()).unwrap());
		out.extend(central);
		out.extend(b"PK\x05\x06");
		out.extend([0; 4]);
		out.extend(count);
		out.extend(count);
		out.extend(central_len.to_le_bytes());
		out.extend(central_at.to_le_bytes());
		out.extend([0; 2]);
		out
	}

	const CONTAINER: &str = r#"<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>"#;
	const PACKAGE: &str = r#"<package><manifest>
		<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
		<item id="one" href="text/Chapter%201.xhtml" media-type="application/xhtml+xml"/>
		<item id='two' href='text/two.xhtml#top' media-type='application/xhtml+xml'/>
		<item id="css" href="style.css" media-type="text/css"/>
		<item id="out" href="../../secret.xhtml" media-type="application/xhtml+xml"/>
	</manifest><spine><itemref idref="cover"/><itemref idref="one"/><itemref idref="css"/><itemref idref="out"/><itemref idref="two"/></spine></package>"#;
	const COVER: &str = r#"<html><head><title>Cover</title></head><body><div><img src="cover.png" alt="Cover"/></div></body></html>"#;
	const ONE: &str = "<html xmlns=\"http://www.w3.org/1999/xhtml\"><head><title>One</title><style>p { color: red }</style></head>\r\n<body>\
		<nav epub:type=\"toc\"><ol><li>Skip me</li></ol></nav>\
		<p class=\"epigraph\">An epigraph &amp; a quote</p>\
		<h1 id=\"c1\">Sets &#x26; <em>Logic</em></h1>\
		<p>A set   is a\n collection&nbsp;of things&#8230; <script>alert(1)</script>like <m:math><m:mi>x</m:mi><m:mo>&#x2208;</m:mo><m:mi>A</m:mi><m:annotation encoding=\"application/x-tex\">x \\in A</m:annotation></m:math>.</p>\
		<!-- a <p>comment</p> -->\
		<ul><li>First</li><li>Second &unknown; &lt;b&gt;</li></ul>\
		<pre>let x = 1;\n  x + 1</pre>\
		<h2>A smaller heading</h2></body></html>";
	const TWO: &str = "<html><body><p>Chapter two text.</p></body></html>";

	fn book(extra: &[(&str, &str)]) -> Vec<u8> {
		// Zip order differs from spine order: two comes before one.
		let mut files = vec![("mimetype", "application/epub+zip"), ("META-INF/container.xml", CONTAINER), ("OEBPS/content.opf", PACKAGE), ("OEBPS/text/two.xhtml", TWO), ("OEBPS/cover.xhtml", COVER), ("OEBPS/text/Chapter 1.xhtml", ONE), ("secret.xhtml", "<p>outside</p>")];
		files.extend_from_slice(extra);
		zip_of(&files)
	}

	#[test]
	fn chapters_come_in_spine_order_as_lines() {
		let text = book_text(book(&[])).unwrap();
		assert_eq!(
			text,
			"--- Chapter 1 ---\nSets & Logic\nAn epigraph & a quote\nA set is a collection of things\u{2026} like x\u{2208}A.\nFirst\nSecond &unknown; <b>\nlet x = 1;\n  x + 1\nA smaller heading\n\n--- Chapter 2 ---\nChapter two text."
		);
	}

	#[test]
	fn font_obfuscation_is_fine_but_drm_is_refused() {
		let fonts = r#"<encryption><EncryptedData><EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/><CipherData><CipherReference URI="OEBPS/font.otf"/></CipherData></EncryptedData></encryption>"#;
		assert!(book_text(book(&[("META-INF/encryption.xml", fonts)])).unwrap().starts_with("--- Chapter 1 ---"));
		let drm = r#"<enc:encryption xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/><enc:CipherData><enc:CipherReference URI="OEBPS/text/two.xhtml"/></enc:CipherData></enc:EncryptedData></enc:encryption>"#;
		assert_eq!(book_text(book(&[("META-INF/encryption.xml", drm)])), Err(COPY_PROTECTED.to_owned()));
	}

	#[test]
	fn a_zip_that_is_not_a_book_is_refused() {
		let refused = Err(NOT_EPUB.to_owned());
		assert_eq!(book_text(zip_of(&[("notes.txt", "hello")])), refused);
		assert_eq!(book_text(b"plain text, not a zip".to_vec()), refused);
		assert_eq!(book_text(zip_of(&[("META-INF/container.xml", CONTAINER)])), refused);
		let empty_spine = zip_of(&[("META-INF/container.xml", CONTAINER), ("OEBPS/content.opf", "<package><manifest/><spine/></package>")]);
		assert_eq!(book_text(empty_spine), refused);
	}

	#[test]
	fn hrefs_stay_inside_the_archive() {
		assert_eq!(in_archive("OEBPS", "text/a%20b.xhtml#x").as_deref(), Some("OEBPS/text/a b.xhtml"));
		assert_eq!(in_archive(".", "a.xhtml").as_deref(), Some("a.xhtml"));
		assert_eq!(in_archive("OEBPS", "../../etc/passwd"), None);
		assert_eq!(percent_decoded("%zz%4"), "%zz%4");
	}
}
