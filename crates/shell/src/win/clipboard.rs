//! The clipboard's text, for Paste in an agent's terminal.

use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;

use windows::Win32::Foundation::HGLOBAL;
use windows::Win32::System::DataExchange::{CloseClipboard, GetClipboardData, OpenClipboard};
use windows::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};

/// Text as UTF-16 (`CF_UNICODETEXT`).
const UNICODE_TEXT: u32 = 13;

pub fn text() -> Option<String> {
	// SAFETY: the clipboard is opened and closed here; its data is read only while locked, and
	// never past the size the system gives.
	unsafe {
		OpenClipboard(None).ok()?;
		let text = GetClipboardData(UNICODE_TEXT).ok().and_then(|data| {
			let memory = HGLOBAL(data.0);
			let units = GlobalLock(memory).cast::<u16>();
			if units.is_null() {
				return None;
			}
			let all = std::slice::from_raw_parts(units, GlobalSize(memory) / 2);
			let length = all.iter().position(|&unit| unit == 0).unwrap_or(all.len());
			let text = OsString::from_wide(&all[..length]).to_string_lossy().into_owned();
			let _ = GlobalUnlock(memory);
			Some(text)
		});
		let _ = CloseClipboard();
		text
	}
}
