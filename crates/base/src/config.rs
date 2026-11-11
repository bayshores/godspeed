//! Where things live, read from the environment once at start-up (src/backend/config.ts):
//!
//! - `LH_DATA_DIR`: every mutable record; unset, `data/` in the working directory.
//! - `HOME`: `os.homedir()`; `TMPDIR`: `os.tmpdir()` (trailing slash dropped, `/tmp` when unset).
//! - The working directory holds what ships beside the server: `ui/`, `models/`, `pdfjs-dist/`.
//!
//! Stores and services take a `Paths` instead of reading globals, so tests give each one its own
//! folders.

use std::path::{Path, PathBuf};

/// The app version from package.json (`LH_VERSION` in the Node build).
pub const VERSION: &str = env!("GODSPEED_VERSION");

#[derive(Clone, Debug)]
pub struct Paths {
	pub data: PathBuf,
	/// One `<id>.json` per lesson, with `<id>/` beside it for files the learner sent.
	pub chats: PathBuf,
	/// The "No class" graph family.
	pub graph: PathBuf,
	/// One folder per class: `class.json`, `files/`, `graph/`, `cheat-sheets/`.
	pub classes: PathBuf,
	pub settings_file: PathBuf,
	/// The learner's prompt overrides, mirroring the source layout.
	pub prompts_dir: PathBuf,
	pub home: PathBuf,
	pub tmp: PathBuf,
	/// The folder with `ui/`, `models/` and `pdfjs-dist/` (the working directory).
	pub resources: PathBuf,
}

/// Every file of one graph family (the "No class" graph or a class's `graph/`).
#[derive(Clone, Debug, PartialEq)]
pub struct GraphFiles {
	pub nodes: PathBuf,
	pub chains: PathBuf,
	pub sessions: PathBuf,
	pub coverage: PathBuf,
	pub sources: PathBuf,
	pub format: PathBuf,
	pub topics: PathBuf,
}

impl GraphFiles {
	pub fn new(dir: &Path) -> GraphFiles {
		GraphFiles {
			nodes: dir.join("nodes.jsonl"),
			chains: dir.join("chains.jsonl"),
			sessions: dir.join("sessions.jsonl"),
			coverage: dir.join("coverage.jsonl"),
			sources: dir.join("sources.json"),
			format: dir.join("format.json"),
			topics: dir.join("topics.jsonl"),
		}
	}
}

/// `path.resolve(p)`: absolute and without `.` or `..` parts, symlinks left alone.
pub fn resolve(p: &Path) -> PathBuf {
	let base = if p.is_absolute() { PathBuf::new() } else { std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/")) };
	let mut out = PathBuf::new();
	for part in base.join(p).components() {
		match part {
			std::path::Component::ParentDir => {
				out.pop();
			}
			std::path::Component::CurDir => {}
			other => out.push(other),
		}
	}
	out
}

fn env_path(key: &str) -> Option<PathBuf> {
	std::env::var_os(key).filter(|v| !v.is_empty()).map(PathBuf::from)
}

impl Paths {
	/// The server's paths from its environment.
	pub fn from_env() -> Paths {
		let resources = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
		let data = env_path("LH_DATA_DIR").map_or_else(|| resources.join("data"), |p| resolve(&p));
		let home = env_path("HOME").unwrap_or_else(|| PathBuf::from("/"));
		let tmp = env_path("TMPDIR").map_or_else(|| PathBuf::from("/tmp"), |p| PathBuf::from(p.to_string_lossy().trim_end_matches('/')));
		Paths::new(data, home, tmp, resources)
	}

	pub fn new(data: PathBuf, home: PathBuf, tmp: PathBuf, resources: PathBuf) -> Paths {
		Paths {
			chats: data.join("chats"),
			graph: data.join("graph"),
			classes: data.join("classes"),
			settings_file: data.join("settings.json"),
			prompts_dir: data.join("prompts"),
			data,
			home,
			tmp,
			resources,
		}
	}

	/// The override file for a prompt segment path (validate the path first).
	pub fn prompt_override_file(&self, segment: &str) -> PathBuf {
		segment.split('/').fold(self.prompts_dir.clone(), |p, part| p.join(part))
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn layout_matches_config_ts() {
		let p = Paths::new("/d".into(), "/h".into(), "/t".into(), "/r".into());
		assert_eq!(p.chats, Path::new("/d/chats"));
		assert_eq!(p.settings_file, Path::new("/d/settings.json"));
		assert_eq!(p.prompt_override_file("shared/10-voice.md"), Path::new("/d/prompts/shared/10-voice.md"));
		assert_eq!(GraphFiles::new(&p.graph).topics, Path::new("/d/graph/topics.jsonl"));
		assert_eq!(resolve(Path::new("/a/./b/../c")), Path::new("/a/c"));
		assert!(!VERSION.is_empty());
	}
}
