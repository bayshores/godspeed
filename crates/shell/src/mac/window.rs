//! Window behavior AppKit and WebKit settle: none changed yet.

/// What a double-click on the title bar does (System Settings, Desktop & Dock).
#[expect(dead_code, reason = "the title bar command reads it")]
pub enum DoubleClick {
	Zoom,
	Minimize,
	Nothing,
}

/// WebKit's typing defaults, set before the first web view.
pub fn register_text_defaults() {}

/// The file paths on the drag pasteboard.
#[expect(dead_code, reason = "the drag command calls it")]
pub fn drag_paths() -> Vec<String> {
	Vec::new()
}

#[expect(dead_code, reason = "the title bar command calls it")]
pub fn double_click_action() -> DoubleClick {
	DoubleClick::Zoom
}
