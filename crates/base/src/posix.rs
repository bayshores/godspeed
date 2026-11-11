//! The `path.posix` functions, with Node's results for odd inputs (`join` normalizes, `basename`
//! ignores trailing slashes, `extname` skips dot files).

/// `path.posix.normalize`: no `.`, `..` or doubled slashes; a trailing slash stays.
pub fn normalize(path: &str) -> String {
	if path.is_empty() {
		return ".".to_owned();
	}
	let absolute = path.starts_with('/');
	let mut parts: Vec<&str> = Vec::new();
	for part in path.split('/') {
		match part {
			"" | "." => {}
			".." if parts.last().is_some_and(|last| *last != "..") => {
				parts.pop();
			}
			".." if !absolute => parts.push(".."),
			".." => {}
			other => parts.push(other),
		}
	}
	let mut out = parts.join("/");
	if out.is_empty() {
		return if absolute {
			"/".to_owned()
		} else if path.ends_with('/') {
			"./".to_owned()
		} else {
			".".to_owned()
		};
	}
	if path.ends_with('/') {
		out.push('/');
	}
	if absolute { format!("/{out}") } else { out }
}

/// `path.posix.join`: empty parts are skipped.
pub fn join(parts: &[&str]) -> String {
	let joined = parts.iter().filter(|p| !p.is_empty()).copied().collect::<Vec<_>>().join("/");
	if joined.is_empty() { ".".to_owned() } else { normalize(&joined) }
}

/// `path.posix.dirname`.
pub fn dirname(path: &str) -> String {
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
pub fn basename(path: &str) -> &str {
	path.trim_end_matches('/').rsplit('/').next().unwrap_or("")
}

/// `path.posix.extname`: from the last dot of the basename, "" when that dot starts the name or
/// the name is `..`.
pub fn extname(path: &str) -> &str {
	let base = basename(path);
	match base.rfind('.') {
		None | Some(0) => "",
		Some(1) if base == ".." => "",
		Some(dot) => &base[dot..],
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn normalize_like_node() {
		assert_eq!(normalize("/a/b/../c//d/"), "/a/c/d/");
		assert_eq!(normalize("/../a"), "/a");
		assert_eq!(normalize("a/../.."), "..");
		assert_eq!(normalize("../../a"), "../../a");
		assert_eq!(normalize("a/.."), ".");
		assert_eq!(normalize("/.."), "/");
		assert_eq!(normalize(""), ".");
		assert_eq!(normalize("./"), "./");
		assert_eq!(normalize("/"), "/");
		assert_eq!(normalize("a//"), "a/");
	}

	#[test]
	fn join_skips_empty_parts() {
		assert_eq!(join(&["/home/x", ""]), "/home/x");
		assert_eq!(join(&["/home/x", "/"]), "/home/x/");
		assert_eq!(join(&["/home/x", "a/../b"]), "/home/x/b");
		assert_eq!(join(&["", ""]), ".");
		assert_eq!(join(&["ppt", "../x/./y.xml"]), "x/y.xml");
		assert_eq!(join(&["ppt", "/ppt/slides/slide1.xml"]), "ppt/ppt/slides/slide1.xml");
		assert_eq!(join(&[".", "_rels", "a.rels"]), "_rels/a.rels");
	}

	#[test]
	fn dirname_like_node() {
		assert_eq!(dirname("ppt/slides/slide1.xml"), "ppt/slides");
		assert_eq!(dirname("a"), ".");
		assert_eq!(dirname("/a"), "/");
		assert_eq!(dirname("//a"), "//");
		assert_eq!(dirname("a/b/"), "a");
	}

	#[test]
	fn names_and_extensions() {
		assert_eq!(basename("/a/b.txt"), "b.txt");
		assert_eq!(basename("/a/b/"), "b");
		assert_eq!(basename("a/b//"), "b");
		assert_eq!(basename("/"), "");
		assert_eq!(extname("/a/b.TXT"), ".TXT");
		assert_eq!(extname("/a/b.txt/"), ".txt");
		assert_eq!(extname("/a/.bashrc"), "");
		assert_eq!(extname("/a/b."), ".");
		assert_eq!(extname("/a/.."), "");
		assert_eq!(extname("/a/a.."), ".");
		assert_eq!(extname("/a/..."), ".");
		assert_eq!(extname("/a/a.b.c"), ".c");
		assert_eq!(extname("/a/noext"), "");
	}
}
