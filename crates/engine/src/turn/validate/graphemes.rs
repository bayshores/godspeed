//! TypeBox's string length rule (guard/string.mjs): `minLength` and `maxLength` count rough
//! grapheme clusters, with a fast path on UTF-16 length that skips the count in plain text.

fn code_point_at(units: &[u16], i: usize) -> u32 {
	let unit = u32::from(units[i]);
	if (0xD800..=0xDBFF).contains(&unit) && i + 1 < units.len() && (0xDC00..=0xDFFF).contains(&units[i + 1]) {
		return 0x10000 + ((unit - 0xD800) << 10) + (u32::from(units[i + 1]) - 0xDC00);
	}
	unit
}

fn width(point: u32) -> usize {
	if point > 0xFFFF { 2 } else { 1 }
}

fn is_combining_mark(p: u32) -> bool {
	(0x0300..=0x036F).contains(&p) || (0x1AB0..=0x1AFF).contains(&p) || (0x1DC0..=0x1DFF).contains(&p) || (0xFE20..=0xFE2F).contains(&p)
}

fn is_variation_selector(p: u32) -> bool {
	(0xFE00..=0xFE0F).contains(&p)
}

fn is_regional_indicator(p: u32) -> bool {
	(0x1F1E6..=0x1F1FF).contains(&p)
}

const ZWJ: u32 = 0x200D;

fn consume_modifiers(units: &[u16], mut i: usize) -> usize {
	while i < units.len() {
		let p = code_point_at(units, i);
		if !(is_combining_mark(p) || is_variation_selector(p)) {
			break;
		}
		i += width(p);
	}
	i
}

fn next_cluster(units: &[u16], start: usize) -> usize {
	let first = code_point_at(units, start);
	let mut end = consume_modifiers(units, start + width(first));
	while end + 1 < units.len() && code_point_at(units, end) == ZWJ {
		end += 1 + width(code_point_at(units, end + 1));
		end = consume_modifiers(units, end);
	}
	if is_regional_indicator(first) && end < units.len() && is_regional_indicator(code_point_at(units, end)) {
		end += width(code_point_at(units, end));
	}
	end
}

fn is_grapheme_unit(unit: u16) -> bool {
	let p = u32::from(unit);
	p >= 0x0300 && ((0xD800..=0xDBFF).contains(&p) || is_combining_mark(p) || is_variation_selector(p) || p == ZWJ)
}

/// Counts clusters up to `stop` (or the end), returning how many it saw.
fn clusters_up_to(units: &[u16], stop: usize) -> usize {
	let (mut count, mut i) = (0, 0);
	while i < units.len() {
		i = next_cluster(units, i);
		count += 1;
		if count >= stop {
			break;
		}
	}
	count
}

pub fn is_min_length(units: &[u16], min: usize) -> bool {
	if min == 0 {
		return true;
	}
	if units.len() < min {
		return false;
	}
	let mut i = 0;
	loop {
		if is_grapheme_unit(units[i]) {
			return clusters_up_to(units, min) >= min;
		}
		i += 1;
		if i >= min {
			return true;
		}
	}
}

pub fn is_max_length(units: &[u16], max: usize) -> bool {
	if units.len() <= max {
		return true;
	}
	let mut i = 0;
	loop {
		if is_grapheme_unit(units[i]) {
			return clusters_up_to(units, max + 1) <= max;
		}
		i += 1;
		if i > max {
			return false;
		}
	}
}
