//! The notes block: what an agent is told to write the notes of one pass. It carries everything
//! the agent needs and none of the lesson, so any agent writes it at the same cost. Short, in
//! the style agent texts use.

use std::fmt::Write;

use gs_core::vault::note_tool::{RECALL_MAX, TEXT_MAX};

/// The most of a godspeed section's text sent along with an update.
const SECTIONS_MAX_CHARS: usize = 1_500;
/// The longest passage or note snippet.
const SNIPPET_CHARS: usize = 100;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Words {
	/// The teacher writes the whole note.
	Teacher,
	/// The learner adds "My words" at the lesson end; the teacher writes the rest.
	Mine,
}

/// One mistake the note has not been sent yet.
pub struct Mistake {
	pub id: String,
	/// "wrong" or "hint".
	pub kind: &'static str,
	pub text: String,
}

/// What a note already holds that is godspeed's to rewrite.
pub struct Section {
	pub name: String,
	pub text: String,
}

pub enum Entry {
	New,
	/// An existing note; its sections that are still godspeed's (none: all are the learner's).
	Update(Vec<Section>),
}

pub struct Topic {
	pub id: String,
	pub name: String,
	pub entry: Entry,
	/// "shaky", "ok", "solid" or "untested".
	pub standing: String,
	/// "2 of 3 right", or "none yet".
	pub answered: String,
	pub mistakes: Vec<Mistake>,
	/// The kinds the note already lists.
	pub kinds: Vec<String>,
	/// `(passage id, text)` from the space's files.
	pub passages: Vec<(String, String)>,
	/// `(name, the learner's own)` of notes it may link to.
	pub links: Vec<(String, bool)>,
	/// `(path, text)` of the learner's notes that may already cover it.
	pub covering: Vec<(String, String)>,
}

pub struct Block {
	pub space_id: String,
	pub space_name: String,
	pub words: Words,
	pub topics: Vec<Topic>,
	/// `(path, name)` of notes handed over with `godspeed: keep` that no topic's name matched.
	pub kept: Vec<(String, String)>,
}

fn snippet(text: &str, max: usize) -> String {
	let one_line = text.split_whitespace().collect::<Vec<_>>().join(" ");
	if one_line.chars().count() <= max { one_line } else { format!("{}...", one_line.chars().take(max).collect::<String>().trim_end()) }
}

fn topic_lines(out: &mut String, n: usize, topic: &Topic) {
	let entry = if matches!(topic.entry, Entry::New) { "new" } else { "updating" };
	let _ = writeln!(out, "{n}. {} \"{}\", {entry}. {}, {}.", topic.id, topic.name, topic.standing, topic.answered);
	for m in &topic.mistakes {
		let _ = writeln!(out, "   {} {}: \"{}\"", m.id, m.kind, snippet(&m.text, 160));
	}
	let kinds = if topic.kinds.is_empty() { "none".to_owned() } else { topic.kinds.join(", ") };
	let _ = writeln!(out, "   kinds so far: {kinds}");
	let passages = if topic.passages.is_empty() { "none".to_owned() } else { topic.passages.iter().map(|(id, text)| format!("{id} \"{}\"", snippet(text, SNIPPET_CHARS))).collect::<Vec<_>>().join("; ") };
	let _ = writeln!(out, "   passages: {passages}");
	let links = if topic.links.is_empty() { "none".to_owned() } else { topic.links.iter().map(|(name, yours)| if *yours { format!("{name} (yours)") } else { name.clone() }).collect::<Vec<_>>().join(", ") };
	let _ = writeln!(out, "   links: {links}");
	let covering = if topic.covering.is_empty() { "none".to_owned() } else { topic.covering.iter().map(|(path, text)| format!("{path} \"{}\"", snippet(text, SNIPPET_CHARS))).collect::<Vec<_>>().join("; ") };
	let _ = writeln!(out, "   yours, maybe covering: {covering}");
	if let Entry::Update(sections) = &topic.entry {
		if sections.is_empty() {
			let _ = writeln!(out, "   all sections yours: send only mistakes");
		} else {
			let names: Vec<&str> = sections.iter().map(|s| s.name.as_str()).collect();
			let _ = writeln!(out, "   sections godspeed's: {}", names.join(", "));
			let mut left = SECTIONS_MAX_CHARS;
			for section in sections {
				let text = snippet(&section.text, left);
				left = left.saturating_sub(text.chars().count());
				let _ = writeln!(out, "   {}: {text}", section.name);
			}
		}
	}
}

/// The block for one space's pass.
pub fn notes_block(block: &Block) -> String {
	let mode = match block.words {
		Words::Teacher => "teacher writes",
		Words::Mine => "learner adds My words, you write the rest",
	};
	let mut out = format!(
		"[Vault notes] One write_vault_note per idea (space_id {}), then go on with the item.\nWrite to the learner in full plain sentences.\ntext: 2 to 5 sentences, what it is and when it applies, math as $...$, at most {TEXT_MAX} characters.\nrecall: one question answerable without notes, at most {RECALL_MAX} characters.\nmistakes: one line each, what went wrong and the fix, with the id listed; kind 1 to 3 words, reuse a listed kind when it is the same mistake.\nsource: one passage id from the list. links: only names listed.\ncovered_by: path of a \"yours\" note that already covers it; then nothing else.\nSpace {}. Mode: {mode}.\n\n",
		block.space_id, block.space_name
	);
	for (i, topic) in block.topics.iter().enumerate() {
		topic_lines(&mut out, i + 1, topic);
	}
	if !block.kept.is_empty() {
		out.push_str("\nKept notes no topic name matched. For each, send write_vault_note with the topic_id it is about and covered_by its path:\n");
		for (path, name) in &block.kept {
			let _ = writeln!(out, "   {path} \"{name}\"");
		}
	}
	out
}

#[cfg(test)]
mod tests {
	use super::*;

	fn topic(entry: Entry) -> Topic {
		Topic {
			id: "tpc_1".to_owned(),
			name: "Stars and bars".to_owned(),
			entry,
			standing: "shaky".to_owned(),
			answered: "2 of 3 right".to_owned(),
			mistakes: vec![Mistake { id: "m1a2b3c".to_owned(), kind: "wrong", text: "Solutions to x1+x2+x3=7?".to_owned() }],
			kinds: Vec::new(),
			passages: vec![("f_ab:4".to_owned(), "n identical   items\ninto k bins".to_owned())],
			links: vec![("Combinations".to_owned(), true), ("Objects into boxes".to_owned(), false)],
			covering: Vec::new(),
		}
	}

	fn block(topics: Vec<Topic>) -> Block {
		Block { space_id: "spc_1".to_owned(), space_name: "CSE 21".to_owned(), words: Words::Teacher, topics, kept: Vec::new() }
	}

	#[test]
	fn a_new_topic_lists_its_mistakes_passages_and_links() {
		let text = notes_block(&block(vec![topic(Entry::New)]));
		assert!(text.starts_with("[Vault notes] One write_vault_note per idea (space_id spc_1)"), "{text}");
		assert!(text.contains("Space CSE 21. Mode: teacher writes."));
		assert!(text.contains("1. tpc_1 \"Stars and bars\", new. shaky, 2 of 3 right.\n   m1a2b3c wrong: \"Solutions to x1+x2+x3=7?\"\n   kinds so far: none\n   passages: f_ab:4 \"n identical items into k bins\"\n   links: Combinations (yours), Objects into boxes\n   yours, maybe covering: none\n"), "{text}");
	}

	#[test]
	fn an_update_sends_godspeeds_sections_or_says_all_are_the_learners() {
		let mine = Entry::Update(vec![Section { name: "recall".to_owned(), text: "> [!recall] Without looking".to_owned() }]);
		let text = notes_block(&block(vec![topic(mine)]));
		assert!(text.contains("updating.") && text.contains("sections godspeed's: recall\n   recall: > [!recall] Without looking"), "{text}");
		let text = notes_block(&block(vec![topic(Entry::Update(Vec::new()))]));
		assert!(text.contains("all sections yours: send only mistakes"), "{text}");
	}

	#[test]
	fn the_sections_sent_with_an_update_are_cut_to_the_limit() {
		let long = Section { name: "in short".to_owned(), text: "word ".repeat(1_000) };
		let text = notes_block(&block(vec![topic(Entry::Update(vec![long]))]));
		let sent = text.lines().find(|l| l.starts_with("   in short: ")).unwrap();
		assert!(sent.chars().count() < SECTIONS_MAX_CHARS + 20, "{}", sent.chars().count());
	}

	#[test]
	fn the_mode_and_kept_notes_show() {
		let mut b = block(vec![topic(Entry::New)]);
		b.words = Words::Mine;
		b.kept = vec![("Mine/Sets.md".to_owned(), "Sets".to_owned())];
		let text = notes_block(&b);
		assert!(text.contains("Mode: learner adds My words, you write the rest."));
		assert!(text.contains("Kept notes no topic name matched.") && text.contains("   Mine/Sets.md \"Sets\""), "{text}");
	}
}
