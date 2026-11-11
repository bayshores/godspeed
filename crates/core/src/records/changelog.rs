//! The changelog entries (src/shared/changelog.json), newest first.

use std::cmp::Ordering;
use std::sync::LazyLock;

use gs_base::re::{Caps, Re};
use gs_json::{Json, parse};

static ENTRIES: LazyLock<Vec<Json>> = LazyLock::new(|| {
	let all = parse(include_str!("../../../../src/shared/changelog.json")).expect("changelog.json is valid JSON");
	all.as_arr().cloned().unwrap_or_default()
});

static VERSION: LazyLock<Re> = LazyLock::new(|| Re::new(r"^(\d+)\.(\d+)\.(\d+)$", ""));

/// CHANGELOG: every release as `{ version, date, changes }`.
pub fn changelog() -> &'static [Json] {
	&ENTRIES
}

/// A string shaped "x.y.z".
pub fn is_version(value: &Json) -> bool {
	value.as_str().is_some_and(|v| VERSION.test(v))
}

/// Negative when a is older than b, 0 when equal, positive when newer. Anything that is not
/// "x.y.z" sorts as oldest.
pub fn compare_versions(a: &str, b: &str) -> f64 {
	let (Some(pa), Some(pb)) = (VERSION.captures(a), VERSION.captures(b)) else {
		return f64::from(u8::from(VERSION.test(a))) - f64::from(u8::from(VERSION.test(b)));
	};
	let part = |caps: &Caps, i: usize| caps.get(i).and_then(|d| d.parse::<f64>().ok()).unwrap_or(f64::NAN);
	for i in 1..=3 {
		let diff = part(&pa, i) - part(&pb, i);
		if diff != 0.0 {
			return diff;
		}
	}
	0.0
}

/// The sort order a JS comparator result means (NaN counts as equal).
fn order(diff: f64) -> Ordering {
	diff.partial_cmp(&0.0).unwrap_or(Ordering::Equal)
}

/// The entries newer than `since` and no newer than `current`, newest first.
pub fn entries_since(since: &str, current: &str, all: &[Json]) -> Vec<Json> {
	let version = |e: &Json| e["version"].as_str().unwrap_or("").to_owned();
	let mut kept: Vec<Json> = all.iter().filter(|e| compare_versions(&version(e), since) > 0.0 && compare_versions(&version(e), current) <= 0.0).cloned().collect();
	kept.sort_by(|a, b| order(compare_versions(&version(b), &version(a))));
	kept
}

/// The entry for one version.
pub fn entry_for(version: &str, all: &[Json]) -> Option<Json> {
	all.iter().find(|e| e["version"].as_str() == Some(version)).cloned()
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn versions_compare_and_select() {
		assert!(compare_versions("0.5.10", "0.5.9") > 0.0);
		assert_eq!(compare_versions("1.2.3", "1.2.3"), 0.0);
		assert_eq!(compare_versions("junk", "1.0.0"), -1.0);
		assert_eq!(compare_versions("junk", "also junk"), 0.0);
		assert!(is_version(&Json::from("0.5.44")) && !is_version(&Json::from("0.5")) && !is_version(&Json::Null));
		let picked = entries_since("0.5.41", "0.5.43", changelog());
		let versions: Vec<&str> = picked.iter().map(|e| e["version"].as_str().unwrap()).collect();
		assert_eq!(versions, ["0.5.43", "0.5.42"]);
		assert_eq!(entry_for("0.5.44", changelog()).unwrap()["date"].as_str(), Some("2026-11-09"));
		assert!(entry_for("9.9.9", changelog()).is_none());
	}
}
