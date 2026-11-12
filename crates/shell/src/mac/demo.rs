//! The demo runner on the Mac. Each run gets a WKWebView of its own, made for the run and closed
//! after it, with no way into the app: no Tauri bridge, a data store that keeps nothing (so no
//! app cookie), the made-up origin `https://demo.invalid/` and a content rule list that blocks
//! every loopback address. Everything here runs on the main thread, where WebKit lives, one run
//! at a time (the queue in rpc.rs waits for each).

use std::cell::{Cell, RefCell};
use std::path::Path;
use std::rc::Rc;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, NSObject, ProtocolObject};
use objc2::{AnyThread, DefinedClass, MainThreadMarker, MainThreadOnly, define_class, msg_send};
use objc2_app_kit::{
	NSBackingStoreType, NSBitmapImageFileType, NSBitmapImageRep, NSDeviceRGBColorSpace, NSGraphicsContext, NSImage, NSScreen, NSStatusWindowLevel, NSWindow,
	NSWindowCollectionBehavior, NSWindowStyleMask,
};
use objc2_foundation::{
	NSDictionary, NSError, NSNumber, NSObjectProtocol, NSPoint, NSRect, NSRunLoop, NSRunLoopCommonModes, NSSize, NSString, NSTimer, NSURL,
};
use objc2_web_kit::{
	WKContentRuleList, WKContentRuleListStore, WKContentWorld, WKInactiveSchedulingPolicy, WKNavigation, WKNavigationAction, WKNavigationActionPolicy,
	WKNavigationDelegate, WKNavigationResponse, WKNavigationResponsePolicy, WKSnapshotConfiguration, WKUserScript, WKUserScriptInjectionTime, WKWebView,
	WKWebViewConfiguration, WKWebsiteDataStore,
};
use tauri::{AppHandle, Manager};

use crate::demo::{
	self, ANSWER_LIMIT, BLOCK_LOOPBACK, DEMO_SIZE, DemoDone, DemoJob, LOAD_LIMIT, LOAD_TIMED_OUT, NO_ANSWER, NO_SNAPSHOT, ORIGIN, READ, RECORDER, SETTLE, SvgDone, SvgJob,
};
use crate::paths::Paths;

/// One run: a demo to check or an SVG to draw, and who hears the outcome.
pub enum Work {
	Demo(DemoJob, DemoDone),
	Svg(SvgJob, SvgDone),
}

impl Work {
	fn fail(self, err: String) {
		match self {
			Work::Demo(_, done) => done(Err(err)),
			Work::Svg(_, done) => done(Err(err)),
		}
	}
}

pub fn run(app: &AppHandle, job: DemoJob, done: DemoDone) {
	start(&app.state::<Paths>().demo_data, Work::Demo(job, done));
}

pub fn svg(app: &AppHandle, job: SvgJob, done: SvgDone) {
	start(&app.state::<Paths>().demo_data, Work::Svg(job, done));
}

/// Starts `work` on the main thread; `folder` keeps the compiled loopback rules.
pub fn start(folder: &Path, work: Work) {
	let Some(mtm) = MainThreadMarker::new() else {
		return work.fail("the demo runner must run on the main thread".to_owned());
	};
	compile_rules(mtm, folder, move |rules| match rules {
		Ok(rules) => open(mtm, &rules, work),
		Err(err) => work.fail(err),
	});
}

fn compile_rules(mtm: MainThreadMarker, folder: &Path, then: impl FnOnce(Result<Retained<WKContentRuleList>, String>) + 'static) {
	if let Err(err) = std::fs::create_dir_all(folder) {
		return then(Err(format!("cannot make the demo folder: {err}")));
	}
	let url = NSURL::fileURLWithPath_isDirectory(&NSString::from_str(&folder.to_string_lossy()), true);
	// SAFETY: a file URL of a folder this process made, on the main thread.
	let Some(store) = (unsafe { WKContentRuleListStore::storeWithURL(Some(&url), mtm) }) else {
		return then(Err("WebKit has no rule list store".to_owned()));
	};
	let then = Cell::new(Some(then));
	let compiled = RcBlock::new(move |list: *mut WKContentRuleList, err: *mut NSError| {
		let Some(then) = then.take() else { return };
		// SAFETY: WebKit passes a valid list, or null and a valid error.
		match unsafe { Retained::retain(list) } {
			Some(list) => then(Ok(list)),
			None => then(Err(describe(err))),
		}
	});
	// SAFETY: the rule text is the JSON WebKit's content blockers take; the block lives until
	// WebKit calls it on the main thread.
	unsafe {
		store.compileContentRuleListForIdentifier_encodedContentRuleList_completionHandler(
			Some(&NSString::from_str("loopback")),
			Some(&NSString::from_str(BLOCK_LOOPBACK)),
			Some(&compiled),
		);
	}
}

/// The run in progress.
struct Run {
	id: u64,
	view: Retained<WKWebView>,
	window: Retained<NSWindow>,
	/// WebKit holds its navigation delegate weakly.
	_navigation: Retained<Navigation>,
	/// The pending limit or settle timer.
	timer: RefCell<Option<Retained<NSTimer>>>,
	loading: Cell<bool>,
	/// Errors the page could not record itself (it never loaded, or never answered).
	errors: RefCell<Vec<String>>,
	work: RefCell<Option<Work>>,
}

thread_local! {
	static RUN: RefCell<Option<Rc<Run>>> = const { RefCell::new(None) };
	static LAST_ID: Cell<u64> = const { Cell::new(0) };
}

/// The run `id`, if it is still the one in progress (a callback can outlive its run).
fn current(id: u64) -> Option<Rc<Run>> {
	RUN.with_borrow(|run| run.as_ref().filter(|run| run.id == id).cloned())
}

fn open(mtm: MainThreadMarker, rules: &WKContentRuleList, work: Work) {
	let ((width, height), html) = match &work {
		Work::Demo(job, _) => (DEMO_SIZE, job.html.clone()),
		Work::Svg(job, _) => ((job.width, job.height), demo::svg_page(&job.svg)),
	};
	let id = LAST_ID.get() + 1;
	LAST_ID.set(id);
	let frame = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(f64::from(width), f64::from(height)));
	// SAFETY: a fresh configuration, set up on the main thread before any view uses it.
	let view = unsafe {
		let config = WKWebViewConfiguration::new(mtm);
		config.setWebsiteDataStore(&WKWebsiteDataStore::nonPersistentDataStore(mtm));
		let content = config.userContentController();
		content.addUserScript(&WKUserScript::initWithSource_injectionTime_forMainFrameOnly(
			WKUserScript::alloc(mtm),
			&NSString::from_str(RECORDER),
			WKUserScriptInjectionTime::AtDocumentStart,
			true,
		));
		content.addContentRuleList(rules);
		// Timers and animation frames keep running in a view nobody looks at.
		config.preferences().setInactiveSchedulingPolicy(WKInactiveSchedulingPolicy::None);
		WKWebView::initWithFrame_configuration(WKWebView::alloc(mtm), frame, &config)
	};
	let navigation = Navigation::new(mtm, id);
	// SAFETY: `Run` keeps the delegate alive for as long as the view can call it.
	unsafe { view.setNavigationDelegate(Some(ProtocolObject::from_ref(&*navigation))) };
	let window = invisible_window(mtm, frame, &view);
	let base = NSURL::URLWithString(&NSString::from_str(ORIGIN));
	// SAFETY: a plain HTML string and an https base URL.
	let first = unsafe { view.loadHTMLString_baseURL(&NSString::from_str(&html), base.as_deref()) };
	navigation.ivars().first.replace(first);
	let run = Run {
		id,
		view,
		window,
		_navigation: navigation,
		timer: RefCell::default(),
		loading: Cell::new(true),
		errors: RefCell::default(),
		work: RefCell::new(Some(work)),
	};
	RUN.set(Some(Rc::new(run)));
	arm(id, LOAD_LIMIT.as_secs_f64(), |id| loaded(id, Err(LOAD_TIMED_OUT.to_owned())));
}

/// WebKit stops drawing, and pauses animation frames, in a window that is hidden, off screen
/// or covered. So the view's window stays on screen above the others, fully transparent, never
/// clicked, and out of the Window menu, ⌘` and Mission Control.
fn invisible_window(mtm: MainThreadMarker, frame: NSRect, view: &WKWebView) -> Retained<NSWindow> {
	// SAFETY: a plain borderless window, made on the main thread.
	let window = unsafe {
		NSWindow::initWithContentRect_styleMask_backing_defer(NSWindow::alloc(mtm), frame, NSWindowStyleMask::Borderless, NSBackingStoreType::Buffered, false)
	};
	// SAFETY: the Retained owns the window, so closing it must not release it a second time.
	unsafe { window.setReleasedWhenClosed(false) };
	window.setContentView(Some(view));
	window.setAlphaValue(0.0);
	window.setIgnoresMouseEvents(true);
	window.setExcludedFromWindowsMenu(true);
	window.setLevel(NSStatusWindowLevel);
	window.setCollectionBehavior(
		NSWindowCollectionBehavior::Transient
			| NSWindowCollectionBehavior::IgnoresCycle
			| NSWindowCollectionBehavior::CanJoinAllSpaces
			| NSWindowCollectionBehavior::Stationary
			| NSWindowCollectionBehavior::FullScreenAuxiliary,
	);
	if let Some(screen) = NSScreen::mainScreen(mtm) {
		let screen = screen.frame();
		window.setFrameOrigin(NSPoint::new(screen.origin.x + 60.0, screen.origin.y + 60.0));
	}
	window.orderFrontRegardless();
	window
}

/// Calls `fire(id)` after `seconds` unless the run moves on first. Common modes, so a menu held
/// open or a modal dialog does not hold it back.
fn arm(id: u64, seconds: f64, fire: fn(u64)) {
	let Some(run) = current(id) else { return };
	let block = RcBlock::new(move |_| fire(id));
	// SAFETY: a one-shot timer whose block owns only the run id, added to the main run loop.
	let timer = unsafe {
		let timer = NSTimer::timerWithTimeInterval_repeats_block(seconds, false, &block);
		NSRunLoop::mainRunLoop().addTimer_forMode(&timer, NSRunLoopCommonModes);
		timer
	};
	if let Some(old) = run.timer.replace(Some(timer)) {
		old.invalidate();
	}
}

/// The first load ended, or never will.
fn loaded(id: u64, result: Result<(), String>) {
	let Some(run) = current(id) else { return };
	if !run.loading.replace(false) {
		return;
	}
	let svg = matches!(*run.work.borrow(), Some(Work::Svg(..)));
	match result {
		Ok(()) if svg => snapshot(&run),
		Ok(()) => arm(id, SETTLE.as_secs_f64(), |id| read(id, true)),
		Err(err) if svg => end_svg(id, Err(err)),
		Err(err) => {
			run.errors.borrow_mut().push(err);
			read(id, false);
		}
	}
}

/// Runs the probe (only on a page that loaded) and reads what the page recorded.
fn read(id: u64, loaded: bool) {
	let Some(run) = current(id) else { return };
	let probe = match &*run.work.borrow() {
		Some(Work::Demo(job, _)) if loaded => job.probe.clone(),
		_ => None,
	};
	let args = match &probe {
		Some(probe) => {
			let source: &AnyObject = &NSString::from_str(probe);
			NSDictionary::from_slices(&[&*NSString::from_str("probeSource")], &[source])
		}
		None => NSDictionary::new(),
	};
	let answered = RcBlock::new(move |answer: *mut AnyObject, err: *mut NSError| {
		// SAFETY: WebKit passes the function's value (here always a string) or a valid error.
		let text = unsafe { answer.as_ref() }.and_then(|answer| answer.downcast_ref::<NSString>()).map(NSString::to_string);
		match text {
			Some(text) => end_demo(id, Some(&text)),
			None => {
				if let Some(run) = current(id) {
					run.errors.borrow_mut().push(format!("the page could not be read: {}", describe(err)));
				}
				end_demo(id, None);
			}
		}
	});
	// SAFETY: a function body and string arguments in the page's world of a live view; the
	// block lives until WebKit calls it on the main thread.
	unsafe {
		let world = WKContentWorld::pageWorld(MainThreadMarker::from(&*run.view));
		run.view.callAsyncJavaScript_arguments_inFrame_inContentWorld_completionHandler(&NSString::from_str(READ), Some(&args), None, &world, Some(&answered));
	}
	arm(id, ANSWER_LIMIT.as_secs_f64(), |id| {
		if let Some(run) = current(id) {
			run.errors.borrow_mut().push(NO_ANSWER.to_owned());
		}
		end_demo(id, None);
	});
}

/// Ends the demo run with what the page recorded (`answer`, the JSON from READ).
fn end_demo(id: u64, answer: Option<&str>) {
	let Some(run) = end(id) else { return };
	let result = demo::result(answer, run.errors.take());
	if let Some(Work::Demo(_, done)) = run.work.take() {
		done(Ok(result));
	}
}

/// Draws the loaded SVG page.
fn snapshot(run: &Run) {
	let (id, size) = (run.id, run.view.frame().size);
	let drawn = RcBlock::new(move |image: *mut NSImage, err: *mut NSError| {
		// SAFETY: WebKit passes a valid image, or null and a valid error.
		let png = match unsafe { image.as_ref() } {
			Some(image) => exact_png(image, size),
			None => Err(describe(err)),
		};
		end_svg(id, png);
	});
	// SAFETY: a snapshot of the whole view at its own width in points, on the main thread; the
	// block lives until WebKit calls it.
	unsafe {
		let config = WKSnapshotConfiguration::new(MainThreadMarker::from(&*run.view));
		config.setRect(run.view.bounds());
		config.setSnapshotWidth(Some(&NSNumber::new_f64(size.width)));
		run.view.takeSnapshotWithConfiguration_completionHandler(Some(&config), &drawn);
	}
	arm(id, ANSWER_LIMIT.as_secs_f64(), |id| end_svg(id, Err(NO_SNAPSHOT.to_owned())));
}

/// The image as a PNG of exactly `size` pixels: the snapshot has the screen's scale (2 px a
/// point on a Retina screen), so it is drawn again at one pixel a point.
pub(super) fn exact_png(image: &NSImage, size: NSSize) -> Result<Vec<u8>, String> {
	let (width, height) = (size.width as isize, size.height as isize);
	// SAFETY: no planes, so AppKit allocates an 8-bit RGBA buffer it owns; the color space
	// name is AppKit's own constant.
	let bitmap = unsafe {
		NSBitmapImageRep::initWithBitmapDataPlanes_pixelsWide_pixelsHigh_bitsPerSample_samplesPerPixel_hasAlpha_isPlanar_colorSpaceName_bytesPerRow_bitsPerPixel(
			NSBitmapImageRep::alloc(),
			std::ptr::null_mut(),
			width,
			height,
			8,
			4,
			true,
			false,
			NSDeviceRGBColorSpace,
			0,
			0,
		)
	}
	.ok_or("cannot make a bitmap of that size")?;
	bitmap.setSize(size);
	let context = NSGraphicsContext::graphicsContextWithBitmapImageRep(&bitmap).ok_or("cannot draw into the bitmap")?;
	NSGraphicsContext::saveGraphicsState_class();
	NSGraphicsContext::setCurrentContext(Some(&context));
	image.drawInRect(NSRect::new(NSPoint::new(0.0, 0.0), size));
	context.flushGraphics();
	NSGraphicsContext::restoreGraphicsState_class();
	// SAFETY: PNG with no properties.
	let png = unsafe { bitmap.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new()) }.ok_or("cannot encode the PNG")?;
	Ok(png.to_vec())
}

fn end_svg(id: u64, png: Result<Vec<u8>, String>) {
	let Some(run) = end(id) else { return };
	if let Some(Work::Svg(_, done)) = run.work.take() {
		done(png);
	}
}

/// Stops run `id` and closes its view and window, so nothing outlives the run.
fn end(id: u64) -> Option<Rc<Run>> {
	let run = RUN.with_borrow_mut(|run| run.take_if(|run| run.id == id))?;
	if let Some(timer) = run.timer.take() {
		timer.invalidate();
	}
	// SAFETY: a live view on the main thread.
	unsafe {
		run.view.stopLoading();
		run.view.setNavigationDelegate(None);
	}
	run.view.removeFromSuperview();
	run.window.orderOut(None);
	run.window.close();
	Some(run)
}

pub(super) fn describe(err: *mut NSError) -> String {
	// SAFETY: WebKit's errors are null or valid.
	unsafe { err.as_ref() }.map_or_else(|| "unknown WebKit error".to_owned(), |err| err.localizedDescription().to_string())
}

struct NavigationState {
	run: u64,
	/// The first load, whose end starts the check.
	first: RefCell<Option<Retained<WKNavigation>>>,
	/// Whether the first load was let through; after it, only `about:blank` is.
	started: Cell<bool>,
}

define_class!(
	// SAFETY: NSObject has no subclassing rules, and Navigation adds no Drop.
	#[unsafe(super(NSObject))]
	#[thread_kind = MainThreadOnly]
	#[name = "GodspeedDemoNavigation"]
	#[ivars = NavigationState]
	struct Navigation;

	// SAFETY: NSObjectProtocol has no extra requirements.
	unsafe impl NSObjectProtocol for Navigation {}

	// SAFETY: each method's signature matches the protocol's.
	unsafe impl WKNavigationDelegate for Navigation {
		/// The demo's own load and blank frames go through; any other navigation (a link, a
		/// redirect, `location`) and every download is cancelled.
		#[unsafe(method(webView:decidePolicyForNavigationAction:decisionHandler:))]
		fn decide_action(&self, _view: &WKWebView, action: &WKNavigationAction, decide: &block2::DynBlock<dyn Fn(WKNavigationActionPolicy)>) {
			let first = !self.ivars().started.replace(true);
			// SAFETY: reading a live action WebKit handed over.
			let (download, url) = unsafe { (action.shouldPerformDownload(), action.request().URL().and_then(|url| url.absoluteString())) };
			let blank = url.is_some_and(|url| url.to_string() == "about:blank");
			let allow = !download && (first || blank);
			decide.call((if allow { WKNavigationActionPolicy::Allow } else { WKNavigationActionPolicy::Cancel },));
		}

		#[unsafe(method(webView:decidePolicyForNavigationResponse:decisionHandler:))]
		fn decide_response(&self, _view: &WKWebView, response: &WKNavigationResponse, decide: &block2::DynBlock<dyn Fn(WKNavigationResponsePolicy)>) {
			// SAFETY: reading a live response WebKit handed over.
			let shown = unsafe { response.canShowMIMEType() };
			decide.call((if shown { WKNavigationResponsePolicy::Allow } else { WKNavigationResponsePolicy::Cancel },));
		}

		#[unsafe(method(webView:didFinishNavigation:))]
		fn did_finish(&self, _view: &WKWebView, navigation: Option<&WKNavigation>) {
			if self.is_first(navigation) {
				loaded(self.ivars().run, Ok(()));
			}
		}

		#[unsafe(method(webView:didFailProvisionalNavigation:withError:))]
		fn did_fail_provisional(&self, _view: &WKWebView, navigation: Option<&WKNavigation>, err: &NSError) {
			if self.is_first(navigation) {
				loaded(self.ivars().run, Err(err.localizedDescription().to_string()));
			}
		}

		#[unsafe(method(webView:didFailNavigation:withError:))]
		fn did_fail(&self, _view: &WKWebView, navigation: Option<&WKNavigation>, err: &NSError) {
			if self.is_first(navigation) {
				loaded(self.ivars().run, Err(err.localizedDescription().to_string()));
			}
		}

		#[unsafe(method(webViewWebContentProcessDidTerminate:))]
		fn did_terminate(&self, _view: &WKWebView) {
			loaded(self.ivars().run, Err("the page's web process stopped".to_owned()));
		}
	}
);

impl Navigation {
	fn new(mtm: MainThreadMarker, run: u64) -> Retained<Navigation> {
		let this = Navigation::alloc(mtm).set_ivars(NavigationState { run, first: RefCell::default(), started: Cell::new(false) });
		// SAFETY: NSObject's init on a freshly allocated object.
		unsafe { msg_send![super(this), init] }
	}

	fn is_first(&self, navigation: Option<&WKNavigation>) -> bool {
		let first = self.ivars().first.borrow();
		matches!((first.as_deref(), navigation), (Some(first), Some(navigation)) if std::ptr::eq(first, navigation))
	}
}
