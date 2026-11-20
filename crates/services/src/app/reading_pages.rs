//! The pages behind the lesson's "agent at work" view: the file the teacher is reading, as text or
//! as rendered PDF pages. Only plain files under the learner's home are served (the same anchor
//! the read tool resolves against), never anything inside a dot folder or another place the
//! file tools refuse.

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use gs_agent::fs_tools::fs_shared::resolve_source_path;
use gs_agent::fs_tools::protected::Protected;
use gs_base::config::resolve;
use gs_base::{fsx, text};
use gs_json::{Json, json};
use gs_pdf::PageCrop;

use crate::App;

pub(crate) const TEXT_MAX_BYTES: u64 = 2 * 1024 * 1024;
const PAGE_DPI: f64 = 100.0;
pub(crate) const CACHE_LIMIT: usize = 48;
/// The widths a piece is drawn at: a width asked for is raised to the next one, so pieces of one
/// page share pictures.
const PIECE_WIDTHS: [u32; 5] = [480, 720, 960, 1440, 1920];
const PIECE_DEFAULT_WIDTH: u32 = 960;
/// The bytes the drawn pieces may hold; the oldest go first.
const PIECE_CACHE_BYTES: usize = 32 * 1024 * 1024;

/// Drawn pieces of PDF pages, oldest first, up to `PIECE_CACHE_BYTES`.
#[derive(Default)]
pub(crate) struct PieceCache {
	pictures: VecDeque<(String, Arc<Vec<u8>>)>,
	bytes: usize,
}

impl PieceCache {
	fn get(&self, key: &str) -> Option<Arc<Vec<u8>>> {
		self.pictures.iter().find(|(cached, _)| cached == key).map(|(_, png)| png.clone())
	}

	fn keep(&mut self, key: String, png: Arc<Vec<u8>>) {
		self.bytes += png.len();
		self.pictures.push_back((key, png));
		while self.bytes > PIECE_CACHE_BYTES && self.pictures.len() > 1 {
			if let Some((_, oldest)) = self.pictures.pop_front() {
				self.bytes -= oldest.len();
			}
		}
	}
}

/// The `crop`, `w` and `ink` a page's picture was asked for, as the request wrote them.
#[derive(Clone, Copy, Default)]
pub struct PieceQuery<'a> {
	pub crop: Option<&'a str>,
	pub w: Option<&'a str>,
	pub ink: Option<&'a str>,
}

/// A piece of a page as drawn: where, how wide and in which print color.
#[derive(Debug, PartialEq)]
pub(crate) struct PieceView {
	crop: PageCrop,
	width: u32,
	ink: Option<[u8; 3]>,
}

impl PieceQuery<'_> {
	/// None when nothing was asked for (the whole page as it prints). Else the view, or why the
	/// request is wrong.
	pub(crate) fn view(self) -> Result<Option<PieceView>, ReadingError> {
		if self.crop.is_none() && self.w.is_none() && self.ink.is_none() {
			return Ok(None);
		}
		let crop = self.crop.map_or(Ok(PageCrop::WHOLE), read_crop)?;
		let width = self.w.map_or(Ok(PIECE_DEFAULT_WIDTH), read_width)?;
		let ink = self.ink.map(read_ink).transpose()?;
		Ok(Some(PieceView { crop, width, ink }))
	}
}

fn read_crop(raw: &str) -> Result<PageCrop, ReadingError> {
	const BAD: ReadingError = ReadingError::Refused(400, "crop must be left,top,right,bottom, each from 0 to 1, with left before right and top before bottom");
	let sides: Vec<f64> = raw.split(',').map(|side| side.trim().parse::<f64>().ok().filter(|n| (0.0..=1.0).contains(n)).ok_or(BAD)).collect::<Result<_, _>>()?;
	match sides[..] {
		[left, top, right, bottom] if left < right && top < bottom => Ok(PageCrop { left, top, right, bottom }),
		_ => Err(BAD),
	}
}

fn read_width(raw: &str) -> Result<u32, ReadingError> {
	if raw.is_empty() || !raw.bytes().all(|b| b.is_ascii_digit()) {
		return Err(ReadingError::Refused(400, "w must be a whole number of pixels"));
	}
	// Digits too many for a number are far above the widest.
	let asked: u64 = raw.parse().unwrap_or(u64::MAX);
	Ok(PIECE_WIDTHS.into_iter().find(|width| u64::from(*width) >= asked).unwrap_or(PIECE_WIDTHS[PIECE_WIDTHS.len() - 1]))
}

fn read_ink(raw: &str) -> Result<[u8; 3], ReadingError> {
	let channel = |at: usize| raw.get(at..at + 2).and_then(|pair| u8::from_str_radix(pair, 16).ok());
	match (raw.len(), raw.bytes().all(|b| b.is_ascii_hexdigit()), channel(0), channel(2), channel(4)) {
		(6, true, Some(r), Some(g), Some(b)) => Ok([r, g, b]),
		_ => Err(ReadingError::Refused(400, "ink must be six hex digits")),
	}
}

/// Why a file or page can't be shown.
#[derive(Debug, PartialEq)]
pub enum ReadingError {
	/// A status and the words for the window.
	Refused(u16, &'static str),
	/// Reading or rendering broke.
	Failed(String),
}

struct Servable {
	absolute: PathBuf,
	mtime_ms: f64,
	size: u64,
}

fn is_hidden_or_outside(home: &Path, absolute: &Path) -> bool {
	match absolute.strip_prefix(home) {
		Ok(inside) => inside.as_os_str().is_empty() || inside.components().any(|part| part.as_os_str().to_string_lossy().starts_with('.')),
		Err(_) => true,
	}
}

async fn servable(app: &App, raw_path: &str) -> Result<Servable, ReadingError> {
	let absolute = resolve(&resolve_source_path(Some(raw_path)));
	if is_hidden_or_outside(&resolve(&app.paths.home), &absolute) || Protected::new(&app.paths.home, &app.paths.data).refuse(raw_path, &absolute).is_err() {
		return Err(ReadingError::Refused(403, "Not a file the teacher can show"));
	}
	let meta = tokio::fs::metadata(&absolute).await.ok().filter(std::fs::Metadata::is_file).ok_or(ReadingError::Refused(404, "No such file"))?;
	Ok(Servable { absolute, mtime_ms: fsx::modified_ms(&meta), size: meta.len() })
}

pub(crate) fn is_pdf(file: &Path) -> bool {
	file.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("pdf"))
}

/// The whole document: `{ kind: "text", text }`, or a PDF's `{ kind: "pdf", pageCount, aspect }`.
pub async fn reading_document(app: &App, raw_path: &str) -> Result<Json, ReadingError> {
	let Servable { absolute, size, .. } = servable(app, raw_path).await?;
	if is_pdf(&absolute) {
		let shape = app.pdf.pdf_shape(&absolute).await.map_err(|_| ReadingError::Refused(415, "Unreadable PDF"))?;
		return Ok(json!({ "kind": "pdf", "pageCount": shape.page_count, "aspect": shape.aspect }));
	}
	if size > TEXT_MAX_BYTES {
		return Err(ReadingError::Refused(413, "File too large"));
	}
	let bytes = tokio::fs::read(&absolute).await.map_err(|err| ReadingError::Failed(fsx::node_error_message(&err, "open", &absolute)))?;
	let contents = text::from_utf8_lossy(&bytes);
	if contents.contains('\0') {
		return Err(ReadingError::Refused(415, "Not a text file"));
	}
	Ok(json!({ "kind": "text", "text": contents }))
}

/// One page of a PDF at `absolute` as a PNG, cached by file version.
pub(crate) async fn render_pdf_page(app: &App, absolute: &Path, mtime_ms: f64, page: i64) -> Result<Arc<Vec<u8>>, ReadingError> {
	let key = format!("{}:{mtime_ms}:{page}", absolute.display());
	if let Some((_, png)) = app.misc.pages.lock().iter().find(|(cached, _)| *cached == key) {
		return Ok(png.clone());
	}
	let rendered = app.pdf.render_pdf_pages(absolute, &[page], Some(PAGE_DPI)).await.map_err(ReadingError::Failed)?;
	let png = Arc::new(rendered.into_iter().next().ok_or(ReadingError::Refused(404, "No such page"))?.png);
	let mut cache = app.misc.pages.lock();
	cache.push_back((key, png.clone()));
	if cache.len() > CACHE_LIMIT {
		cache.pop_front();
	}
	Ok(png)
}

/// The piece of one PDF page `view` asks for, as a PNG, cached by file version.
pub(crate) async fn render_pdf_piece(app: &App, absolute: &Path, mtime_ms: f64, page: i64, view: &PieceView) -> Result<Arc<Vec<u8>>, ReadingError> {
	let PieceView { crop, width, ink } = view;
	let key = format!("{}:{mtime_ms}:{page}:{:?}:{width}:{ink:?}", absolute.display(), [crop.left, crop.top, crop.right, crop.bottom]);
	if let Some(png) = app.misc.pieces.lock().get(&key) {
		return Ok(png);
	}
	let number = u32::try_from(page).map_err(|_| ReadingError::Refused(404, "No such page"))?;
	let png = Arc::new(app.pdf.render_page_piece(absolute, number, *crop, *width, *ink).await.map_err(ReadingError::Failed)?);
	app.misc.pieces.lock().keep(key, png.clone());
	Ok(png)
}

/// One PDF page of a file the teacher may show, as a PNG.
pub async fn reading_pdf_page(app: &App, raw_path: &str, page: i64) -> Result<Arc<Vec<u8>>, ReadingError> {
	let Servable { absolute, mtime_ms, .. } = servable(app, raw_path).await?;
	if !is_pdf(&absolute) {
		return Err(ReadingError::Refused(415, "Not a PDF"));
	}
	render_pdf_page(app, &absolute, mtime_ms, page).await
}

/// The digits as a number in `radix`, or None when there are none or one is not valid.
fn whole_in_base(digits: &str, radix: u32) -> Option<f64> {
	if digits.is_empty() || !digits.chars().all(|c| c.is_digit(radix)) {
		return None;
	}
	u64::from_str_radix(digits, radix).ok().map(|n| n as f64)
}

/// JavaScript's `Number(text)` when it is a whole number from 1 (a page), else None.
pub fn parse_page(raw: &str) -> Option<i64> {
	let trimmed = text::trim(raw);
	let number = match trimmed.get(..2).map(str::to_ascii_lowercase).as_deref() {
		Some("0x") => whole_in_base(&trimmed[2..], 16)?,
		Some("0o") => whole_in_base(&trimmed[2..], 8)?,
		Some("0b") => whole_in_base(&trimmed[2..], 2)?,
		_ if trimmed.chars().all(|c| c.is_ascii_digit() || matches!(c, '.' | 'e' | 'E' | '+' | '-')) => trimmed.parse::<f64>().ok()?,
		_ => return None,
	};
	(number.is_finite() && number.fract() == 0.0 && number >= 1.0).then_some(number as i64)
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};

	#[test]
	fn a_page_is_a_whole_number_from_one_as_javascript_reads_it() {
		for (raw, page) in [("1", Some(1)), (" 12 ", Some(12)), ("3.0", Some(3)), ("1e1", Some(10)), ("0x10", Some(16)), ("0b11", Some(3)), ("0o7", Some(7)), ("+2", Some(2))] {
			assert_eq!(parse_page(raw), page, "{raw}");
		}
		for raw in ["", "0", "-1", "1.5", "abc", "NaN", "Infinity", "inf", "1e999", "0x", "0x+1", "1_000", "--1", "."] {
			assert_eq!(parse_page(raw), None, "{raw}");
		}
	}

	#[test]
	fn a_piece_is_asked_for_with_a_crop_a_width_and_an_ink() {
		let view = |crop, w, ink| PieceQuery { crop, w, ink }.view();
		assert_eq!(view(None, None, None), Ok(None), "nothing asked: the page as it is");
		assert_eq!(view(None, Some("1"), None), Ok(Some(PieceView { crop: PageCrop::WHOLE, width: 480, ink: None })));
		let asked = view(Some("0.1,0.2,0.9,0.5"), None, Some("e6e4dc")).unwrap().unwrap();
		assert_eq!((asked.crop, asked.width, asked.ink), (PageCrop { left: 0.1, top: 0.2, right: 0.9, bottom: 0.5 }, 960, Some([230, 228, 220])));
		for (w, width) in [("480", 480), ("481", 720), ("961", 1440), ("1920", 1920), ("1921", 1920), ("99999999999999999999999", 1920), ("0", 480)] {
			assert_eq!(view(None, Some(w), None).unwrap().unwrap().width, width, "{w}");
		}
		for crop in ["", "0,0,1", "0,0,1,1,1", "0,0,1,x", "0.5,0,0.5,1", "0,0.5,1,0.5", "0.9,0,0.1,1", "-0.1,0,1,1", "0,0,1.1,1", "nan,0,1,1", "0,0,inf,1", "0,0,1e999,1"] {
			assert!(matches!(view(Some(crop), None, None), Err(ReadingError::Refused(400, _))), "{crop}");
		}
		for w in ["", "-1", "1.5", "abc", "0x10"] {
			assert!(matches!(view(None, Some(w), None), Err(ReadingError::Refused(400, _))), "{w}");
		}
		for ink in ["", "fff", "fffffff", "#e6e4dc", "gggggg", "+12345"] {
			assert!(matches!(view(None, None, Some(ink)), Err(ReadingError::Refused(400, _))), "{ink}");
		}
	}

	#[test]
	fn pieces_are_held_by_their_size_and_the_oldest_go_first() {
		let mut cache = PieceCache::default();
		let third = PIECE_CACHE_BYTES / 3 + 1;
		for key in ["a", "b", "c"] {
			cache.keep(key.to_owned(), Arc::new(vec![0; third]));
		}
		assert!(cache.get("a").is_none() && cache.get("b").is_some() && cache.get("c").is_some());
		cache.keep("huge".to_owned(), Arc::new(vec![0; PIECE_CACHE_BYTES + 1]));
		assert!(cache.get("huge").is_some() && cache.get("c").is_none(), "one picture over the limit stays alone");
		assert_eq!(cache.bytes, PIECE_CACHE_BYTES + 1);
	}

	#[test]
	fn only_plain_files_under_home_may_be_shown() {
		let home = Path::new("/home/a");
		assert!(is_hidden_or_outside(home, Path::new("/home/a")));
		assert!(is_hidden_or_outside(home, Path::new("/home/b/x.txt")));
		assert!(is_hidden_or_outside(home, Path::new("/home/ab/x.txt")));
		assert!(is_hidden_or_outside(home, Path::new("/home/a/.ssh/key")));
		assert!(is_hidden_or_outside(home, Path::new("/home/a/notes/.hidden")));
		assert!(!is_hidden_or_outside(home, Path::new("/home/a/notes/x.txt")));
	}

	#[tokio::test]
	async fn text_comes_back_whole_and_the_refusals_have_their_words() {
		let root = scratch_dir("reading-text");
		let app = test_app(&root);
		let home = root.join("home");
		crate::app::disk::write_file_atomic(&home.join("notes/a.txt"), "hello\nworld").unwrap();
		crate::app::disk::write_file_atomic(&home.join("notes/zero.txt"), "a\0b").unwrap();
		crate::app::disk::write_file_atomic(&home.join(".hidden/a.txt"), "x").unwrap();
		let shown = reading_document(&app, &home.join("notes/a.txt").to_string_lossy()).await.unwrap();
		assert_eq!(gs_json::stringify(&shown), r#"{"kind":"text","text":"hello\nworld"}"#);
		let refused = |path: PathBuf| {
			let app = &app;
			async move { reading_document(app, &path.to_string_lossy()).await }
		};
		assert_eq!(refused(home.join("notes/zero.txt")).await, Err(ReadingError::Refused(415, "Not a text file")));
		assert_eq!(refused(home.join("notes/none.txt")).await, Err(ReadingError::Refused(404, "No such file")));
		assert_eq!(refused(home.join("notes")).await, Err(ReadingError::Refused(404, "No such file")));
		assert_eq!(refused(home.join(".hidden/a.txt")).await, Err(ReadingError::Refused(403, "Not a file the teacher can show")));
		assert_eq!(refused(home.join("Library/Cookies/a.txt")).await, Err(ReadingError::Refused(403, "Not a file the teacher can show")));
		assert_eq!(refused(root.join("data/settings.json")).await, Err(ReadingError::Refused(403, "Not a file the teacher can show")));
		assert_eq!(reading_pdf_page(&app, &home.join("notes/a.txt").to_string_lossy(), 1).await, Err(ReadingError::Refused(415, "Not a PDF")));
	}

	#[tokio::test]
	async fn godspeeds_own_secrets_are_not_shown_even_inside_home() {
		let root = scratch_dir("reading-secrets");
		let home = root.join("home");
		let data = home.join("Library/Application Support/godspeed");
		for name in ["tmp", "res"] {
			std::fs::create_dir_all(root.join(name)).unwrap();
		}
		let app = App::new(gs_base::config::Paths::new(data.clone(), home, root.join("tmp"), root.join("res")), None);
		crate::app::disk::write_file_atomic(&data.join("mcp-token"), "secret").unwrap();
		crate::app::disk::write_file_atomic(&data.join("other.txt"), "fine").unwrap();
		let shown = |name: &'static str| {
			let (app, path) = (&app, data.join(name));
			async move { reading_document(app, &path.to_string_lossy()).await }
		};
		assert_eq!(shown("mcp-token").await, Err(ReadingError::Refused(403, "Not a file the teacher can show")));
		assert_eq!(shown("other.txt").await.unwrap()["text"], Json::from("fine"));
	}

	#[tokio::test]
	async fn a_text_file_over_two_megabytes_is_too_large() {
		let root = scratch_dir("reading-large");
		let app = test_app(&root);
		let big = root.join("home/big.txt");
		crate::app::disk::write_file_atomic(&big, &"x".repeat(TEXT_MAX_BYTES as usize + 1)).unwrap();
		assert_eq!(reading_document(&app, &big.to_string_lossy()).await, Err(ReadingError::Refused(413, "File too large")));
	}
}
