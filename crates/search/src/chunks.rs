//! Space files cut into passages, each with where it sits in its file, and the places the agent
//! names (chunkFile, chunkText, rangePoint, snippetOf in src/shared/core/search.ts). Every length
//! and cut counts UTF-16 units like the TS.

use std::sync::LazyLock;

use gs_base::re::Re;
use gs_base::{num, text};
use gs_core::contracts::space::{extension_of, is_transcript_file};
use gs_json::js_number as finite_number;
use gs_json::lone::{from_utf16, to_utf16};

/// One piece of a space file. `from`/`to` locate it: pages (PDFs), slides (PowerPoint), sections
/// (EPUB), seconds (captions) or lines (text).
#[derive(Clone, Debug, PartialEq)]
pub struct PassageChunk {
	pub range: String,
	pub from: f64,
	pub to: f64,
	pub text: String,
}

/// A file's passages plus its size for the space outline ("98 pages").
#[derive(Debug, PartialEq)]
pub struct ChunkedFile {
	pub chunks: Vec<PassageChunk>,
	pub extent: String,
}

/// About 400 tokens: the embedding model reads at most 512.
const MAX_PASSAGE_CHARS: usize = 1600;
/// About 300 tokens: the target size of a text window.
const TEXT_WINDOW_CHARS: usize = 1200;
/// Caption windows close after a minute and never pass a minute and a half.
const CAPTION_WINDOW_MIN_S: f64 = 60.0;
const CAPTION_WINDOW_MAX_S: f64 = 90.0;

/// PDFs (text with "--- Page N ---" heads) by page, PowerPoint ("--- Slide N ---") by slide, EPUB
/// ("--- Section N ---") by section, .srt/.vtt (the raw caption file) by time, everything else by paragraph windows.
pub fn chunk_file(name: &str, text: &str) -> ChunkedFile {
	match extension_of(name).as_str() {
		".pdf" => chunk_headed(text, "Page", "p.", "page"),
		".pptx" => chunk_headed(text, "Slide", "slide", "slide"),
		".epub" => chunk_headed(text, "Section", "section", "section"),
		_ if is_transcript_file(name) => chunk_captions(text),
		_ => chunk_text(text),
	}
}

fn chunk_headed(text: &str, head: &str, label: &str, unit: &str) -> ChunkedFile {
	let parts = Re::new(&format!("^--- {head} (\\d+) ---$"), "m").split(text);
	let mut chunks = Vec::new();
	let mut count = 0f64;
	for pair in parts[1..].chunks(2) {
		let n = js_number_of(pair[0].as_deref().unwrap_or(""));
		count = count.max(n);
		for piece in split_long(text::trim(pair[1].as_deref().unwrap_or("")), MAX_PASSAGE_CHARS) {
			chunks.push(PassageChunk { range: format!("{label} {}", js_number(n)), from: n, to: n, text: piece });
		}
	}
	let unit = if count == 1.0 { unit.to_owned() } else { format!("{unit}s") };
	ChunkedFile { chunks, extent: format!("{} {unit}", js_number(count)) }
}

/// Text longer than `max` split at line ends (one huge line at spaces), each piece at most `max`.
fn split_long(text: &str, max: usize) -> Vec<String> {
	if text.is_empty() {
		return Vec::new();
	}
	if text::len16(text) <= max {
		return vec![text.to_owned()];
	}
	let mut out = Vec::new();
	let mut cur = String::new();
	let mut cur_len = 0;
	for line in text.split('\n') {
		let pieces = if text::len16(line) > max { hard_wrap(line, max) } else { vec![line.to_owned()] };
		for piece in pieces {
			let len = text::len16(&piece);
			if !cur.is_empty() && cur_len + 1 + len > max {
				out.push(std::mem::replace(&mut cur, piece));
				cur_len = len;
			} else if cur.is_empty() {
				cur = piece;
				cur_len = len;
			} else {
				cur.push('\n');
				cur.push_str(&piece);
				cur_len += 1 + len;
			}
		}
	}
	if !text::trim(&cur).is_empty() {
		out.push(cur);
	}
	out
}

/// One line cut at the last space before `max` (when past halfway), else at `max`.
fn hard_wrap(line: &str, max: usize) -> Vec<String> {
	let units = to_utf16(line);
	let mut rest = &units[..];
	let mut out = Vec::new();
	while rest.len() > max {
		let cut = rest[..=max].iter().rposition(|&u| u == u16::from(b' '));
		let at = cut.filter(|&c| c > max / 2).unwrap_or(max);
		out.push(from_utf16(&rest[..at]));
		rest = &rest[at..];
		let skip = rest.iter().take_while(|&&u| char::from_u32(u32::from(u)).is_some_and(text::is_js_space)).count();
		rest = &rest[skip..];
	}
	if !rest.is_empty() {
		out.push(from_utf16(rest));
	}
	out
}

/// `Number(s)` for the digit, dot and comma strings captions and places hold: "" is 0, anything
/// that is not a decimal is NaN.
fn js_number_of(s: &str) -> f64 {
	let s = text::trim(s);
	if s.is_empty() { 0.0 } else { s.parse().unwrap_or(f64::NAN) }
}

/// `String(n)`: odd caption stamps make NaN and Infinity, which land in ranges as words.
fn js_number(n: f64) -> String {
	match n {
		_ if n.is_nan() => "NaN".to_owned(),
		f64::INFINITY => "Infinity".to_owned(),
		f64::NEG_INFINITY => "-Infinity".to_owned(),
		_ => finite_number(n),
	}
}

/// "00:01:02,500" / "01:02.500" to seconds.
fn cue_seconds(stamp: &str) -> f64 {
	text::trim(stamp).replacen(',', ".", 1).split(':').map(js_number_of).fold(0.0, |total, n| total * 60.0 + n)
}

struct Cue {
	start: f64,
	end: f64,
	text: String,
}

/// `\r\n` and lone `\r` as `\n`.
/// The text with `\n` line ends, as text files are cut into lines.
pub fn unix_lines(text: &str) -> String {
	text.replace("\r\n", "\n").replace('\r', "\n")
}

fn parse_cues(raw: &str) -> Vec<Cue> {
	static TIMING: LazyLock<Re> = LazyLock::new(|| Re::new(r"^\s*([\d:.,]+)\s*-->\s*([\d:.,]+)", ""));
	static TAG: LazyLock<Re> = LazyLock::new(|| Re::new(r"<[^>]+>", "g"));
	let mut cues: Vec<Cue> = Vec::new();
	let mut current: Option<usize> = None;
	for line in unix_lines(raw).split('\n') {
		if let Some(timing) = TIMING.captures(line) {
			let stamp = |i| timing.get(i).unwrap_or_default();
			cues.push(Cue { start: cue_seconds(&stamp(1)), end: cue_seconds(&stamp(2)), text: String::new() });
			current = Some(cues.len() - 1);
			continue;
		}
		let stripped = TAG.replace(line, "");
		let t = text::trim(&stripped);
		if t.is_empty() {
			current = None;
		} else if let Some(c) = current {
			let cue = &mut cues[c];
			if !cue.text.is_empty() {
				cue.text.push(' ');
			}
			cue.text.push_str(t);
		}
	}
	cues.retain(|c| !c.text.is_empty());
	cues
}

/// Seconds as m:ss, or h:mm:ss from an hour on.
fn clock(seconds: f64) -> String {
	let s = seconds.floor();
	let h = (s / 3600.0).floor();
	let m = ((s % 3600.0) / 60.0).floor();
	let ss = text::pad_start(&js_number(s % 60.0), 2, '0');
	if h > 0.0 { format!("{}:{}:{ss}", js_number(h), text::pad_start(&js_number(m), 2, '0')) } else { format!("{}:{ss}", js_number(m)) }
}

fn chunk_captions(raw: &str) -> ChunkedFile {
	let mut chunks = Vec::new();
	let mut window: Vec<Cue> = Vec::new();
	let mut last = String::new();
	let close = |window: &mut Vec<Cue>, chunks: &mut Vec<PassageChunk>| {
		let (Some(first), Some(end)) = (window.first(), window.last()) else { return };
		let (from, to) = (first.start, end.end);
		let text = window.iter().map(|c| c.text.as_str()).collect::<Vec<_>>().join(" ");
		chunks.push(PassageChunk { range: format!("{}–{}", clock(from), clock(to)), from, to, text });
		window.clear();
	};
	for cue in parse_cues(raw) {
		// Rolling captions repeat the previous line: keep it once.
		if cue.text == last {
			continue;
		}
		last.clone_from(&cue.text);
		if let Some(first) = window.first()
			&& (cue.end - first.start > CAPTION_WINDOW_MAX_S || window_chars(&window) + text::len16(&cue.text) > MAX_PASSAGE_CHARS)
		{
			close(&mut window, &mut chunks);
		}
		window.push(cue);
		if window[window.len() - 1].end - window[0].start >= CAPTION_WINDOW_MIN_S {
			close(&mut window, &mut chunks);
		}
	}
	close(&mut window, &mut chunks);
	let minutes = num::math_round(chunks.last().map_or(0.0, |c| c.to) / 60.0);
	ChunkedFile { chunks, extent: format!("{} min", js_number(minutes)) }
}

fn window_chars(window: &[Cue]) -> usize {
	window.iter().map(|c| text::len16(&c.text) + 1).sum()
}

/// Paragraph windows of about TEXT_WINDOW_CHARS with their line ranges (1-based). Also how a long
/// passage is cut into windows for embedding.
pub fn chunk_text(text: &str) -> ChunkedFile {
	let all = unix_lines(text);
	let lines: Vec<&str> = all.split('\n').collect();
	let mut chunks = Vec::new();
	let mut buf: Vec<&str> = Vec::new();
	let (mut from, mut to, mut size) = (0, 0, 0);
	let flush = |buf: &mut Vec<&str>, from: usize, to: usize, chunks: &mut Vec<PassageChunk>| {
		let joined = buf.join("\n");
		for piece in split_long(text::trim(&joined), MAX_PASSAGE_CHARS) {
			chunks.push(PassageChunk { range: format!("lines {from}–{to}"), from: from as f64, to: to as f64, text: piece });
		}
		buf.clear();
	};
	for (i, &line) in lines.iter().enumerate() {
		let blank = text::trim(line).is_empty();
		let len = text::len16(line);
		if !buf.is_empty() && size + len + 1 > MAX_PASSAGE_CHARS {
			flush(&mut buf, from, to, &mut chunks);
		}
		if buf.is_empty() {
			if blank {
				continue;
			}
			from = i + 1;
			size = 0;
		}
		buf.push(line);
		size += len + 1;
		if !blank {
			to = i + 1;
		} else if size >= TEXT_WINDOW_CHARS {
			flush(&mut buf, from, to, &mut chunks);
		}
	}
	flush(&mut buf, from, to, &mut chunks);
	// A trailing newline ends the last line; it doesn't start another.
	let count = if lines.last() == Some(&"") { lines.len() - 1 } else { lines.len() };
	ChunkedFile { chunks, extent: format!("{count} {}", if count == 1 { "line" } else { "lines" }) }
}

/// A point inside a file as the agent names it: "p. 12" / "12" is 12, "12:30" is 750 s,
/// "lines 40–80" is 40. None when it has no number.
pub fn range_point(range: &str) -> Option<f64> {
	static TIME: LazyLock<Re> = LazyLock::new(|| Re::new(r"(\d+(?::\d{1,2}){1,2})", ""));
	static NUMBER: LazyLock<Re> = LazyLock::new(|| Re::new(r"\d+", ""));
	if let Some(time) = TIME.captures(range) {
		return Some(cue_seconds(&time.get(1).unwrap_or_default()));
	}
	NUMBER.captures(range).map(|n| js_number_of(&n.as_string()))
}

/// The most characters a snippet shows.
const SNIPPET_CHARS: i64 = 200;

/// About two lines of a passage around the first query word it holds (its start when none),
/// whitespace collapsed.
pub fn snippet_of(text: &str, query: &str) -> String {
	static SPACES: LazyLock<Re> = LazyLock::new(|| Re::new(r"\s+", "g"));
	static NON_WORD: LazyLock<Re> = LazyLock::new(|| Re::new(r"\W+", ""));
	let collapsed = SPACES.replace(text, " ");
	let flat = text::trim(&collapsed);
	let len = text::len16(flat) as i64;
	if len <= SNIPPET_CHARS {
		return flat.to_owned();
	}
	let lower = flat.to_lowercase();
	let at = NON_WORD
		.split(&query.to_lowercase())
		.into_iter()
		.flatten()
		.filter(|w| text::len16(w) > 2)
		.filter_map(|w| text::index_of16(&lower, &w, 0))
		.min()
		.map_or(0, |i| i as i64);
	let start = 0.max((at - SNIPPET_CHARS / 4).min(len - SNIPPET_CHARS));
	let body = text::slice16(flat, start, Some(start + SNIPPET_CHARS));
	format!("{}{}{}", if start > 0 { "…" } else { "" }, text::trim(&body), if start + SNIPPET_CHARS < len { "…" } else { "" })
}

#[cfg(test)]
mod tests {
	use super::*;

	fn texts(f: &ChunkedFile) -> Vec<&str> {
		f.chunks.iter().map(|c| c.text.as_str()).collect()
	}

	#[test]
	fn text_windows_carry_their_line_ranges() {
		let f = chunk_text("one\r\ntwo\n\n\nthree\n");
		assert_eq!(f.extent, "5 lines");
		assert_eq!(f.chunks, vec![PassageChunk { range: "lines 1–5".into(), from: 1.0, to: 5.0, text: "one\ntwo\n\n\nthree".into() }]);
		assert_eq!(chunk_text("").extent, "0 lines");
		assert_eq!(chunk_text("x").extent, "1 line");
		assert!(chunk_text("\n \n").chunks.is_empty());
	}

	#[test]
	fn long_lines_wrap_at_a_space_past_halfway() {
		let line = format!("{} {}", "a".repeat(1000), "b".repeat(1000));
		assert_eq!(hard_wrap(&line, 1600), vec!["a".repeat(1000), "b".repeat(1000)]);
		let solid = "c".repeat(3300);
		assert_eq!(hard_wrap(&solid, 1600).iter().map(|p| p.len()).collect::<Vec<_>>(), vec![1600, 1600, 100]);
		// A cut inside an emoji splits its UTF-16 halves like the TS.
		let emoji = format!("{}😀x", "a".repeat(1599));
		assert_eq!(text::len16(&hard_wrap(&emoji, 1600)[0]), 1600);
	}

	#[test]
	fn headed_text_goes_by_page() {
		let f = chunk_file("notes.PDF", "intro\n--- Page 1 ---\nfirst\n--- Page 3 ---\n\n--- Page 2 ---\nsecond");
		assert_eq!(texts(&f), vec!["first", "second"]);
		assert_eq!(f.chunks[1].range, "p. 2");
		assert_eq!(f.extent, "3 pages");
		assert_eq!(chunk_file("deck.pptx", "--- Slide 1 ---\nhi").extent, "1 slide");
		assert_eq!(chunk_file("deck.pptx", "no heads").extent, "0 slides");
		let book = chunk_file("book.epub", "--- Section 1 ---\nSets\nA set is a collection.\n\n--- Section 2 ---\nLogic");
		assert_eq!((book.chunks[1].range.as_str(), book.chunks[1].text.as_str(), book.extent.as_str()), ("section 2", "Logic", "2 sections"));
		assert_eq!(range_point("section 2"), Some(2.0));
	}

	#[test]
	fn captions_go_by_minute() {
		let srt = "1\n00:00:01,000 --> 00:00:02,000\n<i>Hello</i>\n\n2\n00:00:02,000 --> 00:00:03,000\nHello\n\n3\n00:01:05,500 --> 00:01:06,000\nlater\nline\n";
		let f = chunk_file("talk.srt", srt);
		assert_eq!(f.chunks, vec![PassageChunk { range: "0:01–1:06".into(), from: 1.0, to: 66.0, text: "Hello later line".into() }]);
		assert_eq!(f.extent, "1 min");
		assert_eq!(clock(3725.9), "1:02:05");
		assert_eq!(clock(f64::NAN), "NaN:NaN");
	}

	#[test]
	fn places_read_like_the_agent_writes_them() {
		assert_eq!(range_point("p. 12"), Some(12.0));
		assert_eq!(range_point("12:30"), Some(750.0));
		assert_eq!(range_point("1:02:03"), Some(3723.0));
		assert_eq!(range_point("lines 40–80"), Some(40.0));
		assert_eq!(range_point("start"), None);
		assert_eq!(cue_seconds("00:01:02,500"), 62.5);
		assert!(cue_seconds("1,2,3").is_nan());
	}

	#[test]
	fn snippets_center_on_the_first_query_word() {
		assert_eq!(snippet_of("  short\n\ttext ", "x"), "short text");
		let long = format!("{} needle {}", "word ".repeat(60), "tail ".repeat(60));
		let s = snippet_of(&long, "a needle");
		assert!(s.starts_with('…') && s.ends_with('…') && s.contains("needle"));
		assert!(snippet_of(&long, "zz").starts_with("word"));
	}
}
