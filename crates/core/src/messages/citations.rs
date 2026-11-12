//! Source marks in teacher text (src/shared/core/citations.ts). The teacher writes
//! `[[<passage id>]]` or `[[<web address>]]` after a sentence. The server checks each mark and
//! keeps a space file's as `[[<file id>/<place>/<file name>]]`, which still points at the right
//! place after the file's passages are renumbered.

use std::sync::LazyLock;

use gs_base::re::Re;

use super::content_reader::{SpanKind, read_content_spans};

/// A mark as written: a passage id still to be checked, or a source.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CiteMark {
	Passage { passage_id: String },
	File { file_id: String, range: String, name: String },
	Web { url: String },
}

static MARK: LazyLock<Re> = LazyLock::new(|| Re::new(r"\[\[([^[\]\n]{1,400})\]\]", "g"));

fn read_mark(body: &str) -> Option<CiteMark> {
	static PASSAGE: LazyLock<Re> = LazyLock::new(|| Re::new(r"^f_[0-9a-f]{12}:\d+$", ""));
	static FILE: LazyLock<Re> = LazyLock::new(|| Re::new(r"^(f_[0-9a-f]{12})\/([^/]+)\/(.+)$", ""));
	static WEB: LazyLock<Re> = LazyLock::new(|| Re::new(r"^https?:\/\/\S+$", ""));
	if PASSAGE.test(body) {
		return Some(CiteMark::Passage { passage_id: body.to_owned() });
	}
	if let Some(file) = FILE.captures(body) {
		let part = |i| file.get(i).unwrap_or_default();
		return Some(CiteMark::File { file_id: part(1), range: part(2), name: part(3) });
	}
	(WEB.test(body) && url::Url::parse(body).is_ok()).then(|| CiteMark::Web { url: body.to_owned() })
}

/// A space file's source as the mark that is stored. Characters in the name that would end the
/// mark or open code or math become spaces.
pub fn file_cite_mark(file_id: &str, range: &str, name: &str) -> String {
	static UNSAFE: LazyLock<Re> = LazyLock::new(|| Re::new(r"[[\]\n`$]", "g"));
	format!("[[{file_id}/{range}/{}]]", UNSAFE.replace(name, " "))
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
		CiteMark::File { file_id: "f_1a2b3c4d5e6f".into(), range: range.into(), name: name.into() }
	}

	#[test]
	fn reads_each_kind_of_mark() {
		assert_eq!(
			marks(&format!("A {PASSAGE} B {FILE} C {WEB}")),
			[CiteMark::Passage { passage_id: "f_1a2b3c4d5e6f:7".into() }, file("p. 12", "Week 6 slides.pdf"), CiteMark::Web { url: "https://example.com/page".into() }]
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
		assert_eq!(marks(&format!("Real one {PASSAGE} and `{WEB}`")), [CiteMark::Passage { passage_id: "f_1a2b3c4d5e6f:7".into() }]);
	}

	#[test]
	fn the_stored_form_reads_back() {
		assert_eq!(file_cite_mark("f_1a2b3c4d5e6f", "p. 12", "Week 6 slides.pdf"), FILE);
		assert_eq!(marks(&file_cite_mark("f_1a2b3c4d5e6f", "p. 2", "Notes [draft] [[v2]].pdf")), [file("p. 2", "Notes  draft    v2  .pdf")]);
		for name in ["HW$2 notes.pdf", "week`3.pdf"] {
			let text = format!("It frees memory. {} Then $x+1$ and `free`.", file_cite_mark("f_1a2b3c4d5e6f", "p. 3", name));
			assert_eq!(marks(&text).len(), 1, "{name}");
		}
	}

	#[test]
	fn cites_in_words_writes_sources_out() {
		assert_eq!(cites_in_words(&format!("A {FILE} B {WEB} C {PASSAGE}")), "A  (Week 6 slides.pdf, p. 12) B  (https://example.com/page) C ");
		let text = "Nothing here, only [[1,2],[3,4]] and `[[x]]`.";
		assert_eq!(cites_in_words(text), text);
	}
}
