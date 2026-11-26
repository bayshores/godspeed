//! A lesson turn's agent session events as the record's messages: one assistant message per model
//! step (its text and godspeed tool calls, its stop reason and usage), each call's `toolResult`,
//! and the markers steered in. It sends the same events the turn stream always sent, so the
//! lesson page and the settled record read as before. The agent's own tools are not part of it.

use gs_base::clock;
use gs_json::{Json, json};
use gs_runtime::{End, Usage};

use gs_core::messages::role::Role;
use super::events::AgentEvent;
use super::messages::tool_calls;

/// The assistant message being written, and the results of its calls so far.
struct Step {
	message: Json,
	/// Its `message_start` went out.
	shown: bool,
	/// A result came in: the message is whole, and new words or calls start the next step.
	closed: bool,
	/// Its `turn_end` went out, once every call in it had its result.
	ended: bool,
	results: Vec<Json>,
	/// The last text block still grows with deltas; its whole, checked text comes at its end.
	open_text: bool,
	/// Where its message goes in the turn's messages.
	from: usize,
}

pub struct TranscriptBuilder {
	/// The model record whose ids the assistant messages carry.
	model: Json,
	messages: Vec<Json>,
	step: Option<Step>,
	/// Model calls' usage not yet on a message.
	usage: Option<Usage>,
	/// Markers steered in, placed at the next step's start.
	steered: Vec<Json>,
	/// Calls held out of the record until a later call releases them.
	aside: Vec<Json>,
	/// Calls that may be held, kept out of what is shown until their result says they are not.
	undecided: Vec<String>,
}

/// `message` as the window may see it: without the calls not yet decided.
fn shown(undecided: &[String], message: &Json) -> Json {
	if undecided.is_empty() {
		return message.clone();
	}
	let mut message = message.clone();
	if let Some(blocks) = message.get_mut("content").and_then(Json::as_arr_mut) {
		blocks.retain(|b| !b["id"].as_str().is_some_and(|id| undecided.iter().any(|u| u == id)));
	}
	message
}

/// pi's usage record: fresh input, cached reads and output; godspeed's agents bill a plan, so
/// every cost is zero.
pub fn usage_json(usage: Usage) -> Json {
	let fresh = usage.input.saturating_sub(usage.cached);
	json!({
		"input": fresh,
		"output": usage.output,
		"cacheRead": usage.cached,
		"cacheWrite": 0,
		"totalTokens": usage.input + usage.output,
		"cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0 },
	})
}

impl TranscriptBuilder {
	pub fn new(model: Json) -> TranscriptBuilder {
		TranscriptBuilder { model, messages: Vec::new(), step: None, usage: None, steered: Vec::new(), aside: Vec::new(), undecided: Vec::new() }
	}

	/// The turn's messages so far.
	pub fn messages(&self) -> &[Json] {
		&self.messages
	}

	/// The assistant message being written, if any.
	pub fn reply(&self) -> Option<&Json> {
		self.step.as_ref().map(|step| &step.message)
	}

	/// The turn's messages before the one being written. A later call of a step reads these, not
	/// its own message and the results of the calls before it.
	pub fn before_reply(&self) -> &[Json] {
		&self.messages[..self.step.as_ref().map_or(self.messages.len(), |step| step.from)]
	}

	pub fn start(&self, emit: &mut dyn FnMut(AgentEvent)) {
		emit(AgentEvent::AgentStart);
		emit(AgentEvent::TurnStart);
	}

	fn new_message(&self) -> Json {
		json!({
			"role": Role::Assistant.as_str(),
			"content": [],
			"api": self.model["api"].clone(),
			"provider": self.model["provider"].clone(),
			"model": self.model["id"].clone(),
			"stopReason": "pending",
			"timestamp": clock::now_ms(),
		})
	}

	/// The step new words or calls go into: the open one, or a new one after a closed one.
	fn writing(&mut self, emit: &mut dyn FnMut(AgentEvent)) -> &mut Step {
		if self.step.as_ref().is_some_and(|step| step.closed) {
			self.end_step(emit);
			emit(AgentEvent::TurnStart);
		}
		if self.step.is_none() {
			for marker in std::mem::take(&mut self.steered) {
				emit(AgentEvent::MessageStart(marker.clone()));
				emit(AgentEvent::MessageEnd(marker.clone()));
				self.messages.push(marker);
			}
			self.step = Some(Step { message: self.new_message(), shown: false, closed: false, ended: false, results: Vec::new(), open_text: false, from: self.messages.len() });
		}
		self.step.as_mut().expect("just made")
	}

	fn show(&mut self, emit: &mut dyn FnMut(AgentEvent)) {
		let Some(step) = self.step.as_mut() else { return };
		let message = shown(&self.undecided, &step.message);
		let event = if step.shown { AgentEvent::MessageUpdate(message) } else { AgentEvent::MessageStart(message) };
		step.shown = true;
		emit(event);
	}

	fn blocks(step: &mut Step) -> &mut Vec<Json> {
		step.message.get_mut("content").and_then(Json::as_arr_mut).expect("content is a list")
	}

	/// A piece of the reply's words as they are written.
	pub fn delta(&mut self, text: &str, emit: &mut dyn FnMut(AgentEvent)) {
		let step = self.writing(emit);
		if !step.open_text {
			Self::blocks(step).push(json!({ "type": "text", "text": "" }));
			step.open_text = true;
		}
		if let Some(block) = Self::blocks(step).last_mut() {
			let grown = format!("{}{text}", block["text"].str_or_empty());
			block.set("text", grown);
		}
		self.show(emit);
	}

	/// One message's whole words, checked: they replace what streamed.
	pub fn text_done(&mut self, text: String, emit: &mut dyn FnMut(AgentEvent)) {
		let step = self.writing(emit);
		if step.open_text {
			if let Some(block) = Self::blocks(step).last_mut() {
				block.set("text", text);
			}
		} else {
			Self::blocks(step).push(json!({ "type": "text", "text": text }));
		}
		step.open_text = false;
		self.show(emit);
	}

	/// A godspeed call in the reply being written, as a `toolCall` block. A call the step already
	/// holds (its calls come first, then each runs) is not added twice. One that `may_hold` is not
	/// shown until `decide` says it is not held.
	pub fn tool_call(&mut self, id: &str, name: &str, args: &Json, may_hold: bool, emit: &mut dyn FnMut(AgentEvent)) -> Json {
		// The step may be closed already by an earlier call's result; its calls are still its own.
		let held = self.step.as_mut().and_then(|step| Self::blocks(step).iter().find(|b| b["type"].as_str() == Some("toolCall") && b["id"].as_str() == Some(id)).cloned());
		if let Some(block) = held {
			return block;
		}
		let block = json!({ "type": "toolCall", "id": id, "name": name, "arguments": args.clone() });
		if may_hold {
			self.undecided.push(id.to_owned());
		}
		let step = self.writing(emit);
		step.open_text = false;
		Self::blocks(step).push(block.clone());
		self.show(emit);
		block
	}

	/// A call that may be held is not: it is shown from now on.
	pub fn decide(&mut self, id: &str) {
		self.undecided.retain(|u| u != id);
	}

	/// The turn ends, so the calls not yet decided never run: they are shown as they are.
	pub fn decide_all(&mut self) {
		self.undecided.clear();
	}

	/// Takes a held call out of the reply being written. It comes back with `release`, or never.
	pub fn set_aside(&mut self, id: &str, emit: &mut dyn FnMut(AgentEvent)) {
		self.decide(id);
		if let Some(Some(block)) = self.edit_reply(|blocks| blocks.iter().position(|b| b["id"].as_str() == Some(id)).map(|at| blocks.remove(at))) {
			self.aside.push(block);
			self.show_open(emit);
		}
		self.end_when_whole(emit);
	}

	/// Puts a call set aside back into the reply being written, right before its call `before`,
	/// and returns it.
	pub fn release(&mut self, id: &str, before: &str, emit: &mut dyn FnMut(AgentEvent)) -> Option<Json> {
		let block = self.aside.remove(self.aside.iter().position(|b| b["id"].as_str() == Some(id))?);
		self.edit_reply(|blocks| {
			let at = blocks.iter().position(|b| b["id"].as_str() == Some(before)).unwrap_or(blocks.len());
			blocks.insert(at, block.clone());
		})?;
		self.show_open(emit);
		Some(block)
	}

	/// Changes the reply being written's blocks, and its copy in the turn's messages once it is
	/// whole.
	fn edit_reply<T>(&mut self, mut change: impl FnMut(&mut Vec<Json>) -> T) -> Option<T> {
		let step = self.step.as_mut()?;
		let out = change(Self::blocks(step));
		if step.closed
			&& let Some(blocks) = self.messages.get_mut(step.from).and_then(|m| m.get_mut("content")).and_then(Json::as_arr_mut)
		{
			change(blocks);
		}
		Some(out)
	}

	/// Shows the reply being written again, while it is still open.
	fn show_open(&mut self, emit: &mut dyn FnMut(AgentEvent)) {
		if self.step.as_ref().is_some_and(|step| !step.closed) {
			self.show(emit);
		}
	}

	pub fn usage(&mut self, usage: Usage) {
		let held = self.usage.get_or_insert_default();
		held.input += usage.input;
		held.cached += usage.cached;
		held.output += usage.output;
	}

	/// Ends the open step's message with `stop` and its usage, and says so.
	fn close(&mut self, stop: &str, error: Option<&str>, emit: &mut dyn FnMut(AgentEvent)) {
		let usage = self.usage.take();
		let Some(step) = self.step.as_mut().filter(|step| !step.closed) else { return };
		if let Some(o) = step.message.as_obj_mut() {
			if let Some(usage) = usage {
				o.insert("usage", usage_json(usage));
			}
			o.insert("stopReason", stop);
			if let Some(error) = error {
				o.insert("errorMessage", error);
			}
		}
		step.closed = true;
		step.open_text = false;
		let message = shown(&self.undecided, &step.message);
		if !step.shown {
			emit(AgentEvent::MessageStart(message.clone()));
		}
		emit(AgentEvent::MessageEnd(message));
		self.messages.push(step.message.clone());
	}

	/// A call's result message: the message with the call is whole now.
	pub fn tool_result(&mut self, result: Json, emit: &mut dyn FnMut(AgentEvent)) {
		self.close("toolUse", None, emit);
		emit(AgentEvent::MessageStart(result.clone()));
		emit(AgentEvent::MessageEnd(result.clone()));
		if let Some(step) = self.step.as_mut() {
			step.results.push(result.clone());
		}
		self.messages.push(result);
		self.end_when_whole(emit);
	}

	/// The step's `turn_end` goes out as soon as every call in it has its result, not when the
	/// agent next writes: the window takes the results from it, and the agent may think a while.
	fn end_when_whole(&mut self, emit: &mut dyn FnMut(AgentEvent)) {
		let Some(step) = self.step.as_mut().filter(|step| step.closed && !step.ended) else { return };
		if tool_calls(&step.message).iter().all(|call| step.results.iter().any(|r| r["toolCallId"] == call["id"])) {
			step.ended = true;
			emit(AgentEvent::TurnEnd { message: shown(&self.undecided, &step.message), tool_results: step.results.clone() });
		}
	}

	/// One of the agent's own turns ended and another follows (a steer sent after it): the reply
	/// being written ends here, so the next one starts a new message after the steered markers.
	pub fn end_reply(&mut self, emit: &mut dyn FnMut(AgentEvent)) {
		self.close("stop", None, emit);
	}

	/// A marker steered into the turn: it goes in where the next step starts.
	pub fn steer(&mut self, marker: Json) {
		self.steered.push(marker);
	}

	fn end_step(&mut self, emit: &mut dyn FnMut(AgentEvent)) {
		if let Some(step) = self.step.take()
			&& !step.ended
		{
			emit(AgentEvent::TurnEnd { message: shown(&self.undecided, &step.message), tool_results: step.results });
		}
	}

	/// The turn ended: the reply being written ends as `end` says (a stopped one keeps what was
	/// written), markers steered in go last, and every message of the turn goes out once more.
	pub fn finish(&mut self, end: &End, emit: &mut dyn FnMut(AgentEvent)) -> Vec<Json> {
		self.decide_all();
		let open = self.step.as_ref().is_some_and(|step| !step.closed);
		let (stop, error) = match end {
			End::Completed => ("stop", None),
			End::Interrupted => ("aborted", Some("Request was aborted")),
			End::Failed(why) => ("error", Some(why.as_str())),
		};
		// A stop or a failure always leaves its message, empty as it may be; a reply that ended
		// at its last result has none left to write.
		if open || !matches!(end, End::Completed) || (self.step.is_none() && !self.messages.iter().any(|m| Role::Assistant.is(m))) {
			self.writing(emit);
			self.close(stop, error, emit);
		}
		self.end_step(emit);
		for marker in std::mem::take(&mut self.steered) {
			emit(AgentEvent::MessageStart(marker.clone()));
			emit(AgentEvent::MessageEnd(marker.clone()));
			self.messages.push(marker);
		}
		emit(AgentEvent::AgentEnd { messages: self.messages.clone() });
		self.messages.clone()
	}
}

/// Whether the turn wrote anything: words or a call.
pub fn wrote_anything(messages: &[Json]) -> bool {
	messages.iter().any(|m| has_words(m) || (Role::Assistant.is(m) && !tool_calls(m).is_empty()))
}

/// Whether this is an assistant message holding some of the agent's words.
pub fn has_words(message: &Json) -> bool {
	Role::Assistant.is(message) && message["content"].items().iter().any(|b| !b["text"].str_or_empty().is_empty())
}

#[cfg(test)]
mod tests {
	use super::*;

	fn played(play: impl FnOnce(&mut TranscriptBuilder, &mut dyn FnMut(AgentEvent)) -> Vec<Json>) -> (Vec<String>, Vec<Json>) {
		let mut builder = TranscriptBuilder::new(json!({ "api": "godspeed-agent", "provider": "agent", "id": "outside-agent" }));
		let mut events = Vec::new();
		let messages = play(&mut builder, &mut |event: AgentEvent| events.push(event.to_json()["type"].str_or_empty().to_owned()));
		(events, messages)
	}

	#[test]
	fn words_a_call_its_result_and_more_words_make_two_steps() {
		let (events, messages) = played(|b, emit| {
			b.start(emit);
			b.delta("Two ", emit);
			b.delta("plus two", emit);
			b.text_done("Two plus two.".to_owned(), emit);
			b.usage(Usage { input: 100, cached: 60, output: 10 });
			b.tool_call("c1", "quiz", &json!({ "question": "?" }), false, emit);
			b.tool_result(json!({ "role": "toolResult", "toolCallId": "c1", "toolName": "quiz", "content": [], "isError": false }), emit);
			b.delta("More.", emit);
			b.finish(&End::Completed, emit)
		});
		assert_eq!(
			events,
			["agent_start", "turn_start", "message_start", "message_update", "message_update", "message_update", "message_end", "message_start", "message_end", "turn_end", "turn_start", "message_start", "message_end", "turn_end", "agent_end"]
		);
		assert_eq!(messages.len(), 3);
		assert_eq!(messages[0]["content"], json!([{ "type": "text", "text": "Two plus two." }, { "type": "toolCall", "id": "c1", "name": "quiz", "arguments": { "question": "?" } }]));
		assert_eq!((messages[0]["stopReason"].as_str(), messages[0]["usage"]["input"].as_f64(), messages[0]["usage"]["cacheRead"].as_f64()), (Some("toolUse"), Some(40.0), Some(60.0)));
		assert_eq!((messages[2]["stopReason"].as_str(), messages[2]["content"][0]["text"].as_str()), (Some("stop"), Some("More.")));
		assert!(messages[2].get("usage").is_none(), "missing usage stays missing");
	}

	#[test]
	fn a_step_ends_once_its_calls_all_have_results_not_when_the_agent_writes_on() {
		// The window reads a step's results from its turn_end: a conclusion that waited there for
		// the agent's next words left the problem open beside its own conclusion.
		let events = std::cell::RefCell::new(Vec::<Json>::new());
		let mut emit = |event: AgentEvent| events.borrow_mut().push(event.to_json());
		let turn_ends = || events.borrow().iter().filter(|e| e["type"].as_str() == Some("turn_end")).cloned().collect::<Vec<_>>();
		let mut b = TranscriptBuilder::new(json!({}));
		b.start(&mut emit);
		b.tool_call("c1", "conclude", &json!({}), false, &mut emit);
		b.tool_call("c2", "set_space_note", &json!({}), false, &mut emit);
		b.tool_result(json!({ "role": "toolResult", "toolCallId": "c1" }), &mut emit);
		assert!(turn_ends().is_empty(), "c2 still runs");
		b.tool_result(json!({ "role": "toolResult", "toolCallId": "c2" }), &mut emit);
		let ended = turn_ends();
		assert_eq!(ended.len(), 1, "both results are in");
		assert_eq!(ended[0]["toolResults"].items().iter().map(|r| r["toolCallId"].str_or_empty()).collect::<Vec<_>>(), ["c1", "c2"]);
		b.text_done("Done.".to_owned(), &mut emit);
		b.finish(&End::Completed, &mut emit);
		assert_eq!(turn_ends().len(), 2, "one per step");
	}

	#[test]
	fn a_turn_ended_by_its_question_leaves_no_empty_reply_and_a_stopped_one_does() {
		let (_, asked) = played(|b, emit| {
			b.start(emit);
			b.tool_call("q1", "quiz", &json!({}), false, emit);
			b.tool_result(json!({ "role": "toolResult", "toolCallId": "q1" }), emit);
			b.finish(&End::Completed, emit)
		});
		assert_eq!(asked.len(), 2);
		let (_, stopped) = played(|b, emit| {
			b.start(emit);
			b.delta("Half a", emit);
			b.finish(&End::Interrupted, emit)
		});
		assert_eq!((stopped[0]["stopReason"].as_str(), stopped[0]["content"][0]["text"].as_str()), (Some("aborted"), Some("Half a")));
		let (_, failed) = played(|b, emit| {
			b.start(emit);
			b.finish(&End::Failed("overloaded".to_owned()), emit)
		});
		assert_eq!((failed[0]["stopReason"].as_str(), failed[0]["errorMessage"].as_str(), failed[0]["content"].clone()), (Some("error"), Some("overloaded"), json!([])));
		assert!(!wrote_anything(&failed));
	}

	#[test]
	fn a_marker_steered_in_goes_where_the_next_step_starts() {
		let (_, messages) = played(|b, emit| {
			b.start(emit);
			b.tool_call("c1", "read_space", &json!({}), false, emit);
			b.steer(json!({ "id": "steer_1", "role": "user", "content": "also this" }));
			b.tool_result(json!({ "role": "toolResult", "toolCallId": "c1" }), emit);
			b.text_done("Done.".to_owned(), emit);
			b.finish(&End::Completed, emit)
		});
		let roles: Vec<&str> = messages.iter().map(|m| m["role"].str_or_empty()).collect();
		assert_eq!(roles, ["assistant", "toolResult", "user", "assistant"]);
	}

	#[test]
	fn the_later_calls_of_a_step_stay_in_its_message_and_read_only_what_came_before_it() {
		let (_, messages) = played(|b, emit| {
			b.start(emit);
			b.text_done("Two looks.".to_owned(), emit);
			b.tool_call("c1", "read_space", &json!({}), false, emit);
			b.tool_call("c2", "read_space", &json!({}), false, emit);
			b.tool_result(json!({ "role": "toolResult", "toolCallId": "c1" }), emit);
			b.tool_call("c2", "read_space", &json!({}), false, emit);
			assert!(b.before_reply().is_empty(), "c2's check reads no copy of its own step");
			assert_eq!(b.reply().unwrap()["content"].items().len(), 3);
			b.tool_result(json!({ "role": "toolResult", "toolCallId": "c2" }), emit);
			b.finish(&End::Completed, emit)
		});
		let roles: Vec<&str> = messages.iter().map(|m| m["role"].str_or_empty()).collect();
		assert_eq!(roles, ["assistant", "toolResult", "toolResult"]);
	}

	#[test]
	fn a_call_that_may_be_held_is_shown_only_once_decided() {
		let mut builder = TranscriptBuilder::new(json!({}));
		let mut shown_calls: Vec<Vec<String>> = Vec::new();
		let mut emit = |event: AgentEvent| {
			if let AgentEvent::MessageStart(m) | AgentEvent::MessageUpdate(m) | AgentEvent::MessageEnd(m) = event
				&& Role::Assistant.is(&m)
			{
				shown_calls.push(m["content"].items().iter().filter_map(|b| b["id"].as_str().map(str::to_owned)).collect());
			}
		};
		builder.start(&mut emit);
		builder.tool_call("p1", "plot", &json!({}), true, &mut emit);
		builder.tool_call("q1", "quiz", &json!({}), true, &mut emit);
		builder.decide("p1");
		builder.decide_all();
		builder.tool_result(json!({ "role": "toolResult", "toolCallId": "p1" }), &mut emit);
		assert_eq!(shown_calls, [Vec::<String>::new(), Vec::new(), vec!["p1".to_owned(), "q1".to_owned()]]);
		assert_eq!(builder.messages()[0]["content"].items().len(), 2, "the record always holds both");
	}

	#[test]
	fn a_call_set_aside_leaves_the_record_until_a_later_call_puts_it_back_before_itself() {
		let ids = |m: &Json| m["content"].items().iter().map(|b| b["id"].as_str().or(b["text"].as_str()).unwrap_or_default().to_owned()).collect::<Vec<_>>();
		let (_, messages) = played(|b, emit| {
			b.start(emit);
			b.tool_call("p1", "plot", &json!({}), false, emit);
			b.set_aside("p1", emit);
			assert!(b.reply().unwrap()["content"].items().is_empty(), "held out of the record");
			b.text_done("Guess first.".to_owned(), emit);
			b.tool_call("q1", "quiz", &json!({}), false, emit);
			assert_eq!(b.release("p1", "q1", emit).unwrap()["id"], json!("p1"));
			b.tool_result(json!({ "role": "toolResult", "toolCallId": "p1" }), emit);
			b.tool_call("p2", "plot", &json!({}), false, emit);
			b.set_aside("p2", emit);
			b.finish(&End::Completed, emit)
		});
		assert_eq!(ids(&messages[0]), ["Guess first.", "p1", "q1"]);
		assert!(messages.iter().all(|m| !ids(m).contains(&"p2".to_owned())), "one never put back stays out");
	}
}
