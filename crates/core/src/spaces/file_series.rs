//! Files are `Json` records read by their `name`; a series refers to them by position in the
//! slice that was grouped.

use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

use gs_base::{locale, re::Re, text};
use gs_json::Json;

use crate::contracts::space::extension_of;

/// One number of a series and the files that carry it (a lecture's notes can come as two files).
#[derive(Debug, Clone, PartialEq)]
pub struct SeriesItem {
	pub number: f64,
	/// Positions in the grouped slice.
	pub files: Vec<usize>,
	/// `YYYY-MM-DD` when a file's name has one.
	pub date: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FileSeries {
	/// The shared start of the names, lowercased ("day", "cse21_hw", "" for "01_...").
	pub key: String,
	/// For people: "Day", "CSE21 HW", "Week, Discussion", "Numbered".
	pub label: String,
	/// In number order.
	pub items: Vec<SeriesItem>,
}

/// `2026-09-24`, or `20260924` as a whole number (a real month and day).
static DATE: LazyLock<Re> =
	LazyLock::new(|| Re::new(r"(\d{4})-(\d{2})-(\d{2})|(?<!\d)(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?!\d)", ""));

fn stem(name: &str) -> String {
	let ext = extension_of(name);
	if ext.is_empty() { name.to_owned() } else { text::slice16(name, 0, Some(-(text::len16(&ext) as i64))) }
}

/// `YYYY-MM-DD` when the name carries a date.
pub fn date_in_name(name: &str) -> Option<String> {
	split_date(name).1
}

/// The name with its date cut out, and the date.
fn split_date(name: &str) -> (String, Option<String>) {
	let Some(m) = DATE.captures(name) else { return (name.to_owned(), None) };
	let (y, mo, d) = if m.get(1).is_some() { (m.get(1), m.get(2), m.get(3)) } else { (m.get(4), m.get(5), m.get(6)) };
	let date = format!("{}-{}-{}", y.unwrap_or_default(), mo.unwrap_or_default(), d.unwrap_or_default());
	(DATE.replace(name, " "), Some(date))
}

/// Words with a letter in them: no bare numbers or dashes.
fn words(s: &str) -> Vec<String> {
	static SPLIT: LazyLock<Re> = LazyLock::new(|| Re::new(r"[\s_\-.()]+", ""));
	static LETTER: LazyLock<Re> = LazyLock::new(|| Re::new(r"\p{L}", "u"));
	SPLIT.split(s).into_iter().flatten().map(|w| text::trim(&w).to_owned()).filter(|w| LETTER.test(w)).collect()
}

/// One way to read a name as "<prefix><number><remainder>".
struct Candidate {
	key: String,
	prefix: String,
	number: f64,
	remainder: String,
}

fn candidates(name: &str) -> Vec<Candidate> {
	static DIGITS: LazyLock<Re> = LazyLock::new(|| Re::new(r"\d+", "g"));
	static EDGES: LazyLock<Re> = LazyLock::new(|| Re::new(r"^[\s_\-.]+|[\s_\-.]+$", "g"));
	static SPACES: LazyLock<Re> = LazyLock::new(|| Re::new(r"\s+", "g"));
	let (rest, _) = split_date(&stem(name));
	DIGITS
		.captures_iter(&rest)
		.into_iter()
		.map(|m| {
			let range = m.range();
			let prefix = text::slice16(&rest, 0, Some(range.start as i64));
			Candidate {
				key: SPACES.replace(&EDGES.replace(&prefix.to_lowercase(), ""), " "),
				prefix,
				number: m.as_string().parse().unwrap_or(f64::NAN),
				remainder: text::slice16(&rest, range.end as i64, None),
			}
		})
		.collect()
}

/// Shared by chance, so they name nothing ("Sets and functions", "Proofs go on and on").
const SMALL_WORDS: [&str; 18] = ["a", "an", "and", "as", "at", "by", "for", "from", "in", "into", "is", "of", "on", "or", "the", "to", "vs", "with"];

fn label_for(members: &[&Candidate]) -> String {
	static DIGIT: LazyLock<Re> = LazyLock::new(|| Re::new(r"\d", ""));
	// A prefix of name codes only ("29-fa26-l") makes no label.
	let head_words = words(&members[0].prefix);
	let head = if head_words.iter().any(|w| !DIGIT.test(w) && text::len16(w) > 1) { head_words.join(" ") } else { String::new() };
	// Words every member's remainder shares, e.g. "Discussion".
	let sets: Vec<HashSet<String>> = members.iter().map(|c| words(&c.remainder).iter().map(|w| w.to_lowercase()).collect()).collect();
	let shared: Vec<String> = words(&members[0].remainder)
		.into_iter()
		.filter(|w| !SMALL_WORDS.contains(&w.to_lowercase().as_str()) && sets.iter().all(|s| s.contains(&w.to_lowercase())))
		.collect();
	let tail = shared
		.iter()
		.enumerate()
		.filter(|(i, w)| shared.iter().position(|x| x.to_lowercase() == w.to_lowercase()) == Some(*i))
		.map(|(_, w)| w.as_str())
		.collect::<Vec<_>>()
		.join(" ");
	match (head.is_empty(), tail.is_empty()) {
		(true, true) => "Numbered".to_owned(),
		(true, false) => tail,
		(false, true) => head,
		(false, false) => format!("{head}, {tail}"),
	}
}

fn distinct_numbers(list: &[(usize, &Candidate)]) -> usize {
	list.iter().map(|(_, c)| c.number.to_bits()).collect::<HashSet<_>>().len()
}

fn name_of(files: &[Json], at: usize) -> &str {
	files[at]["name"].as_str().unwrap_or("")
}

/// Groups files into numbered series. A series needs at least two files whose numbers differ;
/// each file joins the biggest series it can (ties go to the longer prefix). The rest are
/// returned as `other` (positions), in name order.
pub fn group_file_series(files: &[Json]) -> (Vec<FileSeries>, Vec<usize>) {
	let options: Vec<Vec<Candidate>> = (0..files.len()).map(|i| candidates(name_of(files, i))).collect();
	let mut by_key: HashMap<&str, Vec<(usize, &Candidate)>> = HashMap::new();
	for (file, cs) in options.iter().enumerate() {
		for c in cs {
			by_key.entry(&c.key).or_default().push((file, c));
		}
	}
	// A key counts only when its numbers differ.
	let size = |key: &str| {
		let list = by_key.get(key).map_or(&[][..], Vec::as_slice);
		if distinct_numbers(list) > 1 { list.iter().map(|(f, _)| *f).collect::<HashSet<_>>().len() } else { 0 }
	};
	let mut chosen: Vec<(&str, Vec<(usize, &Candidate)>)> = Vec::new();
	let mut other: Vec<usize> = Vec::new();
	for (file, cs) in options.iter().enumerate() {
		let mut best: Option<&Candidate> = None;
		for c in cs {
			let s = size(&c.key);
			if s < 2 {
				continue;
			}
			if best.is_none_or(|b| s > size(&b.key) || (s == size(&b.key) && text::len16(&c.key) > text::len16(&b.key))) {
				best = Some(c);
			}
		}
		let Some(best) = best else {
			other.push(file);
			continue;
		};
		match chosen.iter_mut().find(|(k, _)| *k == best.key) {
			Some((_, list)) => list.push((file, best)),
			None => chosen.push((&best.key, vec![(file, best)])),
		}
	}
	let mut series: Vec<FileSeries> = Vec::new();
	for (key, members) in chosen {
		// A series left with one number after the others chose elsewhere isn't one.
		if distinct_numbers(&members) < 2 {
			other.extend(members.iter().map(|(f, _)| *f));
			continue;
		}
		let mut items: Vec<SeriesItem> = Vec::new();
		for (file, c) in &members {
			let at = items.iter().position(|i| i.number == c.number).unwrap_or_else(|| {
				items.push(SeriesItem { number: c.number, files: vec![], date: None });
				items.len() - 1
			});
			items[at].files.push(*file);
			if items[at].date.is_none() {
				items[at].date = split_date(&stem(name_of(files, *file))).1;
			}
		}
		items.sort_by(|a, b| a.number.partial_cmp(&b.number).unwrap_or(Ordering::Equal));
		let label = label_for(&members.iter().map(|(_, c)| *c).collect::<Vec<_>>());
		series.push(FileSeries { key: key.to_owned(), label, items });
	}
	series.sort_by(|a, b| locale::compare(&a.label, &b.label));
	other.sort_by(|a, b| locale::compare_numeric(name_of(files, *a), name_of(files, *b)));
	(series, other)
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;

	fn named(names: &[&str]) -> Vec<Json> {
		names.iter().enumerate().map(|(i, n)| json!({ "id": format!("f{i}"), "name": *n })).collect()
	}

	#[test]
	fn dates_in_both_forms() {
		assert_eq!(date_in_name("Lecture01_2026-09-25.pdf").as_deref(), Some("2026-09-25"));
		assert_eq!(date_in_name("notes 20260925.txt").as_deref(), Some("2026-09-25"));
		assert_eq!(date_in_name("x120260925.txt"), None);
		assert_eq!(date_in_name("20261325.txt"), None);
		assert_eq!(date_in_name("plain.txt"), None);
	}

	#[test]
	fn numbered_names_make_a_series() {
		let files = named(&["Day1 intro.pdf", "Day2 loops.pdf", "Day10 end.pdf", "syllabus.pdf"]);
		let (series, other) = group_file_series(&files);
		assert_eq!(series.len(), 1);
		assert_eq!((series[0].label.as_str(), series[0].key.as_str()), ("Day", "day"));
		assert_eq!(series[0].items.iter().map(|i| i.number).collect::<Vec<_>>(), [1.0, 2.0, 10.0]);
		assert_eq!(other, [3]);
	}

	#[test]
	fn names_with_only_codes_are_numbered() {
		let files = named(&["06_Counting.pdf", "07_Sets.pdf"]);
		let (series, _) = group_file_series(&files);
		assert_eq!((series[0].key.as_str(), series[0].label.as_str()), ("", "Numbered"));
	}
}
