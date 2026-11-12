//! The demo window's WebKitGTK parts: its page size, its loopback rules (a content filter, which
//! the webkit2gtk crate has no binding for) and the SVG snapshot.

use std::ffi::{CString, c_void};
use std::path::Path;

use gtk::prelude::WidgetExt;
use tauri::webview::PlatformWebview;
use webkit2gtk::glib::object::ObjectType;
use webkit2gtk::glib::translate::{ToGlibPtr, from_glib_full};
use webkit2gtk::glib::{self, gobject_ffi};
use webkit2gtk::{SnapshotOptions, SnapshotRegion, WebView, WebViewExt, ffi, gio};

use crate::demo::{BLOCK_LOOPBACK, ORIGIN, SvgDone};

type Loaded = Box<dyn FnOnce(Result<(), String>) + Send>;

/// Gives the view its page size, compiles the loopback rules into `folder`, adds them to the
/// view, and only then loads `html`; `done` hears whether the load started.
pub fn load(webview: &PlatformWebview, folder: &Path, (width, height): (u32, u32), html: &str, done: Loaded) {
	let view = webview.inner();
	// GTK sizes nothing in a hidden window, and an unsized view lays the page out at 0 × 0 and
	// draws nothing; this view is never shown, so the size stays.
	let size = |n: u32| i32::try_from(n).unwrap_or(i32::MAX);
	view.size_allocate(&gtk::Allocation::new(0, 0, size(width), size(height)));
	let Ok(folder) = CString::new(folder.to_string_lossy().as_bytes()) else {
		return done(Err("the demo folder's path holds a NUL".to_owned()));
	};
	let rules = glib::Bytes::from_static(BLOCK_LOOPBACK.as_bytes());
	let source: *const glib::ffi::GBytes = rules.to_glib_none().0;
	// SAFETY: WebKit copies the path; the new store comes with a reference the Object owns.
	let store: glib::Object = unsafe { from_glib_full(ffi::webkit_user_content_filter_store_new(folder.as_ptr()).cast::<gobject_ffi::GObject>()) };
	let saving = Box::into_raw(Box::new(Saving { view, html: html.to_owned(), done }));
	// SAFETY: the store and the rule bytes are live (the save holds its own references while it
	// runs), and `saved` takes `saving` back exactly once, on this main thread.
	unsafe {
		ffi::webkit_user_content_filter_store_save(store.as_ptr().cast(), c"loopback".as_ptr(), source.cast_mut(), std::ptr::null_mut(), Some(saved), saving.cast::<c_void>());
	}
}

struct Saving {
	view: WebView,
	html: String,
	done: Loaded,
}

unsafe extern "C" fn saved(store: *mut gobject_ffi::GObject, result: *mut gio::ffi::GAsyncResult, data: *mut c_void) {
	// SAFETY: `data` is the box `load` gave up for this one call.
	let saving = unsafe { Box::from_raw(data.cast::<Saving>()) };
	let mut err = std::ptr::null_mut();
	// SAFETY: finishes the save this call reports, on the store that started it.
	let filter = unsafe { ffi::webkit_user_content_filter_store_save_finish(store.cast(), result, &mut err) };
	if filter.is_null() {
		// SAFETY: a failed save hands over a GError.
		let err: glib::Error = unsafe { from_glib_full(err) };
		return (saving.done)(Err(format!("cannot compile the loopback rules: {err}")));
	}
	let Some(manager) = saving.view.user_content_manager() else {
		// SAFETY: the filter is ours to release.
		unsafe { ffi::webkit_user_content_filter_unref(filter) };
		return (saving.done)(Err("the demo view has no content manager".to_owned()));
	};
	// SAFETY: the manager keeps its own reference to the filter, so ours is released after.
	unsafe {
		ffi::webkit_user_content_manager_add_filter(manager.as_ptr(), filter);
		ffi::webkit_user_content_filter_unref(filter);
	}
	saving.view.load_html(&saving.html, Some(ORIGIN));
	(saving.done)(Ok(()));
}

/// The loaded page as a PNG of exactly `width` × `height` px on white.
pub fn snapshot(webview: &PlatformWebview, width: u32, height: u32, done: SvgDone) {
	webview.inner().snapshot(SnapshotRegion::Visible, SnapshotOptions::NONE, None::<&gio::Cancellable>, move |shot| {
		done(shot.map_err(|err| err.to_string()).and_then(|shot| exact_png(&shot, width, height)));
	});
}

/// The snapshot drawn at one pixel a point: cairo scales a HiDPI surface down by its device scale.
fn exact_png(shot: &cairo::Surface, width: u32, height: u32) -> Result<Vec<u8>, String> {
	let fail = |err: cairo::Error| err.to_string();
	let size = |n: u32| i32::try_from(n).map_err(|_| "the SVG is too large".to_owned());
	let canvas = cairo::ImageSurface::create(cairo::Format::ARgb32, size(width)?, size(height)?).map_err(fail)?;
	let context = cairo::Context::new(&canvas).map_err(fail)?;
	context.set_source_rgb(1.0, 1.0, 1.0);
	context.paint().map_err(fail)?;
	context.set_source_surface(shot, 0.0, 0.0).map_err(fail)?;
	context.paint().map_err(fail)?;
	drop(context);
	let mut png = Vec::new();
	canvas.write_to_png(&mut png).map_err(|err| err.to_string())?;
	Ok(png)
}
