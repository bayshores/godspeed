//! Linked folders by where they live: Google Drive for desktop's folders sit under
//! ~/Library/CloudStorage/GoogleDrive-<account>/.

use std::sync::LazyLock;

use gs_base::re::Re;

pub fn is_google_drive_folder(folder: &str) -> bool {
	static DRIVE: LazyLock<Re> = LazyLock::new(|| Re::new(r"/Library/CloudStorage/GoogleDrive-[^/]+(/|$)", ""));
	DRIVE.test(folder)
}

/// The folder's own name, its last path segment.
pub fn folder_name(folder: &str) -> String {
	static TRAIL: LazyLock<Re> = LazyLock::new(|| Re::new(r"[\\/]+$", ""));
	static SEPARATOR: LazyLock<Re> = LazyLock::new(|| Re::new(r"[\\/]", ""));
	SEPARATOR.split(&TRAIL.replace(folder, "")).pop().flatten().filter(|name| !name.is_empty()).unwrap_or_else(|| folder.to_owned())
}

/// Where a folder's files come from: "Google Drive", else its name.
pub fn folder_source(folder: &str) -> String {
	if is_google_drive_folder(folder) { "Google Drive".to_owned() } else { folder_name(folder) }
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn names_and_sources() {
		assert_eq!(folder_name("/a/b/CSE 21/"), "CSE 21");
		assert_eq!(folder_name("/"), "/");
		assert_eq!(folder_name("C:\\x\\y"), "y");
		assert_eq!(folder_source("/Users/a/Library/CloudStorage/GoogleDrive-me@x.edu/My Drive"), "Google Drive");
		assert_eq!(folder_source("/Users/a/Notes"), "Notes");
		assert!(!is_google_drive_folder("/Library/CloudStorage/GoogleDrive-"));
	}
}
