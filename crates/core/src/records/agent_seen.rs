use gs_base::hash::{Hasher, sha256_text};
use gs_base::locale;
use gs_json::{Json, Obj, json};

/// Agents kept in the file; each new agent session drops the oldest.
pub const SEEN_AGENTS_MAX: usize = 20;

/// How many messages of a conversation an agent has seen and a hash of them (the instructions
/// left out), the hash of the last one (its own reply, to find its place after a summary
/// replaced the messages before it), and the hash of the instructions it was given.
#[derive(Clone, Debug, PartialEq)]
pub struct SeenMark {
	pub count: usize,
	pub hash: String,
	pub last: String,
	pub lead: String,
}

impl SeenMark {
	/// The mark as saved: `{count, hash, last, lead}`.
	pub fn to_json(&self) -> Json {
		json!({ "count": self.count, "hash": self.hash.as_str(), "last": self.last.as_str(), "lead": self.lead.as_str() })
	}

	/// A saved mark that `parse_agent_seen` kept.
	pub fn from_json(mark: &Json) -> Option<SeenMark> {
		Some(SeenMark {
			count: usize::try_from(mark["count"].as_i64()?).ok()?,
			hash: mark["hash"].as_str()?.to_owned(),
			last: mark["last"].as_str()?.to_owned(),
			lead: mark["lead"].as_str()?.to_owned(),
		})
	}
}

/// Where marks are saved (gs_store::agent_seen implements it).
pub trait SeenStore: Send + Sync {
	fn get(&self, agent: &str, conversation: &str) -> Option<SeenMark>;
	fn set(&self, agent: &str, conversation: &str, mark: &SeenMark);
	fn forget_agent(&self, agent: &str);
}

/// A short hash of one message's fingerprint (or the instructions').
pub fn print_hash(print: &str) -> String {
	sha256_text(print)[..32].to_owned()
}

/// The mark for a list of message fingerprints and the instructions' hash.
pub fn seen_mark(prints: &[String], lead: &str) -> SeenMark {
	let mut hash = Hasher::new();
	for print in prints {
		hash.update_text(print);
		hash.update(b"\0");
	}
	let last = print_hash(prints.last().map_or("", String::as_str));
	SeenMark { count: prints.len(), hash: hash.hex()[..32].to_string(), last, lead: lead.to_owned() }
}

/// Where the new messages start for an agent with this mark: after the ones it saw when they
/// are unchanged, else after the newest copy of the last one it saw (a summary replaced what
/// came before it). None: nowhere.
pub fn resume_at(mark: Option<&SeenMark>, prints: &[String]) -> Option<usize> {
	let mark = mark?;
	if mark.count <= prints.len() && seen_mark(&prints[..mark.count], &mark.lead).hash == mark.hash {
		return Some(mark.count);
	}
	prints.iter().rposition(|print| print_hash(print) == mark.last).map(|i| i + 1)
}

/// A saved file, checked: `{ agents: { agent: { at, conversations: { id: mark } } } }`.
/// Anything unreadable reads as nothing seen; a mark without `last` and `lead` (an older file)
/// is dropped. A `__proto__` key is lost, as in JS, where assigning it sets the prototype
/// instead of a key.
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
			let texts = (mark["hash"].as_str(), mark["last"].as_str(), mark["lead"].as_str());
			if let (Some(count), (Some(hash), Some(last), Some(lead)), false) = (count, texts, conversation == "__proto__") {
				kept.insert(conversation, json!({ "count": count, "hash": hash, "last": last, "lead": lead }));
			}
		}
		agents.insert(agent, json!({ "at": at, "conversations": Json::Obj(kept) }));
	}
	json!({ "agents": Json::Obj(agents) })
}

/// The file with one mark set, keeping the SEEN_AGENTS_MAX newest agents.
pub fn with_seen(file: &Json, agent: &str, conversation: &str, mark: &SeenMark, at: &str) -> Json {
	let mut conversations = file["agents"][agent]["conversations"].as_obj().cloned().unwrap_or_default();
	conversations.insert(conversation, mark.to_json());
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

	fn prints(list: &[&str]) -> Vec<String> {
		list.iter().map(|p| (*p).to_owned()).collect()
	}

	fn mark(count: usize) -> SeenMark {
		SeenMark { count, hash: "h".into(), last: "l".into(), lead: "L".into() }
	}

	#[test]
	fn saved_files_are_checked_and_trimmed_to_the_newest_agents() {
		let raw = parse(r#"{"agents":{"a":{"at":"1","conversations":{"c":{"count":2,"hash":"h","last":"l","lead":"L"},"old":{"count":2,"hash":"h"},"bad":{"count":-1,"hash":"h","last":"l","lead":"L"},"frac":{"count":1.5,"hash":"h","last":"l","lead":"L"}}},"b":{"at":5,"conversations":{}},"c":null,"d":{"at":"2","conversations":[{"count":0,"hash":"z","last":"l","lead":""}]}}}"#).unwrap();
		assert_eq!(stringify(&parse_agent_seen(&raw)), r#"{"agents":{"a":{"at":"1","conversations":{"c":{"count":2,"hash":"h","last":"l","lead":"L"}}},"d":{"at":"2","conversations":{"0":{"count":0,"hash":"z","last":"l","lead":""}}}}}"#);
		assert_eq!(stringify(&parse_agent_seen(&Json::Null)), r#"{"agents":{}}"#);
		let mut file = parse_agent_seen(&Json::Null);
		for i in 0..22 {
			file = with_seen(&file, &format!("agent{i}"), "chat", &mark(1), &format!("2026-01-{:02}", i + 1));
		}
		let kept: Vec<&String> = file["agents"].as_obj().unwrap().keys().collect();
		assert_eq!(kept.len(), SEEN_AGENTS_MAX);
		assert_eq!(kept[0], "agent21");
		assert!(!kept.iter().any(|k| *k == "agent0" || *k == "agent1"));
		assert_eq!(SeenMark::from_json(&file["agents"]["agent21"]["conversations"]["chat"]), Some(mark(1)));
	}

	#[test]
	fn a_mark_continues_after_the_exact_messages_it_was_made_from() {
		let mark = seen_mark(&prints(&["a", "b"]), "L");
		assert_eq!(mark.count, 2);
		assert_eq!(mark.hash, "8fb20ef63ced4145fc2e983ffe597d1d"); // Node's digest
		assert_eq!(mark.last, print_hash("b"));
		assert_eq!(resume_at(Some(&mark), &prints(&["a", "b"])), Some(2));
		assert_eq!(resume_at(Some(&mark), &prints(&["a", "b", "c"])), Some(2), "new messages after the seen ones");
		assert_eq!(resume_at(None, &prints(&["a"])), None);
		assert_ne!(seen_mark(&prints(&["ab"]), "L").hash, mark.hash, "message borders count");
	}

	#[test]
	fn after_a_summary_the_mark_finds_its_last_message_again() {
		let mark = seen_mark(&prints(&["a", "b", "reply"]), "L");
		assert_eq!(resume_at(Some(&mark), &prints(&["summary", "reply", "c"])), Some(2), "starts right after the agent's own reply");
		assert_eq!(resume_at(Some(&mark), &prints(&["reply", "x", "reply", "c"])), Some(3), "the newest copy wins");
		assert_eq!(resume_at(Some(&mark), &prints(&["summary", "c"])), None, "its reply is gone: nothing to continue from");
	}
}
