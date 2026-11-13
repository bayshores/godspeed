//! The tool input contracts of the question tools
//! (schemas plus the cross-field rules a schema cannot say) and the compact answer record.
//!
//! An invalid question never reaches the learner: the problems below go back to the teacher as
//! a tool result and the teacher retries. The rules mirror the grading path exactly, so
//! "schema-valid" means "gradeable".

use std::sync::LazyLock;

use gs_base::text;
use gs_json::{Json, Obj, json, parse};

use gs_json::js_text::js_string;
use super::schema::{array, boolean, described, object, one_of_literals, string};
use crate::messages::value_debris::strip_model_value_debris;

/// The answer record as the model sees it: only what is new information, in this key order.
pub fn compact_answer_for_model(ad: &Json) -> Json {
	let mut out = Obj::new();
	out.insert("kind", ad["kind"].clone());
	if ad["dismissed"].truthy() {
		out.insert("dismissed", true);
		return Json::Obj(out);
	}
	if ad["dontKnow"].truthy() {
		out.insert("dontKnow", true);
	}
	if let Some(answers) = ad["answers"].as_arr().filter(|a| !a.is_empty()) {
		// A missing key stays missing, as `undefined` does in JSON.stringify.
		let pick = |a: &Json| Json::Obj(["index", "label"].into_iter().filter_map(|k| a.get(k).map(|v| (k, v.clone()))).collect());
		out.insert("answers", answers.iter().map(pick).collect::<Json>());
	}
	for key in ["text", "other", "code", "language"] {
		if ad[key].truthy() {
			out.insert(key, ad[key].clone());
		}
	}
	if ad.get("correct").is_some() && !ad["dontKnow"].truthy() {
		out.insert("correct", ad["correct"].clone());
	}
	if ad.get("confidence").is_some() {
		out.insert("confidence", ad["confidence"].clone());
	}
	let thinking = if ad.get("thinking").is_some_and(|t| !t.is_null()) { &ad["thinking"] } else { &ad["note"] };
	if thinking.truthy() {
		out.insert("thinking", thinking.clone());
	}
	if ad["readingThinking"].truthy() {
		out.insert("thinkingWhileReading", ad["readingThinking"].clone());
	}
	Json::Obj(out)
}

/// The percentage a 1-5 confidence level stands for.
pub fn level_percent(level: u8) -> f64 {
	f64::from(level) * 20.0
}

/// The 1-5 level nearest a stored percentage (not finite reads as 60).
pub fn confidence_level(percent: f64) -> u8 {
	let p = if percent.is_finite() { percent.clamp(0.0, 100.0) } else { 60.0 };
	let mut best = 1;
	for level in 2..=5 {
		if (level_percent(level) - p).abs() < (level_percent(best) - p).abs() {
			best = level;
		}
	}
	best
}

/// A quiz's role in the teaching cycle, "predict" or "check", read past a model's copy debris.
pub fn normalize_quiz_type(raw: &Json) -> Option<&'static str> {
	match strip_model_value_debris(raw.as_str()?).as_str() {
		"predict" => Some("predict"),
		"check" => Some("check"),
		_ => None,
	}
}

/// Models sometimes send `options` as a JSON-encoded string. A string that parses to an array
/// becomes that array; anything else comes back untouched so validation reports it.
pub fn parse_options_if_string(options: Option<&Json>) -> Option<Json> {
	if let Some(Json::Str(raw)) = options
		&& let Ok(parsed @ Json::Arr(_)) = parse(raw)
	{
		return Some(parsed);
	}
	options.cloned()
}

/// Option sanity shared by quiz and ask: labels non-empty and resolved values (the trimmed
/// `value`, else the trimmed label) distinct. Returns the problems and the resolved keys.
fn option_problems(options: &[Json]) -> (Vec<String>, Vec<String>) {
	let mut problems = Vec::new();
	let mut keys: Vec<String> = Vec::new();
	for (i, option) in options.iter().enumerate() {
		let label = text::trim(option["label"].as_str().unwrap_or_default());
		if label.is_empty() {
			problems.push(format!("options[{i}].label is empty \u{2014} every option needs a label."));
			continue;
		}
		let value = text::trim(option["value"].as_str().unwrap_or_default());
		let key = if value.is_empty() { label } else { value };
		if keys.iter().any(|k| k == key) {
			problems.push(format!("Two options resolve to the same value \"{key}\" \u{2014} options must be distinct."));
		}
		keys.push(key.to_owned());
	}
	(problems, keys)
}

/// ask options: the shared sanity, nothing more (ask is not graded).
pub fn ask_option_problems(options: &[Json]) -> Vec<String> {
	option_problems(options).0
}

/// Keeps an exact option key whole before any copy-syntax cleanup: a label's final period or
/// quotes can be content, not model debris. Non-matches get the debris strip, and a string that
/// looks like a JSON array is read as the several values it lists. A value that is neither a
/// string nor an array has no entries.
pub fn coerce_correct_answer(correct_answer: &Json, option_values: &[String]) -> Vec<String> {
	let clean = |value: &str| {
		let trimmed = text::trim(value);
		if option_values.iter().any(|v| v == trimmed) { trimmed.to_owned() } else { strip_model_value_debris(value) }
	};
	match correct_answer {
		Json::Arr(items) => items.iter().map(|v| clean(v.as_str().unwrap_or_default())).collect(),
		Json::Str(raw) => {
			let trimmed = text::trim(raw);
			// An exact string key can itself look like a JSON array.
			if option_values.iter().any(|v| v == trimmed) {
				return vec![trimmed.to_owned()];
			}
			if trimmed.starts_with('[')
				&& trimmed.ends_with(']')
				&& let Ok(Json::Arr(items)) = parse(trimmed)
			{
				return items.iter().map(|v| clean(&js_string(Some(v)))).collect();
			}
			vec![clean(raw)]
		}
		_ => Vec::new(),
	}
}

/// The quiz authoring contract: option sanity plus a correctAnswer that can be graded. Empty
/// means a quiz the dock can arm and grade faithfully.
pub fn quiz_input_problems(input: &Json) -> Vec<String> {
	let (mut problems, keys) = option_problems(input["options"].as_arr().map_or(&[], Vec::as_slice));
	let mut unique: Vec<String> = Vec::new();
	for entry in coerce_correct_answer(&input["correctAnswer"], &keys) {
		if !unique.contains(&entry) {
			unique.push(entry);
		}
	}
	if unique.is_empty() || unique.iter().any(String::is_empty) {
		problems.push("correctAnswer is required \u{2014} provide the value (or label) of the correct option(s).".to_owned());
		return problems;
	}
	for v in &unique {
		if !keys.contains(v) {
			let valid = keys.iter().map(|k| format!("\"{k}\"")).collect::<Vec<_>>().join(", ");
			problems.push(format!(
				"correctAnswer \"{v}\" does not match any option value. Valid values: {valid}. Copy the exact value (or label) of the intended option \u{2014} never a paraphrase or slug."
			));
		}
	}
	if unique.len() > 1 && input["multiSelect"] != Json::Bool(true) {
		problems.push(format!(
			"correctAnswer lists {} values but multiSelect is not true \u{2014} a single-select question with several correct answers can never be answered correctly. Set multiSelect: true, or make exactly one option correct.",
			unique.len()
		));
	}
	problems
}

/// The explain authoring contract: the commitment must exist.
pub fn explain_input_problems(input: &Json) -> Vec<String> {
	if text::trim(input["correctAnswer"].as_str().unwrap_or_default()).is_empty() {
		return vec!["correctAnswer is required \u{2014} commit to the full correct answer BEFORE posing the question.".to_owned()];
	}
	Vec::new()
}

static QUESTION_ROLE: LazyLock<Json> = LazyLock::new(|| {
	one_of_literals(
		&["predict", "check"],
		"REQUIRED \u{2014} the question's role in the teaching cycle, as a bare word (no quotes): predict = posed BEFORE you teach the step (its own turn; the learner answers, then your teaching resolves it \u{2014} arrives open, never collapsed); check = posed AFTER the step's teaching is complete (arrives collapsed behind the Check your understanding reveal). ONE question per turn either way.",
	)
});

static PLAN_NODE_ID: LazyLock<Json> = LazyLock::new(|| {
	string(
		"REQUIRED plan-tree node id this question is about \u{2014} must EXACTLY match one of this session's plan_init node slugs (validated at call time; a mismatched id is rejected back to you). The lesson's position on the map derives from these tags (the node the latest tagged question is about is where the map stands; earlier ones count as visited). A node takes as many questions as it deserves: stay on one node for as many turns as the understanding needs \u{2014} one reasoning step at a time, never rush forward. For off-map checks use ask_user_question.",
	)
});

const DETAILS: &str = "Optional extra context or instructions shown under the question.";

fn option_label() -> (&'static str, Json) {
	("label", string("Display label for the answer option \u{2014} a bare claim, no reasoning"))
}

fn option_value() -> (&'static str, Json) {
	("value", string("Optional machine-readable value returned for the option. Defaults to the label."))
}

/// The quiz fields the probe and teach tools share. `explanation` sits right before
/// `correctAnswer` because models emit arguments in schema order: reason first, then commit.
fn quiz_fields() -> Vec<(&'static str, Json)> {
	let options = array(
		object(&["label"], vec![option_label(), option_value()]),
		2,
		"REQUIRED. The answer options (2 or more) as a JSON ARRAY of option objects \u{2014} never a JSON-encoded string. Options only \u{2014} there is no free-text mode. Give each option a stable `value`; you reference the correct one by that value in correctAnswer. Never add your own 'I don't know' option \u{2014} that choice is added for you.",
	);
	let correct_answer = json!({
		"anyOf": [{ "type": "string" }, { "type": "array", "items": { "type": "string" } }],
		"description": "REQUIRED. The correct answer as the option value(s) \u{2014} the `value` field of the option you intend. Single-select: a single string (e.g. \"mercury\"). Multi-select: an array of strings (e.g. [\"belize\", \"niue\"]); the learner is only correct if their selection matches this set exactly. Always pass the value, not a position number \u{2014} this is self-checking and prevents miscounting. A value that matches no option fails validation and the call is returned to you to fix.",
	});
	vec![
		("question", string("The single quiz question to ask. ONE question per turn: ask, then end your turn \u{2014} the answer determines the next question.")),
		("options", options),
		("multiSelect", boolean("Set to true when more than one option is correct and the learner must select all of them.")),
		(
			"explanation",
			string("REQUIRED. Explanation revealed AFTER the learner answers (shown whether they got it right or wrong). Use it to reinforce why the correct answer is correct. It is written BEFORE correctAnswer by design: reason it out first, then commit the answer the reasoning supports."),
		),
		("correctAnswer", correct_answer),
		("details", string(DETAILS)),
	]
}

const QUIZ_REQUIRED: [&str; 4] = ["question", "options", "explanation", "correctAnswer"];

/// The teach-side quiz input: the shared fields led by the required `type` and `nodeId` pair,
/// because models drop trailing fields on long calls.
pub fn quiz_input_object() -> Json {
	let mut required = vec!["type", "nodeId"];
	required.extend(QUIZ_REQUIRED);
	let mut fields = vec![("type", QUESTION_ROLE.clone()), ("nodeId", PLAN_NODE_ID.clone())];
	fields.extend(quiz_fields());
	object(&required, fields)
}

/// The Study quiz input: the teach quiz plus `standalone`, which marks a quiz godspeed may ask
/// again weeks later as a question from earlier, `onPlot`, which makes it the guess on the plot
/// sent in the same reply, and `keep`, the sentence he keeps when he answers it right.
pub fn study_quiz_input_object() -> Json {
	let mut schema = quiz_input_object();
	if let Some(properties) = schema.get_mut("properties").and_then(Json::as_obj_mut) {
		properties.insert("standalone", boolean("True when it makes sense weeks later with no lesson around it."));
		let number = |description: &str| json!({ "type": "number", "description": description });
		let on_plot = object(&["line", "x"], vec![("line", string("A line's label.")), ("x", number("The x the guess asks about.")), ("slider", number("The slider value; start if left out."))]);
		properties.insert("onPlot", described(on_plot, "For the plot in this reply: the right option must name this line's value there."));
		properties.insert("keep", keep_schema());
	}
	schema
}

/// The longest kept sentence, analogy line and memory phrase, in UTF-16 units.
const KEEP_TEXT_MAX: usize = 160;
const KEEP_LINE_MAX: usize = 120;
const KEEP_PHRASE_MAX: usize = 60;

fn keep_schema() -> Json {
	let capped = |max: usize, description: &str| json!({ "type": "string", "maxLength": max, "description": description });
	let keep = object(
		&["text"],
		vec![
			("text", capped(KEEP_TEXT_MAX, "The sentence he keeps.")),
			("source", string("A passage id.")),
			("fits", capped(KEEP_LINE_MAX, "With an analogy only: what it gets right.")),
			("stops", capped(KEEP_LINE_MAX, "Required with fits: the first place it breaks.")),
			("phrase", capped(KEEP_PHRASE_MAX, "Optional. A short phrase that makes the sentence easier to remember, like SOH CAH TOA. Words only.")),
		],
	);
	described(keep, "One sentence he earns, shown only after a right answer. At most 2 per topic.")
}

/// A quiz's `keep` as an object: as sent, or decoded when a model sent it as a JSON string.
pub fn keep_of(quiz: &Json) -> Option<Json> {
	match &quiz["keep"] {
		keep @ Json::Obj(_) => Some(keep.clone()),
		Json::Str(raw) => parse(raw).ok().filter(|k| k.as_obj().is_some()),
		_ => None,
	}
}

/// A keep field's words: absent, empty or blank is none; a non-string is Err.
fn keep_words<'a>(keep: &'a Json, field: &str) -> Result<Option<&'a str>, ()> {
	match keep.get(field) {
		None | Some(Json::Null) => Ok(None),
		Some(Json::Str(s)) => Ok(Some(s.as_str()).filter(|s| !text::trim(s).is_empty())),
		Some(_) => Err(()),
	}
}

/// Why a keep is not stored at all, from its own fields: its quiz never fails for it, so the
/// teacher reads this after his answer. None when its fields hold.
pub fn keep_fields_note(keep: &Json) -> Option<String> {
	let not_stored = |why: String| Some(format!("keep not stored: {why}. Add it to a later quiz."));
	if keep.as_obj().is_none() {
		return not_stored("it is not an object with a text".to_owned());
	}
	let mut fits = None;
	for (field, max) in [("text", KEEP_TEXT_MAX), ("source", usize::MAX), ("fits", KEEP_LINE_MAX), ("stops", KEEP_LINE_MAX)] {
		let Ok(words) = keep_words(keep, field) else { return not_stored(format!("{field} is not text")) };
		match words {
			None if field == "text" => return not_stored("it has no text".to_owned()),
			Some(words) if text::len16(words) > max => return not_stored(format!("{field} {} characters, at most {max}", text::len16(words))),
			Some(_) if field == "fits" => fits = words,
			_ => {}
		}
	}
	if fits.is_some() && keep_words(keep, "stops") == Ok(None) {
		return not_stored("fits needs stops".to_owned());
	}
	None
}

/// Why a keep's memory phrase is not shown; the sentence stays.
pub fn keep_phrase_note(keep: &Json) -> Option<String> {
	match keep_words(keep, "phrase") {
		Ok(None) => None,
		Ok(Some(phrase)) if text::len16(phrase) <= KEEP_PHRASE_MAX => None,
		Ok(Some(phrase)) => Some(format!("keep.phrase not shown: {} characters, at most {KEEP_PHRASE_MAX}.", text::len16(phrase))),
		Err(()) => Some("keep.phrase not shown: it is not text.".to_owned()),
	}
}

/// A Study quiz's arguments as its checks read them: a keep that breaks its own rules is taken out
/// (a broken phrase alone loses just the phrase), so the quiz is never refused for it. The stored
/// call keeps what was sent; the teacher learns why after his answer.
pub fn without_broken_keep(mut args: Json) -> Json {
	let Some(keep) = keep_of(&args) else {
		if let Some(obj) = args.as_obj_mut() {
			obj.remove("keep");
		}
		return args;
	};
	let Some(obj) = args.as_obj_mut() else { return args };
	if keep_fields_note(&keep).is_some() {
		obj.remove("keep");
	} else {
		let mut keep = keep;
		if keep_phrase_note(&keep).is_some()
			&& let Some(k) = keep.as_obj_mut()
		{
			k.remove("phrase");
		}
		obj.insert("keep", keep);
	}
	args
}

/// The probe-side quiz input: the shared fields with no map yet, so no `nodeId` and no `type`.
pub fn probe_quiz_input_schema() -> Json {
	object(&QUIZ_REQUIRED, quiz_fields())
}

fn explain_fields() -> Vec<(&'static str, Json)> {
	vec![
		("question", string("The single question to ask. ONE question per turn: ask, then end your turn \u{2014} the answer determines the next.")),
		(
			"correctAnswer",
			string("REQUIRED. The full correct answer in your own words, reasoning included \u{2014} COMMITTED before the learner ever sees the question. The commitment is immutable: when his answer returns, grade it strictly against this text \u{2014} never revise the commitment after seeing his words, and never mark a wrong answer right to be kind. It is shown to him on submit; your next reply grades the nuance of what he wrote."),
		),
		("details", string(DETAILS)),
	]
}

/// The probe-side explain input (free-recall quizzing).
pub fn explain_input_base() -> Json {
	object(&["question", "correctAnswer"], explain_fields())
}

/// The teach-side explain input: the base led by the same `type` and `nodeId` as the quiz.
pub fn explain_input_object() -> Json {
	let mut fields = vec![("type", QUESTION_ROLE.clone()), ("nodeId", PLAN_NODE_ID.clone())];
	fields.extend(explain_fields());
	object(&["type", "nodeId", "question", "correctAnswer"], fields)
}

/// The ask input. There is no `mode`: it follows from whether options are present.
pub fn ask_input_schema() -> Json {
	let option = object(
		&["label"],
		vec![option_label(), option_value(), ("description", string("Optional extra detail shown below the option"))],
	);
	let options = array(
		option,
		2,
		"Optional multiple-choice options. Omit for free-form text input. The learner can always choose 'Other' and type a custom answer when options are provided.",
	);
	object(
		&["question"],
		vec![
			("question", string("The single question to ask the learner. ONE question per turn: ask, then end your turn \u{2014} the answer determines the next question.")),
			("details", string(DETAILS)),
			("options", options),
			("multiSelect", boolean("Set to true to allow multiple answers to the same question.")),
		],
	)
}

#[cfg(test)]
mod tests {
	use gs_json::{json, stringify};

	use super::*;

	#[test]
	fn quiz_types_read_past_debris() {
		assert_eq!(normalize_quiz_type(&json!(" \"predict\"")), Some("predict"));
		assert_eq!(normalize_quiz_type(&json!("check")), Some("check"));
		assert_eq!(normalize_quiz_type(&json!("Predict")), None);
		assert_eq!(normalize_quiz_type(&json!(1)), None);
	}

	#[test]
	fn compact_answer_keeps_the_typescript_order() {
		let ad = json!({ "kind": "quiz", "confidence": 80, "correct": false, "answers": [{ "index": 1, "label": "B", "x": 1 }], "note": "old", "text": "" });
		assert_eq!(stringify(&compact_answer_for_model(&ad)), r#"{"kind":"quiz","answers":[{"index":1,"label":"B"}],"correct":false,"confidence":80,"thinking":"old"}"#);
		assert_eq!(stringify(&compact_answer_for_model(&json!({ "kind": "ask", "dismissed": true, "text": "x" }))), r#"{"kind":"ask","dismissed":true}"#);
		assert_eq!(confidence_level(50.0), 2);
		assert_eq!(confidence_level(f64::NAN), 3);
	}

	#[test]
	fn options_arrive_as_text_sometimes() {
		let text = Json::Str(r#"[{"label":"a"}]"#.to_owned());
		assert_eq!(stringify(&parse_options_if_string(Some(&text)).unwrap()), r#"[{"label":"a"}]"#);
		let junk = Json::Str("not json".to_owned());
		assert_eq!(parse_options_if_string(Some(&junk)), Some(junk.clone()));
		assert_eq!(parse_options_if_string(None), None);
	}

	#[test]
	fn quiz_problems_name_what_is_wrong() {
		let ok = json!({ "options": [{ "label": "A", "value": "a" }, { "label": "B." }], "correctAnswer": ":a" });
		assert!(quiz_input_problems(&ok).is_empty());
		let exact = json!({ "options": [{ "label": "A" }, { "label": "B." }], "correctAnswer": "B." });
		assert!(quiz_input_problems(&exact).is_empty());
		let bad = json!({ "options": [{ "label": " " }, { "label": "A" }, { "label": "A" }], "correctAnswer": ["A", "zzz"] });
		let problems = quiz_input_problems(&bad);
		assert_eq!(problems[0], "options[0].label is empty \u{2014} every option needs a label.");
		assert_eq!(problems[1], "Two options resolve to the same value \"A\" \u{2014} options must be distinct.");
		assert!(problems[2].starts_with("correctAnswer \"zzz\" does not match any option value. Valid values: \"A\", \"A\"."));
		assert!(problems[3].starts_with("correctAnswer lists 2 values but multiSelect is not true"));
		let none = json!({ "options": [{ "label": "A" }, { "label": "B" }], "correctAnswer": "" });
		assert_eq!(quiz_input_problems(&none).len(), 1);
		assert_eq!(coerce_correct_answer(&Json::Str(r#"["a", 2]"#.to_owned()), &[]), ["a", "2"]);
		assert_eq!(explain_input_problems(&json!({ "correctAnswer": "  " })).len(), 1);
		assert!(ask_option_problems(&[json!({ "label": "x" })]).is_empty());
	}

	#[test]
	fn schemas_lead_with_the_required_pair() {
		let quiz = quiz_input_object();
		assert_eq!(stringify(&quiz["required"]), r#"["type","nodeId","question","options","explanation","correctAnswer"]"#);
		assert_eq!(quiz["properties"].as_obj().unwrap().keys().next().map(String::as_str), Some("type"));
		assert_eq!(stringify(&probe_quiz_input_schema()["required"]), r#"["question","options","explanation","correctAnswer"]"#);
		assert_eq!(stringify(&explain_input_base()["required"]), r#"["question","correctAnswer"]"#);
		assert_eq!(stringify(&ask_input_schema()["required"]), r#"["question"]"#);
		assert_eq!(stringify(&explain_input_object()["required"]), r#"["type","nodeId","question","correctAnswer"]"#);
		let study = study_quiz_input_object();
		assert_eq!(study["required"], quiz["required"], "standalone is optional");
		assert_eq!(study["properties"].as_obj().unwrap().keys().rev().take(3).map(String::as_str).collect::<Vec<_>>(), ["keep", "onPlot", "standalone"]);
		assert_eq!(
			stringify(&study["properties"]["onPlot"]),
			r#"{"type":"object","required":["line","x"],"properties":{"line":{"type":"string","description":"A line's label."},"x":{"type":"number","description":"The x the guess asks about."},"slider":{"type":"number","description":"The slider value; start if left out."}},"description":"For the plot in this reply: the right option must name this line's value there."}"#
		);
		assert_eq!(stringify(&study["properties"]["standalone"]), r#"{"type":"boolean","description":"True when it makes sense weeks later with no lesson around it."}"#);
		assert_eq!(study["properties"]["keep"]["required"], json!(["text"]));
		assert_eq!(study["properties"]["keep"]["properties"].as_obj().unwrap().keys().map(String::as_str).collect::<Vec<_>>(), ["text", "source", "fits", "stops", "phrase"]);
	}

	fn keep(fields: Json) -> Json {
		json!({ "question": "Q?", "keep": fields })
	}

	#[test]
	fn a_keep_that_breaks_its_rules_is_taken_out_of_the_prepared_copy() {
		let ok = keep(json!({ "text": "Lambda prices large weights.", "fits": "The leash fits one part.", "stops": "It stops at new data." }));
		assert_eq!(without_broken_keep(ok.clone()), ok);
		let long = keep(json!({ "text": "x".repeat(212) }));
		assert_eq!(keep_fields_note(&long["keep"]).as_deref(), Some("keep not stored: text 212 characters, at most 160. Add it to a later quiz."));
		assert_eq!(without_broken_keep(long), json!({ "question": "Q?" }));
		let alone = keep(json!({ "text": "t", "fits": "f" }));
		assert_eq!(keep_fields_note(&alone["keep"]).as_deref(), Some("keep not stored: fits needs stops. Add it to a later quiz."));
		assert_eq!(keep_fields_note(&json!({ "text": "t", "fits": "f", "stops": "s".repeat(121) })).as_deref(), Some("keep not stored: stops 121 characters, at most 120. Add it to a later quiz."));
		assert_eq!(keep_fields_note(&json!({ "text": " " })).as_deref(), Some("keep not stored: it has no text. Add it to a later quiz."));
		assert_eq!(keep_fields_note(&json!({ "text": "t", "source": 7 })).as_deref(), Some("keep not stored: source is not text. Add it to a later quiz."));
		assert_eq!(keep_fields_note(&json!("t")).as_deref(), Some("keep not stored: it is not an object with a text. Add it to a later quiz."));
		assert_eq!(keep_fields_note(&json!({ "text": "\u{1F600}".repeat(80) })), None, "160 UTF-16 units");
		assert_eq!(without_broken_keep(keep(Json::Null)), json!({ "question": "Q?" }));
		assert_eq!(without_broken_keep(json!({ "question": "Q?" })), json!({ "question": "Q?" }));
	}

	#[test]
	fn a_long_phrase_alone_loses_the_phrase() {
		let args = keep(json!({ "text": "SOH CAH TOA names the ratios.", "phrase": "p".repeat(74) }));
		assert_eq!(keep_phrase_note(&args["keep"]).as_deref(), Some("keep.phrase not shown: 74 characters, at most 60."));
		assert_eq!(keep_fields_note(&args["keep"]), None);
		assert_eq!(without_broken_keep(args), keep(json!({ "text": "SOH CAH TOA names the ratios." })));
		assert_eq!(keep_phrase_note(&json!({ "text": "t", "phrase": "SOH CAH TOA" })), None);
	}

	#[test]
	fn a_keep_sent_as_a_string_is_read_as_its_object() {
		let encoded = json!({ "question": "Q?", "keep": "{\"text\":\"t\"}" });
		assert_eq!(keep_of(&encoded), Some(json!({ "text": "t" })));
		assert_eq!(without_broken_keep(encoded), keep(json!({ "text": "t" })));
		assert_eq!(keep_of(&json!({ "keep": "not json" })), None);
	}
}
