use gs_base::{hash::Hasher, locale};
use gs_json::{Json, Obj, json};

/// Agents kept in the file; each new agent session drops the oldest.
pub const SEEN_AGENTS_MAX: usize = 20;

/// How many messages of a conversation an agent has seen, and a hash of them.
#[derive(Clone, Debug, PartialEq)]
pub struct SeenMark {
	pub count: usize,
	pub hash: String,
}

/// Where marks are saved (gs_store::agent_seen implements it).
pub trait SeenStore: Send + Sync {
	fn get(&self, agent: &str, conversation: &str) -> Option<SeenMark>;
	fn set(&self, agent: &str, conversation: &str, mark: &SeenMark);
	fn forget_agent(&self, agent: &str);
}

/// The mark for a list of message fingerprints.
pub fn seen_mark(prints: &[String]) -> SeenMark {
	let mut hash = Hasher::new();
	for print in prints {
		hash.update_text(print);
		hash.update(b"\0");
	}
	SeenMark { count: prints.len(), hash: hash.hex()[..32].to_string() }
}

/// True when the agent saw exactly the first `mark.count` of these messages.
pub fn continues_from(mark: Option<&SeenMark>, prints: &[String]) -> bool {
	mark.is_some_and(|m| m.count <= prints.len() && seen_mark(&prints[..m.count]).hash == m.hash)
}

/// A saved file, checked: `{ agents: { agent: { at, conversations: { id: { count, hash } } } } }`.
/// Anything unreadable reads as nothing seen. A `__proto__` key is lost, as in JS, where
/// assigning it sets the prototype instead of a key.
pub fn parse_agent_seen(raw: &Json) -> Json {
	let mut agents = Obj::new();
	for (agent, entry) in super::entries(&raw["agents"]) {
		let (Some(at), true) = (entry["at"].as_str(), matches!(entry["conversations"], Json::Obj(_) | Json::Arr(_))) else { continue };
		if agent == "__proto__" {
			continue;
		}
		let mut kept = Obj::new();
		for (conversation, mark) in super::entries(&entry["conversations"]) {
			let count = mark["count"].as_f64().filter(|c| c.fract() == 0.0 && *c >= 0.0);
			if let (Some(count), Some(hash), false) = (count, mark["hash"].as_str(), conversation == "__proto__") {
				kept.insert(conversation, json!({ "count": count, "hash": hash }));
			}
		}
		agents.insert(agent, json!({ "at": at, "conversations": Json::Obj(kept) }));
	}
	json!({ "agents": Json::Obj(agents) })
}

/// The file with one mark set, keeping the SEEN_AGENTS_MAX newest agents.
pub fn with_seen(file: &Json, agent: &str, conversation: &str, mark: &SeenMark, at: &str) -> Json {
	let mut conversations = file["agents"][agent]["conversations"].as_obj().cloned().unwrap_or_default();
	conversations.insert(conversation, json!({ "count": mark.count, "hash": mark.hash.as_str() }));
	let mut agents = file["agents"].as_obj().cloned().unwrap_or_default();
	agents.insert(agent, json!({ "at": at, "conversations": Json::Obj(conversations) }));
	let mut newest: Vec<(String, Json)> = agents.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
	newest.sort_by(|(_, a), (_, b)| locale::compare(b["at"].as_str().unwrap_or(""), a["at"].as_str().unwrap_or("")));
	newest.truncate(SEEN_AGENTS_MAX);
	json!({ "agents": Json::Obj(newest.into_iter().collect()) })
}

#[cfg(test)]
mod tests {
	use gs_json::{parse, stringify};

	use super::*;

	#[test]
	fn saved_files_are_checked_and_trimmed_to_the_newest_agents() {
		let raw = parse(r#"{"agents":{"a":{"at":"1","conversations":{"c":{"count":2,"hash":"h"},"bad":{"count":-1,"hash":"h"},"frac":{"count":1.5,"hash":"h"},"nohash":{"count":1}}},"b":{"at":5,"conversations":{}},"c":null,"d":{"at":"2","conversations":[{"count":0,"hash":"z"}]}}}"#).unwrap();
		assert_eq!(stringify(&parse_agent_seen(&raw)), r#"{"agents":{"a":{"at":"1","conversations":{"c":{"count":2,"hash":"h"}}},"d":{"at":"2","conversations":{"0":{"count":0,"hash":"z"}}}}}"#);
		assert_eq!(stringify(&parse_agent_seen(&Json::Null)), r#"{"agents":{}}"#);
		let mut file = parse_agent_seen(&Json::Null);
		for i in 0..22 {
			file = with_seen(&file, &format!("agent{i}"), "chat", &SeenMark { count: 1, hash: "h".into() }, &format!("2026-01-{:02}", i + 1));
		}
		let kept: Vec<&String> = file["agents"].as_obj().unwrap().keys().collect();
		assert_eq!(kept.len(), SEEN_AGENTS_MAX);
		assert_eq!(kept[0], "agent21");
		assert!(!kept.iter().any(|k| *k == "agent0" || *k == "agent1"));
	}

	#[test]
	fn marks_continue_only_from_the_same_start() {
		let prints: Vec<String> = ["a", "b", "c"].map(String::from).to_vec();
		let mark = seen_mark(&prints[..2]);
		assert_eq!(mark.count, 2);
		assert_eq!(mark.hash, "8fb20ef63ced4145fc2e983ffe597d1d"); // Node's digest
		assert!(continues_from(Some(&mark), &prints));
		assert!(!continues_from(Some(&mark), &["a".into(), "x".into(), "c".into()]));
		assert!(!continues_from(Some(&mark), &prints[..1]));
		assert!(!continues_from(None, &prints));
	}
}
