//! The installed font families, as the font picker lists them.

use gs_base::locale;

/// Every family once, sorted like the picker shows them.
pub fn list() -> Vec<String> {
	let mut names = system_families();
	// The one name font-list never listed.
	names.retain(|name| name != "iconfont");
	names.sort_by(|a, b| locale::compare(a, b));
	names.dedup();
	names
}

#[cfg(target_os = "macos")]
fn system_families() -> Vec<String> {
	crate::mac::fonts::families()
}

#[cfg(not(target_os = "macos"))]
fn system_families() -> Vec<String> {
	let mut fonts = fontdb::Database::new();
	fonts.load_system_fonts();
	fonts.faces().filter_map(|face| face.families.first().map(|(name, _)| name.clone())).collect()
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn the_list_is_sorted_and_names_a_family_once() {
		let names = list();
		assert!(names.windows(2).all(|pair| locale::compare(&pair[0], &pair[1]).is_le()));
		assert!(!names.contains(&"iconfont".to_owned()));
	}
}
