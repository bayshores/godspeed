use std::sync::LazyLock;

use gs_base::re::Re;

/// Strips the copy syntax a model glues onto a membership value (`":value"`, `` `value` ``):
/// surrounding whitespace, colons, periods, quotes and backticks. Never use on free text.
pub fn strip_model_value_debris(value: &str) -> String {
	static LEAD: LazyLock<Re> = LazyLock::new(|| Re::new(r#"^[\s:."'`]+"#, ""));
	static TRAIL: LazyLock<Re> = LazyLock::new(|| Re::new(r#"[\s:."'`]+$"#, ""));
	TRAIL.replace(&LEAD.replace(value, ""), "")
}

#[cfg(test)]
mod tests {
	#[test]
	fn strips_only_the_ends() {
		assert_eq!(super::strip_model_value_debris(" \":a.b\". `"), "a.b");
	}
}
