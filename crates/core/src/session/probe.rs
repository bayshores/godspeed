//! Ported from src/shared/core/contracts/probe.ts: the probe_done tool, which ends the probe phase
//! with the prober's read of the learner. The first probe_done in the transcript is the seam
//! where the teacher takes over.

use gs_json::Json;

use super::schema::{array, described, object, string};

/// What the prober sees after probe_done. The assessment is the call's own arguments (durable in
/// the transcript, shown to the learner), so echoing it would repeat the phase's largest payload
/// in every later context.
pub const PROBE_DONE_ACK_TEXT: &str = "Assessment recorded \u{2014} it is shown to the learner now and the teacher plans from it. Say your closing sentence and end your turn; the teaching phase takes over from here.";

/// The probe_done tool input: a list of dependency strands, each with a read of the learner's
/// edge, and an optional summary.
pub fn probe_done_input_schema() -> Json {
	let strand = object(
		&["strand", "assessment"],
		vec![
			("strand", string("The dependency strand (e.g. 'the derivative as a limit') \u{2014} a name the plan can hang a node on.")),
			(
				"assessment",
				string("Where his edge sits on this strand: the floor (what he reliably gets right), the ceiling (where it runs out), misconceptions found, and what the lesson should build from."),
			),
		],
	);
	let strands = array(strand, 1, "Every strand the planned lesson will depend on, each with your read of his edge on it.");
	let assessment = object(
		&["strands"],
		vec![("strands", strands), ("summary", string("Optional overall synthesis: his apparent goal and where the teaching should enter."))],
	);
	object(&["assessment"], vec![("assessment", described(assessment, "The learner assessment \u{2014} the probe's distilled output."))])
}

#[cfg(test)]
mod tests {
	use gs_json::stringify;

	use super::*;

	#[test]
	fn the_assessment_needs_at_least_one_strand() {
		let schema = probe_done_input_schema();
		assert_eq!(stringify(&schema["required"]), r#"["assessment"]"#);
		assert_eq!(schema["properties"]["assessment"]["properties"]["strands"]["minItems"].as_f64(), Some(1.0));
		assert!(PROBE_DONE_ACK_TEXT.ends_with("takes over from here."));
	}
}
