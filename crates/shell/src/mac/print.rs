//! Printing a PDF with PDFKit: the file's own vector pages, through the Mac's print sheet.

use std::path::Path;
use std::sync::mpsc;

use objc2::rc::Retained;
use objc2::{AnyThread, MainThreadMarker};
use objc2_app_kit::{NSPrintInfo, NSPrintOperation, NSWindow};
use objc2_foundation::{NSCopying, NSString, NSURL};
use objc2_pdf_kit::{PDFDisplayBox, PDFDocument, PDFPrintScalingMode};
use tauri::WebviewWindow;

/// Opens the print sheet for the PDF at `path` on `window`.
#[expect(dead_code, reason = "the print command calls it")]
pub fn print_pdf(window: &WebviewWindow, path: &Path) -> Result<(), String> {
	let (tx, rx) = mpsc::channel();
	let (main, path) = (window.clone(), path.to_owned());
	// On the main thread this runs at once; elsewhere this waits for it, and a sheet returns at
	// once.
	window
		.run_on_main_thread(move || {
			let shown = main.ns_window().map_err(|err| err.to_string()).and_then(|ns_window| {
				// SAFETY: Tauri hands over this window's NSWindow, autoreleased, on the main thread.
				let ns_window = unsafe { Retained::retain(ns_window.cast::<NSWindow>()) }.ok_or("the window is gone")?;
				show_sheet(&ns_window, &path)
			});
			let _ = tx.send(shown);
		})
		.map_err(|err| err.to_string())?;
	rx.recv().map_err(|_| "the print sheet did not open".to_owned())?
}

/// Runs the print operation as a sheet on `window`.
pub fn show_sheet(window: &NSWindow, path: &Path) -> Result<(), String> {
	let operation = operation(MainThreadMarker::from(window), path)?;
	// SAFETY: no delegate, so no callback selector and no context.
	unsafe { operation.runOperationModalForWindow_delegate_didRunSelector_contextInfo(window, None, None, std::ptr::null_mut()) };
	Ok(())
}

/// PDFKit's operation for the PDF at `path`, on a copy of the shared print info (the learner's
/// printer): the paper starts at the first page's size with no margins, as the cheat sheet was
/// laid out; pages shrink only when they do not fit the paper picked, and turn to match it.
pub fn operation(mtm: MainThreadMarker, path: &Path) -> Result<Retained<NSPrintOperation>, String> {
	let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
	// SAFETY: a file URL; PDFKit returns None for a file it cannot read.
	let document = unsafe { PDFDocument::initWithURL(PDFDocument::alloc(), &url) }.ok_or("PDFKit could not open the PDF")?;
	// SAFETY: reading the first page of a document this call holds.
	let page = unsafe { document.pageAtIndex(0) }.ok_or("the PDF has no pages")?;
	// SAFETY: the crop box is what PDFKit shows and prints (the media box when there is none).
	let size = unsafe { page.boundsForBox(PDFDisplayBox::CropBox) }.size;
	let info = NSPrintInfo::sharedPrintInfo().copy();
	info.setPaperSize(size);
	info.setTopMargin(0.0);
	info.setBottomMargin(0.0);
	info.setLeftMargin(0.0);
	info.setRightMargin(0.0);
	// SAFETY: a print info this call owns, on the main thread.
	unsafe { document.printOperationForPrintInfo_scalingMode_autoRotate(Some(&info), PDFPrintScalingMode::PageScaleDownToFit, true, mtm) }
		.ok_or_else(|| "PDFKit could not print the PDF".to_owned())
}
