//! The `plugins` section of the settings record: per installed plugin, keyed by its id, whether it
//! is on and the values the learner set. Which values are valid depends on the plugin's manifest,
//! so this read side only keeps the shape; the plugins service checks values against it.

use std::sync::LazyLock;

use gs_base::re::Re;
use gs_json::{Json, Obj};

/// A plugin id: a lowercase slug, so it is safe as a folder name and in a URL.
pub fn is_plugin_id(id: &str) -> bool {
	static SHAPE: LazyLock<Re> = LazyLock::new(|| Re::new(r"^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$", ""));
	SHAPE.test(id)
}

/// A setting value as stored: a boolean, a finite number or a string.
pub fn is_setting_value(value: &Json) -> bool {
	match value {
		Json::Bool(_) | Json::Str(_) => true,
		Json::Num(n) => n.is_finite(),
		_ => false,
	}
}

/// One plugin's entry: `enabled` when a boolean, `values` with only storable values.
fn sanitize_entry(raw: &Json) -> Json {
	let mut out = Obj::new();
	if let Some(enabled) = raw["enabled"].as_bool() {
		out.insert("enabled", enabled);
	}
	if let Some(values) = raw["values"].as_obj() {
		let kept: Obj = values.iter().filter(|(k, v)| is_setting_value(v) && *k != "__proto__").map(|(k, v)| (k.clone(), v.clone())).collect();
		out.insert("values", kept);
	}
	Json::Obj(out)
}

/// The section with entries for plugin ids only, each an object.
pub fn sanitize_plugin_settings(raw: &Json) -> Json {
	let Some(entries) = raw.as_obj() else { return Json::Obj(Obj::new()) };
	Json::Obj(entries.iter().filter(|(id, entry)| is_plugin_id(id) && entry.as_obj().is_some()).map(|(id, entry)| (id.clone(), sanitize_entry(entry))).collect())
}

#[cfg(test)]
mod tests {
	use gs_json::{parse, stringify};

	use super::*;

	#[test]
	fn ids_are_lowercase_slugs() {
		for good in ["memes", "meme-plugin", "a", "x2"] {
			assert!(is_plugin_id(good), "{good}");
		}
		for bad in ["", "-a", "a-", "Memes", "a_b", "a.b", "../x", "a/b", &"a".repeat(65)] {
			assert!(!is_plugin_id(bad), "{bad}");
		}
	}

	#[test]
	fn the_section_keeps_its_shape_only() {
		let raw = parse(r#"{"memes":{"enabled":false,"values":{"size":2,"style":"bold","on":true,"bad":[1],"nope":null},"extra":1},"Bad Id":{"enabled":true},"quiz":3}"#).unwrap();
		assert_eq!(stringify(&sanitize_plugin_settings(&raw)), r#"{"memes":{"enabled":false,"values":{"size":2,"style":"bold","on":true}}}"#);
		assert_eq!(stringify(&sanitize_plugin_settings(&parse(r#"{"memes":{"enabled":"yes"}}"#).unwrap())), r#"{"memes":{}}"#);
	}
}
