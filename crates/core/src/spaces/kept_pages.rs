//! Kept pages: PDF pages the PDF reader wrote out once as Markdown with LaTeX. In a PDF's
//! page-headed text (`--- Page N ---`, then the page's text) a kept page stands in for the text
//! pdfium read from it.

use std::collections::BTreeMap;

/// The number of a `--- Page N ---` head line.
fn page_head(line: &str) -> Option<u32> {
	let digits = line.strip_prefix("--- Page ")?.strip_suffix(" ---")?;
	if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
		return None;
	}
	digits.parse().ok()
}

/// `text` with each kept page's text in place of what follows its head.
pub fn with_kept_pages(text: &str, kept: &BTreeMap<u32, String>) -> String {
	if kept.is_empty() {
		return text.to_owned();
	}
	let mut out: Vec<&str> = Vec::new();
	let mut replaced = false;
	for line in text.split('\n') {
		if let Some(page) = page_head(line) {
			out.push(line);
			replaced = kept.get(&page).inspect(|markdown| out.push(markdown)).is_some();
		} else if !replaced {
			out.push(line);
		}
	}
	out.join("\n")
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn a_kept_page_replaces_only_its_own_text() {
		let text = "--- Page 1 ---\nOne\n--- Page 2 ---\nTwo a\nTwo b\n--- Page 3 ---\nThree";
		let kept = BTreeMap::from([(2, "$$x^2$$\nKept".to_owned()), (9, "not in the text".to_owned())]);
		assert_eq!(with_kept_pages(text, &kept), "--- Page 1 ---\nOne\n--- Page 2 ---\n$$x^2$$\nKept\n--- Page 3 ---\nThree");
		assert_eq!(with_kept_pages(text, &BTreeMap::new()), text);
		assert_eq!(with_kept_pages("--- Page x ---\nA\n--- Page 2 --- \nB", &kept), "--- Page x ---\nA\n--- Page 2 --- \nB");
	}
}
