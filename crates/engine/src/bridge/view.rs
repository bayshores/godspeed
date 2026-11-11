//! One work item as the MCP layer presents it: only the unseen tail when its agent already
//! holds the conversation, and only the instructions and tools it does not already have.

use gs_core::contracts::chat::CHAT_ID_PREFIX;
use gs_core::records::agent_seen::{SeenMark, SeenStore, continues_from};
use gs_json::{Json, stringify};

use super::render::{fingerprint, hash_of, instructions_and_tools, render_message};
use super::{Bridge, State, WorkItem};
use crate::turn::messages::role;

#[derive(Clone, Debug, PartialEq)]
pub struct WorkView {
	pub work_id: String,
	pub conversation: String,
	/// True: `messages` holds only what arrived since the agent's last reply here.
	pub continued: bool,
	/// The system prompt, on a full delivery whose agent has not had the same text.
	pub instructions: Option<String>,
	/// Instead of `instructions`: the earlier workId that carried the same ones.
	pub instructions_as_in: Option<String>,
	/// On a full delivery: the tools (`{name, description, parameters}`) its agent lacks.
	pub tools: Option<Vec<Json>>,
	/// The names of the other tools, which the agent already has.
	pub tools_as_before: Option<Vec<String>>,
	/// The flattened messages (role, text, toolCalls, …).
	pub messages: Vec<Json>,
	/// The background task's name, when its run gave one.
	pub label: Option<String>,
	/// The images in `messages` (`{data, mimeType}`), in "[image N]" order.
	pub images: Option<Vec<Json>>,
}

/// Only lessons outlive a restart; background jobs never come back.
fn saves_seen(agent: Option<&str>, conversation: &str) -> bool {
	agent.is_some_and(|a| !a.is_empty()) && conversation.starts_with(CHAT_ID_PREFIX)
}

pub(super) fn seen_of(state: &State, store: &dyn SeenStore, agent: Option<&str>, conversation: &str) -> Option<SeenMark> {
	let mark = state.seen_by.get(conversation).and_then(|by| by.get(agent.unwrap_or_default())).cloned();
	match (mark, agent) {
		(Some(mark), _) => Some(mark),
		(None, Some(agent)) if saves_seen(Some(agent), conversation) => store.get(agent, conversation),
		_ => None,
	}
}

pub(super) fn remember_seen(state: &mut State, store: &dyn SeenStore, agent: Option<&str>, conversation: &str, mark: SeenMark) {
	state.seen_by.entry(conversation.to_owned()).or_default().insert(agent.unwrap_or_default().to_owned(), mark.clone());
	if let Some(agent) = agent.filter(|a| saves_seen(Some(a), conversation)) {
		store.set(agent, conversation, &mark);
	}
}

impl Bridge {
	/// Presents the item at `index` (sending everything again when `force_full`).
	pub(super) fn view(&self, state: &mut State, index: usize, force_full: bool) -> WorkView {
		let item: &WorkItem = &state.items[index];
		let (all, conversation, agent) = (item.context.clone(), item.conversation.clone(), item.agent.clone());
		let work_id = format!("{}_{}", item.id, item.claims);
		let prints: Vec<String> = all.iter().map(fingerprint).collect();
		let seen = if force_full { None } else { seen_of(state, self.0.seen.as_ref(), agent.as_deref(), &conversation) };
		let continued = continues_from(seen.as_ref(), &prints);
		let fresh = if continued { &all[seen.map_or(0, |m| m.count)..] } else { &all[..] };
		let mut images = Vec::new();
		let messages = fresh.iter().filter(|m| continued || role(m) != "system").filter_map(|m| render_message(m, Some(&mut images))).collect();
		let mut view = WorkView {
			work_id: work_id.clone(),
			conversation: conversation.clone(),
			continued,
			instructions: None,
			instructions_as_in: None,
			tools: None,
			tools_as_before: None,
			messages,
			label: state.labels.get(&conversation).filter(|l| !l.is_empty()).cloned(),
			images: (!images.is_empty()).then_some(images),
		};
		if continued {
			return view;
		}
		let (instructions, tools) = instructions_and_tools(&all);
		// Without an id, agents cannot be told apart: everything goes in full.
		let Some(agent) = agent else {
			view.instructions = Some(instructions);
			view.tools = Some(tools);
			return view;
		};
		let known = state.known.entry(agent).or_default();
		let instructions_hash = hash_of(&instructions);
		view.instructions_as_in = if force_full || instructions.is_empty() { None } else { known.instructions.get(&instructions_hash).cloned() };
		if view.instructions_as_in.is_none() {
			known.instructions.insert(instructions_hash, work_id);
			view.instructions = Some(instructions);
		}
		let (mut new_tools, mut as_before) = (Vec::new(), Vec::new());
		for tool in tools {
			let tool_hash = hash_of(&stringify(&tool));
			if !force_full && known.tools.contains(&tool_hash) {
				as_before.push(tool["name"].as_str().unwrap_or_default().to_owned());
			} else {
				new_tools.push(tool);
			}
			known.tools.insert(tool_hash);
		}
		view.tools = Some(new_tools);
		view.tools_as_before = (!as_before.is_empty()).then_some(as_before);
		view
	}
}
