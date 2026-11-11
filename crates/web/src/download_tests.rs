//! PDF downloads against a local server, written into a fresh folder under the system temp folder.

use std::path::{Path, PathBuf};

use gs_base::ids;

use super::{download_pdf, pdf_file_name, safe_slug, unreadable_download};
use crate::test_server::{Route, serve};

const LIMIT: usize = 25 * 1024 * 1024;

struct Folder(PathBuf);

impl Folder {
	fn new() -> Folder {
		let dir = std::env::temp_dir().join(format!("gs-web-download-{}", ids::uuid()));
		std::fs::create_dir_all(&dir).unwrap();
		Folder(dir)
	}

	fn files(&self) -> Vec<String> {
		std::fs::read_dir(&self.0).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect()
	}
}

impl Drop for Folder {
	fn drop(&mut self) {
		let _ = std::fs::remove_dir_all(&self.0);
	}
}

async fn download(route: Route, path: &str, dir: &Path) -> Result<PathBuf, String> {
	let server = serve(move |_| Some(route.clone())).await;
	download_pdf(&format!("{}{path}", server.origin), dir).await
}

#[tokio::test]
async fn a_pdf_is_saved_under_its_name_with_a_random_suffix() {
	let folder = Folder::new();
	let path = download(Route::ok("application/pdf", b"%PDF-1.4 body"), "/papers/Binary%20Search.pdf", &folder.0).await.unwrap();
	assert_eq!(std::fs::read(&path).unwrap(), b"%PDF-1.4 body");
	let name = path.file_name().unwrap().to_str().unwrap();
	assert!(name.starts_with("Binary-20Search-"), "{name}");
	assert_eq!(folder.files(), vec![name.to_owned()]);
}

#[tokio::test]
async fn the_request_asks_for_a_pdf() {
	let folder = Folder::new();
	let server = serve(|_| Some(Route::ok("application/pdf", b"%PDF"))).await;
	download_pdf(&format!("{}/a.pdf", server.origin), &folder.0).await.unwrap();
	let seen = &server.requests()[0];
	assert_eq!(seen.header("accept"), Some("application/pdf,application/octet-stream,*/*"));
	assert_eq!(seen.header("user-agent"), Some(crate::fetch::USER_AGENT));
	assert_eq!(seen.header("accept-language"), Some("*"));
	assert_eq!(seen.header("sec-fetch-mode"), Some("cors"));
}

#[tokio::test]
async fn a_pdf_address_is_enough_when_the_type_is_octet_stream() {
	let folder = Folder::new();
	assert!(download(Route::ok("binary/octet-stream", b"%PDF"), "/files/a.PDF", &folder.0).await.is_ok());
	assert!(download(Route::ok("APPLICATION/PDF; charset=x", b"%PDF"), "/download", &folder.0).await.is_ok());
}

#[tokio::test]
async fn other_content_is_refused_with_its_type() {
	let folder = Folder::new();
	let html = Route::ok("text/html; charset=utf-8", b"<html>");
	assert_eq!(download(html, "/page", &folder.0).await.unwrap_err(), "Not a PDF (content-type text/html)");
	let untyped = Route { status: 200, reason: "OK".into(), body: b"x".to_vec(), ..Route::default() };
	assert_eq!(download(untyped, "/page", &folder.0).await.unwrap_err(), "Not a PDF (content-type unknown)");
	assert!(folder.files().is_empty());
}

#[tokio::test]
async fn a_failed_status_is_reported() {
	let folder = Folder::new();
	assert_eq!(download(Route::status(404, "Not Found"), "/a.pdf", &folder.0).await.unwrap_err(), "HTTP 404 Not Found");
}

#[tokio::test]
async fn an_empty_body_is_refused() {
	let folder = Folder::new();
	assert_eq!(download(Route::ok("application/pdf", b""), "/a.pdf", &folder.0).await.unwrap_err(), "Empty response");
}

#[tokio::test]
async fn a_declared_size_over_the_limit_is_refused_before_reading() {
	let folder = Folder::new();
	let mut route = Route::ok("application/pdf", b"");
	route.content_length = Some(LIMIT + 1);
	assert_eq!(download(route, "/a.pdf", &folder.0).await.unwrap_err(), "PDF too large (over 25 MB)");
}

#[tokio::test]
async fn a_declared_size_at_the_limit_is_read_and_a_short_body_is_cut() {
	let folder = Folder::new();
	let mut route = Route::ok("application/pdf", b"%PDF");
	route.content_length = Some(LIMIT);
	assert_eq!(download(route, "/a.pdf", &folder.0).await.unwrap_err(), "terminated");
	assert!(folder.files().is_empty());
}

#[tokio::test]
async fn a_body_over_the_limit_is_refused_after_reading() {
	let folder = Folder::new();
	let route = Route::ok("application/pdf", &vec![b'a'; LIMIT + 1]);
	assert_eq!(download(route, "/a.pdf", &folder.0).await.unwrap_err(), "PDF too large (over 25 MB)");
	assert!(folder.files().is_empty());
}

#[tokio::test]
async fn a_missing_folder_gives_the_open_error_node_gives() {
	let folder = Folder::new();
	let missing = folder.0.join("gone");
	let error = download(Route::ok("application/pdf", b"%PDF"), "/a.pdf", &missing).await.unwrap_err();
	let prefix = format!("ENOENT: no such file or directory, open '{}", missing.join("a-").display());
	assert!(error.starts_with(&prefix) && error.ends_with(".pdf'"), "{error}");
}

#[tokio::test]
async fn a_file_where_the_folder_should_be_gives_the_open_error_node_gives() {
	let folder = Folder::new();
	let file = folder.0.join("file");
	std::fs::File::create(&file).unwrap();
	let error = download(Route::ok("application/pdf", b"%PDF"), "/a.pdf", &file).await.unwrap_err();
	let prefix = format!("ENOTDIR: not a directory, open '{}", file.join("a-").display());
	assert!(error.starts_with(&prefix) && error.ends_with(".pdf'"), "{error}");
}

#[test]
fn an_unreadable_download_is_removed() {
	let folder = Folder::new();
	let path = folder.0.join("broken-abc123.pdf");
	gs_base::fsx::write_atomic(&path, b"not a pdf", None).unwrap();
	assert_eq!(unreadable_download(&path), "The download is not a readable PDF");
	assert!(!path.exists());
	// Already gone is fine.
	assert_eq!(unreadable_download(&path), "The download is not a readable PDF");
}

#[test]
fn slugs_keep_safe_characters_and_squeeze_the_rest() {
	assert_eq!(safe_slug("a b!!c"), "a-b-c");
	assert_eq!(safe_slug("Plain_name-1.0.pdf"), "Plain_name-1.0.pdf");
	assert_eq!(safe_slug("--x--"), "x");
	assert_eq!(safe_slug("%%%"), "document");
	assert_eq!(safe_slug(""), "document");
	assert_eq!(safe_slug("caf\u{e9}"), "caf");
}

#[test]
fn a_long_slug_keeps_its_last_eighty_characters() {
	let long = format!("{}{}", "a".repeat(30), "b".repeat(80));
	assert_eq!(safe_slug(&long), "b".repeat(80));
}

#[test]
fn file_names_come_from_the_last_path_segment() {
	let suffix_ok = |name: &str, stem: &str| {
		let tail = name.strip_prefix(stem).and_then(|r| r.strip_suffix(".pdf")).unwrap_or_else(|| panic!("{name} does not fit {stem}"));
		assert_eq!(tail.len(), 6, "{name}");
		assert!(tail.chars().all(|c| c.is_ascii_digit() || c.is_ascii_lowercase()), "{name}");
	};
	suffix_ok(&pdf_file_name("https://x.org/a/Paper.PDF"), "Paper-");
	suffix_ok(&pdf_file_name("https://x.org/a/paper.pdf?x=1#y"), "paper-");
	suffix_ok(&pdf_file_name("https://x.org/a/paper/"), "paper-");
	suffix_ok(&pdf_file_name("https://x.org/"), "document-");
	suffix_ok(&pdf_file_name("https://x.org/.pdf"), "-");
	suffix_ok(&pdf_file_name("not a url"), "document-");
}

#[test]
fn two_names_for_one_address_differ() {
	assert_ne!(pdf_file_name("https://x.org/a.pdf"), pdf_file_name("https://x.org/a.pdf"));
}
