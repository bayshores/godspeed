//! Plan labels and token folds. Every call runs on a plan,
//! so nothing has a dollar price: a turn is either a plan turn or unpriced.

use gs_json::{Json, Obj};

/// Plan-billed model ids and the plan's label. The old prefixes only appear in records from
/// before the built-in sign-ins were removed.
const PLAN_LABELS: [(&str, &str); 4] = [("agent:", "Your agent"), ("chatgpt:", "ChatGPT"), ("github-copilot-subscription:", "GitHub Copilot"), ("xai-subscription:", "Grok")];

fn subscription_label(model: Option<&str>) -> Option<&'static str> {
	let model = model?;
	PLAN_LABELS.iter().find(|(prefix, _)| model.starts_with(prefix)).map(|(_, label)| *label)
}

pub fn is_subscription_model(model: Option<&str>) -> bool {
	subscription_label(model).is_some()
}

/// The distinct plan labels of these models, in first-seen order.
pub fn subscription_labels(models: &[Option<&str>]) -> Vec<String> {
	let mut out: Vec<String> = Vec::new();
	for label in models.iter().filter_map(|m| subscription_label(*m)) {
		if !out.iter().any(|l| l == label) {
			out.push(label.to_owned());
		}
	}
	out
}

/// One model call's token counts; a count that was never reported stays `None`.
#[derive(Clone, Default, Debug, PartialEq)]
pub struct CallUsage {
	pub input_tokens: Option<f64>,
	pub output_tokens: Option<f64>,
	pub cache_read_tokens: Option<f64>,
	pub cache_write_tokens: Option<f64>,
	pub cache_write_1h_tokens: Option<f64>,
	pub reasoning_tokens: Option<f64>,
}

impl CallUsage {
	/// Reads a stored usage record. A present null counts as a reported zero.
	pub fn from_json(v: &Json) -> CallUsage {
		let read = |key: &str| v.get(key).map(|n| n.as_f64().unwrap_or(0.0));
		CallUsage {
			input_tokens: read("inputTokens"),
			output_tokens: read("outputTokens"),
			cache_read_tokens: read("cacheReadTokens"),
			cache_write_tokens: read("cacheWriteTokens"),
			cache_write_1h_tokens: read("cacheWrite1hTokens"),
			reasoning_tokens: read("reasoningTokens"),
		}
	}

	/// The stored shape: counts that were never reported are left out.
	pub fn to_json(&self) -> Json {
		let mut out = Obj::new();
		for (key, value) in [
			("inputTokens", self.input_tokens),
			("outputTokens", self.output_tokens),
			("cacheReadTokens", self.cache_read_tokens),
			("cacheWriteTokens", self.cache_write_tokens),
			("cacheWrite1hTokens", self.cache_write_1h_tokens),
			("reasoningTokens", self.reasoning_tokens),
		] {
			if let Some(n) = value {
				out.insert(key, n);
			}
		}
		Json::Obj(out)
	}
}

/// Sums a count that stays unreported when no step reported it.
fn sum_if_any(vals: impl Iterator<Item = Option<f64>>) -> Option<f64> {
	let vals: Vec<Option<f64>> = vals.collect();
	if vals.iter().all(Option::is_none) { None } else { Some(vals.iter().fold(0.0, |a, v| a + v.unwrap_or(0.0))) }
}

/// Sums steps. The long-cache split is unknown if any write-bearing step lacks it; a missing
/// detail is never silently turned into zero.
pub fn sum_steps(steps: &[CallUsage]) -> CallUsage {
	let unknown_split = steps.iter().any(|s| s.cache_write_tokens.unwrap_or(0.0) > 0.0 && s.cache_write_1h_tokens.is_none());
	CallUsage {
		input_tokens: sum_if_any(steps.iter().map(|s| s.input_tokens)),
		output_tokens: sum_if_any(steps.iter().map(|s| s.output_tokens)),
		cache_read_tokens: sum_if_any(steps.iter().map(|s| s.cache_read_tokens)),
		cache_write_tokens: sum_if_any(steps.iter().map(|s| s.cache_write_tokens)),
		cache_write_1h_tokens: if unknown_split { None } else { sum_if_any(steps.iter().map(|s| s.cache_write_1h_tokens)) },
		reasoning_tokens: sum_if_any(steps.iter().map(|s| s.reasoning_tokens)),
	}
}

/// `sessionCost`: `{unpriced, [subscription, subscriptionProviders]}` for a chat record.
pub fn session_cost(record: &Json) -> Json {
	let turns: &[Json] = record["turns"].as_arr().map_or(&[], Vec::as_slice);
	let models: Vec<Option<&str>> = turns.iter().map(|t| t["model"].as_str()).collect();
	let subscription = models.iter().filter(|m| is_subscription_model(**m)).count();
	let mut out = Obj::new();
	out.insert("unpriced", (turns.len() - subscription) as f64);
	if subscription > 0 {
		out.insert("subscription", subscription as f64);
		out.insert("subscriptionProviders", subscription_labels(&models).into_iter().map(Json::Str).collect::<Json>());
	}
	Json::Obj(out)
}

#[cfg(test)]
mod tests {
	use gs_json::{json, stringify};

	use super::*;

	#[test]
	fn labels_come_from_the_model_prefix() {
		assert_eq!(subscription_labels(&[Some("agent:x"), None, Some("gpt"), Some("chatgpt:y"), Some("agent:z")]), ["Your agent", "ChatGPT"]);
		assert!(!is_subscription_model(None));
	}

	#[test]
	fn a_missing_split_on_a_write_stays_unknown() {
		let a = CallUsage { cache_write_tokens: Some(5.0), ..CallUsage::default() };
		let b = CallUsage { input_tokens: Some(2.0), cache_write_1h_tokens: Some(1.0), ..CallUsage::default() };
		let sum = sum_steps(&[a, b.clone()]);
		assert_eq!(sum.cache_write_1h_tokens, None);
		assert_eq!(sum.input_tokens, Some(2.0));
		assert_eq!(sum_steps(&[b]).cache_write_1h_tokens, Some(1.0));
		assert_eq!(stringify(&sum_steps(&[]).to_json()), "{}");
	}

	#[test]
	fn session_cost_counts_plan_turns() {
		let record = json!({ "turns": [{ "model": "agent:a" }, { "model": "old" }, {}] });
		assert_eq!(stringify(&session_cost(&record)), r#"{"unpriced":2,"subscription":1,"subscriptionProviders":["Your agent"]}"#);
		assert_eq!(stringify(&session_cost(&json!({}))), r#"{"unpriced":0}"#);
	}
}
