//! Files outside /api (src/backend/server/ui-files.ts, pdfjs-assets.ts): the window's screens
//! from `ui/`, and pdf.js's worker and data from `pdfjs-dist/`, both beside the server.

use std::path::Path;
use std::sync::{Arc, LazyLock};

use axum::extract::State;
use axum::http::{HeaderValue, Uri, header};
use axum::response::Response;
use gs_base::re::Re;
use gs_services::App;

use super::paths::{decoded_segments, extname};
use super::reply;

/// Built files carry a content hash in their name, so they never change.
const HASHED: &str = "public, max-age=31536000, immutable";

fn ui_type(ext: &str) -> &'static str {
	match ext {
		".html" => "text/html; charset=utf-8",
		".js" => "text/javascript; charset=utf-8",
		".css" => "text/css; charset=utf-8",
		".woff2" => "font/woff2",
		".woff" => "font/woff",
		".ttf" => "font/ttf",
		".png" => "image/png",
		".mp3" => "audio/mpeg",
		_ => "application/octet-stream",
	}
}

fn file_reply(body: Vec<u8>, content_type: &'static str, cache: &'static str) -> Response {
	let mut res = Response::new(body.into());
	let headers = res.headers_mut();
	headers.insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
	headers.insert(header::CACHE_CONTROL, HeaderValue::from_static(cache));
	res
}

/// Every path no route answers: a path with a file extension is that file, any other the page
/// (index.html), so the UI's router picks the screen. /api paths stay a 404.
pub async fn page(State(app): State<Arc<App>>, uri: Uri) -> Response {
	let parts = decoded_segments(uri.path()).unwrap_or_default();
	let root = app.paths.resources.join("ui");
	match ui_file(&root, &parts).await {
		Some(res) => res,
		None => reply::not_found(),
	}
}

async fn ui_file(root: &Path, parts: &[String]) -> Option<Response> {
	if parts.first().is_some_and(|p| p == "api") {
		return None;
	}
	let name = parts.join("/");
	let ext = extname(&name).to_lowercase();
	if ext.is_empty() {
		let body = tokio::fs::read(root.join("index.html")).await.ok()?;
		return Some(file_reply(body, ui_type(".html"), "no-cache"));
	}
	let file = gs_base::config::resolve(&root.join(&name));
	if !file.starts_with(root) || file == root {
		return None;
	}
	let body = tokio::fs::read(&file).await.ok()?;
	Some(file_reply(body, ui_type(&ext), if name.starts_with("assets/") { HASHED } else { "no-cache" }))
}

/// The pdf.js files the cheat sheet viewer may load, by pattern; its scripting engine never.
static PDFJS: LazyLock<Vec<(Re, &'static str, &'static str)>> = LazyLock::new(|| {
	let js = "text/javascript; charset=utf-8";
	let bin = "application/octet-stream";
	[
		(r"^pdf\.worker\.min\.mjs$", "build", js),
		(r"^standard_fonts\/[A-Za-z0-9_-]+\.(pfb|ttf)$", "", bin),
		(r"^cmaps\/[A-Za-z0-9_-]+\.bcmap$", "", bin),
		(r"^iccs\/[A-Za-z0-9_-]+\.icc$", "", bin),
		(r"^wasm\/(jbig2|openjpeg|qcms_bg)\.wasm$", "", "application/wasm"),
		(r"^wasm\/(jbig2|openjpeg)_nowasm_fallback\.js$", "", js),
	]
	.into_iter()
	.map(|(pattern, dir, ty)| (Re::new(pattern, ""), dir, ty))
	.collect()
});

/// GET /pdfjs/<file>.
pub async fn pdfjs(State(app): State<Arc<App>>, uri: Uri) -> Response {
	let parts = decoded_segments(uri.path()).unwrap_or_default();
	let name = parts.get(1..).unwrap_or_default().join("/");
	let Some((_, dir, ty)) = PDFJS.iter().find(|(re, _, _)| re.test(&name)) else { return reply::text(404, "Not found") };
	let file = app.paths.resources.join("pdfjs-dist").join(dir).join(&name);
	match tokio::fs::read(file).await {
		Ok(body) => file_reply(body, ty, "public, max-age=86400"),
		Err(_) => reply::text(404, "Not found"),
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[tokio::test]
	async fn files_pages_and_refusals() {
		let dir = std::env::temp_dir().join(format!("gs-ui-{}", gs_base::ids::uuid()));
		std::fs::create_dir_all(dir.join("assets")).unwrap();
		gs_base::fsx::write_text_atomic(&dir.join("index.html"), "<!doctype html>").unwrap();
		gs_base::fsx::write_text_atomic(&dir.join("assets/a.js"), "x").unwrap();
		let parts = |p: &str| decoded_segments(p).unwrap();
		let cache = |r: &Response| r.headers()[header::CACHE_CONTROL].to_str().unwrap().to_string();
		assert_eq!(cache(&ui_file(&dir, &parts("/graph")).await.unwrap()), "no-cache");
		assert_eq!(cache(&ui_file(&dir, &parts("/assets/a.js")).await.unwrap()), HASHED);
		assert!(ui_file(&dir, &parts("/api/nope")).await.is_none());
		assert!(ui_file(&dir, &parts("/..%2fserver.js")).await.is_none());
		assert!(ui_file(&dir, &parts("/notes.bar")).await.is_none());
		assert!(ui_file(&dir, &parts("/icon.png%00.js")).await.is_none());
		assert!(ui_file(&dir, &parts("/.env")).await.is_some());
		std::fs::remove_dir_all(dir).unwrap();
	}
}
