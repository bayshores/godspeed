//! The file name a lesson downloads as, from its title.

/// The download's file name from the title: lower case, NFKD, every run of other characters one
/// dash, no dash at the ends; "session" when nothing is left.
pub fn slugify(title: &str) -> String {
	let mut decomposed = String::new();
	for c in title.to_lowercase().chars() {
		match nfkd_alnum(c) {
			Some(parts) => decomposed.push_str(parts),
			None => decomposed.push(c),
		}
	}
	let mut slug = String::new();
	for c in decomposed.chars() {
		if c.is_ascii_lowercase() || c.is_ascii_digit() {
			slug.push(c);
		} else if !slug.ends_with('-') {
			slug.push('-');
		}
	}
	let slug = slug.trim_matches('-');
	if slug.is_empty() { "session".to_owned() } else { slug.to_owned() }
}

/// The letters and digits a character's NFKD form holds, with `-` for the rest (a combining
/// accent), for the Latin, super- and subscript, ligature and fullwidth blocks; None for any
/// other character, which counts as a separator either way. Generated from Unicode 15.1.
fn nfkd_alnum(c: char) -> Option<&'static str> {
	const LATIN: &str = "          a        2 3      1 o  1-4 1-2 3-4                                  a- a- a- a- a- a-  c- e- e- e- e- i- i- i- i-  n- o- o- o- o- o-   u- u- u- u- y-  y-  a-  a-  a-  c-  c-  c-  c-  d-    e-  e-  e-  e-  e-  g-  g-  g-  g-  h-    i-  i-  i-  i-    ij  j-  k-   l-  l-  l-  l-    n-  n-  n- -n    o-  o-  o-    r-  r-  r-  s-  s-  s-  s-  t-  t-    u-  u-  u-  u-  u-  u-  w-  y-   z-  z-  z- s                                  o-               u-                     -z- dz-  -j lj  -j nj  a-  i-  o-  u-  u-  u-  u-  u-   a-  a-      g-  k-  o-  o-   j-  -z dz  g-    n-  a-      a-  a-  e-  e-  i-  i-  o-  o-  r-  r-  u-  u-  s-  t-    h-        a-  e-  o-  o-  o-  o-  y-                            ";
	const LATIN_MORE: &str = " a-  b-  b-  b-  c-  d-  d-  d-  d-  d-  e-  e-  e-  e-  e-  f-  g-  h-  h-  h-  h-  h-  i-  i-  k-  k-  k-  l-  l-  l-  l-  m-  m-  m-  n-  n-  n-  n-  o-  o-  o-  o-  p-  p-  r-  r-  r-  r-  s-  s-  s-  s-  s-  t-  t-  t-  t-  u-  u-  u-  u-  u-  v-  v-  w-  w-  w-  w-  w-  x-  x-  y-  z-  z-  z- h- t- w- y- a- s-      a-  a-  a-  a-  a-  a-  a-  a-  a-  a-  a-  a-  e-  e-  e-  e-  e-  e-  e-  e-  i-  i-  o-  o-  o-  o-  o-  o-  o-  o-  o-  o-  o-  o-  u-  u-  u-  u-  u-  u-  u-  y-  y-  y-  y-      ";
	const SCRIPTS: &str = "0 i   4 5 6 7 8 9      n 0 1 2 3 4 5 6 7 8 9       a e o x  h k l m n p s t   ";
	const LIGATURES: &str = "ff fi fl ffi ffl st st";
	const FULLWIDTH: &str = "0123456789abcdefghijklmnopqrstuvwxyz";
	let cp = c as u32;
	let from = |table: &'static str, first: u32| table.split(' ').nth((cp - first) as usize).filter(|t| !t.is_empty());
	match cp {
		0xA0..=0x24F => from(LATIN, 0xA0),
		0x1E00..=0x1EFF => from(LATIN_MORE, 0x1E00),
		0x2070..=0x209F => from(SCRIPTS, 0x2070),
		0xFB00..=0xFB06 => from(LIGATURES, 0xFB00),
		0xFF10..=0xFF19 => Some(&FULLWIDTH[(cp - 0xFF10) as usize..][..1]),
		0xFF41..=0xFF5A => Some(&FULLWIDTH[(cp - 0xFF41 + 10) as usize..][..1]),
		_ => None,
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn file_names_follow_the_typescript_slug() {
		assert_eq!(slugify("Café -- Naïve  Bayes: 100% (really)!"), "cafe-nai-ve-bayes-100-really");
		assert_eq!(slugify("日本語 🎓"), "session");
		assert_eq!(slugify("Work on HW5"), "work-on-hw5");
		assert_eq!(slugify("ﬁx Ａ½ x²"), "fix-a1-2-x2");
		assert_eq!(slugify("Tiếng Việt"), "tie-ng-vie-t");
	}
}
