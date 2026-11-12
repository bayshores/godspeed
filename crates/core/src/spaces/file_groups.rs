//! A space's files in groups, as the Files page and the godspeed folder's spaces/ show them.

use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

use gs_base::locale;
use gs_json::{Json, js_number};

use super::file_series::{FileSeries, date_in_name, group_file_series};
use crate::contracts::space::is_recording_or_captions;

/// One entry of a group: a number of a series ("Lecture 3", with every file that carries it,
/// notes and transcript together) or one other file.
#[derive(Debug, Clone, PartialEq)]
pub struct FileItem<'a> {
	pub key: String,
	/// "Lecture 3", "Week 2", "6"; None for a file outside any series.
	pub label: Option<String>,
	/// `YYYY-MM-DD` from the item's own or its paired transcript's name.
	pub date: Option<String>,
	pub files: Vec<&'a Json>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FileGroup<'a> {
	pub key: String,
	pub label: String,
	/// Files in the group (not entries).
	pub count: usize,
	pub items: Vec<FileItem<'a>>,
}

fn name_of(file: &Json) -> &str {
	file["name"].as_str().unwrap_or("")
}

/// "Day", "Week" from a series label ("Week, Discussion"); None when the names start with the
/// number ("06_Counting") or with codes ("29-fa26-l3").
fn head_of(series: &FileSeries) -> Option<&str> {
	(!series.key.is_empty() && series.label != "Numbered").then(|| series.label.split(", ").next().unwrap_or(""))
}

/// How alike two series' numbers are: shared over all (1 = the same numbers). A number whose
/// items both carry a date shares only when the dates agree (Week 1's discussion is not
/// Lecture 1).
fn likeness(a: &FileSeries, b: &FileSeries) -> f64 {
	let dates: HashMap<u64, Option<&str>> = b.items.iter().map(|i| (i.number.to_bits(), i.date.as_deref())).collect();
	let shared = a
		.items
		.iter()
		.filter(|i| dates.get(&i.number.to_bits()).is_some_and(|other| i.date.is_none() || other.is_none() || i.date.as_deref() == *other))
		.count();
	let all: HashSet<u64> = a.items.iter().chain(&b.items).map(|i| i.number.to_bits()).collect();
	if shared < 2 { 0.0 } else { shared as f64 / all.len() as f64 }
}

/// Which notes series each transcript series pairs with (transcript index to notes index): a
/// series made only of transcripts or recordings pairs with the one series that has none and
/// shares the most of its numbers (at least two, and at least half of all their numbers). Names
/// that start with their number ("01_Logic") are chapters or readings, not lecture notes, so
/// they never pair. A tie pairs nothing, and a notes series pairs once.
pub fn pair_series(files: &[Json], series: &[FileSeries]) -> HashMap<usize, usize> {
	let all = |s: &FileSeries, test: fn(&str) -> bool| s.items.iter().all(|i| i.files.iter().all(|f| test(name_of(&files[*f]))));
	let transcripts: Vec<usize> = (0..series.len()).filter(|&i| all(&series[i], is_recording_or_captions)).collect();
	let notes: Vec<usize> = (0..series.len()).filter(|&i| !series[i].key.is_empty() && all(&series[i], |n| !is_recording_or_captions(n))).collect();
	// (transcript, notes, score) in transcript order.
	let mut best: Vec<(usize, usize, f64)> = Vec::new();
	for &t in &transcripts {
		let mut scored: Vec<(usize, f64)> = notes.iter().map(|&n| (n, likeness(&series[t], &series[n]))).filter(|(_, score)| *score >= 0.5).collect();
		scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(Ordering::Equal));
		if scored.is_empty() || scored.get(1).is_some_and(|second| second.1 == scored[0].1) {
			continue;
		}
		best.push((t, scored[0].0, scored[0].1));
	}
	let mut pairs = HashMap::new();
	for &(t, pick, score) in &best {
		if best.iter().any(|&(other, p, s)| other != t && p == pick && s >= score) {
			continue;
		}
		pairs.insert(t, pick);
	}
	pairs
}

fn series_group<'a>(files: &'a [Json], series: &FileSeries, partner: Option<&FileSeries>) -> FileGroup<'a> {
	let head = head_of(series);
	let mut items: Vec<(f64, FileItem<'a>)> = Vec::new();
	let mut add = |from: &FileSeries, first: bool| {
		for item in &from.items {
			let at = items.iter().position(|(n, _)| *n == item.number).unwrap_or_else(|| {
				let number = js_number(item.number);
				let label = head.map_or_else(|| number.clone(), |h| format!("{h} {number}"));
				items.push((item.number, FileItem { key: format!("{}#{number}", series.key), label: Some(label), date: None, files: vec![] }));
				items.len() - 1
			});
			let entry = &mut items[at].1;
			let added = item.files.iter().map(|&f| &files[f]);
			entry.files = if first { added.chain(entry.files.drain(..)).collect() } else { entry.files.drain(..).chain(added).collect() };
			entry.date = item.date.clone().or(entry.date.take());
		}
	};
	// Notes first, then the transcript; the transcript's date wins.
	if let Some(partner) = partner {
		add(partner, true);
	}
	add(series, false);
	items.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(Ordering::Equal));
	let list: Vec<FileItem<'a>> = items.into_iter().map(|(_, item)| item).collect();
	FileGroup {
		key: partner.map_or_else(|| series.key.clone(), |p| format!("{}+{}", series.key, p.key)),
		label: series.label.clone(),
		count: list.iter().map(|i| i.files.len()).sum(),
		items: list,
	}
}

/// Files in no series that share a linked subfolder (two or more): one group per folder, named
/// after it, by date in the names.
fn folder_groups<'a>(other: &[&'a Json]) -> (Vec<FileGroup<'a>>, Vec<&'a Json>) {
	let mut by_dir: Vec<(String, Vec<&'a Json>)> = Vec::new();
	for &f in other {
		let path = f["path"].as_str().unwrap_or("");
		let dir = if f["origin"].as_str() == Some("linked") && path.contains('/') { &path[..path.rfind('/').unwrap_or(0)] } else { "" };
		match by_dir.iter_mut().find(|(d, _)| d == dir) {
			Some((_, list)) => list.push(f),
			None => by_dir.push((dir.to_owned(), vec![f])),
		}
	}
	let mut groups = Vec::new();
	let mut rest = Vec::new();
	for (dir, files) in by_dir {
		if dir.is_empty() || files.len() < 2 {
			rest.extend(files);
			continue;
		}
		let mut items: Vec<FileItem<'a>> =
			files.iter().map(|&f| FileItem { key: f["id"].as_str().unwrap_or("").to_owned(), label: None, date: date_in_name(name_of(f)), files: vec![f] }).collect();
		items.sort_by(|a, b| {
			locale::compare(a.date.as_deref().unwrap_or("9"), b.date.as_deref().unwrap_or("9"))
				.then_with(|| locale::compare_numeric(name_of(a.files[0]), name_of(b.files[0])))
		});
		let label = dir.rsplit('/').next().unwrap_or("").to_owned();
		groups.push(FileGroup { key: format!("folder:{dir}"), label, count: files.len(), items });
	}
	(groups, rest)
}

/// The groups: one per numbered series, a lecture's notes and transcript joined (`pair_series`),
/// one per linked subfolder of the rest, study groups first, then "Other".
pub fn file_groups(files: &[Json]) -> Vec<FileGroup<'_>> {
	let (series, other) = group_file_series(files);
	let pairs = pair_series(files, &series);
	let paired: HashSet<usize> = pairs.values().copied().collect();
	let other_files: Vec<&Json> = other.iter().map(|&i| &files[i]).collect();
	let (folder_groups, mut rest) = folder_groups(&other_files);
	let mut groups: Vec<FileGroup<'_>> =
		(0..series.len()).filter(|i| !paired.contains(i)).map(|i| series_group(files, &series[i], pairs.get(&i).map(|&p| &series[p]))).collect();
	groups.extend(folder_groups);
	// Groups with study material (lectures, readings) come before space info.
	let has_study = |g: &FileGroup<'_>| g.items.iter().any(|i| i.files.iter().any(|f| f["kind"].as_str() == Some("study")));
	groups.sort_by_key(|g| !has_study(g));
	rest.sort_by(|a, b| locale::compare_numeric(name_of(a), name_of(b)));
	if !rest.is_empty() {
		let items = rest.iter().map(|&f| FileItem { key: f["id"].as_str().unwrap_or("").to_owned(), label: None, date: None, files: vec![f] }).collect();
		groups.push(FileGroup { key: "other".to_owned(), label: "Other".to_owned(), count: rest.len(), items });
	}
	groups
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;

	fn file(id: &str, name: &str, kind: &str) -> Json {
		json!({ "id": id, "name": name, "kind": kind, "origin": "copied", "path": name })
	}

	#[test]
	fn a_transcript_series_joins_its_notes() {
		let files = vec![
			file("a", "Lecture 1 notes.pdf", "study"),
			file("b", "Lecture 2 notes.pdf", "study"),
			file("c", "Lecture 1 captions.srt", "study"),
			file("d", "Lecture 2 captions.srt", "study"),
			file("e", "syllabus.pdf", "info"),
		];
		let groups = file_groups(&files);
		assert_eq!(groups.len(), 2);
		assert_eq!(groups[0].count, 4);
		assert_eq!(groups[0].items[0].label.as_deref(), Some("Lecture 1"));
		let ids: Vec<&str> = groups[0].items[0].files.iter().map(|f| f["id"].as_str().unwrap()).collect();
		assert_eq!(ids, ["a", "c"]);
		assert_eq!(groups[1].label, "Other");
	}
}
