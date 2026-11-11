//! A new-issue link with an empty report template. Only the app version and OS go in, never
//! anything from the learner's data.

use tauri::AppHandle;

use crate::log;

pub fn open(app: &AppHandle) {
	let version = app.package_info().version.to_string();
	let arch = match std::env::consts::ARCH {
		"aarch64" => "arm64",
		"x86_64" => "x64",
		other => other,
	};
	// Reading the OS version runs helper programs (sw_vers, uname, lsb_release); off the main
	// thread, where menu and command handlers run, they cannot freeze the window.
	std::thread::spawn(move || {
		let link = url(&version, std::env::consts::OS, &os_info::get().version().to_string(), arch);
		if let Err(err) = tauri_plugin_opener::open_url(link, None::<&str>) {
			log::line(&format!("cannot open the bug report page: {err}"));
		}
	});
}

fn url(version: &str, os: &str, os_version: &str, arch: &str) -> String {
	let os_name = match os {
		"macos" => "macOS",
		"windows" => "Windows",
		"linux" => "Linux",
		other => other,
	};
	let body = ["### What happened", "", "### What you expected", "", "### Steps to reproduce", "", "---", &format!("godspeed {version} · {os_name} {os_version} {arch}")].join("\n");
	format!("https://github.com/bayshores/godspeed/issues/new?body={}", encode_uri_component(&body))
}

/// JavaScript's `encodeURIComponent`.
fn encode_uri_component(text: &str) -> String {
	text.bytes()
		.map(|b| match b {
			b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')' => char::from(b).to_string(),
			_ => format!("%{b:02X}"),
		})
		.collect()
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn opens_a_new_issue_with_the_template_version_and_os() {
		let body = ["### What happened", "", "### What you expected", "", "### Steps to reproduce", "", "---", "godspeed 0.5.0 · macOS 26.0.1 arm64"].join("\n");
		assert_eq!(url("0.5.0", "macos", "26.0.1", "arm64"), format!("https://github.com/bayshores/godspeed/issues/new?body={}", encode_uri_component(&body)));
		assert!(url("0.5.0", "macos", "26.0.1", "arm64").starts_with("https://github.com/bayshores/godspeed/issues/new?body=%23%23%23%20What%20happened%0A%0A"));
	}

	#[test]
	fn names_windows_and_linux() {
		assert!(url("1.0.0", "windows", "10.0", "x64").ends_with(&encode_uri_component("godspeed 1.0.0 · Windows 10.0 x64")));
		assert!(url("1.0.0", "linux", "10.0", "x64").ends_with(&encode_uri_component("godspeed 1.0.0 · Linux 10.0 x64")));
	}

	#[test]
	fn encodes_like_javascript() {
		assert_eq!(encode_uri_component("a b·c/?(x)!~*'"), "a%20b%C2%B7c%2F%3F(x)!~*'");
	}
}
