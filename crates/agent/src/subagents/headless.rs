//! What the helper jobs check their work
//! with. SVGs go to PNG through gs_media and PDF pages through gs_pdf, both in this process.
//!
//! Running a demo's JavaScript needs a browser, and SVGs gs_media cannot draw go to one too. The
//! desktop shell owns that browser view, so `browser` hands out the shell link to ask; without
//! a shell (a browser-mode server) it answers what the Node server answered when it found no
//! browser.

use std::path::Path;
use std::sync::Arc;

use futures_util::future::BoxFuture;
use gs_json::Json;
use gs_media::png::provider_safe_png;
use gs_media::svg::{RenderSvgOptions, render_svg, svg_viewport};
use gs_pdf::{Pdf, RenderedPdfPage};
use gs_shell_rpc::{DemoResult, ShellLink};

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

/// The server's checks; `pdf` renders PDF pages and `shell` runs pages in the app's browser.
pub fn get_headless(pdf: &Pdf, shell: Option<&ShellLink>) -> Arc<dyn HeadlessApi> {
	Arc::new(RealHeadless { pdf: pdf.clone(), shell: shell.cloned() })
}

struct RealHeadless {
	pdf: Pdf,
	shell: Option<ShellLink>,
}

impl RealHeadless {
	/// The browser seam: the shell that runs pages in its browser.
	fn browser(&self) -> Result<&ShellLink, String> {
		self.shell.as_ref().ok_or_else(|| NO_CHROME_MESSAGE.to_owned())
	}
}

impl From<DemoResult> for DemoRunResult {
	fn from(r: DemoResult) -> DemoRunResult {
		DemoRunResult {
			console_errors: r.console_errors,
			page_errors: r.page_errors,
			failed_requests: r.failed_requests,
			// serde_json writes valid JSON, so the parse cannot fail.
			probe_result: r.probe_result.and_then(|v| gs_json::parse(&v.to_string()).ok()),
			ok: r.ok,
		}
	}
}

impl HeadlessApi for RealHeadless {
	fn unavailable_reason(&self) -> Option<String> {
		None
	}

	fn run_demo<'a>(&'a self, html: &'a str, probe: Option<&'a str>) -> BoxFuture<'a, Result<DemoRunResult, String>> {
		Box::pin(async move {
			Ok(self.browser()?.demo(html, probe).await?.into())
		})
	}

	fn render_svg<'a>(&'a self, svg: &'a str) -> BoxFuture<'a, Result<Vec<u8>, String>> {
		Box::pin(async move {
			// Font loading and drawing are slow CPU work: off the async threads.
			let owned = svg.to_owned();
			if let Ok(Ok(png)) = tokio::task::spawn_blocking(move || render_svg(&owned, RenderSvgOptions::default())).await {
				return Ok(png);
			}
			let (width, height) = svg_viewport(svg, RenderSvgOptions::default());
			let png = self.browser()?.svg(svg, width as u32, height as u32).await?;
			// The browser's PNG goes to a vision model, which may refuse its split chunks.
			Ok(provider_safe_png(&gs_base::base64::decode(&png)))
		})
	}

	fn render_pdf_pages<'a>(&'a self, pdf_path: &'a Path, pages: &'a [i64], dpi: Option<f64>) -> BoxFuture<'a, Result<Vec<RenderedPdfPage>, String>> {
		Box::pin(self.pdf.render_pdf_pages(pdf_path, pages, dpi))
	}
}

#[cfg(test)]
mod tests {
	use gs_shell_rpc::ToShell;

	use super::*;

	fn headless() -> Arc<dyn HeadlessApi> {
		get_headless(&Pdf::new(Path::new("/nonexistent")), None)
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

	/// Hands each line the server writes to the fake shell.
	struct Lines(tokio::sync::mpsc::UnboundedSender<Vec<u8>>);

	impl std::io::Write for Lines {
		fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
			let _ = self.0.send(buf.to_vec());
			Ok(buf.len())
		}

		fn flush(&mut self) -> std::io::Result<()> {
			Ok(())
		}
	}

	/// A shell that answers every demo with one console error and the probe's text, and every
	/// SVG with `png`; it keeps the requests it saw.
	fn fake_shell(png: Vec<u8>) -> (ShellLink, Arc<parking_lot::Mutex<Vec<ToShell>>>) {
		let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
		let link = ShellLink::new(Lines(tx));
		let seen = Arc::new(parking_lot::Mutex::new(Vec::new()));
		tokio::spawn({
			let (link, seen) = (link.clone(), seen.clone());
			async move {
				while let Some(line) = rx.recv().await {
					let Some(Ok(msg)) = gs_shell_rpc::read_lines::<ToShell>(&line[..]).next() else { continue };
					let answer = match &msg {
						ToShell::Demo { id, probe, .. } => {
							let probe = probe.as_deref().map_or(String::new(), |p| format!(r#","probeResult":{}"#, gs_json::quote(p)));
							format!(r#"{{"t":"demo_done","id":{id},"result":{{"consoleErrors":["boom"],"pageErrors":[],"failedRequests":[]{probe},"ok":false}}}}"#)
						}
						ToShell::Svg { id, .. } => format!(r#"{{"t":"svg_done","id":{id},"png":"{}"}}"#, gs_base::base64::encode(&png)),
						_ => continue,
					};
					seen.lock().push(msg);
					link.listen(answer.as_bytes());
				}
			}
		});
		(link, seen)
	}

	#[tokio::test]
	async fn with_a_shell_demos_and_broken_svgs_run_there() {
		let png = render_svg(r#"<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>"#, RenderSvgOptions::default()).unwrap();
		let (link, seen) = fake_shell(png.clone());
		let h = get_headless(&Pdf::new(Path::new("/nonexistent")), Some(&link));

		let probed = h.run_demo("<p>hi</p>", Some("1 + 1")).await.unwrap();
		assert_eq!(probed, DemoRunResult { console_errors: vec!["boom".into()], probe_result: Some(Json::Str("1 + 1".into())), ..DemoRunResult::default() });
		assert_eq!(h.run_demo("<p>hi</p>", None).await.unwrap().probe_result, None);

		assert_eq!(h.render_svg(r#"<svg xmlns="http://www.w3.org/2000/svg"><rect x="1""#).await, Ok(png));
		let seen = seen.lock();
		assert!(matches!(&seen[0], ToShell::Demo { html, probe: Some(p), .. } if html == "<p>hi</p>" && p == "1 + 1"));
		assert!(matches!(&seen[2], ToShell::Svg { width: 900, height: 700, .. }), "{:?}", seen[2]);
	}
}
