//! GET /plugin-files/<id>/<path>: a plugin's files for its frame, outside /api, and only at
//! `localhost` (`plugin_files_port`), never at the window's `127.0.0.1`. The frame is
//! sandboxed without `allow-same-origin`, so its own loads come from an opaque origin: they carry
//! `Sec-Fetch-Site: cross-site` and no window cookie, which /api refuses and these files don't
//! need. Module scripts and fonts load in CORS mode from that origin (`Origin: null`), hence
//! `Access-Control-Allow-Origin: *` here; the files are the plugin's public code, never its data.
//!
//! GET /plugin-fonts/<name>.woff2: the app's own font files from the built `ui/assets/`, for
//! the `@font-face` rules a plugin's page gets at initialize. Only `.woff2` files, only at
//! `localhost`, and never to a request that carries a cookie: the frame's loads carry none.

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::{HeaderMap, HeaderValue, header};
use axum::response::Response;
use gs_base::posix::extname;
use gs_services::App;
use gs_services::plugins::{plugin_csp, plugin_files_port, served_file};

use super::reply;

fn file_type(ext: &str) -> &'static str {
	match ext {
		".html" => "text/html; charset=utf-8",
		".js" | ".mjs" => "text/javascript; charset=utf-8",
		".css" => "text/css; charset=utf-8",
		".json" | ".map" => "application/json",
		".txt" => "text/plain; charset=utf-8",
		".svg" => "image/svg+xml",
		".png" => "image/png",
		".jpg" | ".jpeg" => "image/jpeg",
		".gif" => "image/gif",
		".webp" => "image/webp",
		".ico" => "image/x-icon",
		".woff2" => "font/woff2",
		".woff" => "font/woff",
		".ttf" => "font/ttf",
		".otf" => "font/otf",
		".mp3" => "audio/mpeg",
		".wav" => "audio/wav",
		".ogg" => "audio/ogg",
		".mp4" => "video/mp4",
		".webm" => "video/webm",
		_ => "application/octet-stream",
	}
}

pub(crate) async fn plugin_file(State(app): State<Arc<App>>, Path((id, file)): Path<(String, String)>, headers: HeaderMap) -> Response {
	let host = headers.get(header::HOST).and_then(|h| h.to_str().ok()).unwrap_or_default();
	let Some(port) = plugin_files_port(host) else { return reply::not_found() };
	let Some((bytes, manifest)) = served_file(&app, &id, &file).await else { return reply::not_found() };
	let network = manifest["network"].strs();
	let Ok(csp) = HeaderValue::from_str(&plugin_csp(port, &id, &network)) else { return reply::not_found() };
	let mut res = reply::typed(200, bytes, file_type(&extname(&file).to_lowercase()));
	let out = res.headers_mut();
	out.insert(header::CONTENT_SECURITY_POLICY, csp);
	out.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
	out.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
	// A plugin author reinstalls a folder often; the frame must see the new files.
	out.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
	res
}

/// A built font's file name: letters, digits, `-`, `_` and `.`, ending in `.woff2`.
fn is_font_name(name: &str) -> bool {
	name.len() > 6 && name.ends_with(".woff2") && !name.starts_with('.') && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

pub(crate) async fn plugin_font(State(app): State<Arc<App>>, Path(file): Path<String>, headers: HeaderMap) -> Response {
	let host = headers.get(header::HOST).and_then(|h| h.to_str().ok()).unwrap_or_default();
	if plugin_files_port(host).is_none() || !is_font_name(&file) || headers.contains_key(header::COOKIE) {
		return reply::not_found();
	}
	let Ok(bytes) = tokio::fs::read(app.paths.resources.join("ui/assets").join(&file)).await else { return reply::not_found() };
	let mut res = reply::typed(200, bytes, "font/woff2");
	let out = res.headers_mut();
	out.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
	out.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
	// Built files carry a content hash in their name, so they never change.
	out.insert(header::CACHE_CONTROL, HeaderValue::from_static("public, max-age=31536000, immutable"));
	res
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;

	#[tokio::test]
	async fn a_file_comes_with_its_policy_and_only_at_localhost() {
		let root = std::env::temp_dir().join(format!("gs-plugin-files-{}", gs_base::ids::uuid()));
		for name in ["data", "home", "tmp", "res"] {
			std::fs::create_dir_all(root.join(name)).unwrap();
		}
		let app = App::new(gs_base::config::Paths::new(root.join("data"), root.join("home"), root.join("tmp"), root.join("res")), None);
		let dir = root.join("data/plugins/memes");
		let manifest = json!({ "id": "memes", "name": "Memes", "version": "1.0.0", "description": "d", "author": "a", "entry": "index.html", "lesson": { "label": "Memes" }, "network": ["api.memegen.link"] });
		gs_base::fsx::write_json_atomic(&dir.join("manifest.json"), &manifest).unwrap();
		gs_base::fsx::write_text_atomic(&dir.join("index.html"), "<!doctype html>").unwrap();
		gs_base::fsx::write_text_atomic(&dir.join("js/app.mjs"), "go()").unwrap();
		let get = |file: &str, host: &str| {
			let mut headers = HeaderMap::new();
			headers.insert(header::HOST, host.parse().unwrap());
			plugin_file(State(app.clone()), Path(("memes".to_owned(), file.to_owned())), headers)
		};
		let res = get("js/app.mjs", "localhost:4100").await;
		assert_eq!(res.status(), 200);
		let h = res.headers();
		assert_eq!(h[header::CONTENT_TYPE], "text/javascript; charset=utf-8");
		assert_eq!(h[header::ACCESS_CONTROL_ALLOW_ORIGIN], "*");
		let csp = h[header::CONTENT_SECURITY_POLICY].to_str().unwrap();
		assert!(csp.starts_with("default-src 'none'; script-src http://localhost:4100/plugin-files/memes/ 'unsafe-inline';"));
		assert!(csp.contains("connect-src https://api.memegen.link;") && csp.ends_with("sandbox allow-scripts"));
		assert_eq!(get("index.html", "evil.example:4100").await.status(), 404);
		// The window's own host: a frame there would match the shell's Tauri capability.
		assert_eq!(get("index.html", "127.0.0.1:4100").await.status(), 404);
		assert_eq!(get("manifest.json/../index.html", "localhost:4100").await.status(), 404);
		let _ = std::fs::remove_dir_all(root);
	}

	#[tokio::test]
	async fn only_the_app_s_font_files_are_served_to_plugin_pages() {
		let root = std::env::temp_dir().join(format!("gs-plugin-fonts-{}", gs_base::ids::uuid()));
		for name in ["data", "home", "tmp", "res/ui/assets"] {
			std::fs::create_dir_all(root.join(name)).unwrap();
		}
		let app = App::new(gs_base::config::Paths::new(root.join("data"), root.join("home"), root.join("tmp"), root.join("res")), None);
		gs_base::fsx::write_text_atomic(&root.join("res/ui/assets/literata-latin-Ab1_c.woff2"), "font").unwrap();
		gs_base::fsx::write_text_atomic(&root.join("res/ui/assets/index-Ab1_c.js"), "code").unwrap();
		let get = |file: &str, host: &str, cookie: Option<&str>| {
			let mut headers = HeaderMap::new();
			headers.insert(header::HOST, host.parse().unwrap());
			if let Some(cookie) = cookie {
				headers.insert(header::COOKIE, cookie.parse().unwrap());
			}
			plugin_font(State(app.clone()), Path(file.to_owned()), headers)
		};
		let res = get("literata-latin-Ab1_c.woff2", "localhost:4100", None).await;
		assert_eq!(res.status(), 200);
		assert_eq!(res.headers()[header::CONTENT_TYPE], "font/woff2");
		assert_eq!(res.headers()[header::ACCESS_CONTROL_ALLOW_ORIGIN], "*");
		assert_eq!(get("literata-latin-Ab1_c.woff2", "127.0.0.1:4100", None).await.status(), 404);
		assert_eq!(get("literata-latin-Ab1_c.woff2", "localhost:4100", Some("gs_desktop=x")).await.status(), 404);
		for bad in ["index-Ab1_c.js", "..woff2", "missing.woff2", "a b.woff2"] {
			assert_eq!(get(bad, "localhost:4100", None).await.status(), 404, "{bad}");
		}
		let _ = std::fs::remove_dir_all(root);
	}
}
