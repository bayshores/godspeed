//! The Content-Security-Policy every plugin file is served with. The page is sandboxed even when
//! opened on its own (`sandbox allow-scripts`: an opaque origin, no popups, no top navigation).
//! It loads code only from its own folder, and reaches the network only at the manifest's hosts.
//! Host sources name the folder itself, because how `'self'` matches in a document with an opaque
//! origin differs between browsers.

/// Where plugin files are served: `/plugin-files/<id>/<path>`.
pub const FILES_PREFIX: &str = "/plugin-files";

/// The port when `host` (the request's Host header) is `localhost:<port>`, the one host plugin
/// files are served at. The window is on `127.0.0.1`, the only host the shell's Tauri
/// capabilities name, so a plugin's frame can never pass Tauri's capability check: a post to
/// the window's IPC handler from it is refused even with the right invoke key.
pub fn plugin_files_port(host: &str) -> Option<&str> {
	let port = host.strip_prefix("localhost:")?;
	(!port.is_empty() && port.len() <= 5 && port.chars().all(|c| c.is_ascii_digit())).then_some(port)
}

/// The policy for plugin `id` reached at `localhost:<port>`, with its manifest's network hosts.
/// The window that frames it is on `127.0.0.1` (the app) or `localhost` (`npm run dev` in a
/// browser), at the same port.
pub fn plugin_csp(port: &str, id: &str, network: &[&str]) -> String {
	let own = format!("http://localhost:{port}{FILES_PREFIX}/{id}/");
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
		format!("frame-ancestors http://127.0.0.1:{port} http://localhost:{port}"),
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
			plugin_csp("4000", "memes", &["api.memegen.link"]),
			"default-src 'none'; script-src http://localhost:4000/plugin-files/memes/ 'unsafe-inline'; style-src http://localhost:4000/plugin-files/memes/ 'unsafe-inline'; img-src http://localhost:4000/plugin-files/memes/ data: blob: https://api.memegen.link; font-src http://localhost:4000/plugin-files/memes/ data: https://api.memegen.link; media-src http://localhost:4000/plugin-files/memes/ data: blob: https://api.memegen.link; connect-src https://api.memegen.link; form-action 'none'; base-uri 'none'; frame-ancestors http://127.0.0.1:4000 http://localhost:4000; sandbox allow-scripts"
		);
		let offline = plugin_csp("3000", "quiz", &[]);
		assert!(offline.contains("connect-src 'none';"));
		assert!(offline.contains("img-src http://localhost:3000/plugin-files/quiz/ data: blob:;"));
		assert!(!offline.contains("/api"));
	}

	#[test]
	fn plugin_files_are_served_at_localhost_only() {
		assert_eq!(plugin_files_port("localhost:4000"), Some("4000"));
		for bad in ["127.0.0.1:3000", "[::1]:3000", "localhost", "localhost:", "evil.com:3000", "localhost:30a0", "localhost:3000; script-src *", "localhost:123456", "localhost.evil.com:3000"] {
			assert_eq!(plugin_files_port(bad), None, "{bad}");
		}
	}
}
