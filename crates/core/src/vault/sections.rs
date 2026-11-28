//! A note's body split into the sections godspeed writes: the recall callout, "In short", "My
//! words", "Mistakes to remember", "Related" and the "Check yourself" callout. Text outside
//! them (the learner's own headings, notes before the first section) is kept as it is.

use gs_base::hash::sha256_text;

use super::frontmatter::{line_text, normal};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
	Recall,
	InShort,
	MyWords,
	Mistakes,
	Related,
	Check,
	Other,
}

impl Kind {
	/// The name a result gives for a section the learner owns.
	pub fn name(self) -> &'static str {
		match self {
			Kind::Recall => "recall",
			Kind::InShort => "in short",
			Kind::MyWords => "my words",
			Kind::Mistakes => "mistakes to remember",
			Kind::Related => "related",
			Kind::Check => "check yourself",
			Kind::Other => "other",
		}
	}

	/// The place in a note, so a missing section goes before the first one that comes later.
	fn rank(self) -> Option<u8> {
		match self {
			Kind::Recall => Some(0),
			Kind::InShort => Some(1),
			Kind::MyWords => Some(2),
			Kind::Mistakes => Some(3),
			Kind::Related => Some(4),
			Kind::Check => Some(5),
			Kind::Other => None,
		}
	}
}

#[derive(Debug, Clone)]
struct Chunk {
	kind: Kind,
	text: String,
}

#[derive(Debug, Clone)]
pub struct Sections {
	chunks: Vec<Chunk>,
	eol: &'static str,
}

/// The section a line starts, if any. A callout starts one only at the top of a quote block.
fn starts(line: &str, after_quote: bool) -> Option<Kind> {
	let text = line_text(line);
	if let Some(heading) = text.strip_prefix("## ") {
		return Some(match heading.trim().to_lowercase().as_str() {
			"in short" => Kind::InShort,
			"my words" => Kind::MyWords,
			"mistakes to remember" => Kind::Mistakes,
			"related" => Kind::Related,
			_ => Kind::Other,
		});
	}
	if !text.starts_with('>') || after_quote {
		return None;
	}
	let callout = text.trim_start_matches('>').trim_start().to_lowercase();
	if callout.starts_with("[!recall]") {
		Some(Kind::Recall)
	} else if callout.starts_with("[!example]") && callout.contains("check yourself") {
		Some(Kind::Check)
	} else {
		None
	}
}

/// A section is godspeed's only while this hash is the one it last wrote.
pub(crate) fn hash(text: &str) -> String {
	sha256_text(&normal(text))
}

impl Sections {
	pub fn parse(body: &str, eol: &'static str) -> Sections {
		let mut chunks: Vec<Chunk> = Vec::new();
		let (mut in_code, mut after_quote) = (false, false);
		for line in body.split_inclusive('\n') {
			let started = if in_code { None } else { starts(line, after_quote) };
			match (started, chunks.last_mut()) {
				(Some(kind), _) => chunks.push(Chunk { kind, text: line.to_owned() }),
				(None, Some(last)) => last.text.push_str(line),
				(None, None) => chunks.push(Chunk { kind: Kind::Other, text: line.to_owned() }),
			}
			if line.trim_start().starts_with("```") {
				in_code = !in_code;
			}
			after_quote = line.starts_with('>');
		}
		let mut seen = Vec::new();
		for chunk in &mut chunks {
			if chunk.kind == Kind::Other {
				continue;
			}
			if seen.contains(&chunk.kind) {
				chunk.kind = Kind::Other;
			} else {
				seen.push(chunk.kind);
			}
		}
		Sections { chunks, eol }
	}

	fn at(&self, kind: Kind) -> Option<usize> {
		self.chunks.iter().position(|c| c.kind == kind)
	}

	pub fn has(&self, kind: Kind) -> bool {
		self.at(kind).is_some()
	}

	/// The hash of the section as it stands.
	pub fn hash_of(&self, kind: Kind) -> Option<String> {
		Some(hash(&self.chunks[self.at(kind)?].text))
	}

	/// The section as it stands, without the blank lines after it.
	pub fn text_of(&self, kind: Kind) -> Option<String> {
		Some(self.chunks[self.at(kind)?].text.trim_end().to_owned())
	}

	/// The list lines of a section, without its heading.
	pub fn list_lines(&self, kind: Kind) -> Vec<String> {
		let Some(at) = self.at(kind) else { return Vec::new() };
		self.chunks[at].text.lines().filter(|l| l.trim_start().starts_with("- ")).map(str::to_owned).collect()
	}

	/// Puts new text in a section, keeping the blank lines that followed the old one.
	pub fn replace(&mut self, kind: Kind, content: &str) {
		let Some(at) = self.at(kind) else { return };
		let old = &self.chunks[at].text;
		let trailing = old[old.trim_end().len()..].to_owned();
		self.chunks[at].text = format!("{}{trailing}", content.replace('\n', self.eol));
	}

	/// Adds a section where it belongs: before the first section that comes later, else last.
	pub fn insert(&mut self, kind: Kind, content: &str) {
		let rank = kind.rank();
		let at = self.chunks.iter().position(|c| c.kind.rank() > rank).unwrap_or(self.chunks.len());
		if let Some(prev) = at.checked_sub(1) {
			self.end_with_blank_line(prev);
		}
		let mut text = content.replace('\n', self.eol);
		text.push_str(self.eol);
		if at < self.chunks.len() {
			text.push_str(self.eol);
		}
		self.chunks.insert(at, Chunk { kind, text });
	}

	/// Adds list lines at the end of a section, before the blank lines that follow it.
	pub fn append_lines(&mut self, kind: Kind, lines: &[String]) {
		let Some(at) = self.at(kind) else { return };
		let old = &self.chunks[at].text;
		let end = old.trim_end().len();
		let added: String = lines.iter().map(|l| format!("{}{l}", self.eol)).collect();
		self.chunks[at].text = format!("{}{added}{}", &old[..end], &old[end..]);
	}

	fn end_with_blank_line(&mut self, at: usize) {
		let text = &mut self.chunks[at].text;
		if !text.ends_with('\n') {
			text.push_str(self.eol);
		}
		if !(text.ends_with("\n\n") || text.ends_with("\n\r\n")) {
			text.push_str(self.eol);
		}
	}

	pub fn render(&self) -> String {
		self.chunks.iter().map(|c| c.text.as_str()).collect()
	}
}

/// The text godspeed writes for each section, with `\n` line ends and no trailing newline.
pub(crate) fn recall_text(question: &str) -> String {
	let lines: Vec<String> = question.trim().lines().map(|l| format!("> {l}")).collect();
	format!("> [!recall] Without looking at your notes\n{}", lines.join("\n"))
}

pub(crate) fn in_short_text(text: &str) -> String {
	format!("## In short\n{}", text.trim())
}

pub(crate) fn my_words_text(words: &str) -> String {
	format!("## My words\n{}", words.trim())
}

pub(crate) fn mistakes_text(lines: &[String]) -> String {
	format!("## Mistakes to remember\n{}", lines.join("\n"))
}

pub(crate) fn related_text(names: &[String]) -> String {
	let items: Vec<String> = names.iter().map(|n| format!("- [[{n}]]")).collect();
	format!("## Related\n{}", items.join("\n"))
}

pub(crate) fn check_text(title: &str, line: &str) -> String {
	format!("> [!example]- Check yourself: {title}\n> {line}")
}

#[cfg(test)]
mod tests {
	use super::*;

	const BODY: &str = "> [!recall] Without looking at your notes\n> What does C(n,k) count?\n\n## My words\n*1-2 sentences.*\n\n\n## Mistakes to remember\n\n\n> [!example]- Check yourself: class slide\n> ![[a.pdf#page=14]]\n";

	#[test]
	fn the_owners_body_splits_into_its_sections_and_joins_back_exactly() {
		let s = Sections::parse(BODY, "\n");
		for kind in [Kind::Recall, Kind::MyWords, Kind::Mistakes, Kind::Check] {
			assert!(s.has(kind), "{kind:?}");
		}
		assert!(!s.has(Kind::InShort));
		assert_eq!(s.render(), BODY);
	}

	#[test]
	fn a_section_hash_ignores_line_endings_and_trailing_blank_lines() {
		let a = Sections::parse("## In short\nText\n\n", "\n");
		let b = Sections::parse("## In short\r\nText\r\n", "\r\n");
		assert_eq!(a.hash_of(Kind::InShort), b.hash_of(Kind::InShort));
		let edited = Sections::parse("## In short\nText!\n", "\n");
		assert_ne!(a.hash_of(Kind::InShort), edited.hash_of(Kind::InShort));
	}

	#[test]
	fn the_learners_own_heading_is_not_part_of_the_section_above() {
		let s = Sections::parse("## In short\nText\n\n## My ideas\nMine\n\n## Related\n- [[A]]\n", "\n");
		assert_eq!(s.hash_of(Kind::InShort), Some(hash("## In short\nText")));
		assert_eq!(s.list_lines(Kind::Related), ["- [[A]]"]);
		assert_eq!(s.render(), "## In short\nText\n\n## My ideas\nMine\n\n## Related\n- [[A]]\n");
	}

	#[test]
	fn headings_inside_a_code_fence_do_not_split() {
		let s = Sections::parse("## In short\n```\n## Related\n```\n", "\n");
		assert!(!s.has(Kind::Related));
	}

	#[test]
	fn replace_keeps_the_blank_lines_after_the_section() {
		let mut s = Sections::parse(BODY, "\n");
		s.replace(Kind::Recall, &recall_text("New question?"));
		assert!(s.render().starts_with("> [!recall] Without looking at your notes\n> New question?\n\n## My words"));
	}

	#[test]
	fn a_missing_section_goes_in_its_place() {
		let mut s = Sections::parse(BODY, "\n");
		s.insert(Kind::InShort, &in_short_text("Short."));
		s.insert(Kind::Related, &related_text(&["A".to_owned()]));
		assert_eq!(
			s.render(),
			"> [!recall] Without looking at your notes\n> What does C(n,k) count?\n\n## In short\nShort.\n\n## My words\n*1-2 sentences.*\n\n\n## Mistakes to remember\n\n\n## Related\n- [[A]]\n\n> [!example]- Check yourself: class slide\n> ![[a.pdf#page=14]]\n"
		);
	}

	#[test]
	fn a_section_appended_to_a_body_that_lacks_a_final_newline_stays_apart() {
		let mut s = Sections::parse("## In short\nText", "\n");
		s.insert(Kind::Related, &related_text(&["A".to_owned()]));
		assert_eq!(s.render(), "## In short\nText\n\n## Related\n- [[A]]\n");
	}

	#[test]
	fn lines_are_added_before_the_blank_lines_that_follow() {
		let mut s = Sections::parse(BODY, "\n");
		s.append_lines(Kind::Mistakes, &["- Bar count (Nov 20): x".to_owned()]);
		assert!(s.render().contains("## Mistakes to remember\n- Bar count (Nov 20): x\n\n\n> [!example]-"));
	}

	#[test]
	fn crlf_sections_are_written_with_crlf() {
		let mut s = Sections::parse("## In short\r\nText\r\n", "\r\n");
		s.insert(Kind::Related, &related_text(&["A".to_owned()]));
		assert_eq!(s.render(), "## In short\r\nText\r\n\r\n## Related\r\n- [[A]]\r\n");
	}

	#[test]
	fn a_repeated_heading_is_kept_but_only_the_first_is_managed() {
		let s = Sections::parse("## In short\nA\n\n## In short\nB\n", "\n");
		assert_eq!(s.hash_of(Kind::InShort), Some(hash("## In short\nA")));
		assert_eq!(s.render(), "## In short\nA\n\n## In short\nB\n");
	}
}
