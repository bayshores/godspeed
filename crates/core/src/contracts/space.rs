//! Space constants, id checks and file-type rules (src/shared/core/contracts/space.ts).

use std::cmp::Ordering;
use std::sync::LazyLock;

use gs_base::{locale, re::Re, text};
use gs_json::{Json, json};

pub const SPEECH_TOOL_INSTALL: &str = "brew install whisper-cpp ffmpeg";
/// The most files a linked folder may hold before the scan stops.
pub const MAX_LINKED_FILES: usize = 500;
pub const MAX_HOMEWORK_PROBLEMS: usize = 60;
/// Longest signature, in characters.
pub const SIGNATURE_MAX: usize = 60;
/// Longest space note, in characters.
pub const NOTE_MAX: usize = 280;
/// v9: the record file is space.json (class.json before).
pub const CURRENT_SPACE_VERSION: i64 = 9;
pub const FILE_NOT_FOUND: &str = "The file could not be found";
pub const DEADLINE_KINDS: [&str; 4] = ["exam", "homework", "quiz", "project"];

/// The subject icons a space can wear (lucide names) and what each stands for, in source order.
pub const SPACE_ICONS: [(&str, &str); 16] = [
	("cpu", "Computer science"),
	("code", "Programming"),
	("sigma", "Math"),
	("chart-line", "Statistics"),
	("atom", "Physics"),
	("flask-conical", "Chemistry"),
	("dna", "Biology"),
	("brain", "Psychology"),
	("landmark", "History"),
	("scale", "Law and politics"),
	("trending-up", "Economics"),
	("globe", "Geography"),
	("languages", "Languages"),
	("book-open", "Literature"),
	("palette", "Art"),
	("music", "Music"),
];

pub fn is_space_icon(name: &Json) -> bool {
	name.as_str().is_some_and(|n| SPACE_ICONS.iter().any(|(icon, _)| *icon == n))
}

/// How many space colors there are (--lh-space-1 to --lh-space-8).
const SPACE_COLOR_COUNT: i64 = 8;

/// A space's color: a whole number from 1 to SPACE_COLOR_COUNT.
pub fn is_space_color(color: &Json) -> bool {
	matches!(color, Json::Num(n) if n.fract() == 0.0 && *n >= 1.0 && *n <= SPACE_COLOR_COUNT as f64)
}

/// The color a new space takes: the one the fewest spaces wear, lowest number first.
pub fn next_space_color(taken: &[i64]) -> i64 {
	(1..=SPACE_COLOR_COUNT).min_by_key(|color| taken.iter().filter(|t| *t == color).count()).unwrap_or(1)
}

/// A signature as given, cleaned to one trimmed line: `{ kind, value }`, or None when the kind is
/// unknown or the value empty or longer than SIGNATURE_MAX.
pub fn clean_signature(raw: &Json) -> Option<Json> {
	let kind = raw["kind"].as_str().filter(|k| ["math", "code", "text"].contains(k))?;
	static SPACES: LazyLock<Re> = LazyLock::new(|| Re::new(r"\s+", "g"));
	let value = SPACES.replace(raw["value"].as_str()?, " ");
	let value = text::trim(&value);
	(!value.is_empty() && text::len16(value) <= SIGNATURE_MAX).then(|| json!({ "kind": kind, "value": value }))
}

/// The error a deadline edit is refused with: `code` is what the routes answer.
#[derive(Debug, Clone, PartialEq)]
pub struct SpaceDeadlineError {
	pub code: &'static str,
	pub message: String,
}

/// A real `YYYY-MM-DD` date.
pub fn is_calendar_date(date: &Json) -> bool {
	static SHAPE: LazyLock<Re> = LazyLock::new(|| Re::new(r"^\d{4}-\d{2}-\d{2}$", ""));
	let Some(d) = date.as_str().filter(|d| SHAPE.test(d)) else { return false };
	let n = |r: std::ops::Range<usize>| d[r].parse::<i64>().unwrap_or(0);
	let (y, m, day) = (n(0..4), n(5..7), n(8..10));
	(1..=12).contains(&m) && day >= 1 && gs_base::time::civil_from_days(gs_base::time::days_from_civil(y, m, 1) + day - 1) == (y, m, day)
}

/// `HH:mm`, 00:00 to 23:59.
pub fn is_clock_time(time: &Json) -> bool {
	static SHAPE: LazyLock<Re> = LazyLock::new(|| Re::new(r"^([01]\d|2[0-3]):[0-5]\d$", ""));
	time.as_str().is_some_and(|t| SHAPE.test(t))
}

pub fn is_deadline_kind(kind: &Json) -> bool {
	kind.as_str().is_some_and(|k| DEADLINE_KINDS.contains(&k))
}

/// When a deadline is due: its time, or 23:59.
pub fn deadline_due_at(deadline: &Json) -> (String, String) {
	(deadline["date"].as_str().unwrap_or("").to_owned(), deadline["time"].as_str().unwrap_or("23:59").to_owned())
}

/// Soonest first, then by time, then by name (`compareDeadlines`).
pub fn compare_deadlines(a: &Json, b: &Json) -> Ordering {
	let (da, ta) = deadline_due_at(a);
	let (db, tb) = deadline_due_at(b);
	locale::compare(&da, &db)
		.then_with(|| locale::compare(&ta, &tb))
		.then_with(|| locale::compare(a["name"].as_str().unwrap_or(""), b["name"].as_str().unwrap_or("")))
}

pub fn is_space_id(id: &str) -> bool {
	static SHAPE: LazyLock<Re> = LazyLock::new(|| Re::new(r"^(spc|cls)_[A-Za-z0-9_-]+$", ""));
	SHAPE.test(id)
}

/// A space scope from a query or body: Some(None) is "No space" (absent, "" or "none"),
/// Some(Some(id)) a space, None a bad value.
pub fn parse_space_scope(raw: Option<&str>) -> Option<Option<String>> {
	match raw {
		None | Some("" | "none") => Some(None),
		Some(id) if is_space_id(id) => Some(Some(id.to_owned())),
		Some(_) => None,
	}
}

const TEXT_EXTENSIONS: [&str; 3] = [".md", ".markdown", ".txt"];
const CODE_EXTENSIONS: [&str; 24] = [
	".c", ".h", ".cpp", ".cc", ".hpp", ".py", ".java", ".js", ".jsx", ".ts", ".tsx", ".go", ".rs", ".rb", ".swift", ".kt", ".cs", ".sql", ".sh", ".r", ".scala", ".hs", ".lua", ".php",
];
const OFFICE_EXTENSIONS: [&str; 2] = [".docx", ".pptx"];
pub const DOCUMENT_EXTENSIONS: [&str; 3] = [".pdf", ".docx", ".pptx"];
const TRANSCRIPT_EXTENSIONS: [&str; 2] = [".vtt", ".srt"];
const RECORDING_EXTENSIONS: [&str; 5] = [".mp3", ".m4a", ".wav", ".mp4", ".mov"];

/// Plain text and code, in source order.
pub fn plain_text_extensions() -> impl Iterator<Item = &'static str> {
	TEXT_EXTENSIONS.into_iter().chain(CODE_EXTENSIONS)
}

/// Every extension a space file may have, in source order.
pub fn supported_space_file_extensions() -> impl Iterator<Item = &'static str> {
	plain_text_extensions().chain(DOCUMENT_EXTENSIONS).chain(TRANSCRIPT_EXTENSIONS).chain(RECORDING_EXTENSIONS)
}

/// The lowercase extension with its dot, or "" (none, after the last slash, or not 1-10 letters
/// and digits).
pub fn extension_of(name: &str) -> String {
	let (Some(dot), slash) = (text::last_index_of16(name, "."), text::last_index_of16(name, "/").max(text::last_index_of16(name, "\\"))) else {
		return String::new();
	};
	if slash.is_some_and(|s| dot <= s) {
		return String::new();
	}
	let ext = text::slice16(name, dot as i64, None).to_lowercase();
	static SHAPE: LazyLock<Re> = LazyLock::new(|| Re::new(r"^\.[a-z0-9]{1,10}$", ""));
	if SHAPE.test(&ext) { ext } else { String::new() }
}

/// The base name of an upload, control characters dropped; "file" when nothing is left.
pub fn safe_name(name: &str) -> String {
	static TRAIL: LazyLock<Re> = LazyLock::new(|| Re::new(r"/+$", ""));
	static CONTROL: LazyLock<Re> = LazyLock::new(|| Re::new(r"[\u0000-\u001f]", "g"));
	let slashed = TRAIL.replace(&name.replace('\\', "/"), "");
	let last = slashed.rsplit('/').next().unwrap_or("");
	let base = CONTROL.replace(last, "");
	let base = text::trim(&base);
	if !base.is_empty() && base != "." && base != ".." { text::slice16(base, 0, Some(200)) } else { "file".to_owned() }
}

fn has_extension(name: &str, list: &[&str]) -> bool {
	let ext = extension_of(name);
	list.contains(&ext.as_str())
}

pub fn is_supported_space_file(name: &str) -> bool {
	let ext = extension_of(name);
	supported_space_file_extensions().any(|e| e == ext)
}

pub fn is_recording_file(name: &str) -> bool {
	has_extension(name, &RECORDING_EXTENSIONS)
}

pub fn is_transcript_file(name: &str) -> bool {
	has_extension(name, &TRANSCRIPT_EXTENSIONS)
}

pub fn is_office_file(name: &str) -> bool {
	has_extension(name, &OFFICE_EXTENSIONS)
}

pub fn is_recording_or_captions(name: &str) -> bool {
	is_recording_file(name) || is_transcript_file(name)
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn checks_match_the_typescript() {
		assert!(is_calendar_date(&json!("2024-02-29")));
		assert!(!is_calendar_date(&json!("2026-02-29")));
		assert!(!is_calendar_date(&json!("2026-1-01")));
		assert!(is_clock_time(&json!("23:59")));
		assert!(!is_clock_time(&json!("24:00")));
		assert!(is_space_id("cls_abc-1_x") && is_space_id("spc_abc-1_x") && !is_space_id("spcx_a"));
		assert_eq!(parse_space_scope(Some("none")), Some(None));
		assert_eq!(parse_space_scope(Some("bad")), None);
		assert_eq!(extension_of("Notes.TXT"), ".txt");
		assert_eq!(extension_of("a.b/c"), "");
		assert_eq!(extension_of(".env"), ".env");
		assert_eq!(extension_of("x.tar-gz"), "");
		assert_eq!(safe_name("dir\\sub/..//"), "file");
		assert_eq!(safe_name(" a\u{1}b.pdf "), "ab.pdf");
		assert!(is_supported_space_file("lec.pptx") && is_recording_or_captions("a.srt") && !is_supported_space_file("a.zip"));
		assert_eq!(clean_signature(&json!({ "kind": "math", "value": "  e^{i\\pi}\n + 1 " })), Some(json!({ "kind": "math", "value": "e^{i\\pi} + 1" })));
		assert_eq!(clean_signature(&json!({ "kind": "tex", "value": "x" })), None);
		let a = json!({ "date": "2026-11-09", "name": "B" });
		let b = json!({ "date": "2026-11-09", "time": "10:00", "name": "A" });
		assert_eq!(compare_deadlines(&a, &b), Ordering::Greater);
	}

	#[test]
	fn colors_are_whole_numbers_from_one_to_eight_and_new_ones_go_to_the_least_worn() {
		assert!(is_space_color(&json!(1)) && is_space_color(&json!(8.0)));
		assert!(!is_space_color(&json!(0)) && !is_space_color(&json!(9)) && !is_space_color(&json!(2.5)) && !is_space_color(&json!("3")));
		assert_eq!(next_space_color(&[]), 1);
		assert_eq!(next_space_color(&[1, 2, 2, 4]), 3);
		assert_eq!(next_space_color(&[1, 2, 3, 4, 5, 6, 7, 8, 1]), 2);
		assert_eq!(next_space_color(&[9, 0]), 1);
	}
}
