//! Ported from src/shared/core/prompt-segments.ts: the prompt segment path grammar.
//!
//! "system-prompt.md" (the shared base), or "<folder>/<fragment>" where the folder is one of
//! the agents or "shared" and the fragment is a numeric-prefixed .md file (20-teaching.md).
//! Posix-relative, no traversal, no nesting.

use std::sync::LazyLock;

use gs_base::re::Re;

/// A prompt fragment: numeric order key + .md (e.g. 20-teaching.md). Nothing else loads.
pub static FRAGMENT_RE: LazyLock<Re> = LazyLock::new(|| Re::new(r"^\d+-[\w.-]+\.md$", ""));

static SEGMENT_RE: LazyLock<Re> = LazyLock::new(|| Re::new(r"^(prober|teacher|practice|study|homework|talk|shared)/([\w.-]+\.md)$", ""));

/// Whether a segment path follows the layout rules.
pub fn is_valid_segment_path(segment_path: &str) -> bool {
	if segment_path == "system-prompt.md" {
		return true;
	}
	SEGMENT_RE.captures(segment_path).and_then(|m| m.get(2)).is_some_and(|file| FRAGMENT_RE.test(&file))
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn only_mirror_layout_paths_are_valid() {
		for ok in ["system-prompt.md", "shared/30-learner-files.md", "teacher/20-teaching.md", "talk/1-a.b.md"] {
			assert!(is_valid_segment_path(ok), "{ok}");
		}
		for bad in ["", "teacher/teaching.md", "teacher/20-teaching.txt", "other/20-a.md", "teacher/../20-a.md", "teacher/x/20-a.md", "/system-prompt.md", "teacher/20-a.md\n"] {
			assert!(!is_valid_segment_path(bad), "{bad}");
		}
	}
}
