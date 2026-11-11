//! `new RegExp(pattern, flags)` for a pattern from a model (grep, PDF search): a pattern that does
//! not compile is refused with V8's message for the mistakes made most. The engine behind `Re`
//! words them differently; anything not listed keeps the engine's own text.

use crate::re::Re;

pub fn new_regexp(pattern: &str, flags: &str) -> Result<Re, String> {
	Re::try_new(pattern, flags).map_err(|reason| format!("Invalid regular expression: /{pattern}/{flags}: {}", v8_reason(pattern, &reason)))
}

fn v8_reason(pattern: &str, reason: &str) -> String {
	match reason {
		"Unbalanced parenthesis" if has_stray_close(pattern) => "Unmatched ')'".to_owned(),
		"Unbalanced parenthesis" => "Unterminated group".to_owned(),
		"Unbalanced bracket" => "Unterminated character class".to_owned(),
		"Invalid atom character" | "Quantifier not allowed here" | "Invalid braced quantifier" => "Nothing to repeat".to_owned(),
		"Invalid quantifier" => "numbers out of order in {} quantifier".to_owned(),
		"Incomplete escape" | "Unterminated escape" => "\\ at end of pattern".to_owned(),
		"Invalid token at named capture group identifier" => "Invalid capture group name".to_owned(),
		"Range values reversed, start char code is greater than end char code." => "Range out of order in character class".to_owned(),
		"Invalid group modifier" => "Invalid group".to_owned(),
		other if other.starts_with("Backreference to invalid named capture group") => "Invalid named capture referenced".to_owned(),
		other => other.to_owned(),
	}
}

/// True when a `)` has no `(` before it, outside classes and escapes.
fn has_stray_close(pattern: &str) -> bool {
	let (mut depth, mut in_class, mut chars) = (0usize, false, pattern.chars());
	while let Some(c) = chars.next() {
		match c {
			'\\' => {
				chars.next();
			}
			']' => in_class = false,
			_ if in_class => {}
			'[' => in_class = true,
			'(' => depth += 1,
			')' if depth == 0 => return true,
			')' => depth -= 1,
			_ => {}
		}
	}
	false
}

#[cfg(test)]
mod tests {
	use super::*;

	fn reason(pattern: &str) -> String {
		new_regexp(pattern, "i").err().unwrap().rsplit_once(": ").unwrap().1.to_owned()
	}

	#[test]
	fn common_mistakes_read_like_v8() {
		assert_eq!(new_regexp("(abc", "i").err().unwrap(), "Invalid regular expression: /(abc/i: Unterminated group");
		assert_eq!(reason("abc)"), "Unmatched ')'");
		assert_eq!(reason("[abc"), "Unterminated character class");
		assert_eq!(reason("*a"), "Nothing to repeat");
		assert_eq!(reason("{2}"), "Nothing to repeat");
		assert_eq!(reason("a\\"), "\\ at end of pattern");
		assert_eq!(reason("a{2,1}"), "numbers out of order in {} quantifier");
		assert_eq!(reason("[z-a]"), "Range out of order in character class");
		assert_eq!(reason("(?i)a"), "Invalid group");
		assert_eq!(reason("(?<n>a)\\k<m>"), "Invalid named capture referenced");
	}

	#[test]
	fn flags_show_in_the_message() {
		assert_eq!(new_regexp("(", "").err().unwrap(), "Invalid regular expression: /(/: Unterminated group");
	}

	#[test]
	fn stray_close_ignores_classes_and_escapes() {
		assert!(!has_stray_close("(a)[)]\\)"));
		assert!(has_stray_close("a)(b"));
	}

	#[test]
	fn good_patterns_compile() {
		assert!(new_regexp("a+b", "").unwrap().test("xaab"));
	}
}
