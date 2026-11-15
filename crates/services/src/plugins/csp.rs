//! The Content-Security-Policy every plugin file is served with. The page is sandboxed even when
//! opened on its own (`sandbox allow-scripts`: an opaque origin, no popups, no top navigation).
//! It loads code only from its own folder, and reaches the network only at the manifest's hosts.
//! Host sources name the folder itself, because how `'self'` matches in a document with an opaque
//! origin differs between browsers.

/// Where plugin files are served: `/plugin-files/<id>/<path>`.
pub const FILES_PREFIX: &str = "/plugin-files";

/// Whether `host` (the request's Host header) is this computer with a port, as the window and a
/// browser on this computer reach the server. Only such a host goes into the header.
pub fn is_loopback_host(host: &str) -> bool {
	let Some((name, port)) = host.rsplit_once(':') else { return false };
	matches!(name, "127.0.0.1" | "localhost" | "[::1]") && !port.is_empty() && port.len() <= 5 && port.chars().all(|c| c.is_ascii_digit())
}

/// The policy for plugin `id` reached at `host`, with its manifest's network hosts.
pub fn plugin_csp(host: &str, id: &str, network: &[&str]) -> String {
	let own = format!("http://{host}{FILES_PREFIX}/{id}/");
	let hosts: String = network.iter().map(|h| format!(" https://{h}")).collect();
	let connect = if hosts.is_empty() { " 'none'".to_owned() } else { hosts.clone() };
	[
		"default-src 'none'".to_owned(),
		format!("script-src {own} 'unsafe-inline'"),
		format!("style-src {own} 'unsafe-inline'"),
		format!("img-src {own} data: blob:{hosts}"),
		format!("font-src {own} data:{hosts}"),
		format!("media-src {own} data: blob:{hosts}"),
		format!("connect-src{connect}"),
		"form-action 'none'".to_owned(),
		"base-uri 'none'".to_owned(),
		format!("frame-ancestors http://{host}"),
		"sandbox allow-scripts".to_owned(),
	]
	.join("; ")
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn the_policy_names_the_plugin_s_folder_and_its_hosts_only() {
		assert_eq!(
			plugin_csp("127.0.0.1:4000", "memes", &["api.memegen.link"]),
			"default-src 'none'; script-src http://127.0.0.1:4000/plugin-files/memes/ 'unsafe-inline'; style-src http://127.0.0.1:4000/plugin-files/memes/ 'unsafe-inline'; img-src http://127.0.0.1:4000/plugin-files/memes/ data: blob: https://api.memegen.link; font-src http://127.0.0.1:4000/plugin-files/memes/ data: https://api.memegen.link; media-src http://127.0.0.1:4000/plugin-files/memes/ data: blob: https://api.memegen.link; connect-src https://api.memegen.link; form-action 'none'; base-uri 'none'; frame-ancestors http://127.0.0.1:4000; sandbox allow-scripts"
		);
		let offline = plugin_csp("localhost:3000", "quiz", &[]);
		assert!(offline.contains("connect-src 'none';"));
		assert!(offline.contains("img-src http://localhost:3000/plugin-files/quiz/ data: blob:;"));
		assert!(!offline.contains("/api"));
	}

	#[test]
	fn only_this_computer_s_hosts_go_into_the_header() {
		for good in ["127.0.0.1:3000", "localhost:4000", "[::1]:3000"] {
			assert!(is_loopback_host(good), "{good}");
		}
		for bad in ["127.0.0.1", "evil.com:3000", "127.0.0.1:30a0", "127.0.0.1:3000; script-src *", "localhost:", "127.0.0.1:123456"] {
			assert!(!is_loopback_host(bad), "{bad}");
		}
	}
}
