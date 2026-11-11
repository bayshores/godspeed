//! The `path.posix` functions the office reader uses, with Node's results for odd inputs.

/// `path.posix.normalize`: no `.` or empty parts, `..` folds into the part before it.
pub(crate) fn normalize(path: &str) -> String {
	if path.is_empty() {
		return ".".to_owned();
	}
	let absolute = path.starts_with('/');
	let mut parts: Vec<&str> = Vec::new();
	for part in path.split('/') {
		match part {
			"" | "." => {}
			".." if parts.last().is_some_and(|p| *p != "..") => {
				parts.pop();
			}
			".." if !absolute => parts.push(".."),
			".." => {}
			_ => parts.push(part),
		}
	}
	let mut out = parts.join("/");
	if out.is_empty() {
		return if absolute { "/".to_owned() } else if path.ends_with('/') { "./".to_owned() } else { ".".to_owned() };
	}
	if path.ends_with('/') {
		out.push('/');
	}
	if absolute { format!("/{out}") } else { out }
}

/// `path.posix.join`.
pub(crate) fn join(parts: &[&str]) -> String {
	let joined = parts.iter().filter(|p| !p.is_empty()).copied().collect::<Vec<_>>().join("/");
	if joined.is_empty() { ".".to_owned() } else { normalize(&joined) }
}

/// `path.posix.dirname`.
pub(crate) fn dirname(path: &str) -> String {
	if path.is_empty() {
		return ".".to_owned();
	}
	let bytes = path.as_bytes();
	let mut end = None;
	let mut matched_slash = true;
	for i in (1..bytes.len()).rev() {
		if bytes[i] == b'/' {
			if !matched_slash {
				end = Some(i);
				break;
			}
		} else {
			matched_slash = false;
		}
	}
	match end {
		None if bytes[0] == b'/' => "/".to_owned(),
		None => ".".to_owned(),
		Some(1) if bytes[0] == b'/' => "//".to_owned(),
		Some(i) => path[..i].to_owned(),
	}
}

/// `path.posix.basename`.
pub(crate) fn basename(path: &str) -> &str {
	let trimmed = path.trim_end_matches('/');
	trimmed.rsplit('/').next().unwrap_or("")
}

/// `path.extname`: from the last dot of the base name, none for a leading dot or "..".
pub(crate) fn extname(path: &str) -> &str {
	let base = basename(path);
	match base.rfind('.') {
		Some(dot) if dot > 0 && base != ".." => &base[dot..],
		_ => "",
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn matches_node() {
		assert_eq!(join(&["ppt", "../x/./y.xml"]), "x/y.xml");
		assert_eq!(join(&["ppt", "/ppt/slides/slide1.xml"]), "ppt/ppt/slides/slide1.xml");
		assert_eq!(join(&["", ""]), ".");
		assert_eq!(join(&[".", "_rels", "a.rels"]), "_rels/a.rels");
		assert_eq!(normalize("../../a"), "../../a");
		assert_eq!(normalize("a/../.."), "..");
		assert_eq!(normalize("a/"), "a/");
		assert_eq!(normalize("a/.."), ".");
		assert_eq!(normalize("/.."), "/");
		assert_eq!(dirname("ppt/slides/slide1.xml"), "ppt/slides");
		assert_eq!(dirname("a"), ".");
		assert_eq!(dirname("/a"), "/");
		assert_eq!(dirname("//a"), "//");
		assert_eq!(dirname("a/b/"), "a");
		assert_eq!(basename("ppt/slides/slide1.xml"), "slide1.xml");
		assert_eq!(basename("a/b//"), "b");
		assert_eq!(extname("/x/Deck.PPTX"), ".PPTX");
		assert_eq!(extname("/x/.pptx"), "");
		assert_eq!(extname("/x/a.."), ".");
		assert_eq!(extname("/x/.."), "");
	}
}
