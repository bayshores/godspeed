//! An older build's Talk chat as Markdown for `Talk.md` in the godspeed folder: who said what,
//! each change a tool made as one line, math left as its source. Its pictures come back as files
//! to save in the folder beside it (`Talk files/`); its PDFs are named by the file they were saved
//! as in the chat's folder, which is copied there too.

use gs_base::base64;
use gs_base::hash::sha256_hex;
use gs_base::text::{slice16, trim};
use gs_json::Json;

use crate::messages::role::Role;
use super::attachments::pdf_note_of;
use crate::spaces::today_note::{day_label, local_day};

pub struct TalkExport {
	pub text: String,
	pub pictures: Vec<Picture>,
}

/// A picture from the chat, decoded, with the file name the text links to.
pub struct Picture {
	pub name: String,
	pub bytes: Vec<u8>,
}

#[derive(Clone, Copy, PartialEq)]
enum Speaker {
	You,
	Teacher,
	Godspeed,
}

/// The chat as Markdown, linking its pictures and PDFs in the folder `files` beside it; None when
/// nothing in it was ever shown.
pub fn talk_export(record: &Json, teacher: &str, files: &str) -> Option<TalkExport> {
	let mut pictures = Vec::new();
	let mut rows: Vec<(Speaker, Option<i64>, String)> = Vec::new();
	for m in record["messages"].items() {
		if m["display"] == Json::Bool(false) {
			continue;
		}
		let at = m["timestamp"].as_f64().map(|t| t as i64);
		match (Role::of(m), m["customType"].as_str()) {
			(Some(Role::User), _) => rows.extend(learner_lines(&m["content"], files, &mut pictures).into_iter().map(|line| (Speaker::You, at, line))),
			(Some(Role::Assistant), _) => rows.extend(m["content"].items().iter().filter(|p| p["type"].as_str() == Some("text")).filter_map(|p| shown(&p["text"])).map(|text| (Speaker::Teacher, at, text))),
			(Some(Role::ToolResult), _) => {
				let labels = m["details"]["changes"].items().iter().filter_map(|c| c["label"].as_str());
				rows.extend(labels.map(|label| (Speaker::Teacher, at, format!("- {label}"))));
			}
			(Some(Role::Custom), Some("app-request")) => rows.push((Speaker::Godspeed, at, asked_text(teacher, &m["details"]["deadlines"]))),
			_ => {}
		}
	}
	if rows.is_empty() {
		return None;
	}
	let mut text = String::from("# Talk\n\nYour Talk chat from earlier versions of godspeed, saved here so you can still read it.\n");
	let (mut speaker, mut day) = (None, None);
	for (who, at, line) in rows {
		let today = at.map(local_day);
		if today.is_some() && today != day {
			let label = today.as_deref().unwrap_or_default();
			text.push_str(&format!("\n## {} {}\n", day_label(label), &label[..4]));
			day = today;
			speaker = None;
		}
		if speaker != Some(who) {
			let name = match who {
				Speaker::You => "You",
				Speaker::Teacher => teacher,
				Speaker::Godspeed => "godspeed",
			};
			text.push_str(&format!("\n**{name}**\n"));
			speaker = Some(who);
		}
		text.push_str(&format!("\n{line}\n"));
	}
	Some(TalkExport { text, pictures })
}

fn shown(text: &Json) -> Option<String> {
	text.as_str().map(trim).filter(|t| !t.is_empty()).map(str::to_owned)
}

/// The learner's words, a link per PDF, and each picture as an image link to its new file.
fn learner_lines(content: &Json, files: &str, pictures: &mut Vec<Picture>) -> Vec<String> {
	if let Some(text) = shown(content) {
		return vec![text];
	}
	let mut lines = Vec::new();
	for part in content.items() {
		match part["type"].as_str() {
			Some("text") => {
				let Some(text) = shown(&part["text"]) else { continue };
				lines.push(match pdf_note_of(&text) {
					Some((name, path)) => format!("[PDF: {name}](<{files}/{}>)", file_name(&path)),
					None => text,
				});
			}
			Some("image") => {
				let bytes = base64::decode(part["data"].str_or_empty());
				let name = format!("{}.{}", slice16(&sha256_hex(&bytes), 0, Some(12)), extension(part["mimeType"].as_str()));
				lines.push(format!("![Picture](<{files}/{name}>)"));
				if !pictures.iter().any(|p| p.name == name) {
					pictures.push(Picture { name, bytes });
				}
			}
			_ => {}
		}
	}
	lines
}

/// The last part of a saved path, on any computer's separators.
fn file_name(path: &str) -> &str {
	path.rsplit(['/', '\\']).next().unwrap_or(path)
}

fn extension(mime: Option<&str>) -> &'static str {
	match mime {
		Some("image/jpeg") => "jpg",
		Some("image/gif") => "gif",
		Some("image/webp") => "webp",
		_ => "png",
	}
}

/// As the Talk panel showed it: "Asked Marco to work out what's on Midterm (CSE 21) from your files."
fn asked_text(teacher: &str, deadlines: &Json) -> String {
	let names: Vec<String> = deadlines.items().iter().map(|d| format!("{} ({})", d["name"].str_or_empty(), d["spaceName"].str_or_empty())).collect();
	let list = match names.split_last() {
		Some((last, rest)) if rest.len() >= 2 => format!("{} and {last}", rest.join(", ")),
		_ => names.join(" and "),
	};
	format!("Asked {teacher} to work out what's on {list} from your files.")
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;

	#[test]
	fn pictures_become_files_and_pdfs_links() {
		let picture = base64::encode(b"\x89PNG tiny");
		let record = json!({ "messages": [
			{ "role": "custom", "customType": "today-context", "display": false, "content": "[Today]" },
			{ "role": "user", "content": [
				{ "type": "text", "text": "what is $x^2$ here?" },
				{ "type": "image", "data": picture, "mimeType": "image/png" },
				{ "type": "text", "text": "[Attached PDF] Week 3.pdf\nPath: /data/chats/chat_talk/0123456789ab-Week 3.pdf\nRead it with the pdf tool when you need its content." },
			] },
			{ "role": "assistant", "content": [{ "type": "text", "text": "It is $x \\cdot x$." }, { "type": "toolCall", "name": "create_space" }] },
			{ "role": "toolResult", "details": { "changes": [{ "label": "Creating Algebra", "page": "/space" }] } },
			{ "role": "custom", "customType": "app-request", "details": { "deadlines": [{ "name": "Midterm", "spaceName": "Algebra" }, { "name": "Quiz", "spaceName": "Algebra" }, { "name": "Final", "spaceName": "Biology" }] } },
		] });
		let export = talk_export(&record, "Marco", "Talk files").unwrap();
		let name = format!("{}.png", &sha256_hex(b"\x89PNG tiny")[..12]);
		assert_eq!(
			export.text,
			format!(
				"# Talk\n\nYour Talk chat from earlier versions of godspeed, saved here so you can still read it.\n\n**You**\n\nwhat is $x^2$ here?\n\n![Picture](<Talk files/{name}>)\n\n[PDF: Week 3.pdf](<Talk files/0123456789ab-Week 3.pdf>)\n\n**Marco**\n\nIt is $x \\cdot x$.\n\n- Creating Algebra\n\n**godspeed**\n\nAsked Marco to work out what's on Midterm (Algebra), Quiz (Algebra) and Final (Biology) from your files.\n"
			)
		);
		assert_eq!(export.pictures.len(), 1);
		assert_eq!((export.pictures[0].name.as_str(), export.pictures[0].bytes.as_slice()), (name.as_str(), &b"\x89PNG tiny"[..]));
		let beside = talk_export(&record, "Marco", "Talk files (godspeed)").unwrap().text;
		assert!(beside.contains(&format!("![Picture](<Talk files (godspeed)/{name}>)")) && beside.contains("](<Talk files (godspeed)/0123456789ab-Week 3.pdf>)"));
	}

	#[test]
	fn a_chat_with_nothing_shown_has_no_export() {
		assert!(talk_export(&json!({ "messages": [] }), "Teacher", "Talk files").is_none());
		assert!(talk_export(&json!({ "messages": [{ "role": "custom", "customType": "compaction", "content": "[SESSION HISTORY COMPACTED]" }] }), "Teacher", "Talk files").is_none());
	}

	#[test]
	fn each_day_gets_a_heading() {
		let (first, second) = (1_762_000_000_000_i64, 1_762_000_000_000_i64 + 2 * 86_400_000);
		let record = json!({ "messages": [
			{ "role": "user", "content": "hi", "timestamp": first },
			{ "role": "assistant", "content": [{ "type": "text", "text": "Hello." }], "timestamp": first },
			{ "role": "user", "content": "back", "timestamp": second },
		] });
		let text = talk_export(&record, "Teacher", "Talk files").unwrap().text;
		let heading = |ms: i64| format!("## {} {}", day_label(&local_day(ms)), &local_day(ms)[..4]);
		assert!(text.ends_with(&format!("\n{}\n\n**You**\n\nhi\n\n**Teacher**\n\nHello.\n\n{}\n\n**You**\n\nback\n", heading(first), heading(second))), "{text}");
	}
}
