//! Finding one printed problem on its page and drawing that piece, on a two-page worksheet: a
//! title, three problems (the second runs onto page 2) and a page number at each foot.

mod common;

use common::{fixture, pdf};
use gs_pdf::{Found, PageCrop, Piece};

/// The fixtures are ASCII, so bytes are UTF-16 units.
fn find(text: &str, words: &str) -> Option<(usize, usize)> {
	text.find(words).map(|at| (at, at + words.len()))
}

async fn piece(starts: &str, ends: Option<&str>) -> Option<Piece> {
	let pdf = pdf()?;
	match pdf.find_piece(&fixture("worksheet.pdf"), 1, starts.to_owned(), ends.map(str::to_owned), find).await.unwrap() {
		Found::Piece(piece) => Some(piece),
		other => panic!("{other:?}"),
	}
}

#[tokio::test]
async fn a_problem_is_cut_from_its_first_words_to_the_next_problem() {
	let Some(first) = piece("1. First problem", Some("2. Second problem")).await else { return };
	let Some(second) = piece("2. Second problem", Some("3. Third problem")).await else { return };
	assert_eq!(first.parts.len(), 1);
	let crop = first.parts[0].crop;
	assert!(crop.top > 0.1 && crop.top < 0.15, "under the title: {crop:?}");
	assert!(crop.bottom > 0.19 && crop.bottom <= second.parts[0].crop.top + 0.03, "{crop:?} then {:?}", second.parts[0].crop);
	assert!(crop.left > 0.05 && crop.left < 0.12 && crop.right > 0.5 && crop.right < 0.9, "the page's print, with a little air: {crop:?}");
	assert_eq!(first.text, "1. First problem: a fair coin is flipped three times.\n(a) How many outcomes are there?\n(b) What is the chance of f(b) heads exactly twice?");
	assert_eq!(first.labels.iter().map(|l| l.label.as_str()).collect::<Vec<_>>(), ["a", "b"]);
	assert!(first.labels[0].y > crop.top && first.labels[1].y > first.labels[0].y && first.labels[1].y < crop.bottom);
	assert_eq!((first.mark, first.parts[0].aspect), (None, 612.0 / 792.0));
}

#[tokio::test]
async fn a_problem_runs_onto_the_next_page_without_page_numbers_or_running_heads() {
	let Some(second) = piece("2. Second problem", Some("3. Third problem")).await else { return };
	assert_eq!(second.parts.iter().map(|p| p.page).collect::<Vec<_>>(), [1, 2]);
	assert!(second.parts[0].crop.bottom < 0.5, "the page number at the foot is left out: {:?}", second.parts[0].crop);
	assert!(second.parts[1].crop.top > 0.06, "the running head is left out: {:?}", second.parts[1].crop);
	assert!(second.parts[1].crop.bottom < 0.2, "it ends before problem 3: {:?}", second.parts[1].crop);
	assert!(second.text.ends_with("(b) Show that the loop ends."), "{}", second.text);
	assert_eq!(second.labels.iter().map(|l| (l.label.as_str(), l.page)).collect::<Vec<_>>(), [("a", 2), ("b", 2)]);
}

#[tokio::test]
async fn without_an_end_a_problem_ends_with_its_page() {
	let Some(first) = piece("1. First problem", None).await else { return };
	let Some(lost) = piece("1. First problem", Some("9. No such problem")).await else { return };
	assert_eq!(first, lost);
	assert_eq!(first.parts.len(), 1);
	assert!(first.parts[0].crop.bottom > 0.25 && first.parts[0].crop.bottom < 0.5, "{:?}", first.parts[0].crop);
}

#[tokio::test]
async fn words_that_are_not_on_the_page_give_its_lines_and_a_scan_says_so() {
	let Some(pdf) = pdf() else { return };
	let missing = pdf.find_piece(&fixture("worksheet.pdf"), 1, "4. Fourth".to_owned(), None, find).await.unwrap();
	let Found::Missing(lines) = missing else { panic!("{missing:?}") };
	assert_eq!(lines[1], "1. First problem: a fair coin is flipped three times.");
	assert_eq!(pdf.find_piece(&fixture("image-only.pdf"), 1, "anything".to_owned(), None, find).await, Ok(Found::Scan { aspect: 612.0 / 792.0 }));
	assert_eq!(pdf.find_piece(&fixture("worksheet.pdf"), 9, "1. First".to_owned(), None, find).await, Err("Invalid page request.".to_owned()));
}

#[tokio::test]
async fn a_piece_is_drawn_at_the_asked_width_and_recolored_with_an_ink() {
	let Some(first) = piece("1. First problem", Some("2. Second problem")).await else { return };
	let Some(pdf) = pdf() else { return };
	let crop = first.parts[0].crop;
	let printed = image::load_from_memory(&pdf.render_page_piece(&fixture("worksheet.pdf"), 1, crop, 600, None).await.unwrap()).unwrap().to_rgba8();
	assert!((598..=604).contains(&printed.width()), "{}", printed.width());
	assert!(printed.pixels().all(|p| p[3] == 255) && printed.get_pixel(0, 0).0 == [255; 4]);
	let themed = image::load_from_memory(&pdf.render_page_piece(&fixture("worksheet.pdf"), 1, crop, 600, Some([230, 228, 220])).await.unwrap()).unwrap().to_rgba8();
	assert_eq!(themed.dimensions(), printed.dimensions());
	assert_eq!(themed.get_pixel(0, 0)[3], 0, "the paper is see-through");
	let inked = themed.pixels().filter(|p| p[3] > 200).count();
	assert!(inked > 200 && themed.pixels().filter(|p| p[3] > 200).all(|p| p[0] > 200), "{inked} pixels of light ink");
	for bad in [PageCrop { left: f64::NAN, ..crop }, PageCrop { right: crop.left, ..crop }, PageCrop { bottom: 1.5, ..crop }] {
		assert_eq!(pdf.render_page_piece(&fixture("worksheet.pdf"), 1, bad, 600, None).await, Err("Page 1 has no such piece.".to_owned()));
	}
}
