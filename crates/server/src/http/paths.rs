//! How Next reads a request path before any route sees it, so odd paths get the same answers:
//! backslashes, `//` and a trailing slash redirect (308), `.`/`..` segments (also as `%2e`) are
//! resolved like a URL parser does, and a segment that is not valid percent-encoded UTF-8 is a 500.

/// What to do with a request target (`/path?query`).
#[derive(Debug, PartialEq)]
pub enum Target {
	/// Redirect here (path and query).
	Redirect(String),
	/// Route this path (still percent-encoded, dot segments resolved) with this query (`?…` or "").
	Route { path: String, query: String },
}

pub fn normalize(target: &str) -> Target {
	let (path, query) = target.find('?').map_or((target, ""), |i| target.split_at(i));
	let messy = path.contains('\\') || path.contains("//");
	let mut clean = if messy { collapse_slashes(&path.replace('\\', "/")) } else { path.to_string() };
	clean = resolve_dots(&clean);
	// Next cleans slashes first and redirects; a trailing slash left over goes on the next request.
	let trailing = !messy && clean.len() > 1 && clean.ends_with('/');
	if trailing {
		clean = clean.trim_end_matches('/').to_string();
		if clean.is_empty() {
			clean.push('/');
		}
	}
	if messy || trailing {
		return Target::Redirect(format!("{clean}{query}"));
	}
	Target::Route { path: clean, query: query.to_string() }
}

fn collapse_slashes(path: &str) -> String {
	let mut out = String::with_capacity(path.len());
	for c in path.chars() {
		if !(c == '/' && out.ends_with('/')) {
			out.push(c);
		}
	}
	out
}

fn is_dot(seg: &str) -> bool {
	seg == "." || seg.eq_ignore_ascii_case("%2e")
}

fn is_dot_dot(seg: &str) -> bool {
	matches!(seg.to_ascii_lowercase().as_str(), ".." | ".%2e" | "%2e." | "%2e%2e")
}

/// The URL standard's path parsing: `.` is dropped, `..` drops the segment before it, and a path
/// ending in either keeps its trailing slash.
fn resolve_dots(path: &str) -> String {
	let mut out: Vec<&str> = Vec::new();
	let segs: Vec<&str> = path.strip_prefix('/').unwrap_or(path).split('/').collect();
	for (i, seg) in segs.iter().enumerate() {
		let last = i + 1 == segs.len();
		if is_dot_dot(seg) {
			out.pop();
			if last {
				out.push("");
			}
		} else if is_dot(seg) {
			if last {
				out.push("");
			}
		} else {
			out.push(seg);
		}
	}
	format!("/{}", out.join("/"))
}

/// `decodeURIComponent`: None where it would throw (a bad `%` escape or bytes that are not UTF-8).
pub fn decode_component(s: &str) -> Option<String> {
	let bytes = s.as_bytes();
	let mut out = Vec::with_capacity(bytes.len());
	let mut i = 0;
	while i < bytes.len() {
		if bytes[i] == b'%' {
			let hex = s.get(i + 1..i + 3)?;
			out.push(u8::from_str_radix(hex, 16).ok()?);
			i += 3;
		} else {
			out.push(bytes[i]);
			i += 1;
		}
	}
	String::from_utf8(out).ok()
}

/// The path's segments decoded, as Next hands them to a catch-all route; None when one fails.
pub fn decoded_segments(path: &str) -> Option<Vec<String>> {
	path.split('/').filter(|s| !s.is_empty()).map(decode_component).collect()
}

/// `URLSearchParams`: `+` is a space and bad escapes or bytes become U+FFFD instead of failing.
pub fn search_params(query: &str) -> Vec<(String, String)> {
	let decode = |s: &str| {
		let s = s.replace('+', " ");
		let bytes = s.as_bytes();
		let mut out = Vec::with_capacity(bytes.len());
		let mut i = 0;
		while i < bytes.len() {
			match (bytes[i], s.get(i + 1..i + 3).and_then(|h| u8::from_str_radix(h, 16).ok())) {
				(b'%', Some(b)) => {
					out.push(b);
					i += 3;
				}
				(b, _) => {
					out.push(b);
					i += 1;
				}
			}
		}
		String::from_utf8_lossy(&out).into_owned()
	};
	query
		.trim_start_matches('?')
		.split('&')
		.filter(|pair| !pair.is_empty())
		.map(|pair| {
			let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
			(decode(k), decode(v))
		})
		.collect()
}

/// `URLSearchParams.get`: the first value for `key`.
pub fn param<'a>(params: &'a [(String, String)], key: &str) -> Option<&'a str> {
	params.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str())
}

#[cfg(test)]
mod tests {
	use super::*;

	fn route(p: &str) -> Target {
		Target::Route { path: p.into(), query: String::new() }
	}

	#[test]
	fn redirects_and_dots_match_the_recordings() {
		assert_eq!(normalize("/graph/"), Target::Redirect("/graph".into()));
		assert_eq!(normalize("//graph"), Target::Redirect("/graph".into()));
		assert_eq!(normalize("/api/mcp//"), Target::Redirect("/api/mcp/".into()));
		assert_eq!(normalize("/api/"), Target::Redirect("/api".into()));
		assert_eq!(normalize("/graph/?x=1"), Target::Redirect("/graph?x=1".into()));
		assert_eq!(normalize("/assets\\..\\..\\server.js"), Target::Redirect("/server.js".into()));
		assert_eq!(normalize("/"), route("/"));
		assert_eq!(normalize("/assets/../index.html"), route("/index.html"));
		assert_eq!(normalize("/assets/../../package.json"), route("/package.json"));
		assert_eq!(normalize("/%2e%2e/server.js"), route("/server.js"));
		assert_eq!(normalize("/..%2fserver.js"), route("/..%2fserver.js"));
		assert_eq!(normalize("/?x=1"), Target::Route { path: "/".into(), query: "?x=1".into() });
	}

	#[test]
	fn decoding_like_decode_uri_component() {
		assert_eq!(decode_component("chat%2Fchat_talk").as_deref(), Some("chat/chat_talk"));
		assert_eq!(decode_component("%E0%A4%A"), None);
		assert_eq!(decode_component("%ED%A0%80"), None);
		assert_eq!(decode_component("%252e").as_deref(), Some("%2e"));
		assert_eq!(decoded_segments("/a/%41/"), Some(vec!["a".into(), "A".into()]));
		let params = search_params("?a=1+2&b=%ZZ&a=3&c");
		assert_eq!(param(&params, "a"), Some("1 2"));
		assert_eq!(param(&params, "b"), Some("%ZZ"));
		assert_eq!(param(&params, "c"), Some(""));
	}
}
