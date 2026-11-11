//! Printing a PDF with PDFKit: the pages come out whole, and the print sheet opens on a window.
//! The shared print info is a test one that saves to a file, so nothing reaches a printer.
//! AppKit needs the process's main thread, so this runs without the test harness.

#[cfg(not(target_os = "macos"))]
fn main() {}

#[cfg(target_os = "macos")]
fn main() {
	checks::main();
}

#[cfg(target_os = "macos")]
#[allow(dead_code, unused_imports)]
#[path = "../src/demo.rs"]
mod demo;

#[cfg(target_os = "macos")]
#[allow(dead_code, unused_imports)]
#[path = "../src/paths.rs"]
mod paths;

#[cfg(target_os = "macos")]
#[allow(dead_code)]
#[path = "../src/mac/mod.rs"]
mod mac;

#[cfg(target_os = "macos")]
mod checks {
	use std::path::Path;
	use std::time::{Duration, Instant};

	use objc2::MainThreadMarker;
	use objc2::rc::{Retained, autoreleasepool};
	use objc2_app_kit::{NSApplication, NSApplicationActivationPolicy, NSModalResponseCancel, NSPDFInfo, NSPanel, NSPrintInfo};
	use objc2_foundation::{NSDate, NSPoint, NSRect, NSRunLoop, NSSize, NSString, NSURL};

	use crate::mac::print::{operation, show_sheet};

	pub fn main() {
		let mtm = MainThreadMarker::new().expect("the test runs on the main thread");
		NSApplication::sharedApplication(mtm).setActivationPolicy(NSApplicationActivationPolicy::Accessory);
		let folder = std::env::temp_dir().join(format!("godspeed-mac-print-test-{}", std::process::id()));
		std::fs::create_dir_all(&folder).unwrap();
		// 5 × 7 in, the size of a small cheat sheet.
		let pdf = folder.join("sheet.pdf");
		gs_base::fsx::write_atomic(&pdf, &two_page_pdf(360, 504), None).unwrap();

		let printed = folder.join("printed.pdf");
		NSPrintInfo::setSharedPrintInfo(&save_to(&printed));
		let job = operation(mtm, &pdf).expect("PDFKit's print operation");
		let paper = job.printInfo().paperSize();
		assert_eq!((paper.width, paper.height), (360.0, 504.0), "the paper is not the PDF's page size");
		assert_saves(&job.printInfo());
		job.setShowsPrintPanel(false);
		job.setShowsProgressPanel(false);
		assert!(job.runOperation(), "the print operation failed");
		let pages = media_boxes(&std::fs::read(&printed).expect("the printed file"));
		assert_eq!(pages, ["0 0 360 504", "0 0 360 504"]);

		// The sheet shows on screen, so it is checked only where CI is set (GitHub sets it).
		if std::env::var_os("CI").is_some() {
			sheet_opens_and_cancels(mtm, &folder, &pdf);
		} else {
			eprintln!("mac_print: print sheet check skipped (set CI=1 to run it; it shows a sheet on screen)");
		}

		let _ = std::fs::remove_dir_all(&folder);
		eprintln!("mac_print: all checks passed");
	}

	fn sheet_opens_and_cancels(mtm: MainThreadMarker, folder: &Path, pdf: &Path) {
		// Anything the sheet would print lands in this file, which a cancel never writes.
		let sheet_file = folder.join("from-the-sheet.pdf");
		NSPrintInfo::setSharedPrintInfo(&save_to(&sheet_file));
		let window = NSPanel::new(mtm);
		window.setFrame_display(NSRect::new(NSPoint::new(80.0, 80.0), NSSize::new(640.0, 480.0)), true);
		window.orderFrontRegardless();
		show_sheet(&window, pdf).expect("the print sheet");
		let sheet = run_until(|| window.attachedSheet()).expect("no print sheet on the window");
		window.endSheet_returnCode(&sheet, NSModalResponseCancel);
		assert!(run_until(|| window.attachedSheet().is_none().then_some(())).is_some(), "the print sheet stayed open");
		window.orderOut(None);
		assert!(!sheet_file.exists(), "a cancelled sheet printed");
	}

	/// A print info that saves the job as a PDF at `path` instead of printing it.
	fn save_to(path: &Path) -> Retained<NSPrintInfo> {
		let target = NSPDFInfo::new();
		target.setURL(Some(&NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()))));
		let info = NSPrintInfo::new();
		info.takeSettingsFromPDFInfo(&target);
		assert_saves(&info);
		info
	}

	/// Stops the test before anything could reach a real printer.
	fn assert_saves(info: &NSPrintInfo) {
		assert_eq!(info.jobDisposition().to_string(), "NSPrintSaveJob", "the print info would print on paper");
	}

	/// Runs the main run loop until `ready` gives a value, for up to 10 s.
	fn run_until<T>(mut ready: impl FnMut() -> Option<T>) -> Option<T> {
		let deadline = Instant::now() + Duration::from_secs(10);
		while Instant::now() < deadline {
			if let Some(value) = ready() {
				return Some(value);
			}
			autoreleasepool(|_| NSRunLoop::currentRunLoop().runUntilDate(&NSDate::dateWithTimeIntervalSinceNow(0.05)));
		}
		None
	}

	/// A two-page PDF of `width` × `height` pt, each page a filled box inside a margin.
	fn two_page_pdf(width: u32, height: u32) -> Vec<u8> {
		let content = format!("0 0 1 rg 36 36 {} {} re f", width - 72, height - 72);
		let page = format!("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {width} {height}] /Contents 5 0 R >>");
		let objects = [
			"<< /Type /Catalog /Pages 2 0 R >>".to_owned(),
			"<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>".to_owned(),
			page.clone(),
			page,
			format!("<< /Length {} >>\nstream\n{content}\nendstream", content.len()),
		];
		let mut pdf = b"%PDF-1.4\n".to_vec();
		let mut offsets = Vec::new();
		for (n, body) in objects.iter().enumerate() {
			offsets.push(pdf.len());
			pdf.extend(format!("{} 0 obj\n{body}\nendobj\n", n + 1).bytes());
		}
		let xref = pdf.len();
		pdf.extend(format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).bytes());
		for offset in offsets {
			pdf.extend(format!("{offset:010} 00000 n \n").bytes());
		}
		pdf.extend(format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n", objects.len() + 1).bytes());
		pdf
	}

	/// Each page's media box, from the page objects Quartz writes uncompressed.
	fn media_boxes(pdf: &[u8]) -> Vec<String> {
		let text = String::from_utf8_lossy(pdf);
		text.split("/Type /Page")
			.skip(1)
			.filter(|rest| !rest.starts_with('s'))
			.filter_map(|rest| {
				let object = &rest[..rest.find(">>")?];
				let start = object.find("/MediaBox")?;
				let open = start + object[start..].find('[')?;
				let close = open + object[open..].find(']')?;
				Some(object[open + 1..close].split_whitespace().collect::<Vec<_>>().join(" "))
			})
			.collect()
	}
}
