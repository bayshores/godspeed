//! A note's file text: built new from the values godspeed knows, or merged into an existing
//! note without touching what the learner changed. A key or section is godspeed's while it
//! still holds what godspeed last wrote (`Written`); once the learner edits it, it is theirs.

use std::collections::{BTreeMap, HashSet};

use super::frontmatter::{Doc, Owner, list_block, normal, scalar_block};
use super::mistakes::{self, Mistake, line_kind};
use super::note_keys::*;
use super::sections::{self, Kind, Sections};
use crate::spaces::space_shortcuts::safe_entry_name;
use crate::study::progress::TopicStatus;

/// What the teacher and the server know about one idea. `text`, `recall`, `source` and `words`
/// are left alone in a note when None; `links` when empty.
#[derive(Debug, Clone)]
pub struct NoteData {
	pub title: String,
	pub space: String,
	pub deadlines: Vec<String>,
	pub standing: TopicStatus,
	/// "2 of 3 right".
	pub answered: Option<String>,
	/// A date, written as it is.
	pub next_review: Option<String>,
	pub facts: Vec<String>,
	/// The name of the space's own note, when it exists.
	pub up: Option<String>,
	pub text: Option<String>,
	pub recall: Option<String>,
	/// Oldest first, so a later one has the newest wording.
	pub mistakes: Vec<Mistake>,
	pub links: Vec<String>,
	pub source: Option<Source>,
	pub words: Option<String>,
}

/// The "Check yourself" callout: its title and the one line under it (an embed or a link).
#[derive(Debug, Clone)]
pub struct Source {
	pub title: String,
	pub line: String,
}

/// What godspeed last wrote: each key's block and each section's hash, by key and by section
/// name. A key or section whose present value differs is the learner's.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Written {
	pub keys: BTreeMap<String, String>,
	pub sections: BTreeMap<String, String>,
}

#[derive(Debug, Clone)]
pub struct Merged {
	pub text: String,
	pub written: Written,
	/// Keys and sections that held the learner's text and were left alone.
	pub kept_keys: Vec<String>,
	pub kept_sections: Vec<String>,
}

/// A note name that works in a `[[link]]` and as a file name on every OS.
pub fn note_name(title: &str) -> String {
	let name = safe_entry_name(title).replace(['[', ']', '#', '^'], "-");
	name.trim().to_owned()
}

pub fn file_name(title: &str) -> String {
	format!("{}.md", note_name(title))
}

/// A new note for a topic.
pub fn build(topic_id: &str, data: &NoteData) -> Merged {
	let mut doc = Doc::empty("");
	doc.set_block(OWNER_KEY, &scalar_block(OWNER_KEY, topic_id));
	apply(doc, false, data, &Written::default())
}

/// Updates an existing note. None when it is not godspeed's: no `godspeed` key, or no
/// frontmatter to hold one. A note marked `keep` gets its keys updated and mistake lines
/// added, and its body is never changed.
pub fn merge(existing: &str, data: &NoteData, last: &Written) -> Option<Merged> {
	merge_as(existing, data, last, false)
}

/// Like `merge` for a note the learner handed over, whose `godspeed` key already names its
/// topic: its body is never changed.
pub fn merge_handed_over(existing: &str, data: &NoteData, last: &Written) -> Option<Merged> {
	merge_as(existing, data, last, true)
}

fn merge_as(existing: &str, data: &NoteData, last: &Written, handed_over: bool) -> Option<Merged> {
	let doc = Doc::parse(existing);
	let keep = match doc.owner()? {
		Owner::Keep => true,
		Owner::Topic(_) => handed_over,
	};
	Some(apply(doc, keep, data, last))
}

fn apply(mut doc: Doc, keep: bool, data: &NoteData, last: &Written) -> Merged {
	let mut written = last.clone();
	let (mut kept_keys, mut kept_sections) = (Vec::new(), Vec::new());
	let mut body = Sections::parse(&doc.body, doc.eol());
	if !keep {
		update_sections(&mut body, data, last, &mut written, &mut kept_sections);
	}
	update_mistakes(&mut body, keep, data, last, &mut written, &mut kept_sections);
	doc.body = body.render();

	let kinds: Vec<String> = body.list_lines(Kind::Mistakes).iter().filter_map(|l| line_kind(l)).collect();
	for (key, block) in key_blocks(data, &kinds) {
		update_key(&mut doc, &key, &block, last, &mut written, &mut kept_keys);
	}
	Merged { text: doc.render(), written, kept_keys, kept_sections }
}

/// Every key godspeed writes besides `godspeed`, in the note's order.
fn key_blocks(data: &NoteData, mistake_kinds: &[String]) -> Vec<(String, String)> {
	let mut out = vec![
		(SPACE_KEY, scalar_block(SPACE_KEY, &data.space)),
		(DEADLINES_KEY, list_block(DEADLINES_KEY, &data.deadlines)),
		(STANDING_KEY, scalar_block(STANDING_KEY, confidence_word(data.standing).unwrap_or(""))),
	];
	if let Some(answered) = &data.answered {
		out.push((ANSWERED_KEY, scalar_block(ANSWERED_KEY, answered)));
	}
	if !mistake_kinds.is_empty() || data.standing != TopicStatus::Untested {
		out.push((MISTAKES_KEY, list_block(MISTAKES_KEY, mistake_kinds)));
	}
	if let Some(date) = &data.next_review {
		out.push((NEXT_REVIEW_KEY, scalar_block(NEXT_REVIEW_KEY, date)));
	}
	out.push((FACTS_KEY, list_block(FACTS_KEY, &data.facts)));
	if let Some(up) = &data.up {
		out.push((UP_KEY, scalar_block(UP_KEY, &format!("[[{}]]", note_name(up)))));
	}
	out.into_iter().map(|(key, block)| (key.to_owned(), block)).collect()
}

fn is_blank(block: &str, key: &str) -> bool {
	!block.contains('\n') && block.strip_prefix(key).and_then(|rest| rest.strip_prefix(':')).is_some_and(|value| matches!(value.trim(), "" | "[]"))
}

fn update_key(doc: &mut Doc, key: &str, block: &str, last: &Written, written: &mut Written, kept: &mut Vec<String>) {
	let new = normal(block);
	let ours = match doc.block(key) {
		None => !last.keys.contains_key(key),
		Some(b) => {
			let current = normal(&b.text);
			current == new
				|| match last.keys.get(key) {
					Some(previous) => *previous == current,
					None => is_blank(&current, key),
				}
		}
	};
	if ours {
		doc.set_block(key, block);
		written.keys.insert(key.to_owned(), new);
	} else {
		kept.push(key.to_owned());
	}
}

fn update_sections(body: &mut Sections, data: &NoteData, last: &Written, written: &mut Written, kept: &mut Vec<String>) {
	let own_name = note_name(&data.title).to_lowercase();
	let mut seen = HashSet::from([own_name]);
	let links: Vec<String> = data.links.iter().filter(|l| !l.trim().is_empty()).map(|l| note_name(l)).filter(|n| seen.insert(n.to_lowercase())).collect();
	let wanted = [
		(Kind::Recall, data.recall.as_deref().map(sections::recall_text)),
		(Kind::InShort, data.text.as_deref().map(sections::in_short_text)),
		(Kind::Related, (!links.is_empty()).then(|| sections::related_text(&links))),
		(Kind::Check, data.source.as_ref().map(|s| sections::check_text(&s.title, &s.line))),
	];
	for (kind, content) in wanted {
		let Some(content) = content else { continue };
		let content = content.trim().to_owned();
		let name = kind.name().to_owned();
		let new_hash = sections::hash(&content);
		let ours = match body.hash_of(kind) {
			Some(current) => current == new_hash || last.sections.get(&name) == Some(&current),
			None => !last.sections.contains_key(&name),
		};
		if !ours {
			kept.push(name);
			continue;
		}
		if body.has(kind) {
			body.replace(kind, &content);
		} else {
			body.insert(kind, &content);
		}
		written.sections.insert(name, new_hash);
	}
	if let Some(words) = data.words.as_deref().filter(|_| !body.has(Kind::MyWords)) {
		body.insert(Kind::MyWords, &sections::my_words_text(words));
	}
}

fn update_mistakes(body: &mut Sections, keep: bool, data: &NoteData, last: &Written, written: &mut Written, kept: &mut Vec<String>) {
	if data.mistakes.is_empty() {
		return;
	}
	let name = Kind::Mistakes.name().to_owned();
	let Some(current) = body.hash_of(Kind::Mistakes) else {
		let text = sections::mistakes_text(&mistakes::merge_owned(&[], &data.mistakes));
		body.insert(Kind::Mistakes, &text);
		if !keep {
			written.sections.insert(name, sections::hash(&text));
		}
		return;
	};
	let old = body.list_lines(Kind::Mistakes);
	if !keep && last.sections.get(&name) == Some(&current) {
		let text = sections::mistakes_text(&mistakes::merge_owned(&old, &data.mistakes));
		body.replace(Kind::Mistakes, &text);
		written.sections.insert(name, sections::hash(&text));
	} else {
		body.append_lines(Kind::Mistakes, &mistakes::append_new(&old, &data.mistakes));
		if !keep {
			kept.push(name);
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	const OWNERS_NOTE: &str = "---\nclass: CSE 21\ntest:\n  - Test 1\nconfidence:\napproved: false\ncssclasses:\n  - concept\nslide: \"[[courses/fa26/cse21/lectures/Day3 permutations and combinations.pdf#page=14]]\"\nunit: Counting\nmistakes: []\nup: \"[[CSE 21]]\"\n---\n> [!recall] Without looking at your notes\n> What does C(n,k) count, and why does order not matter?\n\n## My words\n*1–2 sentences, your own words. Then open the slide below to check.*\n\n\n## Mistakes to remember\n\n\n> [!example]- Check yourself: class slide\n> ![[courses/fa26/cse21/lectures/Day3 permutations and combinations.pdf#page=14]]\n";

	fn mistake(kind: &str, text: &str, date: &str) -> Mistake {
		Mistake { kind: kind.to_owned(), text: text.to_owned(), date: date.to_owned() }
	}

	fn data() -> NoteData {
		NoteData {
			title: "Stars and bars".to_owned(),
			space: "CSE 21".to_owned(),
			deadlines: vec!["Midterm 1".to_owned()],
			standing: TopicStatus::Shaky,
			answered: Some("2 of 3 right".to_owned()),
			next_review: Some("2026-11-24".to_owned()),
			facts: vec!["n_4k2a91".to_owned(), "n_4k2a97".to_owned()],
			up: Some("CSE 21".to_owned()),
			text: Some("Each solution is a row of n stars cut by k - 1 bars.".to_owned()),
			recall: Some("What are the stars and what are the bars?".to_owned()),
			mistakes: vec![mistake("bar count", "counted k bars instead of k - 1", "Nov 20")],
			links: vec!["Combinations".to_owned(), "Objects into boxes".to_owned()],
			source: Some(Source { title: "Day6 Stars and Bars.pdf, page 13".to_owned(), line: "![[lectures/Day6 Stars and Bars.pdf#page=13]]".to_owned() }),
			words: Some("Stars are units, bars are walls.".to_owned()),
		}
	}

	const BUILT: &str = "---\ngodspeed: tpc_9f2\nclass: CSE 21\ntest:\n  - Midterm 1\nconfidence: ok\nanswered: 2 of 3 right\nmistakes:\n  - bar count\nnext_review: 2026-11-24\nfacts:\n  - n_4k2a91\n  - n_4k2a97\nup: \"[[CSE 21]]\"\n---\n> [!recall] Without looking at your notes\n> What are the stars and what are the bars?\n\n## In short\nEach solution is a row of n stars cut by k - 1 bars.\n\n## My words\nStars are units, bars are walls.\n\n## Mistakes to remember\n- Bar count (Nov 20): counted k bars instead of k - 1\n\n## Related\n- [[Combinations]]\n- [[Objects into boxes]]\n\n> [!example]- Check yourself: Day6 Stars and Bars.pdf, page 13\n> ![[lectures/Day6 Stars and Bars.pdf#page=13]]\n";

	fn built() -> Merged {
		build("tpc_9f2", &data())
	}

	#[test]
	fn a_new_note_has_the_design_layout() {
		assert_eq!(built().text, BUILT);
	}

	#[test]
	fn merging_the_same_data_changes_nothing() {
		let b = built();
		let again = merge(&b.text, &data(), &b.written).unwrap();
		assert_eq!(again.text, b.text);
		assert!(again.kept_keys.is_empty() && again.kept_sections.is_empty());
		assert_eq!(again.written, b.written);
	}

	#[test]
	fn an_untested_note_has_no_answers_review_or_mistakes() {
		let mut d = data();
		d.standing = TopicStatus::Untested;
		d.answered = Some("none yet".to_owned());
		d.next_review = None;
		d.mistakes.clear();
		d.deadlines.clear();
		let text = build("tpc_1", &d).text;
		assert!(text.contains("confidence:\nanswered: none yet\nfacts:"), "{text}");
		assert!(text.contains("test: []"));
		assert!(!text.contains("mistakes") && !text.contains("next_review") && !text.contains("Mistakes to remember"));
	}

	#[test]
	fn the_owners_note_gets_godspeeds_keys_and_keeps_every_other_key_byte_for_byte() {
		let text = OWNERS_NOTE.replacen("---\n", "---\ngodspeed: tpc_9f2\n", 1);
		let merged = merge(&text, &data(), &Written::default()).unwrap();
		for kept_line in ["approved: false\n", "cssclasses:\n  - concept\n", "slide: \"[[courses/fa26/cse21/lectures/Day3 permutations and combinations.pdf#page=14]]\"\n", "unit: Counting\n", "test:\n  - Test 1\n", "class: CSE 21\n"] {
			assert!(merged.text.contains(kept_line), "{kept_line}");
		}
		let at = |s: &str| merged.text.find(s).unwrap();
		assert!(at("godspeed:") < at("class:") && at("class:") < at("test:") && at("test:") < at("confidence:") && at("confidence:") < at("approved:") && at("unit:") < at("mistakes:") && at("mistakes:") < at("up:"));
		assert!(merged.text.contains("confidence: ok\n"));
		assert!(merged.text.contains("mistakes:\n  - bar count\n"));
		assert!(merged.text.contains("up: \"[[CSE 21]]\"\nanswered: 2 of 3 right\nnext_review: 2026-11-24\nfacts:\n  - n_4k2a91\n  - n_4k2a97\n---\n"));
		assert_eq!(merged.kept_keys, ["test"]);
		assert!(merged.text.contains("> What does C(n,k) count, and why does order not matter?"));
		assert_eq!(merged.kept_sections, ["recall", "check yourself", "mistakes to remember"]);
		assert!(merged.text.contains("## My words\n*1–2 sentences, your own words. Then open the slide below to check.*\n\n\n## Mistakes to remember\n- Bar count (Nov 20): counted k bars instead of k - 1\n\n\n## Related\n- [[Combinations]]\n- [[Objects into boxes]]\n\n> [!example]- Check yourself: class slide"));
		assert!(merged.text.contains("## In short\nEach solution"));
	}

	fn edit_and_merge(find: &str, replace: &str, newer: NoteData) -> (String, Merged) {
		let b = built();
		let edited = b.text.replace(find, replace);
		assert_ne!(edited, b.text, "{find}");
		let merged = merge(&edited, &newer, &b.written).unwrap();
		(edited, merged)
	}

	fn changed() -> NoteData {
		let mut d = data();
		d.text = Some("Different text.".to_owned());
		d.recall = Some("A different question?".to_owned());
		d.links = vec!["Other idea".to_owned()];
		d.source = Some(Source { title: "Other.pdf, page 2".to_owned(), line: "![[Other.pdf#page=2]]".to_owned() });
		d
	}

	#[test]
	fn a_hand_edit_in_each_section_is_kept() {
		for (find, replace, section, mine) in [
			("What are the stars", "What exactly are the stars", "recall", "What exactly are the stars"),
			("Each solution", "My own start. Each solution", "in short", "My own start. Each solution"),
			("- [[Combinations]]", "- [[Combinations]] (read this)", "related", "(read this)"),
			("page 13\n>", "page 13, mine\n>", "check yourself", "page 13, mine"),
		] {
			let (_, merged) = edit_and_merge(find, replace, changed());
			assert_eq!(merged.kept_sections, [section], "{section}");
			assert!(merged.text.contains(mine), "{section}");
		}
		let (_, merged) = edit_and_merge("Each solution", "Mine. Each solution", changed());
		assert!(!merged.text.contains("Different text."));
		assert!(merged.text.contains("A different question?") && merged.text.contains("- [[Other idea]]") && merged.text.contains("Other.pdf, page 2"));
	}

	#[test]
	fn the_untouched_sections_are_rewritten() {
		let b = built();
		let merged = merge(&b.text, &changed(), &b.written).unwrap();
		assert!(merged.kept_sections.is_empty());
		assert!(merged.text.contains("> A different question?") && merged.text.contains("## In short\nDifferent text.\n") && merged.text.contains("- [[Other idea]]\n\n> [!example]- Check yourself: Other.pdf, page 2"));
		assert!(!merged.text.contains("Combinations"));
	}

	#[test]
	fn my_words_is_never_touched() {
		let mut d = data();
		d.words = Some("New words".to_owned());
		let (_, merged) = edit_and_merge("Stars are units, bars are walls.", "Mine.", d);
		assert!(merged.text.contains("## My words\nMine.\n") && !merged.text.contains("New words"));
		assert!(merged.kept_sections.is_empty());
	}

	#[test]
	fn a_changed_key_becomes_the_learners_for_good() {
		let mut newer = data();
		newer.standing = TopicStatus::Strong;
		let (_, merged) = edit_and_merge("confidence: ok", "confidence: nearly there", newer.clone());
		assert_eq!(merged.kept_keys, ["confidence"]);
		assert!(merged.text.contains("confidence: nearly there\n") && merged.text.contains("answered: 2 of 3 right"));
		let again = merge(&merged.text, &newer, &merged.written).unwrap();
		assert_eq!(again.kept_keys, ["confidence"]);
		assert!(again.text.contains("confidence: nearly there\n"));
	}

	#[test]
	fn a_key_the_learner_deleted_stays_deleted() {
		let mut newer = data();
		newer.next_review = Some("2026-12-01".to_owned());
		let (_, merged) = edit_and_merge("next_review: 2026-11-24\n", "", newer);
		assert_eq!(merged.kept_keys, ["next_review"]);
		assert!(!merged.text.contains("next_review"));
	}

	#[test]
	fn a_section_the_learner_deleted_stays_deleted() {
		let (_, merged) = edit_and_merge("## Related\n- [[Combinations]]\n- [[Objects into boxes]]\n\n", "", changed());
		assert_eq!(merged.kept_sections, ["related"]);
		assert!(!merged.text.contains("## Related"));
	}

	#[test]
	fn keys_the_learner_added_stay_where_they_are() {
		let b = built();
		let edited = b.text.replacen("class: CSE 21\n", "class: CSE 21\nunit: Counting\n", 1);
		let mut newer = data();
		newer.standing = TopicStatus::Strong;
		let merged = merge(&edited, &newer, &b.written).unwrap();
		assert!(merged.text.contains("class: CSE 21\nunit: Counting\ntest:\n"));
		assert!(merged.text.contains("confidence: solid\n"));
	}

	#[test]
	fn a_keep_note_gets_keys_and_mistake_lines_and_its_body_never_changes() {
		let text = OWNERS_NOTE.replacen("---\n", "---\ngodspeed: keep\n", 1);
		let merged = merge(&text, &changed(), &Written::default()).unwrap();
		assert!(merged.text.starts_with("---\ngodspeed: keep\nclass: CSE 21\n"));
		assert!(merged.text.contains("confidence: ok\n") && merged.text.contains("mistakes:\n  - bar count\n"));
		assert!(merged.kept_sections.is_empty());
		assert!(merged.written.sections.is_empty());
		let body = |t: &str| t[t.rfind("---\n").unwrap() + 4..].to_owned();
		assert_eq!(body(&merged.text).replace("- Bar count (Nov 20): counted k bars instead of k - 1\n", ""), body(&text));
		assert!(body(&merged.text).contains("## Mistakes to remember\n- Bar count (Nov 20): counted k bars instead of k - 1\n"));
		assert!(!merged.text.contains("Different text") && !merged.text.contains("Other idea"));
	}

	#[test]
	fn a_keep_note_without_a_mistakes_section_gets_one_at_its_place() {
		let text = "---\ngodspeed: keep\n---\n## My words\nMine\n\n> [!example]- Check yourself: s\n> x\n";
		let merged = merge(text, &data(), &Written::default()).unwrap();
		assert!(merged.text.contains("Mine\n\n## Mistakes to remember\n- Bar count (Nov 20): counted k bars instead of k - 1\n\n> [!example]-"));
	}

	#[test]
	fn mistakes_merge_into_godspeeds_section_with_dates_and_the_cap() {
		let b = built();
		let mut newer = data();
		newer.mistakes = vec![mistake("Bar count", "newer wording", "Nov 24")];
		let m = merge(&b.text, &newer, &b.written).unwrap();
		assert!(m.text.contains("## Mistakes to remember\n- Bar count (Nov 20, again Nov 24): newer wording\n\n## Related"));
		assert!(m.kept_sections.is_empty());
		let mut many = data();
		many.mistakes = (1..=7).map(|i| mistake(&format!("kind {i}"), "x", "Nov 25")).collect();
		let m = merge(&m.text, &many, &m.written).unwrap();
		let lines: Vec<_> = m.text.lines().filter(|l| l.starts_with("- ") && l.contains("(Nov")).collect();
		assert_eq!(lines.len(), 6);
		assert!(m.text.contains("mistakes:\n  - kind 2\n") && !m.text.contains("kind 1 ("));
	}

	#[test]
	fn mistakes_go_at_the_end_of_a_learner_edited_section_without_touching_their_lines() {
		let (edited, merged) = edit_and_merge("- Bar count (Nov 20): counted k bars instead of k - 1", "- bar count: my line about bars\n- Sign error: minus", {
			let mut d = data();
			d.mistakes = vec![mistake("bar count", "again", "Nov 24"), mistake("off by one", "fix", "Nov 24")];
			d
		});
		assert!(merged.text.contains("## Mistakes to remember\n- bar count: my line about bars\n- Sign error: minus\n- Off by one (Nov 24): fix\n\n## Related"), "{}", merged.text);
		assert!(merged.text.contains("mistakes:\n  - bar count\n  - sign error\n  - off by one\n"));
		assert!(edited.contains("- bar count: my line about bars"));
		assert_eq!(merged.kept_sections, ["mistakes to remember"]);
	}

	#[test]
	fn a_missing_mistakes_section_comes_back_for_new_lines() {
		let (_, merged) = edit_and_merge("## Mistakes to remember\n- Bar count (Nov 20): counted k bars instead of k - 1\n\n", "", data());
		assert!(merged.text.contains("## My words\nStars are units, bars are walls.\n\n## Mistakes to remember\n- Bar count (Nov 20): counted k bars instead of k - 1\n\n## Related"));
	}

	#[test]
	fn crlf_notes_stay_crlf_everywhere() {
		let b = built();
		let crlf = b.text.replace('\n', "\r\n");
		let merged = merge(&crlf, &changed(), &b.written).unwrap();
		assert!(!merged.text.replace("\r\n", "").contains('\n'));
		assert!(merged.text.contains("## In short\r\nDifferent text.\r\n"));
		let same = merge(&crlf, &data(), &b.written).unwrap();
		assert_eq!(same.text, crlf);
		assert!(same.kept_keys.is_empty() && same.kept_sections.is_empty());
	}

	#[test]
	fn a_note_that_is_not_godspeeds_is_not_merged() {
		let w = Written::default();
		assert!(merge("# No frontmatter\ntext\n", &data(), &w).is_none());
		assert!(merge("---\nclass: CSE 21\n---\nbody\n", &data(), &w).is_none());
		assert!(merge("---\ngodspeed: tpc_1\nunclosed text\n", &data(), &w).is_none());
		assert!(merge("", &data(), &w).is_none());
	}

	#[test]
	fn unsafe_characters_in_names_are_replaced() {
		assert_eq!(note_name("Big [O] #1 ^2 | a/b"), "Big -O- -1 -2 - a-b");
		assert_eq!(file_name("Sets: A or B?"), "Sets- A or B-.md");
		let mut d = data();
		d.title = "Stars [and] bars".to_owned();
		d.links = vec!["Back|alias".to_owned(), "stars -and- bars".to_owned(), "  ".to_owned(), "Sec#tion".to_owned()];
		d.up = Some("CSE [21]".to_owned());
		let text = build("tpc_1", &d).text;
		assert!(text.contains("## Related\n- [[Back-alias]]\n- [[Sec-tion]]\n"), "{text}");
		assert!(text.contains("up: \"[[CSE -21-]]\"\n"));
	}
}
