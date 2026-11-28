//! The teacher's chats from godspeed's terminal in an older build (data/teacher-chats.json). The
//! first time the talk chats are read, each Claude Code chat from the godspeed folder that the
//! learner typed in becomes a talk chat, and the file is kept aside. Its words stay in Claude
//! Code's own session file, which the chat's read draws from (text only); a send goes on with
//! that session. Codex kept its chats in the learner's own Codex folder, which godspeed's Codex
//! cannot read, so they are not carried over.

use std::path::{Path, PathBuf};

use gs_base::{clock, fsx, time};
use gs_core::records::teacher_chats::parse_teacher_chats;
use gs_core::spaces::agent_folder::FolderAgent;
use gs_json::{Json, json};

use super::UNNAMED;
use crate::App;
use crate::app::agent_folder::agent_folder;

const FILE: &str = "teacher-chats.json";

/// Carries the old chats over once, if the old file is still there. A file that is not valid
/// JSON is kept aside unread; one that is read is kept aside after its chats are carried over.
pub(super) fn carry_over(app: &App) {
	let file = app.paths.data.join(FILE);
	if !file.exists() {
		return;
	}
	let _carrying = app.turns.carrying_talk.lock();
	let Some(saved) = fsx::read_json_or_set_aside(&file) else { return };
	let folder = agent_folder(app);
	let carried: Vec<String> = app.stores.chats.list_talk_chats().iter().filter_map(|chat| chat["terminalChat"].as_str().map(str::to_owned)).collect();
	let mut chats = parse_teacher_chats(&saved);
	chats.retain(|chat| chat.agent == FolderAgent::Claude && chat.used && chat.folder == folder && !carried.contains(&chat.id));
	chats.sort_by_key(|chat| chat.at);
	for chat in chats {
		let fields = json!({ "agentSession": { "agent": FolderAgent::Claude.name(), "id": chat.id.as_str(), "promptHash": null, "seen": null }, "terminalChat": chat.id.as_str() });
		if let Err(err) = app.stores.chats.import_talk_chat(chat.name.as_deref().unwrap_or(UNNAMED), &time::iso(chat.at), &fields) {
			// The file stays, so the next read tries again; chats already carried over are skipped.
			eprintln!("[talk] carrying over the terminal chat {} failed: {err}", chat.id);
			return;
		}
	}
	let aside = PathBuf::from(format!("{}.carried-over-{}", file.display(), clock::now_ms()));
	if let Err(err) = std::fs::rename(&file, &aside) {
		eprintln!("[talk] keeping {} aside failed: {err}", file.display());
	}
}

/// Claude Code's folder for the sessions it ran in `folder`: every character that is not a letter
/// or a digit becomes "-".
fn sessions_dir(home: &Path, folder: &str) -> PathBuf {
	let name: String = folder.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
	home.join(".claude").join("projects").join(name)
}

/// The words of a chat carried over from the terminal, from Claude Code's own session file, as
/// `[{role, text}]`: what the learner typed and what the agent wrote, older than `before` (the
/// chat's first message in godspeed, since a send writes to the same file). Empty when the file is
/// gone.
pub(super) fn earlier_words(app: &App, session: &str, before: Option<&str>) -> Vec<Json> {
	let file = sessions_dir(&app.paths.home, &agent_folder(app)).join(format!("{session}.jsonl"));
	let Ok(raw) = fsx::read_text(&file) else { return Vec::new() };
	words_of(&raw, before)
}

fn words_of(raw: &str, before: Option<&str>) -> Vec<Json> {
	let mut words: Vec<Json> = Vec::new();
	for line in raw.lines() {
		let Ok(entry) = gs_json::parse(line) else { continue };
		if entry["isSidechain"].truthy() || entry["isMeta"].truthy() {
			continue;
		}
		if before.is_some_and(|before| entry["timestamp"].as_str().is_some_and(|at| at >= before)) {
			break;
		}
		let role = match entry["type"].as_str() {
			Some("user") => "user",
			Some("assistant") => "assistant",
			_ => continue,
		};
		let text = text_of(&entry["message"]["content"]);
		if text.is_empty() || (role == "user" && is_command_echo(&text)) {
			continue;
		}
		// The agent's text comes in pieces, one entry each: one reply is one block.
		match words.last_mut() {
			Some(last) if role == "assistant" && last["role"].as_str() == Some("assistant") => {
				let joined = format!("{}\n\n{text}", last["text"].str_or_empty());
				if let Some(fields) = last.as_obj_mut() {
					fields.insert("text", joined);
				}
			}
			_ => words.push(json!({ "role": role, "text": text })),
		}
	}
	words
}

/// The text of a message's content: a plain string, or its text blocks (tool calls and results
/// are left out).
fn text_of(content: &Json) -> String {
	match content {
		Json::Str(text) => gs_base::text::trim(text).to_owned(),
		Json::Arr(blocks) => {
			let texts: Vec<&str> = blocks.iter().filter(|b| b["type"].as_str() == Some("text")).map(|b| gs_base::text::trim(b["text"].str_or_empty())).filter(|t| !t.is_empty()).collect();
			texts.join("\n\n")
		}
		_ => String::new(),
	}
}

/// What Claude Code writes in the learner's name for a slash command or its output.
fn is_command_echo(text: &str) -> bool {
	["<command-name>", "<command-message>", "<local-command-", "<system-reminder>"].iter().any(|tag| text.starts_with(tag))
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};

	const A: &str = "0f8fad5b-d9cb-469f-a165-70867728950e";
	const B: &str = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

	#[test]
	fn claude_names_a_folder_by_its_letters_and_digits() {
		assert_eq!(sessions_dir(Path::new("/h"), "/Users/sam/god.speed"), PathBuf::from("/h/.claude/projects/-Users-sam-god-speed"));
	}

	#[test]
	fn the_words_are_text_only_one_block_per_reply_and_stop_at_the_first_new_message() {
		let lines = [
			json!({ "type": "user", "isMeta": true, "message": { "role": "user", "content": "<local-command-caveat>" }, "timestamp": "2026-11-01T10:00:00.000Z" }),
			json!({ "type": "user", "message": { "role": "user", "content": "<command-name>/model</command-name>" }, "timestamp": "2026-11-01T10:00:01.000Z" }),
			json!({ "type": "user", "message": { "role": "user", "content": "What is due this week?" }, "timestamp": "2026-11-01T10:00:02.000Z" }),
			json!({ "type": "assistant", "message": { "role": "assistant", "content": [{ "type": "text", "text": "Let me look." }] }, "timestamp": "2026-11-01T10:00:03.000Z" }),
			json!({ "type": "assistant", "message": { "role": "assistant", "content": [{ "type": "tool_use", "id": "t1", "name": "read_space", "input": {} }] }, "timestamp": "2026-11-01T10:00:04.000Z" }),
			json!({ "type": "user", "message": { "role": "user", "content": [{ "type": "tool_result", "tool_use_id": "t1", "content": "{}" }] }, "timestamp": "2026-11-01T10:00:05.000Z" }),
			json!({ "type": "assistant", "message": { "role": "assistant", "content": [{ "type": "text", "text": "HW7 on Friday." }] }, "timestamp": "2026-11-01T10:00:06.000Z" }),
			json!({ "type": "assistant", "isSidechain": true, "message": { "role": "assistant", "content": [{ "type": "text", "text": "A helper's words." }] }, "timestamp": "2026-11-01T10:00:07.000Z" }),
			json!({ "type": "user", "message": { "role": "user", "content": "Thanks" }, "timestamp": "2026-11-02T09:00:00.000Z" }),
		];
		let raw = lines.iter().map(gs_json::stringify).collect::<Vec<_>>().join("\n") + "\nnot json\n";
		let words = words_of(&raw, Some("2026-11-02T09:00:00.000Z"));
		assert_eq!(words, [json!({ "role": "user", "text": "What is due this week?" }), json!({ "role": "assistant", "text": "Let me look.\n\nHW7 on Friday." })]);
		assert_eq!(words_of(&raw, None).len(), 3);
	}

	#[test]
	fn the_used_claude_chats_of_this_folder_carry_over_once_and_the_file_is_kept_aside() {
		let root = scratch_dir("talk-carry-over");
		let app = test_app(&root);
		let folder = agent_folder(&app);
		let old = json!({ "version": 1, "chats": [
			{ "id": A, "agent": "claude", "folder": folder, "name": "Limits proof", "used": true, "at": 1_793_000_000_000_i64 },
			{ "id": B, "agent": "claude", "folder": folder, "name": null, "used": false, "at": 2 },
			{ "id": "11111111-2222-4333-8444-555555555555", "agent": "codex", "folder": folder, "name": "Codex chat", "used": true, "at": 3 },
			{ "id": "11111111-2222-4333-8444-666666666666", "agent": "claude", "folder": "/elsewhere", "name": "Other folder", "used": true, "at": 4 },
		] });
		let file = app.paths.data.join(FILE);
		fsx::write_json_atomic(&file, &old).unwrap();
		carry_over(&app);
		let talk = app.stores.chats.list_talk_chats();
		assert_eq!(talk.len(), 1);
		assert_eq!((talk[0]["title"].as_str(), talk[0]["agent"].as_str(), talk[0]["updatedAt"].as_str()), (Some("Limits proof"), Some("claude"), Some(time::iso(1_793_000_000_000).as_str())));
		let record = app.stores.chats.get_chat(talk[0]["id"].str_or_empty()).unwrap();
		assert_eq!(record["agentSession"], json!({ "agent": "claude", "id": A, "promptHash": null, "seen": null }));
		assert_eq!(record["terminalChat"], json!(A));
		assert!(!file.exists());
		let aside: Vec<_> = std::fs::read_dir(&app.paths.data).unwrap().filter_map(|e| e.ok()).filter(|e| e.file_name().to_string_lossy().starts_with("teacher-chats.json.carried-over-")).collect();
		assert_eq!(aside.len(), 1);
		assert_eq!(fsx::read_json(&aside[0].path()).unwrap(), old, "kept as it was");
		carry_over(&app);
		assert_eq!(app.stores.chats.list_talk_chats().len(), 1, "once");
	}

	#[test]
	fn a_damaged_file_is_kept_aside_and_nothing_is_carried_over() {
		let root = scratch_dir("talk-carry-over-damaged");
		let app = test_app(&root);
		let file = app.paths.data.join(FILE);
		fsx::write_text_atomic(&file, "{ not json").unwrap();
		carry_over(&app);
		assert!(app.stores.chats.list_talk_chats().is_empty());
		assert!(!file.exists());
		let kept: Vec<String> = std::fs::read_dir(&app.paths.data).unwrap().filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| n.starts_with("teacher-chats.json.corrupt-")).collect();
		assert_eq!(kept.len(), 1);
		assert_eq!(std::fs::read_to_string(app.paths.data.join(&kept[0])).unwrap(), "{ not json");
	}
}
