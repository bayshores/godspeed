//! The clipboard's text, for Paste in an agent's terminal. GTK's clipboard lives on the main thread.

pub fn text() -> Option<String> {
	gtk::Clipboard::get(&gtk::gdk::SELECTION_CLIPBOARD).wait_for_text().map(|text| text.to_string())
}
