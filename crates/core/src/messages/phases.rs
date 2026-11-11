//! The record-side phase fold; the transcript dividers fold view messages in the browser.

use gs_json::Json;

/// The three phases of a session, as the picker and header see them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase3 {
	Probe,
	Plan,
	Teach,
}

impl Phase3 {
	pub fn as_str(self) -> &'static str {
		match self {
			Phase3::Probe => "probe",
			Phase3::Plan => "plan",
			Phase3::Teach => "teach",
		}
	}
}

/// A quiz call's arguments carry `nodeId` iff it is tagged (teach-only).
pub(super) fn tagged_node_id(input: &Json) -> bool {
	input["nodeId"].as_str().is_some_and(|id| !id.is_empty())
}

/// probe_done refuses (a question still open) with a clean `{ok:false}` result; that concludes
/// nothing.
pub(super) fn refused_probe(details: &Json) -> bool {
	details["ok"] == Json::Bool(false)
}

/// Where a session's phase fold starts: study and homework sessions have no probe and no plan to
/// write, so they teach from their first message.
pub fn first_phase(kind: Option<&str>) -> Phase3 {
	if matches!(kind, Some("study" | "homework")) { Phase3::Teach } else { Phase3::Probe }
}

/// The current phase of a record. Probe becomes plan at the probe_done call's clean result, plan
/// becomes teach at the assistant message carrying the first quiz or explain call tagged with a
/// node id.
pub fn phase_at3_lh(messages: &[Json], start: Phase3) -> Phase3 {
	let mut phase = start;
	for m in messages {
		match m["role"].as_str() {
			Some("toolResult") if phase == Phase3::Probe && m["toolName"].as_str() == Some("probe_done") && !m["isError"].truthy() && !refused_probe(&m["details"]) => phase = Phase3::Plan,
			Some("assistant") if phase == Phase3::Plan => {
				let teaches = m["content"].as_arr().is_some_and(|blocks| {
					blocks.iter().any(|b| b["type"].as_str() == Some("toolCall") && matches!(b["name"].as_str(), Some("quiz" | "explain")) && tagged_node_id(&b["arguments"]))
				});
				if teaches {
					phase = Phase3::Teach;
				}
			}
			_ => {}
		}
	}
	phase
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;

	fn probe_done(details: Json, is_error: bool) -> Json {
		json!({ "role": "toolResult", "toolName": "probe_done", "isError": is_error, "details": details })
	}

	fn quiz(arguments: Json) -> Json {
		json!({ "role": "assistant", "content": [{ "type": "toolCall", "name": "quiz", "arguments": arguments }] })
	}

	#[test]
	fn probe_plan_teach_in_order() {
		let tagged = quiz(json!({ "nodeId": "n1" }));
		assert_eq!(phase_at3_lh(&[], Phase3::Probe), Phase3::Probe);
		// A tagged quiz before probe_done changes nothing.
		assert_eq!(phase_at3_lh(std::slice::from_ref(&tagged), Phase3::Probe), Phase3::Probe);
		assert_eq!(phase_at3_lh(&[probe_done(json!({ "ok": false }), false)], Phase3::Probe), Phase3::Probe);
		assert_eq!(phase_at3_lh(&[probe_done(json!({}), true)], Phase3::Probe), Phase3::Probe);
		let planned = [probe_done(json!({ "ok": true }), false), quiz(json!({ "nodeId": "" })), quiz(json!({}))];
		assert_eq!(phase_at3_lh(&planned, Phase3::Probe), Phase3::Plan);
		let taught = [planned[0].clone(), tagged];
		assert_eq!(phase_at3_lh(&taught, Phase3::Probe), Phase3::Teach);
	}

	#[test]
	fn study_and_homework_start_in_teach() {
		assert_eq!(first_phase(Some("study")), Phase3::Teach);
		assert_eq!(first_phase(Some("homework")), Phase3::Teach);
		assert_eq!(first_phase(Some("practice")), Phase3::Probe);
		assert_eq!(first_phase(None), Phase3::Probe);
		assert_eq!(Phase3::Plan.as_str(), "plan");
	}
}
