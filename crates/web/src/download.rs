//! PDF downloads for web_fetch_pdf (the fetch half of pdf-read.ts). The caller checks the
//! address with `is_http_url`, probes the file with the pdf crate and triages it.

use std::io;
use std::path::{Path, PathBuf};

use gs_base::{fsx, ids, num};

use crate::fetch::{USER_AGENT, is_pdf_url};
use crate::http;

/// PDFs run bigger than pages: arxiv papers are routinely 5 to 20 MB.
const MAX_PDF_BYTES: u64 = 25 * 1024 * 1024;
const TOO_LARGE: &str = "PDF too large (over 25 MB)";

/// Downloads the PDF at `url` into `dir` under a name made from the address, and returns its
/// path. Err holds the message after "web_fetch_pdf failed for <url>: ".
pub async fn download_pdf(url: &str, dir: &Path) -> Result<PathBuf, String> {
	let response = http::get(url, &[("User-Agent", USER_AGENT), ("Accept", "application/pdf,application/octet-stream,*/*")]).await?;
	if !response.status().is_success() {
		return Err(http::status_error(&response));
	}
	let content_type = http::header(&response, "content-type").unwrap_or_default();
	if !content_type.to_ascii_lowercase().contains("application/pdf") && !is_pdf_url(url) {
		let kind = content_type.split(';').next().filter(|k| !k.is_empty()).unwrap_or("unknown");
		return Err(format!("Not a PDF (content-type {kind})"));
	}
	if http::content_length(&response) > MAX_PDF_BYTES {
		return Err(TOO_LARGE.to_owned());
	}
	let bytes = http::read_body(response).await?;
	if bytes.is_empty() {
		return Err("Empty response".to_owned());
	}
	if bytes.len() as u64 > MAX_PDF_BYTES {
		return Err(TOO_LARGE.to_owned());
	}
	let path = dir.join(pdf_file_name(url));
	// writeFile does not make the folder; its open fails the way this check does.
	match std::fs::metadata(dir) {
		Ok(meta) if meta.is_dir() => {}
		Ok(_) => return Err(fsx::node_error_message(&io::Error::from(io::ErrorKind::NotADirectory), "open", &path)),
		Err(e) => return Err(fsx::node_error_message(&e, "open", &path)),
	}
	fsx::write_atomic(&path, &bytes, None).map_err(|e| fsx::node_error_message(&e, "open", &path))?;
	Ok(path)
}

/// Removes a download the pdf crate could not open, and words the failure.
pub fn unreadable_download(path: &Path) -> String {
	let _ = std::fs::remove_file(path);
	"The download is not a readable PDF".to_owned()
}

/// The last path segment of the address as a safe name, plus a random suffix so two PDFs never
/// collide.
fn pdf_file_name(url: &str) -> String {
	let suffix: String = ids::random_bytes(6).iter().map(|b| num::base36(u64::from(b % 36))).collect();
	let Ok(parsed) = reqwest::Url::parse(url) else {
		return format!("document-{suffix}.pdf");
	};
	let last = parsed.path().split('/').rfind(|s| !s.is_empty()).unwrap_or("document");
	let slug = safe_slug(last);
	let stem = match slug.len().checked_sub(4) {
		Some(cut) if slug[cut..].eq_ignore_ascii_case(".pdf") => &slug[..cut],
		_ => &slug,
	};
	format!("{stem}-{suffix}.pdf")
}

/// Letters, digits and `._-` only (a run of anything else becomes one `-`), no dashes at the
/// ends, then the last 80 characters; "document" when nothing is left.
fn safe_slug(segment: &str) -> String {
	let mut slug = String::new();
	let mut in_run = false;
	for c in segment.chars() {
		if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') {
			slug.push(c);
			in_run = false;
		} else if !in_run {
			slug.push('-');
			in_run = true;
		}
	}
	let trimmed = slug.trim_matches('-');
	let tail = &trimmed[trimmed.len().saturating_sub(80)..];
	if tail.is_empty() { "document".to_owned() } else { tail.to_owned() }
}

#[cfg(test)]
#[path = "download_tests.rs"]
mod tests;
