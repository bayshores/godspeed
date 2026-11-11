//! What the helper jobs check their work
//! with. SVGs go to PNG through gs_media and PDF pages through gs_pdf, both in this process.
//!
//! Running a demo's JavaScript needs a browser. The Node server reached one through Electron's
//! browser service; this server has none yet, so `run_in_browser` is the one place a browser
//! would be called, and it answers what the Node server answered when it found no browser. SVGs
//! that gs_media cannot draw went to that browser too, and get the same answer.

use std::path::Path;
use std::sync::Arc;

use futures_util::future::BoxFuture;
use gs_json::Json;
use gs_media::svg::{RenderSvgOptions, render_svg};
use gs_pdf::{Pdf, RenderedPdfPage};

/// What one headless demo run saw.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct DemoRunResult {
	/// Console messages of type "error".
	pub console_errors: Vec<String>,
	/// Uncaught exceptions (window.onerror, unhandled rejections).
	pub page_errors: Vec<String>,
	/// Requests that failed (CDN scripts that did not load).
	pub failed_requests: Vec<String>,
	/// The probe expression's value, when one was asked for and it ran (None: undefined).
	pub probe_result: Option<Json>,
	/// True when nothing above recorded anything.
	pub ok: bool,
}

pub trait HeadlessApi: Send + Sync {
	/// Why nothing can run here, for error messages; None when the checks can run.
	fn unavailable_reason(&self) -> Option<String>;
	/// Runs the HTML in a browser, records its errors and evaluates `probe` after it settles.
	fn run_demo<'a>(&'a self, html: &'a str, probe: Option<&'a str>) -> BoxFuture<'a, Result<DemoRunResult, String>>;
	/// The SVG as a PNG (for verify-by-looking).
	fn render_svg<'a>(&'a self, svg: &'a str) -> BoxFuture<'a, Result<Vec<u8>, String>>;
	/// PDF pages as PNGs (the pdf reader's eyes); pages outside the document are skipped.
	fn render_pdf_pages<'a>(&'a self, pdf_path: &'a Path, pages: &'a [i64], dpi: Option<f64>) -> BoxFuture<'a, Result<Vec<RenderedPdfPage>, String>>;
}

/// What the Node server said when it found neither its browser helper nor a Chrome.
pub const NO_CHROME_MESSAGE: &str = "No render engine available: the app's own browser helper failed to start and no system Chrome/Chromium was found. Install Google Chrome or set CHROME_PATH to a Chrome executable. (Verification is mandatory — demos are never delivered untested.)";

/// The server's checks; `pdf` renders PDF pages.
pub fn get_headless(pdf: &Pdf) -> Arc<dyn HeadlessApi> {
	Arc::new(RealHeadless { pdf: pdf.clone() })
}

struct RealHeadless {
	pdf: Pdf,
}

/// The browser seam: the one call that would run a page in a browser.
fn run_in_browser<T>() -> Result<T, String> {
	Err(NO_CHROME_MESSAGE.to_owned())
}

impl HeadlessApi for RealHeadless {
	fn unavailable_reason(&self) -> Option<String> {
		None
	}

	fn run_demo<'a>(&'a self, _html: &'a str, _probe: Option<&'a str>) -> BoxFuture<'a, Result<DemoRunResult, String>> {
		Box::pin(async { run_in_browser() })
	}

	fn render_svg<'a>(&'a self, svg: &'a str) -> BoxFuture<'a, Result<Vec<u8>, String>> {
		let svg = svg.to_owned();
		Box::pin(async move {
			// Font loading and drawing are slow CPU work: off the async threads.
			let drawn = tokio::task::spawn_blocking(move || render_svg(&svg, RenderSvgOptions::default())).await;
			match drawn {
				Ok(Ok(png)) => Ok(png),
				_ => run_in_browser(),
			}
		})
	}

	fn render_pdf_pages<'a>(&'a self, pdf_path: &'a Path, pages: &'a [i64], dpi: Option<f64>) -> BoxFuture<'a, Result<Vec<RenderedPdfPage>, String>> {
		Box::pin(self.pdf.render_pdf_pages(pdf_path, pages, dpi))
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn headless() -> Arc<dyn HeadlessApi> {
		get_headless(&Pdf::new(Path::new("/nonexistent")))
	}

	#[tokio::test]
	async fn demos_answer_the_no_browser_error() {
		let h = headless();
		assert_eq!(h.unavailable_reason(), None);
		assert_eq!(h.run_demo("<p>hi</p>", Some("1")).await, Err(NO_CHROME_MESSAGE.to_owned()));
	}

	#[tokio::test]
	async fn svgs_render_natively_and_broken_ones_need_the_browser() {
		let h = headless();
		let png = h.render_svg(r#"<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="5" height="5"/></svg>"#).await.unwrap();
		assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
		assert_eq!(h.render_svg(r#"<svg xmlns="http://www.w3.org/2000/svg"><rect x="1""#).await, Err(NO_CHROME_MESSAGE.to_owned()));
	}
}
