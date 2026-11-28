//! The "Mistakes to remember" lines: one per kind, the newest wording, the dates a kind came
//! back, and at most six kinds. A line is `- Bar count (Nov 20, again Nov 24): what went
//! wrong and the fix`.

/// A mistake the teacher sends. `date` is a label such as "Nov 20".
#[derive(Debug, Clone, PartialEq)]
pub struct Mistake {
	pub kind: String,
	pub text: String,
	pub date: String,
}

pub const MAX_KINDS: usize = 6;

/// One written line, taken apart. `raw` holds a line godspeed cannot take apart, kept as it is.
#[derive(Debug, Clone)]
struct Entry {
	kind: String,
	dates: Vec<String>,
	text: String,
	raw: Option<String>,
}

/// A kind as stored: trimmed, and with a capital first letter lowered unless the second is a
/// capital too ("Bar count" is "bar count", "NFA design" stays).
fn normal_kind(kind: &str) -> String {
	let kind = kind.split_whitespace().collect::<Vec<_>>().join(" ");
	let mut chars = kind.chars();
	match (chars.next(), chars.next()) {
		(Some(first), second) if first.is_uppercase() && !second.is_some_and(char::is_uppercase) => first.to_lowercase().chain(kind.chars().skip(1)).collect(),
		_ => kind,
	}
}

fn capitalized(kind: &str) -> String {
	let mut chars = kind.chars();
	chars.next().map(|first| first.to_uppercase().chain(chars).collect()).unwrap_or_default()
}

/// The kind a list line names: the words after "- " up to " (" or ":".
pub fn line_kind(line: &str) -> Option<String> {
	let rest = line.trim_start().strip_prefix("- ")?;
	let end = rest.find(" (").into_iter().chain(rest.find(':')).min().unwrap_or(rest.len());
	let kind = normal_kind(&rest[..end]);
	(!kind.is_empty()).then_some(kind)
}

impl Entry {
	fn new(m: &Mistake) -> Entry {
		Entry { kind: normal_kind(&m.kind), dates: vec![m.date.clone()], text: m.text.trim().to_owned(), raw: None }
	}

	fn parse(line: &str) -> Entry {
		let unparsed = || Entry { kind: line_kind(line).unwrap_or_default(), dates: Vec::new(), text: String::new(), raw: Some(line.to_owned()) };
		let Some(rest) = line.trim_start().strip_prefix("- ") else { return unparsed() };
		let Some((head, text)) = rest.split_once("): ") else { return unparsed() };
		let Some((kind, dates)) = head.split_once(" (") else { return unparsed() };
		let dates = dates.split(", ").map(|d| d.strip_prefix("again ").unwrap_or(d).to_owned()).collect();
		Entry { kind: normal_kind(kind), dates, text: text.to_owned(), raw: None }
	}

	fn render(&self) -> String {
		if let Some(raw) = &self.raw {
			return raw.clone();
		}
		let dates: Vec<String> = self.dates.iter().enumerate().map(|(i, d)| if i == 0 { d.clone() } else { format!("again {d}") }).collect();
		format!("- {} ({}): {}", capitalized(&self.kind), dates.join(", "), self.text)
	}

	/// The kind came back: its wording and date are the newest.
	fn repeat(&mut self, m: &Mistake) {
		self.text = m.text.trim().to_owned();
		if self.dates.last() != Some(&m.date) {
			self.dates.push(m.date.clone());
		}
	}
}

fn same_kind(a: &str, b: &str) -> bool {
	a.to_lowercase() == b.to_lowercase()
}

/// The lines for a godspeed-owned section: the old lines with `new` merged in, oldest first. A
/// kind that came back moves to the end, and past six kinds the oldest drop. `new` is oldest
/// first, so a later one has the newest wording.
pub(crate) fn merge_owned(old_lines: &[String], new: &[Mistake]) -> Vec<String> {
	let mut entries: Vec<Entry> = old_lines.iter().filter(|l| l.trim_start().starts_with("- ")).map(|l| Entry::parse(l)).collect();
	for m in new {
		let kind = normal_kind(&m.kind);
		match entries.iter().position(|e| same_kind(&e.kind, &kind)) {
			Some(at) => {
				let mut entry = entries.remove(at);
				if entry.raw.is_some() {
					entry = Entry::new(m);
				} else {
					entry.repeat(m);
				}
				entries.push(entry);
			}
			None => entries.push(Entry::new(m)),
		}
	}
	let drop = entries.len().saturating_sub(MAX_KINDS);
	entries.drain(..drop);
	entries.iter().map(Entry::render).collect()
}

/// The lines to add at the end of a section the learner owns: only kinds it does not show yet,
/// and none once it holds six. The learner's own lines are never read for wording or changed.
pub(crate) fn append_new(old_lines: &[String], new: &[Mistake]) -> Vec<String> {
	let mut kinds: Vec<String> = old_lines.iter().filter_map(|l| line_kind(l)).collect();
	let mut count = old_lines.iter().filter(|l| l.trim_start().starts_with("- ")).count();
	let mut out = Vec::new();
	for m in new {
		let kind = normal_kind(&m.kind);
		if count >= MAX_KINDS || kinds.iter().any(|k| same_kind(k, &kind)) {
			continue;
		}
		out.push(Entry::new(m).render());
		kinds.push(kind);
		count += 1;
	}
	out
}

#[cfg(test)]
mod tests {
	use super::*;

	fn m(kind: &str, text: &str, date: &str) -> Mistake {
		Mistake { kind: kind.to_owned(), text: text.to_owned(), date: date.to_owned() }
	}

	fn lines(of: &[&str]) -> Vec<String> {
		of.iter().map(|s| (*s).to_owned()).collect()
	}

	#[test]
	fn a_new_kind_is_one_line() {
		assert_eq!(merge_owned(&[], &[m("Bar count", "counted k bars", "Nov 20")]), ["- Bar count (Nov 20): counted k bars"]);
	}

	#[test]
	fn a_repeated_kind_keeps_one_line_with_the_newest_wording_and_each_date() {
		let first = merge_owned(&[], &[m("bar count", "old words", "Nov 20")]);
		let second = merge_owned(&first, &[m("Bar count", "new words", "Nov 24")]);
		assert_eq!(second, ["- Bar count (Nov 20, again Nov 24): new words"]);
		let third = merge_owned(&second, &[m("bar count", "newest", "Nov 24"), m("bar count", "newest", "Nov 27")]);
		assert_eq!(third, ["- Bar count (Nov 20, again Nov 24, again Nov 27): newest"]);
	}

	#[test]
	fn a_repeat_moves_to_the_end_and_the_oldest_kinds_drop_past_six() {
		let mut all = Vec::new();
		for (i, kind) in ["a", "b", "c", "d", "e", "f"].iter().enumerate() {
			all = merge_owned(&all, &[m(kind, "x", &format!("D{i}"))]);
		}
		assert_eq!(all.len(), 6);
		all = merge_owned(&all, &[m("a", "x", "D9")]);
		assert_eq!(all.last().unwrap(), "- A (D0, again D9): x");
		all = merge_owned(&all, &[m("g", "x", "D10")]);
		assert_eq!(all.len(), 6);
		assert!(all.iter().all(|l| !l.starts_with("- B ")));
		assert!(all.last().unwrap().starts_with("- G "));
	}

	#[test]
	fn the_learners_lines_are_never_changed_only_added_to() {
		let theirs = lines(&["- bar count: I always forget the minus one", "- Mixed up C and P"]);
		let add = append_new(&theirs, &[m("Bar count", "counted k bars", "Nov 24"), m("sign error", "dropped a minus", "Nov 24")]);
		assert_eq!(add, ["- Sign error (Nov 24): dropped a minus"]);
	}

	#[test]
	fn a_full_learner_section_gets_no_more_lines() {
		let theirs: Vec<String> = (0..6).map(|i| format!("- own {i}")).collect();
		assert!(append_new(&theirs, &[m("new kind", "x", "Nov 1")]).is_empty());
	}

	#[test]
	fn a_line_godspeed_cannot_take_apart_is_kept_as_it_is() {
		let old = lines(&["- Hand written: no dates here"]);
		assert_eq!(merge_owned(&old, &[m("other", "x", "Nov 1")]), ["- Hand written: no dates here", "- Other (Nov 1): x"]);
	}

	#[test]
	fn kind_names_normalise() {
		assert_eq!(normal_kind("  Bar   count "), "bar count");
		assert_eq!(normal_kind("NFA design"), "NFA design");
		assert_eq!(line_kind("- Bar count (Nov 20): x").as_deref(), Some("bar count"));
		assert_eq!(line_kind("- Plain: x").as_deref(), Some("plain"));
		assert_eq!(line_kind("not a list line"), None);
	}
}
