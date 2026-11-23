//! What godspeed asks the learner's agent to do on deadlines: work out what they cover, write a
//! study guide, or rewrite what one is like (the deadline page, one deadline), or check a space
//! (godspeed itself, one space with every reason it has, each reason once).

use std::collections::{BTreeSet, HashSet};

use gs_base::text::cmp16;
use gs_base::{hash, time};
use gs_json::{Json, Obj};

use super::file_state::{FileKind, FileStatus};
use super::prep_upgrade::{ABOUT_FILE_NAME, GUIDE_FILE_NAME};
use crate::contracts::space::MAX_PATH_TOPICS;
use crate::messages::role::is_custom;
use super::today_note::local_day;

/// Files added this soon after a space's first file came with its setup, which handles them.
const SETUP_MS: i64 = 60 * 60_000;

/// What a request asks for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RequestKind {
	Coverage,
	Guide,
	About,
}

impl RequestKind {
	pub fn parse(name: &str) -> Option<RequestKind> {
		Some(match name {
			"coverage" => RequestKind::Coverage,
			"guide" => RequestKind::Guide,
			"about" => RequestKind::About,
			_ => return None,
		})
	}

	pub fn name(self) -> &'static str {
		match self {
			RequestKind::Coverage => "coverage",
			RequestKind::Guide => "guide",
			RequestKind::About => "about",
		}
	}
}

/// A deadline a request is about.
#[derive(Debug, Clone, PartialEq)]
pub struct RequestedDeadline {
	pub id: String,
	pub name: String,
	pub space_name: String,
	pub space_id: String,
	pub date: String,
	pub time: Option<String>,
	/// Files linked to it already.
	pub linked: usize,
}

fn text_of(value: &Json) -> String {
	value.str_or_empty().to_owned()
}

/// `deadline` of the space record `space`.
pub fn requested_deadline(space: &Json, deadline: &Json) -> RequestedDeadline {
	RequestedDeadline {
		id: text_of(&deadline["id"]),
		name: text_of(&deadline["name"]),
		space_name: text_of(&space["name"]),
		space_id: text_of(&space["id"]),
		date: text_of(&deadline["date"]),
		time: deadline["time"].as_str().filter(|t| !t.is_empty()).map(str::to_owned),
		linked: deadline["fileIds"].items().len(),
	}
}

/// Open deadlines (not done, not past) with no files linked, in spaces that aren't closed and
/// have a study file ready, minus the ones already asked. Spaces are space records.
pub fn unlinked_deadlines(spaces: &[Json], today: &str, asked: &HashSet<String>) -> Vec<RequestedDeadline> {
	let mut out = Vec::new();
	for c in spaces {
		let has_ready_study = c["files"].items().iter().any(|f| FileKind::of(f) == Some(FileKind::Study) && FileStatus::of(f) == Some(FileStatus::Ready));
		if c["closed"].truthy() || !has_ready_study {
			continue;
		}
		for d in c["deadlines"].items() {
			let open = !d["done"].truthy()
				&& cmp16(d["date"].str_or_empty(), today).is_ge()
				&& d["fileIds"].as_arr().is_some_and(Vec::is_empty)
				&& !asked.contains(d["id"].str_or_empty());
			if open {
				out.push(requested_deadline(c, d));
			}
		}
	}
	out
}

/// The deadlines godspeed asked about in the Talk chat of earlier versions.
pub fn asked_deadline_ids(messages: &[Json]) -> HashSet<String> {
	let requests = messages.iter().filter(|m| is_custom(m, "app-request"));
	requests.flat_map(|m| m["details"]["deadlines"].items()).map(|d| text_of(&d["id"])).collect()
}

fn line(d: &RequestedDeadline) -> String {
	let time = d.time.as_ref().map_or_else(String::new, |t| format!(" {t}"));
	let linked = match d.linked {
		0 => String::new(),
		1 => ", 1 file linked".to_owned(),
		n => format!(", {n} files linked"),
	};
	format!("- {} in {} (space_id {}, deadline_id {}, due {}{time}{linked})", d.name, d.space_name, d.space_id, d.id, d.date)
}

/// What godspeed already asked its agent about (`data/deadline-requests.json`).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct AskedRecord {
	/// Deadlines asked about with nothing linked.
	pub asked: BTreeSet<String>,
	/// ISO time of the first check: only files added after it count.
	pub since: Option<String>,
	/// `<file id>:<contentFp>` of each info file checked.
	pub checked_info: BTreeSet<String>,
	/// `<deadline id>:<file id>` of each study file weighed for a deadline.
	pub weighed: BTreeSet<String>,
	/// `<space id>:<hash of the path's topic ids>` of each path asked to grow.
	pub path_asked: BTreeSet<String>,
	/// Overdue deadlines the learner said Not yet to.
	pub overdue_asked: BTreeSet<String>,
	/// The keys of the gaps (`space_gaps`) the learner waved off, the newest per space.
	pub gap_asked: BTreeSet<String>,
}

pub const ASKED_VERSION: u32 = 2;

fn string_set(value: &Json) -> BTreeSet<String> {
	value.items().iter().filter_map(|v| v.as_str().map(str::to_owned)).collect()
}

impl AskedRecord {
	/// The record as saved; version 1 had only `asked`.
	pub fn read(saved: &Json) -> AskedRecord {
		AskedRecord {
			asked: string_set(&saved["asked"]),
			since: saved["since"].as_str().map(str::to_owned),
			checked_info: string_set(&saved["checkedInfo"]),
			weighed: string_set(&saved["weighed"]),
			path_asked: string_set(&saved["pathAsked"]),
			overdue_asked: string_set(&saved["overdueAsked"]),
			gap_asked: string_set(&saved["gapAsked"]),
		}
	}

	/// The fields to save; the store adds the version stamp.
	pub fn to_json(&self) -> Json {
		let mut out = Obj::new();
		out.insert("asked", self.asked.iter().cloned().collect::<Vec<_>>());
		if let Some(since) = &self.since {
			out.insert("since", since.as_str());
		}
		out.insert("checkedInfo", self.checked_info.iter().cloned().collect::<Vec<_>>());
		out.insert("weighed", self.weighed.iter().cloned().collect::<Vec<_>>());
		out.insert("pathAsked", self.path_asked.iter().cloned().collect::<Vec<_>>());
		out.insert("overdueAsked", self.overdue_asked.iter().cloned().collect::<Vec<_>>());
		out.insert("gapAsked", self.gap_asked.iter().cloned().collect::<Vec<_>>());
		Json::Obj(out)
	}

	/// The learner waved off a gap: its key replaces the space's older ones.
	pub fn answer_gap(&mut self, key: &str) {
		let space = key.split(':').next().unwrap_or_default();
		self.gap_asked.retain(|asked| asked.split(':').next() != Some(space));
		self.gap_asked.insert(key.to_owned());
	}

	/// A check that ended well: each of its reasons counts as asked.
	pub fn mark(&mut self, reasons: &[Reason]) {
		for reason in reasons {
			match reason {
				Reason::Unlinked(d) => {
					self.asked.insert(d.id.clone());
				}
				Reason::Info { file_id, content_fp, .. } => {
					let prefix = format!("{file_id}:");
					self.checked_info.retain(|key| !key.starts_with(&prefix));
					self.checked_info.insert(format!("{file_id}:{content_fp}"));
				}
				Reason::Unweighed { deadline_id, file_id, .. } => {
					self.weighed.insert(format!("{deadline_id}:{file_id}"));
				}
				Reason::Path { asked, .. } => {
					let space = asked.split(':').next().unwrap_or_default();
					self.path_asked.retain(|key| key.split(':').next() != Some(space));
					self.path_asked.insert(asked.clone());
				}
			}
		}
	}
}

/// Why godspeed checks a space.
#[derive(Debug, Clone, PartialEq)]
pub enum Reason {
	/// An open deadline with nothing linked.
	Unlinked(RequestedDeadline),
	/// A ready info file new since the first check, or read again after a change.
	Info { file_id: String, name: String, content_fp: String },
	/// A new ready study file not yet weighed for a deadline that has files.
	Unweighed { deadline_id: String, deadline_name: String, file_id: String, file_name: String },
	/// The goal path runs low: `topics` on it, `left` of them not strong yet. `asked` is its
	/// `pathAsked` entry.
	Path { asked: String, topics: usize, left: usize },
}

fn added_ms(file: &Json) -> Option<i64> {
	time::parse_date(file["addedAt"].str_or_empty())
}

/// Rule 4: a path with fewer than `MAX_PATH_TOPICS` topics and at most this many not strong
/// grows. With none left the agent may say the goal is reached.
const PATH_LOW: usize = 3;

/// Rule 4 for `path`, the progress payload's path (each topic with its `status`), unless this
/// very list of topics was asked about.
fn path_reason(space_id: &str, path: &Json, record: &AskedRecord) -> Option<Reason> {
	let topics = path["topics"].items();
	let left = topics.iter().filter(|t| t["status"].as_str() != Some("strong")).count();
	if topics.is_empty() || topics.len() >= MAX_PATH_TOPICS || left > PATH_LOW {
		return None;
	}
	let ids: Vec<&str> = topics.iter().map(|t| t["id"].str_or_empty()).collect();
	let asked = format!("{space_id}:{}", &hash::sha256_text(&ids.join(","))[..12]);
	(!record.path_asked.contains(&asked)).then_some(Reason::Path { asked, topics: topics.len(), left })
}

/// The space's reasons to be checked (none for a closed space): rule 1 with `asked` (the
/// record's, the old Talk chat's and the running requests' deadline ids), rule 4 for its `path`,
/// and rules 2 and 3 for files added after the record's `since`, leaving out those that came with
/// the space's setup. Files the agent wrote itself never count as info files.
pub fn space_reasons(space: &Json, path: Option<&Json>, today: &str, record: &AskedRecord, asked: &HashSet<String>) -> Vec<Reason> {
	if space["closed"].truthy() {
		return Vec::new();
	}
	let mut reasons: Vec<Reason> = unlinked_deadlines(std::slice::from_ref(space), today, asked).into_iter().map(Reason::Unlinked).collect();
	reasons.extend(path.and_then(|p| path_reason(space["id"].str_or_empty(), p, record)));
	let Some(since) = record.since.as_deref().and_then(time::parse_date) else { return reasons };
	let files = space["files"].items();
	let Some(first) = files.iter().filter_map(added_ms).min() else { return reasons };
	// A ready file of `kind` added after setup, with the time it was added.
	let ready = |kind: FileKind| {
		files.iter().filter_map(move |f| {
			let at = added_ms(f)?;
			(FileKind::of(f) == Some(kind) && FileStatus::of(f) == Some(FileStatus::Ready) && at >= first + SETUP_MS).then_some((f, at))
		})
	};
	for (f, at) in ready(FileKind::Info).filter(|(f, _)| !f["written"].truthy()) {
		let (id, fp) = (f["id"].str_or_empty(), f["contentFp"].str_or_empty());
		let prefix = format!("{id}:");
		let counts = match record.checked_info.iter().find(|key| key.starts_with(&prefix)) {
			Some(key) => key[prefix.len()..] != *fp,
			None => at > since,
		};
		if counts {
			reasons.push(Reason::Info { file_id: id.to_owned(), name: f["name"].str_or_empty().to_owned(), content_fp: fp.to_owned() });
		}
	}
	for d in space["deadlines"].items() {
		let linked = d["fileIds"].strs();
		if d["done"].truthy() || cmp16(d["date"].str_or_empty(), today).is_lt() || linked.is_empty() {
			continue;
		}
		let (left_out, deadline_id) = (d["leftOutIds"].strs(), d["id"].str_or_empty());
		for (f, at) in ready(FileKind::Study) {
			let id = f["id"].str_or_empty();
			let weighed = linked.contains(&id) || left_out.contains(&id) || record.weighed.contains(&format!("{deadline_id}:{id}"));
			if !weighed && at > since && cmp16(&local_day(at), d["date"].str_or_empty()).is_le() {
				reasons.push(Reason::Unweighed {
					deadline_id: deadline_id.to_owned(),
					deadline_name: d["name"].str_or_empty().to_owned(),
					file_id: id.to_owned(),
					file_name: f["name"].str_or_empty().to_owned(),
				});
			}
		}
	}
	reasons
}

/// A deadline as the check lists it.
fn check_deadline_line(d: &Json) -> String {
	let time = d["time"].as_str().filter(|t| !t.is_empty()).map_or_else(String::new, |t| format!(" {t}"));
	let done = if d["done"].truthy() { ", done" } else { "" };
	let linked = d["fileIds"].items().len();
	let linked = if linked == 0 { String::new() } else { format!(", {linked} linked") };
	format!("- {} ({}, deadline_id {}, due {}{time}{done}{linked})", d["name"].str_or_empty(), d["kind"].str_or_empty(), d["id"].str_or_empty(), d["date"].str_or_empty())
}

/// The reasons as lines; a deadline's unweighed files share one line.
fn reason_lines(reasons: &[Reason]) -> Vec<String> {
	let mut lines = Vec::new();
	let mut unweighed: Vec<(&str, &str, Vec<String>)> = Vec::new();
	for reason in reasons {
		match reason {
			Reason::Unlinked(d) => lines.push(format!("- {} (deadline_id {}) has nothing linked: work out what it covers, link with file_ids, left_out_ids, source.", d.name, d.id)),
			Reason::Info { file_id, name, .. } => lines.push(format!("- Info file {name} (file_id {file_id}) new or changed: add deadlines it names, fix changed dates and times.")),
			Reason::Unweighed { deadline_id, deadline_name, file_id, file_name } => match unweighed.iter_mut().find(|(id, ..)| id == deadline_id) {
				Some((_, _, files)) => files.push(format!("{file_name} ({file_id})")),
				None => unweighed.push((deadline_id, deadline_name, vec![format!("{file_name} ({file_id})")])),
			},
			Reason::Path { topics, left, .. } => lines.push(format!("- Path running low: {topics} topics, only {left} not strong yet.")),
		}
	}
	for (id, name, files) in unweighed {
		lines.push(format!("- New study files for {name} (deadline_id {id}): {}. Covered: add to file_ids; not: add to left_out_ids.", files.join(", ")));
	}
	lines
}

/// The check's request for the agent: fixed rules, the space's reasons and every deadline (done
/// and past ones too, so one the files name again is not added twice).
pub fn check_text(space: &Json, reasons: &[Reason]) -> String {
	let mut out = format!(
		"Check space {} (space_id {}): act on each reason below. Deadline changes: only what files settle.\n\
		- Never add a deadline twice: check list below first. Never make up a date.\n\
		- file_ids and left_out_ids replace whole list: keep current links (read_space).\n\
		- Never remove a deadline. One that looks cancelled: say so in last line.\n",
		space["name"].str_or_empty(),
		space["id"].str_or_empty()
	);
	if reasons.iter().any(|r| matches!(r, Reason::Path { .. })) {
		out.push_str("- Path running low: with update_space, keep current topics and add up to 10 next ones toward goal (40 at most), refresh description. Goal already reached: add none, say so.\n");
	}
	out.push_str("Reasons:\n");
	out.push_str(&reason_lines(reasons).join("\n"));
	let deadlines = space["deadlines"].items();
	out.push_str("\nDeadlines:\n");
	out.push_str(&if deadlines.is_empty() { "none".to_owned() } else { deadlines.iter().map(check_deadline_line).collect::<Vec<_>>().join("\n") });
	out
}

/// The request for the agent.
pub fn request_text(kind: RequestKind, deadlines: &[RequestedDeadline]) -> String {
	let list = deadlines.iter().map(line).collect::<Vec<_>>().join("\n");
	match kind {
		RequestKind::Coverage => format!(
			"Work out what {} from the space's own files (a practice exam or review sheet, the syllabus schedule, announcements) \
			and link them with update_space_deadline: file_ids, left_out_ids for earlier files it doesn't cover, and source for the file you went by.\n{list}",
			if deadlines.len() == 1 { "this deadline covers" } else { "each of these deadlines covers" }
		),
		RequestKind::Guide => format!(
			"Write a study guide for this deadline from the space's own files: the topics to know and how to practice each. \
			Add it with add_space_file as {GUIDE_FILE_NAME} (kind study), then add its id to the deadline's file_ids with update_space_deadline, keeping the ids already there.\n{list}"
		),
		RequestKind::About => format!(
			"Rewrite what this deadline is like. Write it with add_space_file as {ABOUT_FILE_NAME} (kind info) and set it as the deadline's about_file_id with update_space_deadline.\n{list}"
		),
	}
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;

	fn space() -> Json {
		json!({
			"id": "cls_a", "name": "CSE 21", "closed": false,
			"files": [{ "kind": "study", "status": "ready" }],
			"deadlines": [
				{ "id": "d1", "name": "Midterm", "date": "2026-11-02", "time": "10:00", "fileIds": [] },
				{ "id": "d2", "name": "Past", "date": "2026-10-01", "fileIds": [] },
				{ "id": "d3", "name": "Linked", "date": "2026-11-05", "fileIds": ["f"] },
				{ "id": "d4", "name": "Asked", "date": "2026-11-05", "fileIds": [] },
				{ "id": "d5", "name": "Done", "date": "2026-11-05", "fileIds": [], "done": true },
			],
		})
	}

	#[test]
	fn only_open_unlinked_unasked_deadlines_count() {
		let asked: HashSet<String> = ["d4".to_owned()].into();
		let found = unlinked_deadlines(&[space()], "2026-10-30", &asked);
		assert_eq!(found.iter().map(|d| d.id.as_str()).collect::<Vec<_>>(), ["d1"]);
		assert_eq!(found[0].time.as_deref(), Some("10:00"));
		let mut closed = space();
		closed.as_obj_mut().unwrap().insert("closed", true);
		assert!(unlinked_deadlines(&[closed], "2026-10-30", &asked).is_empty());
	}

	#[test]
	fn each_request_names_its_deadlines() {
		let found = unlinked_deadlines(&[space()], "2026-10-30", &HashSet::new());
		let text = request_text(RequestKind::Coverage, &found[..1]);
		assert!(text.starts_with("Work out what this deadline covers from the space's own files"));
		assert!(text.ends_with("source for the file you went by.\n- Midterm in CSE 21 (space_id cls_a, deadline_id d1, due 2026-11-02 10:00)"));
		assert!(request_text(RequestKind::Coverage, &found).contains("each of these deadlines covers"));
		let linked = requested_deadline(&space(), &space()["deadlines"][2]);
		assert!(request_text(RequestKind::Guide, &[linked]).ends_with("keeping the ids already there.\n- Linked in CSE 21 (space_id cls_a, deadline_id d3, due 2026-11-05, 1 file linked)"));
		assert!(request_text(RequestKind::About, &found[..1]).contains("add_space_file as What it's like.md (kind info)"));
	}

	#[test]
	fn the_old_talk_chat_s_requests_count_as_asked() {
		let request = json!({ "role": "custom", "customType": "app-request", "details": { "deadlines": [{ "id": "d1" }, { "id": "d4" }] } });
		assert_eq!(asked_deadline_ids(&[request, json!({ "role": "user", "content": "hi" })]), HashSet::from(["d1".to_owned(), "d4".to_owned()]));
	}

	/// A space set up on Nov 1 at 10:00, with a syllabus from then and new files 2 hours later.
	fn checked_space() -> Json {
		let file = |id: &str, name: &str, kind: &str, at: &str| json!({ "id": id, "name": name, "kind": kind, "status": "ready", "contentFp": format!("fp_{id}"), "addedAt": at });
		json!({
			"id": "spc_a", "name": "CSE 21", "closed": false,
			"files": [
				file("f_syl", "Syllabus.pdf", "info", "2026-11-01T10:00:00.000Z"),
				file("f_w1", "Week 1.pdf", "study", "2026-11-01T10:30:00.000Z"),
				file("f_hw5", "HW5.md", "info", "2026-11-01T12:00:00.000Z"),
				file("f_w7", "Week 7.pdf", "study", "2026-11-01T12:00:00.000Z"),
				json!({ "id": "f_late", "name": "Week 9.pdf", "kind": "study", "status": "pending", "contentFp": "", "addedAt": "2026-11-01T12:00:00.000Z" }),
			],
			"deadlines": [
				{ "id": "d_final", "kind": "exam", "name": "Final", "date": "2026-12-10", "fileIds": ["f_w1"] },
				{ "id": "d_quiz", "kind": "quiz", "name": "Quiz 1", "date": "2026-11-03", "fileIds": [] },
				{ "id": "d_past", "kind": "exam", "name": "Midterm", "date": "2026-10-20", "fileIds": ["f_w1"] },
				{ "id": "d_left", "kind": "exam", "name": "Quiz 2", "date": "2026-11-20", "fileIds": ["f_w1"], "leftOutIds": ["f_w7"] },
			],
		})
	}

	fn record(since: &str) -> AskedRecord {
		AskedRecord { since: Some(since.to_owned()), ..AskedRecord::default() }
	}

	fn names(reasons: &[Reason]) -> Vec<String> {
		reasons
			.iter()
			.map(|r| match r {
				Reason::Unlinked(d) => format!("unlinked {}", d.id),
				Reason::Info { file_id, .. } => format!("info {file_id}"),
				Reason::Unweighed { deadline_id, file_id, .. } => format!("weigh {file_id} for {deadline_id}"),
				Reason::Path { asked, .. } => format!("path {asked}"),
			})
			.collect()
	}

	#[test]
	fn a_space_is_checked_for_unlinked_deadlines_and_files_added_after_its_setup_and_the_first_check() {
		let space = checked_space();
		let found = space_reasons(&space, None, "2026-11-02", &record("2026-11-01T11:00:00.000Z"), &HashSet::new());
		assert_eq!(names(&found), ["unlinked d_quiz", "info f_hw5", "weigh f_w7 for d_final"], "setup files, pending files, past and left-out deadlines don't count");
		let later = space_reasons(&space, None, "2026-11-02", &record("2026-11-01T13:00:00.000Z"), &HashSet::new());
		assert_eq!(names(&later), ["unlinked d_quiz"], "files from before the first check are never checked");
		assert_eq!(names(&space_reasons(&space, None, "2026-11-02", &AskedRecord::default(), &["d_quiz".to_owned()].into())), Vec::<String>::new(), "no first check yet");
		let mut closed = space.clone();
		closed.as_obj_mut().unwrap().insert("closed", true);
		assert!(space_reasons(&closed, None, "2026-11-02", &record("2026-11-01T11:00:00.000Z"), &HashSet::new()).is_empty());
	}

	#[test]
	fn a_study_file_counts_only_for_deadlines_due_on_or_after_the_day_it_came() {
		let mut space = checked_space();
		space.get_mut("deadlines").unwrap().as_arr_mut().unwrap()[0].as_obj_mut().unwrap().insert("date", "2026-10-31");
		let found = space_reasons(&space, None, "2026-10-31", &record("2026-11-01T11:00:00.000Z"), &HashSet::new());
		assert!(!names(&found).iter().any(|n| n.starts_with("weigh")), "{found:?}");
	}

	#[test]
	fn a_file_the_agent_wrote_is_never_an_info_reason() {
		let mut space = checked_space();
		space.get_mut("files").unwrap().as_arr_mut().unwrap()[2].as_obj_mut().unwrap().insert("written", true);
		let found = space_reasons(&space, None, "2026-11-02", &record("2026-11-01T11:00:00.000Z"), &HashSet::new());
		assert!(!names(&found).contains(&"info f_hw5".to_owned()), "{found:?}");
	}

	/// A path of `n` topics, the first `strong` of them strong.
	fn path(n: usize, strong: usize) -> Json {
		let topics: Vec<Json> = (0..n).map(|i| json!({ "id": format!("pth_{i}"), "name": format!("Topic {i}"), "status": if i < strong { "strong" } else { "new" } })).collect();
		json!({ "goal": "backend developer", "topics": topics })
	}

	#[test]
	fn a_path_grows_once_three_or_fewer_topics_are_left_and_is_asked_once_per_list() {
		let space = checked_space();
		let reasons = |p: &Json, asked: &AskedRecord| space_reasons(&space, Some(p), "2026-11-02", asked, &["d_quiz".to_owned()].into());
		let none = AskedRecord::default();
		assert!(reasons(&path(10, 6), &none).is_empty(), "four left");
		assert!(reasons(&path(40, 38), &none).is_empty(), "the path is full");
		let low = reasons(&path(10, 7), &none);
		let Some(Reason::Path { asked, topics: 10, left: 3 }) = low.first() else { panic!("{low:?}") };
		assert!(asked.starts_with("spc_a:") && asked.len() == "spc_a:".len() + 12);
		let mut marked = AskedRecord::default();
		marked.mark(&low);
		assert!(reasons(&path(10, 7), &marked).is_empty(), "the same list is asked once");
		assert!(reasons(&path(10, 10), &marked).is_empty(), "the same list with all strong");
		assert_eq!(reasons(&path(11, 9), &marked).len(), 1, "a list that grew counts again");
	}

	#[test]
	fn reasons_asked_once_stay_asked_and_an_info_file_read_again_counts_again() {
		let space = checked_space();
		let mut asked = record("2026-11-01T11:00:00.000Z");
		let found = space_reasons(&space, None, "2026-11-02", &asked, &HashSet::new());
		asked.mark(&found);
		assert!(asked.asked.contains("d_quiz"));
		assert!(space_reasons(&space, None, "2026-11-02", &asked, &asked.asked.iter().cloned().collect()).is_empty());
		let mut changed = space.clone();
		changed.get_mut("files").unwrap().as_arr_mut().unwrap()[2].as_obj_mut().unwrap().insert("contentFp", "fp_new");
		let again = space_reasons(&changed, None, "2026-11-02", &asked, &asked.asked.iter().cloned().collect());
		assert_eq!(names(&again), ["info f_hw5"]);
		asked.mark(&again);
		assert_eq!(asked.checked_info.iter().collect::<Vec<_>>(), ["f_hw5:fp_new"], "one entry per file");
	}

	#[test]
	fn the_record_reads_version_one_and_writes_version_two() {
		let old = AskedRecord::read(&json!({ "version": 1, "asked": ["d2", "d1"] }));
		assert_eq!(old, AskedRecord { asked: ["d1".to_owned(), "d2".to_owned()].into(), ..AskedRecord::default() });
		let mut full = record("2026-11-01T11:00:00.000Z");
		full.mark(&[Reason::Path { asked: "spc_a:h1".to_owned(), topics: 12, left: 3 }]);
		full.mark(&[Reason::Path { asked: "spc_a:h2".to_owned(), topics: 22, left: 2 }]);
		full.overdue_asked.insert("d_quiz".to_owned());
		full.answer_gap("spc_a:d_hw6:1");
		full.answer_gap("spc_b:d_t2:recent");
		full.answer_gap("spc_a:d_hw6:2");
		assert_eq!(
			gs_json::stringify(&full.to_json()),
			r#"{"asked":[],"since":"2026-11-01T11:00:00.000Z","checkedInfo":[],"weighed":[],"pathAsked":["spc_a:h2"],"overdueAsked":["d_quiz"],"gapAsked":["spc_a:d_hw6:2","spc_b:d_t2:recent"]}"#
		);
		assert_eq!(AskedRecord::read(&full.to_json()), full);
	}

	#[test]
	fn the_check_names_its_rules_reasons_and_every_deadline() {
		let space = checked_space();
		let found = space_reasons(&space, None, "2026-11-02", &record("2026-11-01T11:00:00.000Z"), &HashSet::new());
		let text = check_text(&space, &found);
		assert!(text.starts_with("Check space CSE 21 (space_id spc_a)"));
		assert!(!text.contains("- Path:"), "the path rule only with a path reason");
		assert!(text.contains("\nReasons:\n- Quiz 1 (deadline_id d_quiz) has nothing linked"));
		assert!(text.contains("- Info file HW5.md (file_id f_hw5) new or changed"));
		assert!(text.contains("- New study files for Final (deadline_id d_final): Week 7.pdf (f_w7)."));
		assert!(text.ends_with("\nDeadlines:\n- Final (exam, deadline_id d_final, due 2026-12-10, 1 linked)\n- Quiz 1 (quiz, deadline_id d_quiz, due 2026-11-03)\n- Midterm (exam, deadline_id d_past, due 2026-10-20, 1 linked)\n- Quiz 2 (exam, deadline_id d_left, due 2026-11-20, 1 linked)"));
		let path = check_text(&space, &[Reason::Path { asked: "spc_a:h".to_owned(), topics: 12, left: 3 }]);
		assert!(path.contains("add up to 10 next ones toward goal") && path.contains("Reasons:\n- Path running low: 12 topics, only 3 not strong yet."));
	}

	#[test]
	fn kinds_read_back_their_names() {
		for kind in [RequestKind::Coverage, RequestKind::Guide, RequestKind::About] {
			assert_eq!(RequestKind::parse(kind.name()), Some(kind));
		}
		assert_eq!(RequestKind::parse("talk"), None);
	}
}
