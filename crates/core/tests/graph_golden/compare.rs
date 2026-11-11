//! Comparing a Rust result with the golden value, and the id/time renaming both sides apply to a
//! merge run (the TypeScript twin is `normalise` in graph-support.ts).

use std::collections::{HashMap, HashSet};

use gs_base::hash::sha256_text;
use gs_json::{Json, Obj, stringify};

fn short(value: &Json) -> String {
	stringify(value).chars().take(160).collect()
}

/// The golden marks a big value as `{ "$sha": sha256 of its JSON text, "$len": array length or key count }`.
fn digest_of(want: &Json) -> Option<(&str, f64)> {
	let obj = want.as_obj()?;
	(obj.len() == 2).then_some(())?;
	Some((obj.get("$sha")?.as_str()?, obj.get("$len")?.as_f64()?))
}

fn length_of(got: &Json) -> usize {
	match got {
		Json::Arr(a) => a.len(),
		Json::Obj(o) => o.len(),
		_ => 0,
	}
}

/// The first place `got` differs from `want`, or None when they are the same value with the same key order.
pub fn diff(want: &Json, got: &Json) -> Option<String> {
	walk(want, got, &mut String::new())
}

fn walk(want: &Json, got: &Json, path: &mut String) -> Option<String> {
	if let Some((sha, len)) = digest_of(want) {
		if length_of(got) as f64 != len {
			return Some(format!("{path}: length {} but Node has {len}", length_of(got)));
		}
		return (sha256_text(&stringify(got)) != sha).then(|| format!("{path}: digest differs (Rust gave {})", short(got)));
	}
	let mark = path.len();
	let found = match (want, got) {
		(Json::Arr(w), Json::Arr(g)) => {
			if w.len() != g.len() {
				return Some(format!("{path}: {} items but Node has {}", g.len(), w.len()));
			}
			w.iter().zip(g).enumerate().find_map(|(i, (w, g))| {
				path.truncate(mark);
				path.push_str(&format!("[{i}]"));
				walk(w, g, path)
			})
		}
		(Json::Obj(w), Json::Obj(g)) => {
			let (wk, gk): (Vec<&String>, Vec<&String>) = (w.keys().collect(), g.keys().collect());
			if wk != gk {
				return Some(format!("{path}: keys {gk:?} but Node has {wk:?}"));
			}
			w.iter().zip(g.values()).find_map(|((key, w), g)| {
				path.truncate(mark);
				path.push_str(&format!(".{key}"));
				walk(w, g, path)
			})
		}
		_ => (want != got).then(|| format!("{path}: {} but Node has {}", short(got), short(want))),
	};
	path.truncate(mark);
	found
}

/// Every string anywhere in a value (keys are not ids).
pub fn strings_of(value: &Json, out: &mut HashSet<String>) {
	match value {
		Json::Str(s) => {
			out.insert(s.clone());
		}
		Json::Arr(items) => items.iter().for_each(|v| strings_of(v, out)),
		Json::Obj(obj) => obj.values().for_each(|v| strings_of(v, out)),
		_ => {}
	}
}

fn is_iso_time(s: &str) -> bool {
	let b = s.as_bytes();
	b.len() == 24
		&& b.iter().enumerate().all(|(i, c)| match i {
			4 | 7 => *c == b'-',
			10 => *c == b'T',
			13 | 16 => *c == b':',
			19 => *c == b'.',
			23 => *c == b'Z',
			_ => c.is_ascii_digit(),
		})
}

/// `n` or `arg` when the text is that prefix, an underscore and twelve hex digits.
fn fresh_id_prefix(s: &str) -> Option<&str> {
	let (prefix, hex) = s.split_once('_')?;
	let fresh = matches!(prefix, "n" | "arg") && hex.len() == 12 && hex.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c));
	fresh.then_some(prefix)
}

struct Renamer<'a> {
	known: &'a HashSet<String>,
	renamed: HashMap<String, String>,
	counts: HashMap<String, usize>,
}

impl Renamer<'_> {
	fn walk(&mut self, v: &Json) -> Json {
		match v {
			Json::Str(s) if self.known.contains(s) => v.clone(),
			Json::Str(s) if is_iso_time(s) => Json::from("NOW"),
			Json::Str(s) => match fresh_id_prefix(s) {
				None => v.clone(),
				Some(prefix) => {
					if !self.renamed.contains_key(s) {
						let n = self.counts.entry(prefix.to_owned()).or_insert(0);
						*n += 1;
						self.renamed.insert(s.clone(), format!("{prefix}_NEW{n}"));
					}
					Json::from(self.renamed[s].as_str())
				}
			},
			Json::Arr(items) => Json::Arr(items.iter().map(|x| self.walk(x)).collect()),
			Json::Obj(obj) => {
				let mut out = Obj::new();
				for (k, x) in obj.iter() {
					out.insert(k.clone(), self.walk(x));
				}
				Json::Obj(out)
			}
			_ => v.clone(),
		}
	}
}

/// Ids the inputs did not hold become `<prefix>_NEW<k>` in order of first appearance; new times become "NOW".
pub fn normalise(value: &Json, known: &HashSet<String>) -> Json {
	Renamer { known, renamed: HashMap::new(), counts: HashMap::new() }.walk(value)
}
