//! GET /plugin-files/<id>/<path>: a plugin's files for its frame, outside /api, and only at
//! `localhost` (`plugin_files_port`), never at the window's `127.0.0.1`. The frame is
//! sandboxed without `allow-same-origin`, so its own loads come from an opaque origin: they carry
//! `Sec-Fetch-Site: cross-site` and no window cookie, which /api refuses and these files don't
//! need. Module scripts and fonts load in CORS mode from that origin (`Origin: null`), hence
//! `Access-Control-Allow-Origin: *` here; the files are the plugin's public code, never its data.

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

pub async fn plugin_file(State(app): State<Arc<App>>, Path((id, file)): Path<(String, String)>, headers: HeaderMap) -> Response {
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
}
