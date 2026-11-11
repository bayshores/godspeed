//! The researcher's PDF tools: download and triage a PDF from the web, then read it by page or
//! search it. Every path the tools take is held inside the job's download folder.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use gs_base::posix::resolve;
use gs_engine::turn::tool::Tool;
use gs_json::{Json, json};
use gs_pdf::Pdf;
use gs_web::download::{download_pdf, unreadable_download};
use gs_web::fetch::is_http_url;

use crate::tools::fn_tool::FnTool;
use gs_core::session::schema::{self, string};
use super::web::{ABORTED, until_aborted};

fn size_class(page_count: u32) -> &'static str {
	match page_count {
		..=10 => "short",
		11..=40 => "medium",
		_ => "long",
	}
}

/// `path` resolved against the download folder, or None when it would leave it.
fn scoped_path(dir: &Path, path: &str) -> Option<PathBuf> {
	let root = resolve(&dir.to_string_lossy(), "");
	let resolved = resolve(&root, path);
	let inside = resolved.strip_prefix(&root).is_some_and(|rest| rest.starts_with('/'));
	inside.then(|| PathBuf::from(resolved))
}

/// The tools in the order the researcher lists them.
pub fn create_pdf_read_tools(pdf: &Pdf, dir: &Path) -> Vec<Arc<dyn Tool>> {
	let path_description = "The local PDF path returned by web_fetch_pdf";
	vec![
		fetch_tool(pdf.clone(), dir.to_owned()),
		path_tool(
			"pdf_info",
			"Triage a downloaded PDF: page count plus per-page signals (text_length, image_count, math_density).".to_owned(),
			schema::object(&["path"], vec![("path", string(path_description))]),
			pdf.clone(),
			dir.to_owned(),
			|pdf, file, _| async move {
				let info = pdf.pdf_info(&file).await?;
				Ok(json!({
					"page_count": info.page_count,
					"mean_text_length": info.mean_text_length,
					"size_class": size_class(info.page_count),
					"pages": info.pages.iter().map(|p| p.to_json()).collect::<Vec<_>>(),
				}))
			},
		),
		path_tool(
			"pdf_extract",
			"Extract text from pages of a downloaded PDF (spec: 'all', '1-5', '1,3,7', '3'). Use pdf_info first; narrow the spec for big documents.".to_owned(),
			schema::object(
				&["path", "pages"],
				vec![
					("path", string(path_description)),
					("pages", string("Pages to extract: 'all', '1-5', '1,3,7', or '3'. Use pdf_info first; narrow the spec for big documents.")),
				],
			),
			pdf.clone(),
			dir.to_owned(),
			|pdf, file, args| async move { Ok(Json::Str(pdf.pdf_extract(&file, args["pages"].as_str().unwrap_or_default()).await?)) },
		),
		path_tool(
			"pdf_search",
			"Find text in a downloaded PDF \u{2014} returns the pages and contexts that hit.".to_owned(),
			schema::object(
				&["path", "query"],
				vec![("path", string(path_description)), ("query", string("Text to find (case-insensitive substring)"))],
			),
			pdf.clone(),
			dir.to_owned(),
			|pdf, file, args| async move {
				let hits = pdf.pdf_search(&file, args["query"].as_str().unwrap_or_default(), None, true).await?;
				Ok(json!({ "hits": hits.iter().map(|h| h.to_json()).collect::<Vec<_>>() }))
			},
		),
	]
}

/// A tool that takes a `path` inside the download folder: a path outside it, or a failure of
/// `run`, comes back as text.
fn path_tool<F, Fut>(name: &'static str, description: String, parameters: Json, pdf: Pdf, dir: PathBuf, run: F) -> Arc<dyn Tool>
where
	F: Fn(Pdf, PathBuf, Json) -> Fut + Send + Sync + Clone + 'static,
	Fut: std::future::Future<Output = Result<Json, String>> + Send + 'static,
{
	FnTool::server(name, description, parameters, move |args, _ctx| {
		let (pdf, dir, run) = (pdf.clone(), dir.clone(), run.clone());
		async move {
			let Some(file) = scoped_path(&dir, args["path"].as_str().unwrap_or_default()) else {
				return Ok(Json::Str(format!("{name} failed: path must stay inside this job's download dir")));
			};
			Ok(run(pdf, file, args).await.unwrap_or_else(|message| Json::Str(format!("{name} failed: {message}"))))
		}
	}).into_arc()
}

fn fetch_tool(pdf: Pdf, dir: PathBuf) -> Arc<dyn Tool> {
	FnTool::server(
		"web_fetch_pdf",
		"Download a PDF from the web and triage it: returns its local path, page count, size class (short \u{2264}10 pages, medium \u{2264}40, long), and flagged (math/image-heavy) pages. Then read it with pdf_extract / pdf_search. Use when web_fetch reports a URL is a PDF.".to_owned(),
		schema::object(&["url"], vec![("url", string("The PDF URL to download"))]),
		move |args, ctx| {
			let (pdf, dir) = (pdf.clone(), dir.clone());
			async move {
				let url = args["url"].as_str().unwrap_or_default().to_owned();
				if !is_http_url(&url) {
					return Ok(Json::Str(format!("web_fetch_pdf failed: invalid URL \"{url}\"")));
				}
				let summary = async {
					let file = until_aborted(&ctx.abort, download_pdf(&url, &dir)).await?;
					if ctx.abort.is_aborted() {
						return Err(ABORTED.to_owned());
					}
					if pdf.pdf_probe(&file).await.is_err() {
						return Err(unreadable_download(&file));
					}
					let info = pdf.pdf_info(&file).await?;
					let flagged: Vec<u32> = info.pages.iter().filter(|p| p.math_density >= 0.03 || p.image_count > 0).take(30).map(|p| p.page).collect();
					Ok(json!({
						"path": file.to_string_lossy().into_owned(),
						"url": url.as_str(),
						"page_count": info.page_count,
						"size_class": size_class(info.page_count),
						"mean_text_length": info.mean_text_length,
						"flagged_pages": flagged,
					}))
				};
				Ok(summary.await.unwrap_or_else(|message: String| Json::Str(format!("web_fetch_pdf failed for {url}: {message}"))))
			}
		},
	).into_arc()
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn size_classes_follow_the_page_count() {
		assert_eq!([size_class(1), size_class(10), size_class(11), size_class(40), size_class(41)], ["short", "short", "medium", "medium", "long"]);
	}

	#[test]
	fn paths_must_stay_inside_the_folder() {
		let dir = Path::new("/jobs/a");
		assert_eq!(scoped_path(dir, "/jobs/a/x.pdf"), Some(PathBuf::from("/jobs/a/x.pdf")));
		assert_eq!(scoped_path(dir, "x.pdf"), Some(PathBuf::from("/jobs/a/x.pdf")));
		assert_eq!(scoped_path(dir, "sub/../x.pdf"), Some(PathBuf::from("/jobs/a/x.pdf")));
		assert_eq!(scoped_path(dir, "../b/x.pdf"), None);
		assert_eq!(scoped_path(dir, "/jobs/ab/x.pdf"), None);
		assert_eq!(scoped_path(dir, "/jobs/a"), None);
		assert_eq!(scoped_path(dir, ""), None);
		assert_eq!(scoped_path(Path::new("/jobs/a/"), "x.pdf"), Some(PathBuf::from("/jobs/a/x.pdf")));
	}
}
