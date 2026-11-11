//! The extractor's submit tool (extraction.ts): its JSON Schemas as TypeBox emits them, the
//! instructions, the laws the submit seam checks, and the lift into the merger's findings shape.

use std::collections::HashSet;

use gs_base::text;
use gs_core::session::schema::{self, string, strings};
use gs_json::{Json, Obj, json};

/// The session-only anchor instruction. Approved word for word: keep the wording.
pub const SESSION_MESSAGE_ID_RULE: &str = "For each new proposition, copy the message ID of the passage that most directly states or explains it into messageId.";

pub const SESSION_PREAMBLE: &str = "You are the extraction stage of a learning application. You read one stretch of a source \u{2014} a teaching session, rendered as the teacher's prose in reading order \u{2014} and report what it teaches as findings for the learner's global knowledge graph, building on everything already extracted from this source.";

pub const NOTES_PREAMBLE: &str = "You are the extraction stage of a learning application. You read one stretch of a source \u{2014} the author's personal notes, rendered in reading order \u{2014} and report what it teaches as findings for the learner's global knowledge graph, building on everything already extracted from this source.";

pub const EXTRACTION_CORE: &str = "THE GOAL: uncover the source's CORE IDEAS and show how everything derives from the foundations. The
source teaches by arguing \u{2014} ideas worked out from other ideas, down to a foundation the rest stands on.
Your deliverable is twofold: the core ideas themselves, and the chains of reasoning that derive them.
Each chain is premises that JOINTLY entail a conclusion. Entailment is the only link that earns a
chain \u{2014} where the real connection is historical or narrative (who argued what, how a debate or
exposition unfolds), there is no chain; keep the pieces as bare ideas or drop them. The direction of
the graph is upward: foundational ideas at the bottom, derived ideas above them, each chain showing
how its conclusion follows from what is more established \u{2014} do not submit connections that carry no
derivation.

The graph holds TRUE ideas about the world, nothing else \u{2014} never anything about the learner, the
teacher, or this reading: not \"the learner understands X\" but X. A misconception enters as its TRUE
correction. Each statement is one self-contained idea at full precision.

Extract the load-bearing ideas of the subject \u{2014} what a reference on it would teach \u{2014} not the full run
of the discourse. An idea earns its place only when the source's arguments run through it \u{2014} examples,
notation glosses, and restatements that no argument needs are not core ideas. Every idea must stand
alone for a reader who never saw this source: names and statements may not lean on the source's own
scaffolding (claim numbering, axiom tags, arc labels); a claim that only matters as part of how this
document is organized is not knowledge \u{2014} drop it.

When the prompt carries THE GRAPH SO FAR, you are continuing a source already partly extracted; when
it carries RELATED IDEAS, other sources already taught those ideas. Build on both. An idea either list
already holds \u{2014} even worded differently \u{2014} is never submitted again: reference it by its id (\"n_\u{2026}\"),
and list its id in reteaches when this stretch teaches it. Prefer chains that lean on established
conclusions as premises \u{2014} derive new material from what is already derived. Do not re-derive a
conclusion the graph already holds unless the route is genuinely different.

SUBMIT with one submit_findings call: every NEW core idea with a short name and a precise statement,
every chain as premises + conclusion, and in reteaches the ids of existing ideas this stretch also
teaches. A chain's premises and conclusion may be ids from this submission OR existing ids from THE
GRAPH SO FAR or RELATED IDEAS, verbatim. Premises within one chain are used TOGETHER \u{2014} independent
arguments for the same conclusion are separate chains. A conclusion may reappear, by id, as a premise
of later chains. A bare idea that no argument uses rides the propositions list alone. Include every
field even when empty \u{2014} \"chains\": [] when the source makes no arguments, \"reteaches\": [] when it
re-teaches nothing. The tool's field descriptions carry the details.";

/// Lessons: questions the learner answered arrive as "QUESTION [id]" lines.
const SESSION_QUESTION_RULE: &str = "QUESTION [id] passages are questions the learner was asked. They teach nothing themselves; for each one, list in tests the ideas it asks about (new or existing ids) under its message id, so the learner's answer counts for them.";

/// Added for class files godspeed may sort by itself.
const COURSE_INFO_RULE: &str = "This file is from a class folder. If it is course logistics rather than material to learn from (announcements, emails, grade or submission notices, schedules, forum digests), submit courseInfo: true with empty propositions, chains and reteaches.";

pub fn extractor_instructions() -> String {
	format!("{SESSION_PREAMBLE}\n\n{EXTRACTION_CORE}\n\n{SESSION_MESSAGE_ID_RULE}\n\n{SESSION_QUESTION_RULE}")
}

pub fn notes_extractor_instructions(may_be_course_info: bool) -> String {
	let base = format!("{NOTES_PREAMBLE}\n\n{EXTRACTION_CORE}");
	if may_be_course_info { format!("{base}\n\n{COURSE_INFO_RULE}") } else { base }
}

// ── the schemas, key for key as TypeBox emits them ──

/// `Type.Object`: `required` lists the properties not marked optional, in order.
fn object(properties: Vec<(&str, Json, bool)>) -> Json {
	let required: Vec<&str> = properties.iter().filter(|(_, _, optional)| !optional).map(|(key, _, _)| *key).collect();
	schema::object(&required, properties.into_iter().map(|(key, schema, _)| (key, schema)).collect())
}

fn array(items: Json, description: &str) -> Json {
	json!({ "type": "array", "items": items, "description": description })
}

fn endpoint(role: &str) -> Json {
	string(&format!(
		"The id this {role} \u{2014} EITHER an existing idea id from THE GRAPH SO FAR or RELATED IDEAS in the prompt, verbatim (\"n_\u{2026}\"), OR the local id of a proposition in this submission (\"p1\", \u{2026})."
	))
}

fn proposition_props() -> Vec<(&'static str, Json, bool)> {
	vec![
		("id", string("Local id: \"p1\", \"p2\", \u{2026} \u{2014} referenced by chains in this call."), false),
		(
			"name",
			string("A very short label \u{2014} established terminology, the term the discipline itself uses, a glossary headword a textbook would print ('Will to power', 'Divine command theory'). Not a sentence, needn't be unique or self-contained: this becomes the node's global label in the graph."),
			false,
		),
		(
			"statement",
			string("One true, self-contained, world-facing core idea at full precision. Never about the learner, the teacher, or the reading: not \"the learner understands X\" but \"X\". A misconception enters as its TRUE correction."),
			false,
		),
		("aliases", strings("Verbatim phrasings the source used for the same proposition, if any."), true),
	]
}

const PROPOSITIONS_DESCRIPTION: &str = "Only the NEW core ideas this stretch contributes \u{2014} ideas the prompt's THE GRAPH SO FAR or RELATED IDEAS already hold are referenced by id (in chains and reteaches), never restated here.";
const CHAINS_DESCRIPTION: &str = "Every argument this stretch makes \u{2014} including arguments that join new ideas to established ones; conclusions reusable by id as premises of later chains; bare ideas (no argument) ride the propositions list alone; pass [] when none \u{2014} never omit the field.";
const RETEACHES_DESCRIPTION: &str = "Ids (\"n_\u{2026}\") of ideas already in THE GRAPH SO FAR or RELATED IDEAS that this stretch also teaches; pass [] when none \u{2014} never omit the field.";

fn chains_field() -> Json {
	let premises = json!({
		"type": "array",
		"items": endpoint("premise uses"),
		"minItems": 1,
		"description": "Premise ids used TOGETHER: they jointly entail the conclusion; independent reasons are separate chains.",
	});
	array(object(vec![("premises", premises, false), ("conclusion", endpoint("conclusion is"), false)]), CHAINS_DESCRIPTION)
}

/// The notes door's base shape: propositions, chains, reteaches.
fn base_fields(propositions: Vec<(&'static str, Json, bool)>) -> Vec<(&'static str, Json, bool)> {
	vec![
		("propositions", array(object(propositions), PROPOSITIONS_DESCRIPTION), false),
		("chains", chains_field(), false),
		("reteaches", strings(RETEACHES_DESCRIPTION), false),
	]
}

/// A notes file's submit; a class file godspeed may sort by itself adds the course-info verdict.
pub fn notes_findings_schema(may_be_course_info: bool) -> Json {
	let mut fields = base_fields(proposition_props());
	if may_be_course_info {
		let verdict = json!({ "type": "boolean", "description": "true when this file is course logistics, not material to learn from; then propositions, chains and reteaches stay empty." });
		fields.push(("courseInfo", verdict, true));
	}
	object(fields)
}

/// A lesson's submit: every proposition names its passage, and questions list what they test.
pub fn session_findings_schema() -> Json {
	let mut props = proposition_props();
	props.push((
		"messageId",
		string("The message id of the ONE passage in this stretch that most directly states or explains this proposition \u{2014} copy it EXACTLY from that passage's \"TEACHER [id]\" label."),
		false,
	));
	let mut fields = base_fields(props);
	let test = object(vec![
		("messageId", string("The question's message id, copied EXACTLY from its \"QUESTION [id]\" label."), false),
		("ids", strings("The ideas the question asks about: proposition ids from this call or existing ids from THE GRAPH SO FAR or RELATED IDEAS."), false),
	]);
	fields.push(("tests", array(test, "One entry per \"QUESTION [id]\" passage in this stretch; [] when it has none."), true));
	object(fields)
}

// ── the submit seam ──

fn items(v: &Json) -> &[Json] {
	v.as_arr().map_or(&[], Vec::as_slice)
}

/// The notes door's boundary: a stray messageId (extra properties pass the schema) is dropped, so
/// notes provenance stays file-level.
pub fn fill_notes_findings(raw: Json) -> Json {
	let mut out = raw;
	if let Some(props) = out.get_mut("propositions").and_then(Json::as_arr_mut) {
		for p in props.iter_mut().filter_map(Json::as_obj_mut) {
			p.remove("messageId");
		}
	}
	out
}

/// The chain laws: every endpoint is a submitted proposition id or an existing node id, a
/// conclusion is never its own premise, and reteaches name existing ideas only. A problem goes
/// back to the model as an error result; identical chains are not errors (the merge dedupes them).
pub fn validate_findings_chains(value: &Json, existing: &HashSet<String>) -> Option<String> {
	if let Some(unknown) = items(&value["reteaches"]).iter().map(Json::str_or_empty).find(|id| !existing.contains(*id)) {
		return Some(format!("reteaches: \"{unknown}\" is not an existing idea id from THE GRAPH SO FAR or RELATED IDEAS \u{2014} list only ids shown there."));
	}
	let ids: HashSet<&str> = items(&value["propositions"]).iter().map(|p| p["id"].str_or_empty()).collect();
	for chain in items(&value["chains"]) {
		let premises: Vec<&str> = items(&chain["premises"]).iter().map(Json::str_or_empty).collect();
		let conclusion = chain["conclusion"].str_or_empty();
		if premises.is_empty() {
			return Some("chains: premises must name at least one proposition \u{2014} a proposition with no argument stays in the propositions list alone.".to_owned());
		}
		if let Some(unknown) = premises.iter().chain(std::iter::once(&conclusion)).find(|id| !ids.contains(**id) && !existing.contains(**id)) {
			return Some(format!("chains: \"{unknown}\" is neither a submitted proposition id nor an existing idea id from THE GRAPH SO FAR or RELATED IDEAS \u{2014} every premise and conclusion must resolve."));
		}
		if premises.contains(&conclusion) {
			return Some("chains: a conclusion cannot be its own premise.".to_owned());
		}
	}
	None
}

/// The session anchor law: every proposition, and every question test, names a passage of the
/// batch being read (`batch_ids`), never one of another batch, chat or kind of message.
pub fn validate_session_anchors(value: &Json, batch_ids: &HashSet<String>, existing: &HashSet<String>) -> Option<String> {
	let local: HashSet<&str> = items(&value["propositions"]).iter().map(|p| p["id"].str_or_empty()).collect();
	for test in items(&value["tests"]) {
		let message_id = test["messageId"].str_or_empty();
		if !batch_ids.contains(message_id) {
			return Some(format!("tests: messageId \"{message_id}\" is not a passage of THIS stretch \u{2014} copy the id from the brackets of one of this stretch's own QUESTION [id] passages."));
		}
		if let Some(unknown) = items(&test["ids"]).iter().map(Json::str_or_empty).find(|id| !local.contains(id) && !existing.contains(*id)) {
			return Some(format!("tests: \"{unknown}\" is neither a submitted proposition id nor an existing idea id from THE GRAPH SO FAR or RELATED IDEAS."));
		}
	}
	for p in items(&value["propositions"]) {
		let (id, message_id) = (p["id"].str_or_empty(), p["messageId"].str_or_empty());
		if text::trim(message_id).is_empty() {
			return Some(format!("propositions: \"{id}\" is missing its messageId \u{2014} copy the message id from the brackets of the passage (TEACHER [id]) that most directly states or explains it."));
		}
		if !batch_ids.contains(message_id) {
			return Some(format!("propositions: \"{id}\" names messageId \"{message_id}\", which is not a passage of THIS stretch \u{2014} copy the id from the brackets of one of this stretch's own TEACHER [id] passages."));
		}
	}
	None
}

/// The submit as the merger takes it: omitted aliases become `[]`, `tests` rides along when sent.
pub fn as_session_findings(raw: &Json) -> Json {
	let propositions: Vec<Json> = items(&raw["propositions"])
		.iter()
		.map(|p| {
			let mut p = p.clone();
			if let Some(obj) = p.as_obj_mut() {
				let aliases = obj.get("aliases").filter(|a| !a.is_null()).cloned().unwrap_or_else(|| Json::Arr(Vec::new()));
				obj.insert("aliases", aliases);
			}
			p
		})
		.collect();
	let mut out = Obj::new();
	out.insert("propositions", propositions);
	out.insert("chains", raw["chains"].clone());
	out.insert("reteaches", raw["reteaches"].clone());
	if raw["tests"].truthy() {
		out.insert("tests", raw["tests"].clone());
	}
	Json::Obj(out)
}

#[cfg(test)]
mod tests {
	use gs_json::stringify;

	use super::*;

	fn set(ids: &[&str]) -> HashSet<String> {
		ids.iter().map(|s| (*s).to_owned()).collect()
	}

	#[test]
	fn schemas_keep_typebox_key_order() {
		let notes = notes_findings_schema(false);
		assert_eq!(notes["required"], json!(["propositions", "chains", "reteaches"]));
		assert_eq!(notes["properties"]["propositions"]["items"]["required"], json!(["id", "name", "statement"]));
		let session = stringify(&session_findings_schema());
		assert!(session.starts_with(r#"{"type":"object","required":["propositions","chains","reteaches"],"properties":{"propositions":{"type":"array","items":{"type":"object","required":["id","name","statement","messageId"]"#));
		assert!(session.contains(r#""minItems":1,"description":"Premise ids used TOGETHER"#));
		let course = notes_findings_schema(true);
		assert_eq!(course["properties"]["courseInfo"]["type"], Json::from("boolean"));
		assert_eq!(course["required"], json!(["propositions", "chains", "reteaches"]));
	}

	#[test]
	fn chain_laws_name_the_first_problem() {
		let existing = set(&["n_1"]);
		let ok = json!({ "propositions": [{ "id": "p1" }], "chains": [{ "premises": ["n_1"], "conclusion": "p1" }], "reteaches": ["n_1"] });
		assert_eq!(validate_findings_chains(&ok, &existing), None);
		let bad_reteach = json!({ "propositions": [], "chains": [], "reteaches": ["n_9"] });
		assert!(validate_findings_chains(&bad_reteach, &existing).unwrap().starts_with("reteaches: \"n_9\""));
		let unknown = json!({ "propositions": [{ "id": "p1" }], "chains": [{ "premises": ["p1"], "conclusion": "p9" }], "reteaches": [] });
		assert!(validate_findings_chains(&unknown, &existing).unwrap().starts_with("chains: \"p9\" is neither"));
		let circular = json!({ "propositions": [{ "id": "p1" }, { "id": "p2" }], "chains": [{ "premises": ["p1", "p2"], "conclusion": "p1" }], "reteaches": [] });
		assert_eq!(validate_findings_chains(&circular, &existing).unwrap(), "chains: a conclusion cannot be its own premise.");
	}

	#[test]
	fn anchors_must_be_passages_of_this_batch() {
		let batch = set(&["m1"]);
		let existing = set(&[]);
		let good = json!({ "propositions": [{ "id": "p1", "messageId": "m1" }], "tests": [{ "messageId": "m1", "ids": ["p1"] }] });
		assert_eq!(validate_session_anchors(&good, &batch, &existing), None);
		let blank = json!({ "propositions": [{ "id": "p1", "messageId": " " }] });
		assert!(validate_session_anchors(&blank, &batch, &existing).unwrap().contains("is missing its messageId"));
		let other = json!({ "propositions": [{ "id": "p1", "messageId": "m2" }] });
		assert!(validate_session_anchors(&other, &batch, &existing).unwrap().contains("names messageId \"m2\""));
		let test = json!({ "propositions": [], "tests": [{ "messageId": "m1", "ids": ["x"] }] });
		assert!(validate_session_anchors(&test, &batch, &existing).unwrap().starts_with("tests: \"x\""));
	}

	#[test]
	fn lifting_fills_aliases_and_keeps_tests_only_when_sent() {
		let raw = json!({ "propositions": [{ "id": "p1", "aliases": null, "name": "n" }, { "id": "p2" }], "chains": [], "reteaches": [] });
		let out = as_session_findings(&raw);
		assert_eq!(stringify(&out), r#"{"propositions":[{"id":"p1","aliases":[],"name":"n"},{"id":"p2","aliases":[]}],"chains":[],"reteaches":[]}"#);
		let with_tests = as_session_findings(&json!({ "propositions": [], "chains": [], "reteaches": [], "tests": [] }));
		assert_eq!(with_tests["tests"], json!([]));
		let notes = fill_notes_findings(json!({ "propositions": [{ "id": "p1", "messageId": "m" }], "chains": [] }));
		assert_eq!(stringify(&notes), r#"{"propositions":[{"id":"p1"}],"chains":[]}"#);
	}
}
