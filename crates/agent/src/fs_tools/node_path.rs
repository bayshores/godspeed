//! The posix `path` functions the tools use, with Node's results (`path.join` normalizes,
//! `path.basename` ignores trailing slashes, `path.extname` skips dot files).

/// `path.normalize`: no `.`, `..` or doubled slashes; a trailing slash stays.
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

/// `path.join(base, rest)`: an empty part is skipped.
pub fn join(base: &str, rest: &str) -> String {
	match (base.is_empty(), rest.is_empty()) {
		(true, true) => ".".to_owned(),
		(true, false) => normalize(rest),
		(false, true) => normalize(base),
		(false, false) => normalize(&format!("{base}/{rest}")),
	}
}

/// `path.resolve(base, rest)` for an absolute `base`: `rest` wins when it is absolute, and the
/// result never ends in a slash (except the root).
pub fn resolve(base: &str, rest: &str) -> String {
	let joined = if rest.starts_with('/') { normalize(rest) } else { join(base, rest) };
	match joined.trim_end_matches('/') {
		"" => "/".to_owned(),
		trimmed => trimmed.to_owned(),
	}
}

/// `path.basename`.
pub fn basename(path: &str) -> &str {
	path.trim_end_matches('/').rsplit('/').next().unwrap_or("")
}

/// `path.extname`: from the last dot of the basename, "" when that dot starts the name or the
/// name is `..`.
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
		assert_eq!(normalize(""), ".");
		assert_eq!(normalize("./"), "./");
		assert_eq!(normalize("/"), "/");
		assert_eq!(normalize("a//"), "a/");
	}

	#[test]
	fn join_skips_empty_parts() {
		assert_eq!(join("/home/x", ""), "/home/x");
		assert_eq!(join("/home/x", "/"), "/home/x/");
		assert_eq!(join("/home/x", "a/../b"), "/home/x/b");
		assert_eq!(join("", ""), ".");
	}

	#[test]
	fn resolve_like_node() {
		assert_eq!(resolve("/a/b", "c.pdf"), "/a/b/c.pdf");
		assert_eq!(resolve("/a/b", "../c"), "/a/c");
		assert_eq!(resolve("/a/b", "/x/y/"), "/x/y");
		assert_eq!(resolve("/a/b/", ""), "/a/b");
		assert_eq!(resolve("/a/b", "../../.."), "/");
	}

	#[test]
	fn names_and_extensions() {
		assert_eq!(basename("/a/b.txt"), "b.txt");
		assert_eq!(basename("/a/b/"), "b");
		assert_eq!(basename("/"), "");
		assert_eq!(extname("/a/b.TXT"), ".TXT");
		assert_eq!(extname("/a/b.txt/"), ".txt");
		assert_eq!(extname("/a/.bashrc"), "");
		assert_eq!(extname("/a/b."), ".");
		assert_eq!(extname("/a/.."), "");
		assert_eq!(extname("/a/a.b.c"), ".c");
		assert_eq!(extname("/a/noext"), "");
	}
}
