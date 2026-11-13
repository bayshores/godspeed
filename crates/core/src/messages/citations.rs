//! Source marks in teacher text (src/shared/core/citations.ts). The teacher writes
//! `[[<passage id>]]` or `[[<web address>]]` after a sentence, and may quote a few words of the
//! passage: `[[<passage id> "<words>"]]`. The server checks each mark and keeps a space file's as
//! `[[<file id>/<place>/<file name>]]` or `[[<file id>/<place>/<file name>|<words>]]`, which still
//! points at the right place after the file's passages are renumbered.

use std::sync::LazyLock;

use gs_base::re::Re;

use super::content_reader::{SpanKind, read_content_spans};
use super::quote_find::QuoteMiss;

/// A mark as written: a passage id still to be checked, or a source.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CiteMark {
	Passage { passage_id: String, quote: Option<String> },
	File { file_id: String, range: String, name: String, quote: Option<String> },
	Web { url: String },
}

static MARK: LazyLock<Re> = LazyLock::new(|| Re::new(r"\[\[([^[\]\n]{1,400})\]\]", "g"));

fn read_mark(body: &str) -> Option<CiteMark> {
	static PASSAGE: LazyLock<Re> = LazyLock::new(|| Re::new(r#"^(f_[0-9a-f]{12}:\d+)(?: "(.+)")?$"#, ""));
	static FILE: LazyLock<Re> = LazyLock::new(|| Re::new(r"^(f_[0-9a-f]{12})\/([^/]+)\/(.+)$", ""));
	static WEB: LazyLock<Re> = LazyLock::new(|| Re::new(r"^https?:\/\/\S+$", ""));
	if let Some(passage) = PASSAGE.captures(body) {
		return Some(CiteMark::Passage { passage_id: passage.get(1).unwrap_or_default(), quote: passage.get(2) });
	}
	if let Some(file) = FILE.captures(body) {
		let part = |i| file.get(i).unwrap_or_default();
		// A stored name never holds `|`, so the first one starts the quote.
		let (name, quote) = match part(3).split_once('|') {
			Some((name, quote)) => (name.to_owned(), Some(quote.to_owned()).filter(|q| !q.is_empty())),
			None => (part(3), None),
		};
		return Some(CiteMark::File { file_id: part(1), range: part(2), name, quote });
	}
	(WEB.test(body) && url::Url::parse(body).is_ok()).then(|| CiteMark::Web { url: body.to_owned() })
}

/// A space file's source as the mark that is stored, with the words it quotes. Characters in the
/// name that would end the mark, open code or math, or start the quote become spaces.
pub fn file_cite_mark(file_id: &str, range: &str, name: &str, quote: Option<&str>) -> String {
	static UNSAFE: LazyLock<Re> = LazyLock::new(|| Re::new(r"[[\]\n`$|]", "g"));
	let quote = quote.map(|q| format!("|{q}")).unwrap_or_default();
	format!("[[{file_id}/{range}/{}{quote}]]", UNSAFE.replace(name, " "))
}

/// The text with each source mark swapped for what `swap` returns. Code and math are left alone,
/// and so is anything in brackets that isn't a mark.
pub fn replace_cite_marks(text: &str, mut swap: impl FnMut(CiteMark) -> String) -> String {
	if !text.contains("[[") {
		return text.to_owned();
	}
	read_content_spans(text)
		.into_iter()
		.map(|span| match span.kind {
			SpanKind::Prose => MARK.replace_with(&span.raw, |caps| match read_mark(&caps.get(1).unwrap_or_default()) {
				Some(mark) => swap(mark),
				None => caps.as_string(),
			}),
			_ => span.raw,
		})
		.collect()
}

/// A quote taken off a mark when its text was checked; the mark stays without it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DroppedQuote {
	/// The passage id as written, or `<file id>/<place>` for a stored mark.
	pub mark: String,
	pub quote: String,
	pub miss: QuoteMiss,
}

/// Text after its marks were checked, with the marks that pointed at nothing (taken out) and the
/// quotes that did not hold.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CheckedMarks {
	pub text: String,
	pub removed: Vec<String>,
	pub dropped: Vec<DroppedQuote>,
}

/// The text with the quote cut off each passage mark whose quote holds a bracket, backtick or `$`:
/// those keep the mark from being read at all, so the plain mark is checked instead.
pub fn cut_unreadable_quotes(text: &str) -> (String, Vec<DroppedQuote>) {
	static QUOTED: LazyLock<Re> = LazyLock::new(|| Re::new(r#"\[\[(f_[0-9a-f]{12}:\d+) "((?:(?!"\]\])[^\n])*)"\]\]"#, "g"));
	let mut dropped = Vec::new();
	if !text.contains("[[") {
		return (text.to_owned(), dropped);
	}
	let cut = QUOTED.replace_with(text, |caps| {
		let (mark, quote) = (caps.get(1).unwrap_or_default(), caps.get(2).unwrap_or_default());
		if !quote.contains(['[', ']', '`', '$']) {
			return caps.as_string();
		}
		let plain = format!("[[{mark}]]");
		dropped.push(DroppedQuote { mark, quote, miss: QuoteMiss::Unsafe });
		plain
	});
	(cut, dropped)
}

/// The text with each mark written out in words, for readers that show plain text (the Markdown
/// export, fact extraction). A passage id that was never checked reads as nothing.
pub fn cites_in_words(text: &str) -> String {
	replace_cite_marks(text, |mark| match mark {
		CiteMark::Passage { .. } => String::new(),
		CiteMark::File { range, name, .. } => format!(" ({name}, {range})"),
		CiteMark::Web { url } => format!(" ({url})"),
	})
}

#[cfg(test)]
mod tests {
	use super::*;

	const PASSAGE: &str = "[[f_1a2b3c4d5e6f:7]]";
	const FILE: &str = "[[f_1a2b3c4d5e6f/p. 12/Week 6 slides.pdf]]";
	const WEB: &str = "[[https://example.com/page]]";

	fn marks(text: &str) -> Vec<CiteMark> {
		let mut found = Vec::new();
		replace_cite_marks(text, |mark| {
			found.push(mark);
			String::new()
		});
		found
	}

	fn file(range: &str, name: &str) -> CiteMark {
		CiteMark::File { file_id: "f_1a2b3c4d5e6f".into(), range: range.into(), name: name.into(), quote: None }
	}

	#[test]
	fn reads_each_kind_of_mark() {
		assert_eq!(
			marks(&format!("A {PASSAGE} B {FILE} C {WEB}")),
			[CiteMark::Passage { passage_id: "f_1a2b3c4d5e6f:7".into(), quote: None }, file("p. 12", "Week 6 slides.pdf"), CiteMark::Web { url: "https://example.com/page".into() }]
		);
		assert_eq!(replace_cite_marks(&format!("Sorting is n log n. {PASSAGE} Done."), |_| "<X>".into()), "Sorting is n log n. <X> Done.");
		assert_eq!(marks("[[f_1a2b3c4d5e6f/p. 3/a/b.pdf]]"), [file("p. 3", "a/b.pdf")]);
	}

	#[test]
	fn brackets_that_are_not_marks_are_left_alone() {
		for text in ["[[1,2],[3,4]]", "see [[note]]", "[[f_1a2b:7]]", "[[f_1a2b3c4d5e6f]]", "[[ftp://example.com/a]]", "[[https://]]", "[[https://a b]]", "[[f_1a2b3c4d5e6f:7\n]]"] {
			assert_eq!(marks(text), [], "{text}");
			assert_eq!(replace_cite_marks(text, |_| "X".into()), text);
		}
	}

	#[test]
	fn marks_inside_code_and_math_are_not_read() {
		assert_eq!(marks(&format!("Write `{PASSAGE}` like this.")), []);
		assert_eq!(marks(&format!("```\n{PASSAGE}\n```")), []);
		assert_eq!(marks(&format!("The set ${PASSAGE}$ is odd.")), []);
		assert_eq!(marks(&format!("$$\n{PASSAGE}\n$$")), []);
		assert_eq!(marks(&format!("Real one {PASSAGE} and `{WEB}`")), [CiteMark::Passage { passage_id: "f_1a2b3c4d5e6f:7".into(), quote: None }]);
	}

	#[test]
	fn the_stored_form_reads_back() {
		assert_eq!(file_cite_mark("f_1a2b3c4d5e6f", "p. 12", "Week 6 slides.pdf", None), FILE);
		assert_eq!(marks(&file_cite_mark("f_1a2b3c4d5e6f", "p. 2", "Notes [draft] [[v2]].pdf", None)), [file("p. 2", "Notes  draft    v2  .pdf")]);
		for name in ["HW$2 notes.pdf", "week`3.pdf"] {
			let text = format!("It frees memory. {} Then $x+1$ and `free`.", file_cite_mark("f_1a2b3c4d5e6f", "p. 3", name, None));
			assert_eq!(marks(&text).len(), 1, "{name}");
		}
	}

	#[test]
	fn a_mark_may_quote_words() {
		let quoted = |range: &str, name: &str, quote: &str| CiteMark::File { file_id: "f_1a2b3c4d5e6f".into(), range: range.into(), name: name.into(), quote: Some(quote.into()) };
		assert_eq!(marks(r#"Fit. [[f_1a2b3c4d5e6f:7 "degree 12"]]"#), [CiteMark::Passage { passage_id: "f_1a2b3c4d5e6f:7".into(), quote: Some("degree 12".into()) }]);
		assert_eq!(marks(r#"[[f_1a2b3c4d5e6f:7 "printf("%d", x)"]]"#), [CiteMark::Passage { passage_id: "f_1a2b3c4d5e6f:7".into(), quote: Some(r#"printf("%d", x)"#.into()) }]);
		let stored = file_cite_mark("f_1a2b3c4d5e6f", "p. 14", "Lecture 6.pdf", Some("degree 12"));
		assert_eq!(stored, "[[f_1a2b3c4d5e6f/p. 14/Lecture 6.pdf|degree 12]]");
		assert_eq!(marks(&stored), [quoted("p. 14", "Lecture 6.pdf", "degree 12")]);
		assert_eq!(marks(&file_cite_mark("f_1a2b3c4d5e6f", "lines 10–21", "a|b.c", Some("x || y"))), [quoted("lines 10–21", "a b.c", "x || y")]);
		assert_eq!(cites_in_words(&format!("Fit {stored}.")), "Fit  (Lecture 6.pdf, p. 14).");
		for text in [r#"[[f_1a2b3c4d5e6f:7 ""]]"#, r#"[[f_1a2b3c4d5e6f:7 degree 12]]"#, r#"[[f_1a2b3c4d5e6f:7  "degree 12"]]"#] {
			assert_eq!(marks(text), [], "{text}");
		}
	}

	#[test]
	fn a_quote_that_breaks_the_mark_is_cut_off() {
		let unsafe_quote = |quote: &str| DroppedQuote { mark: "f_1a2b3c4d5e6f:7".into(), quote: quote.into(), miss: QuoteMiss::Unsafe };
		let text = r#"Index. [[f_1a2b3c4d5e6f:7 "a[i] = 0"]] Cost [[f_1a2b3c4d5e6f:7 "costs $5 and $6"]] and [[f_1a2b3c4d5e6f:7 "a b"]] with $x$."#;
		let (cut, dropped) = cut_unreadable_quotes(text);
		assert_eq!(cut, r#"Index. [[f_1a2b3c4d5e6f:7]] Cost [[f_1a2b3c4d5e6f:7]] and [[f_1a2b3c4d5e6f:7 "a b"]] with $x$."#);
		assert_eq!(dropped, [unsafe_quote("a[i] = 0"), unsafe_quote("costs $5 and $6")]);
		// A quote never runs past the end of its own mark.
		let two = r#"[[f_1a2b3c4d5e6f:7 "a b"]] costs $5 [[f_1a2b3c4d5e6f:7 "c d"]]"#;
		assert_eq!(cut_unreadable_quotes(two), (two.to_owned(), vec![]));
	}

	#[test]
	fn cites_in_words_writes_sources_out() {
		assert_eq!(cites_in_words(&format!("A {FILE} B {WEB} C {PASSAGE}")), "A  (Week 6 slides.pdf, p. 12) B  (https://example.com/page) C ");
		let text = "Nothing here, only [[1,2],[3,4]] and `[[x]]`.";
		assert_eq!(cites_in_words(text), text);
	}
}
