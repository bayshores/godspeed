//! Glob matching for find and grep, with fd's rules: a pattern without a slash matches the
//! file's name at any depth; one with a slash matches the path from the search folder.

use gs_base::re::{self, Re};

/// Expands the first `{a,b}` and then what is left: `*.{ts,tsx}` gives `*.ts`, `*.tsx`.
fn expand_braces(pattern: &str) -> Vec<String> {
	let Some(open) = pattern.find('{') else { return vec![pattern.to_owned()] };
	let Some(close) = pattern[open..].find('}').map(|i| open + i) else { return vec![pattern.to_owned()] };
	let (before, after) = (&pattern[..open], &pattern[close + 1..]);
	pattern[open + 1..close].split(',').flat_map(|alt| expand_braces(&format!("{before}{alt}{after}"))).collect()
}

/// A glob as an anchored regex: `*` stays within a segment, `**` crosses `/` (and eats the `/`
/// after it), `?` is one unit, everything else is literal.
fn glob_to_regex(glob: &str) -> Re {
	let chars: Vec<char> = glob.chars().collect();
	let mut pattern = String::new();
	let mut i = 0;
	while i < chars.len() {
		match chars[i] {
			'*' if chars.get(i + 1) == Some(&'*') => {
				pattern.push_str("[\\s\\S]*");
				i += 1;
				if chars.get(i + 1) == Some(&'/') {
					i += 1;
				}
			}
			'*' => pattern.push_str("[^/]*"),
			'?' => pattern.push_str("[^/]"),
			c => pattern.push_str(&re::escape(&c.to_string())),
		}
		i += 1;
	}
	Re::new(&format!("^{pattern}$"), "")
}

enum Alternative {
	/// A pattern without a slash, tested against the file's name.
	Name(Re),
	/// A pattern with a slash, tested against the path from the search folder.
	Path(Re),
}

pub struct GlobMatcher(Vec<Alternative>);

impl GlobMatcher {
	pub fn new(pattern: &str) -> GlobMatcher {
		GlobMatcher(
			expand_braces(pattern)
				.into_iter()
				.map(|alt| {
					if !alt.contains('/') {
						return Alternative::Name(glob_to_regex(&alt));
					}
					let anchored = alt.starts_with('/') || alt.starts_with("**/") || alt == "**";
					let effective = if anchored { alt } else { format!("**/{alt}") };
					Alternative::Path(glob_to_regex(effective.strip_prefix('/').unwrap_or(&effective)))
				})
				.collect(),
		)
	}

	/// `relative` is the path from the search folder, with `/` separators.
	pub fn matches(&self, relative: &str) -> bool {
		let name = relative.rsplit('/').next().unwrap_or(relative);
		self.0.iter().any(|alt| match alt {
			Alternative::Name(re) => re.test(name),
			Alternative::Path(re) => re.test(relative),
		})
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn hit(pattern: &str, path: &str) -> bool {
		GlobMatcher::new(pattern).matches(path)
	}

	#[test]
	fn braces_expand_and_nest() {
		assert_eq!(expand_braces("*.{ts,tsx}"), ["*.ts", "*.tsx"]);
		assert_eq!(expand_braces("a{b,c}d{e,f}"), ["abde", "abdf", "acde", "acdf"]);
		assert_eq!(expand_braces("a{b"), ["a{b"]);
		assert_eq!(expand_braces("plain"), ["plain"]);
	}

	#[test]
	fn names_match_at_any_depth() {
		assert!(hit("*.txt", "a.txt"));
		assert!(hit("*.txt", "deep/er/a.txt"));
		assert!(!hit("*.txt", "a.txt.bak"));
		assert!(hit("?.txt", "sub/a.txt"));
		assert!(!hit("?.txt", "ab.txt"));
		assert!(hit("*.{md,ts}", "x/y.md"));
	}

	#[test]
	fn paths_get_an_implied_deep_prefix() {
		assert!(hit("deep/*.ts", "sub/deep/x.ts"));
		assert!(!hit("deep/*.ts", "sub/deep/deeper/x.ts"));
		assert!(hit("sub/deep/**", "sub/deep/deeper/z.ts"));
		assert!(hit("/sub/c.md", "sub/c.md"));
		assert!(!hit("/sub/c.md", "x/sub/c.md"));
		assert!(hit("**", "any/thing"));
		assert!(hit("**/*.ts", "a/b.ts"));
		assert!(hit("**/*.ts", "b.ts"));
	}

	#[test]
	fn a_question_mark_is_one_utf16_unit() {
		assert!(!hit("?", "\u{1f600}"));
		assert!(hit("??", "\u{1f600}"));
	}
}
