//! A space file's `status` and `kind` as the app writes them. Saved files keep the same text;
//! text from disk that is none of these reads as None, so it equals no variant.

use gs_json::Json;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FileStatus {
	Pending,
	Extracting,
	Ready,
	Failed,
	NeedsWhisper,
}

impl FileStatus {
	pub fn of(file: &Json) -> Option<FileStatus> {
		Some(match file["status"].as_str()? {
			"pending" => FileStatus::Pending,
			"extracting" => FileStatus::Extracting,
			"ready" => FileStatus::Ready,
			"failed" => FileStatus::Failed,
			"needs-whisper" => FileStatus::NeedsWhisper,
			_ => return None,
		})
	}

	pub fn as_str(self) -> &'static str {
		match self {
			FileStatus::Pending => "pending",
			FileStatus::Extracting => "extracting",
			FileStatus::Ready => "ready",
			FileStatus::Failed => "failed",
			FileStatus::NeedsWhisper => "needs-whisper",
		}
	}

	/// Still to be read: queued or being read now.
	pub fn is_waiting(self) -> bool {
		matches!(self, FileStatus::Pending | FileStatus::Extracting)
	}
}

impl From<FileStatus> for Json {
	fn from(status: FileStatus) -> Json {
		Json::from(status.as_str())
	}
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FileKind {
	Study,
	Info,
}

impl FileKind {
	pub fn parse(text: &str) -> Option<FileKind> {
		match text {
			"study" => Some(FileKind::Study),
			"info" => Some(FileKind::Info),
			_ => None,
		}
	}

	pub fn of(file: &Json) -> Option<FileKind> {
		FileKind::parse(file["kind"].as_str()?)
	}

	pub fn as_str(self) -> &'static str {
		match self {
			FileKind::Study => "study",
			FileKind::Info => "info",
		}
	}
}

impl From<FileKind> for Json {
	fn from(kind: FileKind) -> Json {
		Json::from(kind.as_str())
	}
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;

	#[test]
	fn a_status_or_kind_reads_from_its_text_and_anything_else_is_none() {
		for status in [FileStatus::Pending, FileStatus::Extracting, FileStatus::Ready, FileStatus::Failed, FileStatus::NeedsWhisper] {
			assert_eq!(FileStatus::of(&json!({ "status": status.as_str() })), Some(status));
		}
		for kind in [FileKind::Study, FileKind::Info] {
			assert_eq!(FileKind::of(&json!({ "kind": kind.as_str() })), Some(kind));
			assert_eq!(FileKind::parse(kind.as_str()), Some(kind));
		}
		assert_eq!((FileStatus::of(&json!({ "status": "running" })), FileStatus::of(&json!({})), FileKind::of(&json!({ "kind": "" })), FileKind::parse("Study")), (None, None, None, None));
	}

	#[test]
	fn only_pending_and_extracting_files_are_waiting() {
		let waiting: Vec<bool> = [FileStatus::Pending, FileStatus::Extracting, FileStatus::Ready, FileStatus::Failed, FileStatus::NeedsWhisper].map(FileStatus::is_waiting).to_vec();
		assert_eq!(waiting, [true, true, false, false, false]);
	}
}
