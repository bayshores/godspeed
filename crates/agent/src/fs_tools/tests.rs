//! The tools over made-up folders, plus a local web server for the fetch tools. The recorded
//! TypeScript answers are replayed by tests/fs_tools_golden.rs.

#[cfg(unix)]
use std::cell::RefCell;
use std::fs;
#[cfg(unix)]
use std::os::unix::fs::{PermissionsExt, symlink};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use gs_base::{clock, fsx};
use gs_engine::turn::abort::Abort;
use gs_engine::turn::tool::{Tool, ToolContext};
use gs_json::{Json, json};
use gs_pdf::Pdf;
use gs_pdf::test_support::shared_pdf;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use super::find::find_tool;
use super::grep::grep_tool;
use super::ls::ls_tool;
use super::pdf_read::create_pdf_read_tools;
use super::read::read_tool;
use super::web::web_tools;

/// A folder under the system temp folder, removed when dropped.
pub(crate) struct TempDir {
	root: PathBuf,
	#[cfg(unix)]
	locked: RefCell<Vec<PathBuf>>,
}

impl TempDir {
	pub(crate) fn new(label: &str) -> TempDir {
		static COUNT: AtomicUsize = AtomicUsize::new(0);
		let name = format!("gs-fs-tools-{label}-{}-{}", std::process::id(), COUNT.fetch_add(1, Ordering::Relaxed));
		let root = fs::canonicalize(std::env::temp_dir()).unwrap().join(name);
		fs::create_dir_all(&root).unwrap();
		TempDir {
			root,
			#[cfg(unix)]
			locked: RefCell::new(Vec::new()),
		}
	}

	pub(crate) fn path(&self) -> &Path {
		&self.root
	}

	/// A text path in this folder, as the tools take it.
	fn text(&self, rel: &str) -> String {
		self.root.join(rel).to_str().unwrap().to_owned()
	}

	pub(crate) fn put(&self, rel: &str, content: impl AsRef<[u8]>) {
		let file = self.root.join(rel);
		fs::create_dir_all(file.parent().unwrap()).unwrap();
		fsx::write_atomic(&file, content.as_ref(), None).unwrap();
	}

	/// `name` becomes a link to `target` (both from this folder).
	#[cfg(unix)]
	pub(crate) fn link(&self, target: &str, name: &str) {
		symlink(self.root.join(target), self.root.join(name)).unwrap();
	}

	/// Takes away all access to `rel` (until the folder is dropped).
	#[cfg(unix)]
	fn lock(&self, rel: &str) {
		let path = self.root.join(rel);
		fs::set_permissions(&path, fs::Permissions::from_mode(0o000)).unwrap();
		self.locked.borrow_mut().push(path);
	}
}

impl Drop for TempDir {
	fn drop(&mut self) {
		#[cfg(unix)]
		for path in self.locked.borrow().iter() {
			let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o755));
		}
		let _ = fs::remove_dir_all(&self.root);
	}
}

/// True when this process can read a file with no permissions (root), so lock tests cannot run.
#[cfg(unix)]
fn can_ignore_permissions() -> bool {
	let dir = TempDir::new("root-check");
	dir.put("f", "x");
	dir.lock("f");
	fs::read(dir.path().join("f")).is_ok()
}

async fn run(tool: &Arc<dyn Tool>, args: Json) -> Result<String, String> {
	let result = tool.execute(args, ToolContext { tool_call_id: "call".to_owned(), abort: Abort::new() }).await?;
	Ok(result["content"][0]["text"].as_str().unwrap().to_owned())
}

async fn ok(tool: &Arc<dyn Tool>, args: Json) -> String {
	run(tool, args).await.unwrap()
}

async fn err(tool: &Arc<dyn Tool>, args: Json) -> String {
	run(tool, args).await.unwrap_err()
}

// read

#[tokio::test]
async fn read_returns_text_by_lines() {
	let dir = TempDir::new("read");
	dir.put("a.txt", "one\ntwo\nthree\n");
	let tool = read_tool();
	let file = dir.text("a.txt");
	assert_eq!(ok(&tool, json!({ "path": file.as_str() })).await, "one\ntwo\nthree\n");
	assert_eq!(ok(&tool, json!({ "path": file.as_str(), "offset": 2, "limit": 1 })).await, "two\n\n[2 more lines in file. Use offset=3 to continue.]");
	assert_eq!(err(&tool, json!({ "path": file.as_str(), "offset": 10 })).await, "Offset 10 is beyond end of file (4 lines total)");
}

#[tokio::test]
async fn read_shows_pictures_and_refuses_binaries() {
	let dir = TempDir::new("read-binary");
	dir.put("pic.PNG", [1u8, 2, 3, 4]);
	dir.put("data.bin", [0u8, 1, 2]);
	dir.put("paper.pdf", "%PDF-1.4");
	let tool = read_tool();
	let picture = tool.execute(json!({ "path": dir.text("pic.PNG") }), ToolContext { tool_call_id: "c".to_owned(), abort: Abort::new() }).await.unwrap();
	assert_eq!(picture["content"][0]["text"].as_str().unwrap(), "Read image file [image/png] \u{2014} pic.PNG (4B), attached as an image.");
	assert_eq!(picture["content"][1]["data"].as_str().unwrap(), "AQIDBA==");
	assert_eq!(picture["content"][1]["mimeType"].as_str().unwrap(), "image/png");
	assert_eq!(ok(&tool, json!({ "path": dir.text("data.bin") })).await, "data.bin is a binary file (3B), not readable as text.");
	assert_eq!(ok(&tool, json!({ "path": dir.text("paper.pdf") })).await, "paper.pdf is a binary file (8B), not readable as text. For a PDF, dispatch a pdf job if you have that tool.");
}

#[tokio::test]
async fn read_words_failures_like_node() {
	let dir = TempDir::new("read-fail");
	dir.put("sub/x.txt", "x");
	let tool = read_tool();
	assert_eq!(err(&tool, json!({ "path": dir.text("missing.txt") })).await, format!("ENOENT: no such file or directory, open '{}'", dir.text("missing.txt")));
	assert_eq!(err(&tool, json!({ "path": dir.text("missing.pdf") })).await, format!("ENOENT: no such file or directory, stat '{}'", dir.text("missing.pdf")));
	// Links and locks need macOS or Linux, and Node's EISDIR for a folder was only seen there.
	#[cfg(unix)]
	{
		dir.link("nowhere", "dangling");
		assert_eq!(err(&tool, json!({ "path": dir.text("sub") })).await, "EISDIR: illegal operation on a directory, read");
		assert_eq!(err(&tool, json!({ "path": dir.text("dangling") })).await, format!("ENOENT: no such file or directory, open '{}'", dir.text("dangling")));
		if !can_ignore_permissions() {
			dir.lock("sub/x.txt");
			assert_eq!(err(&tool, json!({ "path": dir.text("sub/x.txt") })).await, format!("EACCES: permission denied, open '{}'", dir.text("sub/x.txt")));
		}
	}
}

// ls

#[tokio::test]
async fn ls_sorts_without_case_and_marks_folders() {
	let dir = TempDir::new("ls");
	for name in ["B.txt", "a.txt", "C.txt", ".hidden"] {
		dir.put(name, "");
	}
	dir.put("folder/in.txt", "");
	let tool = ls_tool();
	assert_eq!(ok(&tool, json!({ "path": dir.text("") })).await, ".hidden\na.txt\nB.txt\nC.txt\nfolder/");
	assert_eq!(ok(&tool, json!({ "path": dir.text(""), "limit": 2 })).await, ".hidden\na.txt\n\n[Truncated: 2 entries limit]");
	#[cfg(unix)]
	{
		dir.link("folder", "link-to-folder");
		dir.link("nowhere", "dangling");
		assert_eq!(ok(&tool, json!({ "path": dir.text("") })).await, ".hidden\na.txt\nB.txt\nC.txt\nfolder/\nlink-to-folder/");
	}
}

#[tokio::test]
async fn ls_words_failures() {
	let dir = TempDir::new("ls-fail");
	dir.put("file.txt", "");
	fs::create_dir(dir.path().join("empty")).unwrap();
	let tool = ls_tool();
	assert_eq!(ok(&tool, json!({ "path": dir.text("empty") })).await, "Directory is empty");
	assert_eq!(err(&tool, json!({ "path": dir.text("nope") })).await, format!("Path not found: {}", dir.text("nope")));
	assert_eq!(err(&tool, json!({ "path": dir.text("file.txt") })).await, format!("Not a directory: {}", dir.text("file.txt")));
	#[cfg(unix)]
	if !can_ignore_permissions() {
		dir.lock("empty");
		assert_eq!(err(&tool, json!({ "path": dir.text("empty") })).await, format!("Cannot read directory: EACCES: permission denied, scandir '{}'", dir.text("empty")));
	}
}

#[tokio::test]
async fn ls_cuts_at_fifty_kb() {
	let dir = TempDir::new("ls-big");
	for i in 0..300 {
		dir.put(&format!("{i:03}-{}", "x".repeat(200)), "");
	}
	let out = ok(&ls_tool(), json!({ "path": dir.text("") })).await;
	assert!(out.ends_with("\n\n[Truncated: 50.0KB limit]"));
}

// find

#[tokio::test]
async fn find_matches_globs_and_skips_noise() {
	let dir = TempDir::new("find");
	for file in ["src/main.ts", "src/deep/util.ts", "src/deep/util.spec.ts", "README.md", "node_modules/p.ts", ".git/c.ts", "Library/l.ts", ".Trash/t.ts"] {
		dir.put(file, "");
	}
	#[cfg(unix)]
	dir.link("src", "linked");
	let tool = find_tool();
	let find = |pattern: &str| ok(&tool, json!({ "pattern": pattern, "path": dir.text("") }));
	assert_eq!(find("*.ts").await, "src/deep/util.spec.ts\nsrc/deep/util.ts\nsrc/main.ts");
	assert_eq!(find("**/*.spec.ts").await, "src/deep/util.spec.ts");
	assert_eq!(find("deep/*.ts").await, "src/deep/util.spec.ts\nsrc/deep/util.ts");
	assert_eq!(find("*.{md,spec.ts}").await, "README.md\nsrc/deep/util.spec.ts");
	assert_eq!(find("/README.md").await, "README.md");
	assert_eq!(find("*.zzz").await, "No files found matching pattern");
	assert_eq!(ok(&tool, json!({ "pattern": "*", "path": dir.text("node_modules") })).await, "p.ts");
}

#[tokio::test]
async fn find_stops_at_its_limit() {
	let dir = TempDir::new("find-limit");
	for name in ["a", "b", "c"] {
		dir.put(name, "");
	}
	let tool = find_tool();
	assert_eq!(ok(&tool, json!({ "pattern": "*", "path": dir.text(""), "limit": 2 })).await, "a\nb\n\n[2 results limit reached]");
	assert_eq!(ok(&tool, json!({ "pattern": "*", "path": dir.text(""), "limit": 3 })).await, "a\nb\nc\n\n[3 results limit reached]");
	assert_eq!(err(&tool, json!({ "pattern": "*", "path": dir.text("a") })).await, format!("Not a directory: {}", dir.text("a")));
	assert_eq!(err(&tool, json!({ "pattern": "*", "path": dir.text("zz") })).await, format!("Path not found: {}", dir.text("zz")));
}

// grep

#[tokio::test]
async fn grep_finds_lines_with_context() {
	let dir = TempDir::new("grep");
	dir.put("a.txt", "one\ntwo hit\r\nthree\rfour\nfive hit\n");
	dir.put("sub/b.txt", "hit\n");
	dir.put("bin.dat", [b'h', b'i', b't', 0]);
	dir.put("node_modules/n.txt", "hit\n");
	let tool = grep_tool();
	let path = dir.text("");
	let plain = json!({ "pattern": "hit", "path": path.as_str() });
	assert_eq!(ok(&tool, plain).await, "a.txt:2: two hit\na.txt:5: five hit\nsub/b.txt:1: hit");
	let context = json!({ "pattern": "hit", "path": path.as_str(), "context": 1, "glob": "a.*" });
	assert_eq!(ok(&tool, context).await, "a.txt-1- one\na.txt:2: two hit\na.txt-3- three\na.txt-4- four\na.txt:5: five hit\na.txt-6- ");
	let limited = json!({ "pattern": "hit", "path": path.as_str(), "limit": 1 });
	assert_eq!(ok(&tool, limited).await, "a.txt:2: two hit\n\n[1 matches limit reached]");
	let folded = json!({ "pattern": "HIT", "path": path.as_str(), "ignoreCase": true, "glob": "sub/*" });
	assert_eq!(ok(&tool, folded).await, "sub/b.txt:1: hit");
	let literal = json!({ "pattern": "h.t", "path": path.as_str(), "literal": true });
	assert_eq!(ok(&tool, literal).await, "No matches found");
}

#[tokio::test]
async fn grep_words_bad_patterns_and_files_like_node() {
	let dir = TempDir::new("grep-fail");
	dir.put("a.txt", "x\n");
	dir.put("big.txt", "a".repeat(2_200_000));
	dir.put("bin.dat", [0u8; 4]);
	let tool = grep_tool();
	let path = dir.text("");
	assert_eq!(err(&tool, json!({ "pattern": "(", "path": path.as_str() })).await, "Invalid regular expression: /(/: Unterminated group");
	assert_eq!(err(&tool, json!({ "pattern": "*", "path": path.as_str(), "ignoreCase": true })).await, "Invalid regular expression: /*/i: Nothing to repeat");
	assert_eq!(ok(&tool, json!({ "pattern": "(", "path": path.as_str(), "literal": true })).await, "No matches found");
	assert_eq!(ok(&tool, json!({ "pattern": "a", "path": dir.text("big.txt") })).await, "File is 2148.4KB, over the 2048.0KB grep limit. Use read with offset/limit instead.");
	assert_eq!(ok(&tool, json!({ "pattern": "a", "path": dir.text("bin.dat") })).await, "Binary file, not searched. For a PDF, dispatch a pdf job if you have that tool.");
	assert_eq!(ok(&tool, json!({ "pattern": "a", "path": path.as_str() })).await, "No matches found");
	assert_eq!(err(&tool, json!({ "pattern": "a", "path": dir.text("zz") })).await, format!("Path not found: {}", dir.text("zz")));
}

#[tokio::test]
async fn grep_cuts_long_lines_and_big_output() {
	let dir = TempDir::new("grep-long");
	dir.put("long.txt", format!("hit {}\n", "z".repeat(600)));
	let tool = grep_tool();
	let long = ok(&tool, json!({ "pattern": "hit", "path": dir.text("long.txt") })).await;
	assert_eq!(long, format!("long.txt:1: hit {}\u{2026} [truncated]\n\n[Some lines truncated to 500 chars. Use read tool to see full lines]", "z".repeat(496)));
	dir.put("many/wide.txt", ("hit ".to_owned() + &"q".repeat(480) + "\n").repeat(200));
	let capped = ok(&tool, json!({ "pattern": "hit", "path": dir.text("many"), "limit": 150 })).await;
	assert!(capped.ends_with("\n\n[50.0KB limit reached]"));
}

// stopping

#[tokio::test]
async fn find_and_grep_stop_when_aborted() {
	let dir = TempDir::new("abort");
	dir.put("a.txt", "x");
	for (tool, args) in [(find_tool(), json!({ "pattern": "*", "path": dir.text("") })), (grep_tool(), json!({ "pattern": "x", "path": dir.text("") }))] {
		let abort = Abort::new();
		abort.abort();
		let result = tool.execute(args, ToolContext { tool_call_id: "c".to_owned(), abort }).await.unwrap();
		assert_eq!(result["content"][0]["text"].as_str().unwrap(), "Operation aborted");
	}
}

// the web

/// Answers each request with `routes(path) = (status line, content type, body)`; 404 when None.
async fn serve(routes: impl Fn(&str) -> Option<(&'static str, &'static str, Vec<u8>)> + Send + Sync + 'static) -> String {
	let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
	let origin = format!("http://{}", listener.local_addr().unwrap());
	tokio::spawn(async move {
		loop {
			let (mut socket, _) = listener.accept().await.unwrap();
			let mut request = Vec::new();
			let mut chunk = [0u8; 1024];
			while !request.windows(4).any(|w| w == b"\r\n\r\n") {
				match socket.read(&mut chunk).await {
					Ok(0) | Err(_) => break,
					Ok(n) => request.extend_from_slice(&chunk[..n]),
				}
			}
			let request = String::from_utf8_lossy(&request).into_owned();
			let path = request.split_whitespace().nth(1).unwrap_or("/").to_owned();
			let (status, kind, body) = routes(&path).unwrap_or(("404 Not Found", "text/plain", Vec::new()));
			let head = format!("HTTP/1.1 {status}\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
			let _ = socket.write_all(head.as_bytes()).await;
			let _ = socket.write_all(&body).await;
		}
	});
	origin
}

fn web_fetch() -> Arc<dyn Tool> {
	web_tools().remove(0)
}

#[tokio::test]
async fn web_fetch_reads_text_and_words_failures() {
	let origin = serve(|path| match path {
		"/plain" => Some(("200 OK", "text/plain", b"hello there".to_vec())),
		"/long" => Some(("200 OK", "text/plain", "word ".repeat(10_000).into_bytes())),
		"/paper.pdf" => Some(("200 OK", "application/pdf", b"%PDF".to_vec())),
		"/image" => Some(("200 OK", "image/png; charset=x", vec![1, 2])),
		_ => None,
	})
	.await;
	let tool = web_fetch();
	assert_eq!(ok(&tool, json!({ "url": format!("{origin}/plain") })).await, format!("Source: {origin}/plain (HTTP 200)\n\nhello there"));
	let long = ok(&tool, json!({ "url": format!("{origin}/long") })).await;
	assert!(long.ends_with("\n\n[Truncated: the page goes on]") && long.len() < 25_000);
	assert_eq!(ok(&tool, json!({ "url": format!("{origin}/missing") })).await, format!("web_fetch failed for {origin}/missing: HTTP 404 Not Found"));
	assert_eq!(ok(&tool, json!({ "url": format!("{origin}/image") })).await, format!("web_fetch failed for {origin}/image: Unsupported content type: image/png"));
	assert!(ok(&tool, json!({ "url": format!("{origin}/paper.pdf") })).await.contains("call web_fetch_pdf on it"));
	assert_eq!(ok(&tool, json!({ "url": "gopher://x" })).await, "web_fetch failed: invalid URL \"gopher://x\"");
}

#[tokio::test]
async fn web_fetch_stops_when_aborted() {
	let silent = TcpListener::bind("127.0.0.1:0").await.unwrap();
	let url = format!("http://{}/slow", silent.local_addr().unwrap());
	tokio::spawn(async move {
		let _held = silent.accept().await;
		clock::sleep(60_000).await;
	});
	let abort = Abort::new();
	let stopper = abort.clone();
	tokio::spawn(async move {
		clock::sleep(100).await;
		stopper.abort();
	});
	let result = web_fetch().execute(json!({ "url": url.as_str() }), ToolContext { tool_call_id: "c".to_owned(), abort }).await.unwrap();
	assert_eq!(result["content"][0]["text"].as_str().unwrap(), format!("web_fetch failed for {url}: This operation was aborted"));
}

// the PDF tools

/// A one-page PDF with `text` on it.
fn minimal_pdf(text: &str) -> Vec<u8> {
	let stream = format!("BT /F1 24 Tf 72 700 Td ({text}) Tj ET");
	let objects = [
		"<< /Type /Catalog /Pages 2 0 R >>".to_owned(),
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_owned(),
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>".to_owned(),
		format!("<< /Length {} >>\nstream\n{stream}\nendstream", stream.len()),
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_owned(),
	];
	let mut out = b"%PDF-1.4\n".to_vec();
	let mut offsets = Vec::new();
	for (i, object) in objects.iter().enumerate() {
		offsets.push(out.len());
		out.extend_from_slice(format!("{} 0 obj\n{object}\nendobj\n", i + 1).as_bytes());
	}
	let xref = out.len();
	out.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).as_bytes());
	for offset in offsets {
		out.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
	}
	out.extend_from_slice(format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n", objects.len() + 1).as_bytes());
	out
}

fn pdf_tools(pdf: &Pdf, dir: &Path) -> impl Fn(&str) -> Arc<dyn Tool> {
	let tools = create_pdf_read_tools(pdf, dir);
	move |name| tools.iter().find(|t| t.name() == name).unwrap().clone()
}

#[tokio::test]
async fn pdf_tools_keep_to_their_folder() {
	let dir = TempDir::new("pdf-scope");
	let no_library = Pdf::new(Path::new("/nonexistent"));
	let tool = pdf_tools(&no_library, dir.path());
	let wall = "pdf_info failed: path must stay inside this job's download dir";
	assert_eq!(ok(&tool("pdf_info"), json!({ "path": "../x.pdf" })).await, wall);
	assert_eq!(ok(&tool("pdf_extract"), json!({ "path": "/etc/hosts", "pages": "all" })).await, wall.replace("pdf_info", "pdf_extract"));
	assert_eq!(ok(&tool("pdf_search"), json!({ "path": "", "query": "x" })).await, wall.replace("pdf_info", "pdf_search"));
	// A missing library or file is an ordinary failure text.
	assert!(ok(&tool("pdf_info"), json!({ "path": "x.pdf" })).await.starts_with("pdf_info failed: "));
}

#[tokio::test]
async fn pdf_tools_read_a_pdf() {
	let Some(pdf) = shared_pdf() else { return };
	let dir = TempDir::new("pdf-read");
	dir.put("paper.pdf", minimal_pdf("Hello needle world"));
	let tool = pdf_tools(&pdf, dir.path());
	let info = tool("pdf_info").execute(json!({ "path": "paper.pdf" }), ToolContext { tool_call_id: "c".to_owned(), abort: Abort::new() }).await.unwrap();
	let details = &info["details"];
	assert_eq!((details["page_count"].as_i64(), details["size_class"].as_str()), (Some(1), Some("short")));
	assert_eq!(details["pages"][0]["page"].as_i64(), Some(1));
	assert!(ok(&tool("pdf_extract"), json!({ "path": dir.text("paper.pdf"), "pages": "1" })).await.contains("Hello needle world"));
	let found = tool("pdf_search").execute(json!({ "path": "paper.pdf", "query": "NEEDLE" }), ToolContext { tool_call_id: "c".to_owned(), abort: Abort::new() }).await.unwrap();
	assert_eq!(found["details"]["hits"][0]["page"].as_i64(), Some(1));
	assert_eq!(found["details"]["hits"].as_arr().unwrap().len(), 1);
}

#[tokio::test]
async fn web_fetch_pdf_downloads_and_triages() {
	let pdf = shared_pdf();
	let body = minimal_pdf("Downloaded text");
	let origin = serve(move |path| match path {
		"/paper.pdf" => Some(("200 OK", "application/pdf", body.clone())),
		"/notes.txt" => Some(("200 OK", "text/plain; charset=utf-8", b"words".to_vec())),
		"/broken" => Some(("200 OK", "application/pdf", b"not a pdf at all".to_vec())),
		_ => None,
	})
	.await;
	let dir = TempDir::new("pdf-fetch");
	let tool = pdf_tools(&pdf.clone().unwrap_or_else(|| Pdf::new(Path::new("/nonexistent"))), dir.path())("web_fetch_pdf");

	assert_eq!(ok(&tool, json!({ "url": format!("{origin}/notes.txt") })).await, format!("web_fetch_pdf failed for {origin}/notes.txt: Not a PDF (content-type text/plain)"));
	assert_eq!(ok(&tool, json!({ "url": format!("{origin}/broken") })).await, format!("web_fetch_pdf failed for {origin}/broken: The download is not a readable PDF"));
	assert_eq!(ok(&tool, json!({ "url": format!("{origin}/gone") })).await, format!("web_fetch_pdf failed for {origin}/gone: HTTP 404 Not Found"));
	assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0, "a download that is not a PDF is removed");
	assert_eq!(ok(&tool, json!({ "url": "ftp://x/y.pdf" })).await, "web_fetch_pdf failed: invalid URL \"ftp://x/y.pdf\"");

	if pdf.is_some() {
		let result = tool.execute(json!({ "url": format!("{origin}/paper.pdf") }), ToolContext { tool_call_id: "c".to_owned(), abort: Abort::new() }).await.unwrap();
		let summary = &result["details"];
		let saved = summary["path"].as_str().unwrap();
		assert!(saved.starts_with(dir.text("paper-").as_str()) && saved.ends_with(".pdf"), "{saved}");
		assert_eq!((summary["page_count"].as_i64(), summary["size_class"].as_str()), (Some(1), Some("short")));
		assert_eq!(summary["url"].as_str().unwrap(), format!("{origin}/paper.pdf"));
		assert_eq!(summary["flagged_pages"].as_arr().unwrap().len(), 0);
	}
}
