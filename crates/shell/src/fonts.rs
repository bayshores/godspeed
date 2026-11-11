//! The installed font families, as the font picker lists them.

use gs_base::locale;

/// Every family once, sorted like the picker shows them.
pub fn list() -> Vec<String> {
	tidy(system_families())
}

fn tidy(mut names: Vec<String>) -> Vec<String> {
	// An icon font, not one to read in.
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
	fn the_list_drops_the_icon_font_names_a_family_once_and_sorts_like_the_picker() {
		let names = ["Times", "iconfont", "arial", "Courier", "Arial", "Times", "Courier", "iconfont"].map(str::to_owned).to_vec();
		assert_eq!(tidy(names), ["arial", "Arial", "Courier", "Times"]);
	}
}
