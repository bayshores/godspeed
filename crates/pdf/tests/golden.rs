//! Parity with the pdf.js code (tests/golden/pdf.json, made by scripts/golden.ts from pdf.golden.ts).
//!
//! Every case must equal pdf.js, page text included, on these simple fixtures. On real textbook
//! pages pdfium orders some lines and math symbols differently; that is not checked here.
//! A skipped run (no pdfium library) passes without checking anything.

mod common;

use common::{fixture, pdf};
use gs_json::{Json, json, parse};
use gs_pdf::ops::parse_page_spec;

fn golden() -> Vec<Json> {
	let text = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden/pdf.json")).unwrap();
	parse(&text).unwrap().as_arr().unwrap().clone()
}

fn cut_root(text: &str) -> String {
	let root = gs_base::fsx::without_long_prefix(std::fs::canonicalize(concat!(env!("CARGO_MANIFEST_DIR"), "/../..")).unwrap());
	let text = text.replace(root.to_str().unwrap(), "<root>");
	// Windows paths, in the fixtures folder only: a regex error keeps its backslash.
	text.replace(r"<root>\crates\pdf\tests", "<root>/crates/pdf/tests").replace(r"\fixtures", "/fixtures").replace(r"fixtures\", "fixtures/")
}

fn shape(s: gs_pdf::PdfShape) -> Json {
	json!({ "pageCount": s.page_count, "aspect": s.aspect })
}

fn info(i: gs_pdf::PdfInfo) -> Json {
	let pages: Vec<Json> = i.pages.iter().map(|p| p.to_json()).collect();
	json!({ "path": cut_root(&i.path), "page_count": i.page_count, "mean_text_length": i.mean_text_length, "pages": pages })
}

/// A page image as the golden file keeps it: its size from the PNG header and how many IDAT chunks it holds.
fn page_image(p: &gs_pdf::RenderedPdfPage) -> Json {
	let mut idats = 0;
	let mut at = 8;
	while at < p.png.len() {
		let length = u32::from_be_bytes(p.png[at..at + 4].try_into().unwrap()) as usize;
		if &p.png[at + 4..at + 8] == b"IDAT" {
			idats += 1;
		}
		at += 12 + length;
	}
	let side = |from: usize| u32::from_be_bytes(p.png[from..from + 4].try_into().unwrap());
	json!({ "page": p.page, "width": side(16), "height": side(20), "idats": idats })
}

fn hits(hits: Vec<gs_pdf::PdfSearchHit>) -> Json {
	json!({ "hits": hits.iter().map(|h| h.to_json()).collect::<Vec<_>>() })
}

/// Windows refuses to open a folder, where Node opens it and fails the read.
fn folder_error(want: String) -> String {
	if cfg!(windows) && want.starts_with("EISDIR: illegal operation on a directory, read") {
		"EACCES: permission denied, open '<root>/crates/pdf/tests/fixtures'".to_owned()
	} else {
		want
	}
}

async fn run(pdf: &gs_pdf::Pdf, case: &Json) -> Result<Json, String> {
	let name = case["name"].as_str().unwrap();
	let (kind, rest) = name.split_once(' ').unwrap();
	if kind == "parsePageSpec" {
		let total: u32 = rest.strip_prefix("total ").unwrap().parse().unwrap();
		let specs = case["output"].as_arr().unwrap().iter().map(|c| c["spec"].as_str().unwrap());
		return Ok(Json::Arr(specs.map(|spec| json!({ "spec": spec, "pages": parse_page_spec(spec, total) })).collect()));
	}
	let (file_name, rest) = rest.split_once(' ').unwrap_or((rest, ""));
	// "." is the fixtures folder, a path that is not a file.
	let file = if file_name == "." { fixture("empty.pdf").parent().unwrap().to_owned() } else { fixture(file_name) };
	let result = match kind {
		"render" => {
			let dpi = if rest == "default" { None } else { Some(rest.parse::<f64>().unwrap()) };
			pdf.render_pdf_pages(&file, &[0, 1, 2, 3, 99], dpi).await.map(|pages| Json::Arr(pages.iter().map(page_image).collect()))
		}
		"text" => pdf.text(&file).await.map(Json::from),
		"extract" => pdf.pdf_extract(&file, rest).await.map(Json::from),
		"probe" => pdf.pdf_probe(&file).await.map(|()| Json::Null),
		"shape" => pdf.pdf_shape(&file).await.map(shape),
		"info" => pdf.pdf_info(&file).await.map(info),
		"search" if file_name == "invalid" => pdf.pdf_search(&fixture("sample-3page.pdf"), rest, None, false).await.map(hits),
		"search" => {
			let (query, literal, context) = if let Some(n) = rest.strip_prefix("context ") {
				("needle".to_owned(), true, Some(n.parse::<f64>().unwrap()))
			} else {
				let (query, literal) = rest.rsplit_once(" literal ").unwrap();
				(parse(query).unwrap().as_str().unwrap().to_owned(), literal == "true", None)
			};
			pdf.pdf_search(&file, &query, context, literal).await.map(hits)
		}
		other => panic!("unknown case kind {other}"),
	};
	result.map_err(|e| cut_root(&e))
}

#[tokio::test]
async fn matches_pdfjs() {
	let Some(pdf) = pdf() else { return };
	let mut differing = Vec::new();
	for case in golden() {
		let name = case["name"].as_str().unwrap().to_owned();
		let expected = match case.get("error") {
			Some(error) => Err(folder_error(error.as_str().unwrap().to_owned())),
			None => Ok(case["output"].clone()),
		};
		let actual = run(&pdf, &case).await;
		if actual != expected {
			differing.push(format!("{name}\n  pdf.js: {expected:?}\n  pdfium: {actual:?}"));
		}
	}
	assert!(differing.is_empty(), "{} cases differ:\n{}", differing.len(), differing.join("\n"));
}
