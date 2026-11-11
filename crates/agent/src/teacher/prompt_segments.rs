//! Which parts of the shipped prompt each agent composes, and the learner's saved version of each
//! (src/backend/agent/prompt-segments.ts).
//!
//! The shared base comes first, then the agent's own numbered fragments in file order, then the
//! shared fragments as a trailing appendix. Practice, homework and talk skip the base (their own
//! 00-base.md plays that role) and take only a curated shared set. Study is the teacher plus the
//! practice hint rules plus its own fragment. A saved version is used in place of the source; one
//! keyed to a part the app no longer ships stops composing by itself.

use gs_store::prompt_overrides::PromptOverrides;

use super::prompts::SOURCES;

/// Which agent's prompt to compose.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AgentKind {
	Prober,
	Teacher,
	Practice,
	Study,
	Homework,
	Talk,
}

/// Voice, accuracy and the mental model are one law across every agent, and formatting too
/// (practice writes the same LaTeX and markdown). The question, confidence and file mechanics stay
/// out: practice has no such tools.
const PRACTICE_SHARED: [&str; 5] = ["10-voice.md", "12-class-context.md", "15-accuracy.md", "16-mental-model.md", "40-formatting.md"];
/// Talk is a small side panel: the voice only (its own base sets short replies).
const TALK_SHARED: [&str; 1] = ["10-voice.md"];
/// The hint and claimed-answer rules study and homework problems run on.
const HINT_RULES: [&str; 1] = ["20-hints.md"];

/// One part of an agent's prompt: its source text and the learner's saved version.
#[derive(Debug, PartialEq)]
pub struct PromptSegment {
	/// The key a saved version is stored under, the same in every agent's list.
	pub path: &'static str,
	pub source_text: &'static str,
	pub override_text: Option<String>,
	/// True for the base and the shared fragments, which more than one agent composes.
	pub shared: bool,
}

type Source = (&'static str, &'static str);

/// One folder's fragments in file order (only the named ones when given).
fn folder(dir: &str, only: Option<&[&str]>) -> Vec<Source> {
	let in_folder = |path: &str| path.split_once('/').is_some_and(|(at, file)| at == dir && only.is_none_or(|names| names.contains(&file)));
	SOURCES.iter().copied().filter(|(path, _)| in_folder(path)).collect()
}

fn source_segments(kind: AgentKind) -> Vec<Source> {
	let own = matches!(kind, AgentKind::Practice | AgentKind::Homework | AgentKind::Talk);
	let mut parts = if own { Vec::new() } else { vec![SOURCES[0]] };
	match kind {
		AgentKind::Prober => parts.extend(folder("prober", None)),
		AgentKind::Teacher => parts.extend(folder("teacher", None)),
		AgentKind::Practice => parts.extend(folder("practice", None)),
		AgentKind::Talk => parts.extend(folder("talk", None)),
		AgentKind::Study => {
			parts.extend(folder("teacher", None));
			parts.extend(folder("practice", Some(&HINT_RULES)));
			parts.extend(folder("study", None));
		}
		AgentKind::Homework => {
			parts.extend(folder("homework", None));
			parts.extend(folder("practice", Some(&HINT_RULES)));
		}
	}
	let allowed: Option<&[&str]> = match kind {
		AgentKind::Practice | AgentKind::Homework => Some(&PRACTICE_SHARED),
		AgentKind::Talk => Some(&TALK_SHARED),
		_ => None,
	};
	parts.extend(folder("shared", allowed));
	parts
}

/// Every part of one agent's prompt with its source and the learner's saved version. The saved
/// files are read fresh per call, so a save applies on the next turn.
pub fn effective_prompt_segments(kind: AgentKind, prompts: &PromptOverrides) -> Vec<PromptSegment> {
	source_segments(kind)
		.into_iter()
		.map(|(path, source_text)| PromptSegment { path, source_text, override_text: prompts.read_override(path), shared: path == "system-prompt.md" || path.starts_with("shared/") })
		.collect()
}

/// Every segment path the lesson agents compose, sorted: what a saved version may be for.
pub fn all_segment_paths() -> Vec<&'static str> {
	let mut paths: Vec<&str> = [AgentKind::Prober, AgentKind::Teacher, AgentKind::Practice, AgentKind::Study, AgentKind::Homework].into_iter().flat_map(source_segments).map(|(path, _)| path).collect();
	paths.sort_unstable();
	paths.dedup();
	paths
}
