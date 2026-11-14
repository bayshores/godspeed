//! The mock (mock.ts): one timed run of questions like the real thing a prep is for. The teacher
//! writes every question before it starts, the clock then runs with no agent, and the teacher
//! grades everything once it ends. A code question names one function and gives examples, so the
//! learner can run them while the clock runs.
//!
//! A mock is `{ id, n, format, createdAt, questions, answers, startedAt?, endedAt?, grades? }`;
//! a question `{ id, topicId?, title, statement, kind, fn?, examples? }`; an answer
//! `{ text, language?, code?, seconds, submitted }`; a grade `{ verdict, feedback }`.

use std::collections::HashSet;
use std::sync::LazyLock;

use gs_base::re::Re;
use gs_base::{num, text, time};
use gs_json::{Json, Obj, js_number, json, parse, quote};

use crate::records::teaching_areas::one_line;

/// The languages a code question can be answered (and run) in.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MockLanguage {
	Javascript,
	Python,
}

impl MockLanguage {
	/// In MOCK_LANGUAGES' order.
	pub const ALL: [MockLanguage; 2] = [MockLanguage::Javascript, MockLanguage::Python];

	pub fn as_str(self) -> &'static str {
		match self {
			MockLanguage::Javascript => "javascript",
			MockLanguage::Python => "python",
		}
	}

	/// Its name as the pages and the teacher see it (MOCK_LANGUAGES).
	pub fn label(self) -> &'static str {
		match self {
			MockLanguage::Javascript => "JavaScript",
			MockLanguage::Python => "Python",
		}
	}

	/// `isMockLanguage`.
	pub fn parse(v: &Json) -> Option<MockLanguage> {
		v.as_str().and_then(MockLanguage::named)
	}

	fn named(name: &str) -> Option<MockLanguage> {
		MockLanguage::ALL.into_iter().find(|l| l.as_str() == name)
	}
}

/// The record format this build writes, stamped as "version".
pub const MOCK_FORMAT_VERSION: u32 = 1;

const TITLE_MAX: usize = 80;
const STATEMENT_MAX: i64 = 6000;
pub const ANSWER_MAX: usize = 20000;
const FEEDBACK_MAX: i64 = 2000;
const MAX_EXAMPLES: usize = 6;
const MAX_PARAMS: usize = 6;
/// Longest an example's JSON text may be.
const EXAMPLE_MAX: usize = 2000;

/// Names Node gives every file to run: calling one runs something the learner didn't write.
const NODE_FILE_NAMES: [&str; 3] = ["require", "module", "exports"];
/// Words JavaScript or Python keep for themselves: as a name they break the starter code or the
/// runner ("def f(graph, from, to):").
const KEYWORDS: &[&str] = &[
	"await", "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do", "else", "enum", "export", "extends", "false", "finally", "for", "function", "if",
	"implements", "import", "in", "instanceof", "interface", "let", "new", "null", "package", "private", "protected", "public", "return", "static", "super", "switch", "this", "throw",
	"true", "try", "typeof", "var", "void", "while", "with", "yield", "arguments", "eval",
	"False", "None", "True", "and", "as", "assert", "async", "def", "del", "elif", "except", "from", "global", "is", "lambda", "nonlocal", "not", "or", "pass", "raise",
];

/// One name that works in both languages.
fn is_plain_name(name: &str) -> bool {
	static IDENTIFIER: LazyLock<Re> = LazyLock::new(|| Re::new(r"^[A-Za-z_][A-Za-z0-9_]*$", ""));
	IDENTIFIER.test(name) && !KEYWORDS.contains(&name)
}

/// A code question's function name: a plain name that can only be the learner's own function
/// (no dunder or Node file name).
fn is_function_name(name: &str) -> bool {
	is_plain_name(name) && !name.starts_with("__") && !NODE_FILE_NAMES.contains(&name)
}

fn are_params(params: &[&str]) -> bool {
	params.len() <= MAX_PARAMS && params.iter().all(|p| is_plain_name(p)) && params.iter().collect::<HashSet<_>>().len() == params.len()
}

pub fn is_mock_id(id: &str) -> bool {
	static ID: LazyLock<Re> = LazyLock::new(|| Re::new(r"^mock_[a-f0-9]{8}$", ""));
	ID.test(id)
}

pub fn new_mock(id: &str, n: f64, format: &Json, now: &str) -> Json {
	json!({ "id": id, "n": n, "format": format, "createdAt": now, "questions": [], "answers": {} })
}

/// The mock with one field set (a field it has keeps its place, like `{ ...mock, key }`).
fn with(mock: &Json, key: &str, value: Json) -> Json {
	let mut out = mock.as_obj().cloned().unwrap_or_default();
	out.insert(key, value);
	Json::Obj(out)
}

fn items(list: &Json) -> &[Json] {
	list.as_arr().map_or(&[], Vec::as_slice)
}

// ─── where a mock is ─────────────────────────────────────────────────────────

/// Writing: the teacher is writing the questions. Ready: written, not started. Running: the clock
/// runs. Grading: ended, the teacher is grading. Graded: results are in.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MockState {
	Writing,
	Ready,
	Running,
	Grading,
	Graded,
}

impl MockState {
	pub fn as_str(self) -> &'static str {
		match self {
			MockState::Writing => "writing",
			MockState::Ready => "ready",
			MockState::Running => "running",
			MockState::Grading => "grading",
			MockState::Graded => "graded",
		}
	}
}

pub fn mock_state(mock: &Json) -> MockState {
	if items(&mock["questions"]).is_empty() {
		MockState::Writing
	} else if !mock["startedAt"].truthy() {
		MockState::Ready
	} else if !mock["endedAt"].truthy() {
		MockState::Running
	} else if mock["grades"].truthy() {
		MockState::Graded
	} else {
		MockState::Grading
	}
}

/// `Date.parse`, NaN for text it can't read.
fn date_ms(v: &Json) -> f64 {
	v.as_str().and_then(time::parse_date).map_or(f64::NAN, |ms| ms as f64)
}

/// `Math.max(low, x)`: NaN stays NaN.
fn at_least(low: f64, x: f64) -> f64 {
	if x.is_nan() { x } else { x.max(low) }
}

/// Whole seconds left on a running mock's clock (0 once it is over; NaN when its start can't be
/// read, as in Node).
pub fn seconds_left(mock: &Json, now_ms: f64) -> f64 {
	let minutes = mock["format"]["minutes"].as_f64().unwrap_or(f64::NAN);
	if !mock["startedAt"].truthy() {
		return minutes * 60.0;
	}
	let end = date_ms(&mock["startedAt"]) + minutes * 60_000.0;
	at_least(0.0, ((end - now_ms) / 1000.0).ceil())
}

// ─── the teacher's questions ─────────────────────────────────────────────────

fn is_json(text: &str) -> bool {
	parse(text).is_ok()
}

fn example_problem(e: &Json, params: usize) -> Option<String> {
	let (args, expected) = (e["args"].str_or_empty(), e["expected"].str_or_empty());
	if text::len16(args) > EXAMPLE_MAX || text::len16(expected) > EXAMPLE_MAX {
		return Some("an example is too long".to_owned());
	}
	let Ok(parsed) = parse(args) else { return Some(format!("example args {} is not JSON", quote(args))) };
	if parsed.as_arr().is_none_or(|a| a.len() != params) {
		return Some(format!("example args {args} must be a JSON array with one item per parameter ({params})"));
	}
	if !is_json(expected) {
		return Some(format!("example expected {} is not JSON", quote(expected)));
	}
	None
}

fn strings(list: &Json) -> Vec<&str> {
	items(list).iter().map(Json::str_or_empty).collect()
}

/// The teacher's questions (each `{ title, statement, kind, topic_id?, function_name?, params?,
/// examples? }`) as the mock keeps them, or why they can't be kept (said back to the teacher).
/// There must be exactly as many as the mock's format asks for. A topic id the prep doesn't have
/// is dropped.
pub fn take_questions(written: &[Json], format: &Json, topic_ids: &HashSet<String>) -> Result<Vec<Json>, String> {
	let wanted = &format["questions"];
	if wanted.as_f64() != Some(written.len() as f64) {
		return Err(format!("Write exactly {} questions (got {}).", js_number(wanted.as_f64().unwrap_or(f64::NAN)), written.len()));
	}
	let mut out = Vec::new();
	for (i, w) in written.iter().enumerate() {
		let at = format!("Question {}", i + 1);
		let title = one_line(w["title"].str_or_empty(), TITLE_MAX);
		let statement = text::slice16(text::trim(w["statement"].str_or_empty()), 0, Some(STATEMENT_MAX));
		if title.is_empty() {
			return Err(format!("{at}: title is empty."));
		}
		if statement.is_empty() {
			return Err(format!("{at}: statement is empty."));
		}
		let mut q = Obj::new();
		q.insert("id", format!("q{}", i + 1));
		if let Some(topic) = w["topic_id"].as_str().filter(|t| !t.is_empty() && topic_ids.contains(*t)) {
			q.insert("topicId", topic);
		}
		q.insert("title", title);
		q.insert("statement", statement);
		if w["kind"].as_str() == Some("text") {
			q.insert("kind", "text");
			out.push(Json::Obj(q));
			continue;
		}
		let name = w["function_name"].as_str().unwrap_or("");
		let params = strings(&w["params"]);
		let examples = items(&w["examples"]);
		if !is_function_name(name) {
			return Err(format!(
				"{at}: function_name must be one plain name (letters, digits, _, not starting with __) that works in JavaScript and Python: not a keyword of either, and not require, module or exports."
			));
		}
		if !are_params(&params) {
			return Err(format!("{at}: params must be up to {MAX_PARAMS} different plain names, none a keyword in JavaScript or Python (say start and end, not from and to)."));
		}
		if examples.len() < 2 || examples.len() > MAX_EXAMPLES {
			return Err(format!("{at}: give 2 to {MAX_EXAMPLES} examples."));
		}
		if let Some(problem) = examples.iter().find_map(|e| example_problem(e, params.len())) {
			return Err(format!("{at}: {problem}."));
		}
		q.insert("kind", "code");
		q.insert("fn", json!({ "name": name, "params": params }));
		let examples: Vec<Json> = examples.iter().map(|e| json!({ "args": text::trim(e["args"].str_or_empty()), "expected": text::trim(e["expected"].str_or_empty()) })).collect();
		q.insert("examples", examples);
		out.push(Json::Obj(q));
	}
	Ok(out)
}

/// What the editor starts with for a code question (`function` is its `fn`).
pub fn starter_code(function: &Json, language: MockLanguage) -> String {
	let (name, params) = (function["name"].str_or_empty(), strings(&function["params"]).join(", "));
	match language {
		MockLanguage::Python => format!("def {name}({params}):\n    pass\n"),
		MockLanguage::Javascript => format!("function {name}({params}) {{\n\t\n}}\n"),
	}
}

// ─── taking it ───────────────────────────────────────────────────────────────

pub fn start_mock(mock: &Json, now: &str) -> Json {
	if mock_state(mock) == MockState::Ready { with(mock, "startedAt", Json::from(now)) } else { mock.clone() }
}

/// A code answer's code by language, from anything: strings in known languages only, each cut to
/// the longest answer.
pub fn parse_mock_code(raw: &Json) -> Json {
	let mut out = Obj::new();
	for (language, code) in raw.as_obj().into_iter().flatten() {
		if let (Some(language), Some(code)) = (MockLanguage::named(language), code.as_str()) {
			out.insert(language.as_str(), text::slice16(code, 0, Some(ANSWER_MAX as i64)));
		}
	}
	Json::Obj(out)
}

/// A running mock with one question's answer saved (unknown questions and mocks that aren't
/// running are left alone). A code answer's text is its code in the picked language, so what is
/// graded is what was picked; with nothing written in it, the language that has code is graded
/// instead, so looking at the other one never blanks an answer.
pub fn with_answer(mock: &Json, question_id: &str, answer: &Json) -> Json {
	let question = items(&mock["questions"]).iter().find(|q| q["id"].as_str() == Some(question_id));
	let Some(question) = question.filter(|_| mock_state(mock) == MockState::Running) else { return mock.clone() };
	let seconds = at_least(0.0, num::math_round(answer["seconds"].as_f64().unwrap_or(f64::NAN)));
	let submitted = answer["submitted"].clone();
	let kept = if question["kind"].as_str() == Some("code") {
		let code = parse_mock_code(&answer["code"]);
		let written = |l: Option<MockLanguage>| l.is_some_and(|l| !text::trim(code[l.as_str()].str_or_empty()).is_empty());
		let picked = MockLanguage::parse(&answer["language"]);
		let language = if written(picked) { picked } else { MockLanguage::ALL.into_iter().find(|l| written(Some(*l))).or(picked) };
		let mut kept = Obj::new();
		kept.insert("text", language.and_then(|l| code[l.as_str()].as_str()).unwrap_or(""));
		if let Some(language) = language {
			kept.insert("language", language.as_str());
		}
		kept.insert("code", code);
		kept.insert("seconds", seconds);
		kept.insert("submitted", submitted);
		Json::Obj(kept)
	} else {
		json!({ "text": text::slice16(answer["text"].str_or_empty(), 0, Some(ANSWER_MAX as i64)), "seconds": seconds, "submitted": submitted })
	};
	let mut answers = mock["answers"].as_obj().cloned().unwrap_or_default();
	answers.insert(question_id, kept);
	with(mock, "answers", Json::Obj(answers))
}

pub fn end_mock(mock: &Json, now: &str) -> Json {
	if mock_state(mock) == MockState::Running { with(mock, "endedAt", Json::from(now)) } else { mock.clone() }
}

/// Something was written for the question (`answer` is Null when there is none).
pub fn is_answered(answer: &Json) -> bool {
	!answer.is_null() && !text::trim(answer["text"].str_or_empty()).is_empty()
}

// ─── the teacher's grades ────────────────────────────────────────────────────

/// The ended mock with its grades (each written `{ question, verdict, feedback }`), or why they
/// can't be kept: every answered question needs one (blank ones are never graded).
pub fn with_grades(mock: &Json, written: &[Json]) -> Result<Json, String> {
	let mut grades = Obj::new();
	for q in items(&mock["questions"]) {
		let id = q["id"].str_or_empty();
		if !is_answered(&mock["answers"][id]) {
			continue;
		}
		let Some(grade) = written.iter().find(|g| g["question"].as_str() == Some(id)) else { return Err(format!("No grade for {id}: grade every answered question.")) };
		let feedback = text::slice16(text::trim(grade["feedback"].str_or_empty()), 0, Some(FEEDBACK_MAX));
		if feedback.is_empty() {
			return Err(format!("The feedback for {id} is empty."));
		}
		grades.insert(id, json!({ "verdict": grade["verdict"], "feedback": feedback }));
	}
	Ok(with(mock, "grades", Json::Obj(grades)))
}

/// How one question went: its grade's verdict, or "blank" when nothing was written for it. None
/// before the mock is graded.
pub fn question_result<'a>(mock: &'a Json, question_id: &str) -> Option<&'a str> {
	if !mock["grades"].truthy() {
		return None;
	}
	Some(mock["grades"][question_id]["verdict"].as_str().unwrap_or("blank"))
}

/// A graded mock's questions as answers for the prep's topics (`{ nodeId?, outcome, answeredAt }`),
/// given when it ended: right is right, a blank one is "I don't know", anything else is wrong.
pub fn mock_answers(mock: &Json) -> Vec<Json> {
	items(&mock["questions"])
		.iter()
		.filter_map(|q| {
			let result = question_result(mock, q["id"].str_or_empty())?;
			let ended = mock["endedAt"].as_str().filter(|e| !e.is_empty())?;
			let outcome = match result {
				"right" => "right",
				"blank" => "dontKnow",
				_ => "wrong",
			};
			let mut answer = Obj::new();
			if q["topicId"].truthy() {
				answer.insert("nodeId", q["topicId"].clone());
			}
			answer.insert("outcome", outcome);
			answer.insert("answeredAt", ended);
			Some(Json::Obj(answer))
		})
		.collect()
}

/// Whole minutes an ended mock took, at most its format's; None before it ends.
pub fn minutes_used(mock: &Json) -> Option<f64> {
	if !mock["startedAt"].truthy() || !mock["endedAt"].truthy() {
		return None;
	}
	let minutes = at_least(1.0, ((date_ms(&mock["endedAt"]) - date_ms(&mock["startedAt"])) / 60_000.0).ceil());
	let most = mock["format"]["minutes"].as_f64().unwrap_or(f64::NAN);
	Some(if minutes.is_nan() || most.is_nan() { f64::NAN } else { most.min(minutes) })
}

/// How many questions a graded mock got right.
pub fn solved_count(mock: &Json) -> usize {
	items(&mock["questions"]).iter().filter(|q| question_result(mock, q["id"].str_or_empty()) == Some("right")).count()
}

// ─── what the pages show ─────────────────────────────────────────────────────

/// A mock as a row on its prep's pages: `working` while the teacher writes or grades it, `error`
/// the last failure.
pub fn mock_summary(mock: &Json, working: bool, error: Option<&str>) -> Json {
	let state = mock_state(mock);
	let mut out = Obj::new();
	out.insert("id", mock["id"].clone());
	out.insert("n", mock["n"].clone());
	out.insert("state", state.as_str());
	out.insert("format", mock["format"].clone());
	out.insert("createdAt", mock["createdAt"].clone());
	for key in ["startedAt", "endedAt"] {
		if mock[key].truthy() {
			out.insert(key, mock[key].clone());
		}
	}
	if state == MockState::Graded {
		out.insert("solved", solved_count(mock));
	}
	out.insert("working", working);
	if let Some(error) = error.filter(|e| !e.is_empty()) {
		out.insert("error", error);
	}
	Json::Obj(out)
}

/// A mock as its own page shows it.
pub struct MockView {
	pub space_id: String,
	/// Its prep's name.
	pub prep_name: Json,
	pub mock: Json,
	/// The prep's topics (`{ id, name }`), for naming what to fix.
	pub topics: Vec<Json>,
	/// The teacher is writing or grading it now.
	pub working: bool,
	/// Why the last write or grading failed.
	pub error: Option<String>,
}

impl MockView {
	pub fn to_json(&self) -> Json {
		let mut out = Obj::new();
		out.insert("spaceId", self.space_id.as_str());
		out.insert("prepName", self.prep_name.clone());
		out.insert("mock", self.mock.clone());
		out.insert("topics", self.topics.clone());
		out.insert("working", self.working);
		if let Some(error) = self.error.as_deref().filter(|e| !e.is_empty()) {
			out.insert("error", error);
		}
		Json::Obj(out)
	}
}

// ─── reading a saved one ─────────────────────────────────────────────────────

fn parse_question(raw: &Json) -> Option<Json> {
	raw.as_obj()?;
	let (id, title, statement) = (raw["id"].as_str()?, raw["title"].as_str()?, raw["statement"].as_str()?);
	let mut q = Obj::new();
	q.insert("id", id);
	if let Some(topic) = raw["topicId"].as_str() {
		q.insert("topicId", topic);
	}
	q.insert("title", title);
	q.insert("statement", statement);
	match raw["kind"].as_str() {
		Some("text") => {
			q.insert("kind", "text");
			return Some(Json::Obj(q));
		}
		Some("code") => {}
		_ => return None,
	}
	let function = &raw["fn"];
	function.as_obj()?;
	let (name, params) = (function["name"].as_str()?, function["params"].as_arr()?);
	let examples = raw["examples"].as_arr()?;
	let params: Vec<&str> = params.iter().filter_map(Json::as_str).collect();
	// The name and params go into the program that runs the learner's code.
	if !is_function_name(name) || !are_params(&params) {
		return None;
	}
	let examples: Vec<Json> = examples
		.iter()
		.filter(|e| e.as_obj().is_some())
		.filter_map(|e| Some(json!({ "args": e["args"].as_str()?, "expected": e["expected"].as_str()? })))
		.collect();
	q.insert("kind", "code");
	q.insert("fn", json!({ "name": name, "params": params }));
	q.insert("examples", examples);
	Some(Json::Obj(q))
}

fn parse_answers(raw: &Json) -> Json {
	let mut out = Obj::new();
	for (id, a) in raw.as_obj().into_iter().flatten() {
		let Some(text) = a.as_obj().and(a["text"].as_str()) else { continue };
		let mut answer = Obj::new();
		answer.insert("text", text);
		if let Some(language) = MockLanguage::parse(&a["language"]) {
			answer.insert("language", language.as_str());
		}
		if a["code"].as_obj().is_some() {
			answer.insert("code", parse_mock_code(&a["code"]));
		}
		answer.insert("seconds", a["seconds"].as_f64().filter(|s| *s >= 0.0).unwrap_or(0.0));
		answer.insert("submitted", a["submitted"] == Json::Bool(true));
		out.insert(id.as_str(), answer);
	}
	Json::Obj(out)
}

fn parse_grades(raw: &Json) -> Option<Json> {
	let mut out = Obj::new();
	for (id, g) in raw.as_obj()? {
		let verdict = g["verdict"].as_str().filter(|v| matches!(*v, "right" | "partly" | "wrong"));
		let (Some(_), Some(feedback), Some(verdict)) = (g.as_obj(), g["feedback"].as_str(), verdict) else { continue };
		out.insert(id.as_str(), json!({ "verdict": verdict, "feedback": feedback }));
	}
	Some(Json::Obj(out))
}

/// What a saved mock file holds.
#[derive(Debug, PartialEq)]
pub enum ParsedMock {
	Mock(Json),
	/// A newer build saved it.
	Newer,
}

/// A saved mock; None when it isn't one.
pub fn parse_mock(raw: &Json) -> Option<ParsedMock> {
	raw.as_obj()?;
	if raw["version"].as_f64().is_some_and(|v| v > f64::from(MOCK_FORMAT_VERSION)) {
		return Some(ParsedMock::Newer);
	}
	let format = &raw["format"];
	let id = raw["id"].as_str().filter(|id| is_mock_id(id))?;
	let (n, created) = (raw["n"].as_f64()?, raw["createdAt"].as_str()?);
	format.as_obj()?;
	let (questions, minutes) = (format["questions"].as_f64()?, format["minutes"].as_f64()?);
	let mut mock = Obj::new();
	mock.insert("id", id);
	mock.insert("n", n);
	mock.insert("format", json!({ "questions": questions, "minutes": minutes }));
	mock.insert("createdAt", created);
	mock.insert("questions", items(&raw["questions"]).iter().filter_map(parse_question).collect::<Vec<_>>());
	mock.insert("answers", parse_answers(&raw["answers"]));
	for key in ["startedAt", "endedAt"] {
		if let Some(at) = raw[key].as_str() {
			mock.insert(key, at);
		}
	}
	if let Some(grades) = parse_grades(&raw["grades"]) {
		mock.insert("grades", grades);
	}
	Some(ParsedMock::Mock(Json::Obj(mock)))
}

#[cfg(test)]
#[path = "mock_tests.rs"]
mod tests;
