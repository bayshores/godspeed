//! The vaults Obsidian lists in its `obsidian.json`: `{"vaults":{"<id>":{"path":"...","ts":...,"open":bool}}}`.

use gs_json::parse;

/// The vault paths, most recently opened first (`ts`), then by path. Entries with no path are
/// skipped. Text that is not an Obsidian list gives an error the caller can show.
pub fn vault_paths(json_text: &str) -> Result<Vec<String>, String> {
	let json = parse(json_text).map_err(|e| format!("Obsidian's vault list is not valid JSON ({e})."))?;
	let Some(top) = json.as_obj() else { return Err("Obsidian's vault list is not an object.".to_owned()) };
	let Some(vaults) = top.get("vaults") else { return Ok(Vec::new()) };
	let Some(vaults) = vaults.as_obj() else { return Err("Obsidian's vault list has no \"vaults\" object.".to_owned()) };
	let mut found: Vec<(f64, String)> = vaults.values().filter_map(|v| Some((v["ts"].as_f64().unwrap_or(0.0), v["path"].as_str().filter(|p| !p.is_empty())?.to_owned()))).collect();
	found.sort_by(|a, b| b.0.total_cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
	Ok(found.into_iter().map(|(_, path)| path).collect())
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn reads_paths_newest_first() {
		let text = r#"{"vaults":{"a1":{"path":"/Users/me/Cowork","ts":1700000000000,"open":true},"b2":{"path":"/Users/me/Notes","ts":1710000000000},"c3":{"path":"/Users/me/Old","ts":5},"d4":{"ts":9},"e5":{"path":""}}}"#;
		assert_eq!(vault_paths(text).unwrap(), ["/Users/me/Notes", "/Users/me/Cowork", "/Users/me/Old"]);
	}

	#[test]
	fn no_vaults_is_an_empty_list() {
		assert_eq!(vault_paths("{}").unwrap(), Vec::<String>::new());
		assert_eq!(vault_paths(r#"{"vaults":{}}"#).unwrap(), Vec::<String>::new());
	}

	#[test]
	fn bad_text_is_an_error_not_a_panic() {
		for bad in ["", "not json", "{\"vaults\":", "[]", "5", "null", r#"{"vaults":[1]}"#, r#"{"vaults":{"a":5}}"#] {
			let result = vault_paths(bad);
			if bad == r#"{"vaults":{"a":5}}"# {
				assert_eq!(result.unwrap(), Vec::<String>::new());
			} else {
				assert!(result.is_err(), "{bad}");
			}
		}
	}
}
