//! A printed problem cut out of a file's pages, as the server stores and sends it: which file,
//! the part of each page it lies on, where its labelled parts start, and where it starts on a page
//! shown whole. One check keeps only these fields and writes every number the same way.

use gs_json::{Json, Obj};

/// The most pages a piece runs over.
const MAX_PARTS: usize = 4;
/// The most labelled parts a problem has (a to z).
const MAX_LABELS: usize = 26;
/// The most characters in a part's label.
const MAX_LABEL_CHARS: usize = 4;

fn round4(n: f64) -> f64 {
	(n * 1e4).round() / 1e4
}

/// A fraction of a page: finite, from 0 to 1.
fn fraction(value: &Json, what: &str) -> Result<f64, String> {
	value.as_f64().filter(|n| (0.0..=1.0).contains(n)).map(round4).ok_or_else(|| format!("{what} must be a number from 0 to 1"))
}

fn page_number(value: &Json, what: &str) -> Result<f64, String> {
	value.as_f64().filter(|n| n.fract() == 0.0 && *n >= 1.0 && *n <= f64::from(u32::MAX)).ok_or_else(|| format!("{what} must be a whole number from 1"))
}

fn part(part: &Json) -> Result<Json, String> {
	let sides = part["crop"].as_arr().filter(|crop| crop.len() == 4).ok_or("a part's crop must be four numbers: left, top, right, bottom")?;
	let [left, top, right, bottom] = [0, 1, 2, 3].map(|i| fraction(&sides[i], "a part's crop"));
	let (left, top, right, bottom) = (left?, top?, right?, bottom?);
	if left >= right || top >= bottom {
		return Err("a part's crop must have left before right and top before bottom".to_owned());
	}
	let aspect = part["aspect"].as_f64().filter(|n| n.is_finite() && *n > 0.0).ok_or("a part's aspect must be a number above 0")?;
	let mut out = Obj::new();
	out.insert("page", page_number(&part["page"], "a part's page")?);
	out.insert("crop", vec![left, top, right, bottom]);
	out.insert("aspect", round4(aspect));
	Ok(Json::Obj(out))
}

fn label(label: &Json) -> Result<Json, String> {
	let text = label["label"].as_str().filter(|text| (1..=MAX_LABEL_CHARS).contains(&text.chars().count())).ok_or("a label must be 1 to 4 characters")?;
	let mut out = Obj::new();
	out.insert("label", text);
	out.insert("page", page_number(&label["page"], "a label's page")?);
	out.insert("y", fraction(&label["y"], "a label's y")?);
	Ok(Json::Obj(out))
}

fn mark(mark: &Json) -> Result<Json, String> {
	let mut out = Obj::new();
	out.insert("page", page_number(&mark["page"], "the mark's page")?);
	for side in ["x", "y", "width", "height"] {
		out.insert(side, fraction(&mark[side], &format!("the mark's {side}"))?);
	}
	Ok(Json::Obj(out))
}

/// The piece as it is kept: the same fields with their numbers rounded to 4 decimals, anything
/// else dropped; why not when a field is missing or out of range.
pub fn check_piece(piece: &Json) -> Result<Json, String> {
	if !matches!(piece, Json::Obj(_)) {
		return Err("a piece must be an object".to_owned());
	}
	let file_id = piece["fileId"].as_str().filter(|id| !id.is_empty()).ok_or("a piece needs its fileId")?;
	let parts = piece["parts"].as_arr().filter(|parts| (1..=MAX_PARTS).contains(&parts.len())).ok_or("a piece has 1 to 4 parts")?;
	let mut out = Obj::new();
	out.insert("fileId", file_id);
	out.insert("parts", parts.iter().map(part).collect::<Result<Vec<_>, _>>()?);
	let labels = match &piece["labels"] {
		Json::Null => &[],
		other => other.as_arr().filter(|labels| labels.len() <= MAX_LABELS).ok_or("labels must be a list of at most 26")?.as_slice(),
	};
	if !labels.is_empty() {
		out.insert("labels", labels.iter().map(label).collect::<Result<Vec<_>, _>>()?);
	}
	if !piece["mark"].is_null() {
		out.insert("mark", mark(&piece["mark"])?);
	}
	Ok(Json::Obj(out))
}

#[cfg(test)]
mod tests {
	use gs_json::{json, stringify};

	use super::*;

	fn full() -> Json {
		json!({
			"fileId": "f_1",
			"parts": [{ "page": 2, "crop": [0.12554, 0.67451, 0.89333, 0.90754], "aspect": 0.772727, "extra": 1 }],
			"labels": [{ "label": "a", "page": 3, "y": 0.5784, "more": true }],
			"mark": { "page": 2, "x": 0.1, "y": 0.2, "width": 0.3, "height": 0.02 },
			"unknown": "dropped",
		})
	}

	#[test]
	fn a_piece_keeps_its_fields_rounded_and_drops_the_rest() {
		assert_eq!(
			stringify(&check_piece(&full()).unwrap()),
			r#"{"fileId":"f_1","parts":[{"page":2,"crop":[0.1255,0.6745,0.8933,0.9075],"aspect":0.7727}],"labels":[{"label":"a","page":3,"y":0.5784}],"mark":{"page":2,"x":0.1,"y":0.2,"width":0.3,"height":0.02}}"#
		);
	}

	#[test]
	fn labels_and_mark_may_be_left_out() {
		let mut piece = full();
		let obj = piece.as_obj_mut().unwrap();
		obj.insert("labels", Json::Arr(Vec::new()));
		obj.insert("mark", Json::Null);
		assert_eq!(stringify(&check_piece(&piece).unwrap()), r#"{"fileId":"f_1","parts":[{"page":2,"crop":[0.1255,0.6745,0.8933,0.9075],"aspect":0.7727}]}"#);
	}

	fn broken(path: &[&str], value: Json) -> String {
		let mut piece = full();
		let mut at = &mut piece;
		for key in &path[..path.len() - 1] {
			at = match key.parse::<usize>() {
				Ok(i) => &mut at.as_arr_mut().unwrap()[i],
				Err(_) => at.get_mut(key).unwrap(),
			};
		}
		at.set(path[path.len() - 1], value);
		check_piece(&piece).unwrap_err()
	}

	#[test]
	fn a_bad_field_says_which() {
		assert!(check_piece(&Json::Null).is_err());
		assert!(broken(&["fileId"], json!("")).contains("fileId"));
		assert!(broken(&["parts"], json!([])).contains("1 to 4 parts"));
		assert!(broken(&["parts"], json!([{}, {}, {}, {}, {}])).contains("1 to 4 parts"));
		assert!(broken(&["parts", "0", "page"], json!(0)).contains("page"));
		assert!(broken(&["parts", "0", "page"], json!(1.5)).contains("page"));
		assert!(broken(&["parts", "0", "crop"], json!([0.1, 0.2, 0.3])).contains("four numbers"));
		assert!(broken(&["parts", "0", "crop"], json!([0.1, 0.2, 1.1, 0.9])).contains("0 to 1"));
		assert!(broken(&["parts", "0", "crop"], json!([0.5, 0.2, 0.5, 0.9])).contains("left before right"));
		assert!(broken(&["parts", "0", "crop"], json!([0.1, 0.9, 0.5, 0.2])).contains("top before bottom"));
		assert!(broken(&["parts", "0", "crop"], json!([0.1, "x", 0.5, 0.9])).contains("0 to 1"));
		assert!(broken(&["parts", "0", "aspect"], json!(0)).contains("aspect"));
		assert!(broken(&["labels", "0", "label"], json!("abcde")).contains("1 to 4"));
		assert!(broken(&["labels", "0", "label"], json!("")).contains("1 to 4"));
		assert!(broken(&["labels", "0", "y"], json!(1.2)).contains("0 to 1"));
		assert!(broken(&["labels"], Json::from((0..27).map(|_| json!({ "label": "a", "page": 1, "y": 0.1 })).collect::<Vec<Json>>())).contains("at most 26"));
		assert!(broken(&["mark", "width"], json!(2)).contains("width"));
		assert!(broken(&["mark", "page"], json!(0)).contains("page"));
	}

	#[test]
	fn a_number_that_is_not_finite_is_refused() {
		assert!(broken(&["parts", "0", "aspect"], Json::Num(f64::INFINITY)).contains("aspect"));
		assert!(broken(&["parts", "0", "crop"], json!([Json::Num(f64::NAN), 0.2, 0.5, 0.9])).contains("0 to 1"));
	}
}
