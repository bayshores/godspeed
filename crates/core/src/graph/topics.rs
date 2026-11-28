use std::collections::{HashMap, HashSet};

use gs_base::re::collapse_spaces;
use gs_base::text;
use gs_json::{Json, Obj, json};

const UNGROUPED_TOPIC_ID: &str = "ungrouped";
const UNGROUPED_TOPIC_NAME: &str = "Ungrouped";

/// The repair's catch-all for facts with no grouped neighbor.
const OTHER_TOPIC_NAME: &str = "Other";

/// Topic names are 1-4 words.
const MAX_TOPIC_NAME_WORDS: usize = 4;

/// Below this many facts the grouper does not run.
pub const MIN_FACTS_FOR_TOPICS: usize = 4;

/// The live topics over `fact_ids`: each snapshot topic keeps its live, not yet placed members
/// (empty topics drop), then one "Ungrouped" topic holds the rest. Each is `{ id, name, members
/// [, material] [, ungrouped: true] }`.
pub fn resolve_topics(snapshot: Option<&Json>, fact_ids: &[String]) -> Vec<Json> {
	let live: HashSet<&str> = fact_ids.iter().map(String::as_str).collect();
	let mut placed: HashSet<String> = HashSet::new();
	let mut out = Vec::new();
	for topic in snapshot.and_then(|s| s["topics"].as_arr()).into_iter().flatten() {
		let members: Vec<String> = topic["members"].items().iter().filter_map(Json::as_str).filter(|id| live.contains(id) && !placed.contains(*id)).map(str::to_owned).collect();
		placed.extend(members.iter().cloned());
		if !members.is_empty() {
			out.push(topic_json(topic["id"].clone(), topic["name"].clone(), members, topic["material"].as_str()));
		}
	}
	let rest: Vec<&String> = fact_ids.iter().filter(|id| !placed.contains(*id)).collect();
	if !rest.is_empty() {
		out.push(json!({ "id": UNGROUPED_TOPIC_ID, "name": UNGROUPED_TOPIC_NAME, "members": rest, "ungrouped": true }));
	}
	out
}

/// `{ id, name, members[, material] }`, with the material only when it is set.
fn topic_json(id: Json, name: Json, members: Vec<String>, material: Option<&str>) -> Json {
	let mut o = Obj::new();
	o.insert("id", id);
	o.insert("name", name);
	o.insert("members", members);
	if let Some(material) = material.filter(|m| !m.is_empty()) {
		o.insert("material", material);
	}
	Json::Obj(o)
}

/// True when the snapshot names exactly these facts (the grouper's "nothing changed" skip).
pub fn same_fact_set(snapshot: Option<&Json>, fact_ids: &[String]) -> bool {
	let Some(snapshot) = snapshot else { return false };
	let named: HashSet<&str> = snapshot["topics"].items().iter().flat_map(|topic| topic["members"].strs()).collect();
	let current: HashSet<&str> = fact_ids.iter().map(String::as_str).collect();
	named.len() == current.len() && current.iter().all(|id| named.contains(id))
}

/// Trims and collapses whitespace; empty when nothing is left.
pub(crate) fn clean_topic_name(name: &str) -> String {
	collapse_spaces(text::trim(name))
}

/// Why a submitted name is unusable, or None when it is fine.
pub fn topic_name_problem(name: &str) -> Option<String> {
	let clean = clean_topic_name(name);
	if clean.is_empty() {
		return Some("A topic name is empty \u{2014} give every topic a 1\u{2013}4 word name.".to_owned());
	}
	let words = clean.matches(' ').count() + 1;
	(words > MAX_TOPIC_NAME_WORDS).then(|| format!("\"{clean}\" has {words} words \u{2014} topic names are 1\u{2013}4 words."))
}

/// One topic as the grouper submits it: an id only when it keeps an existing topic.
pub struct TopicDraft {
	pub id: Option<String>,
	pub name: String,
	pub members: Vec<String>,
	/// One of `TOPIC_MATERIALS`, when the grouper gave a known one.
	pub material: Option<String>,
}

struct Topic {
	id: String,
	name: String,
	members: Vec<String>,
	material: Option<String>,
}

impl Topic {
	fn of(topic: &Json) -> Self {
		Self { id: topic["id"].str_or_empty().to_owned(), name: topic["name"].str_or_empty().to_owned(), members: topic["members"].strs().into_iter().map(str::to_owned).collect(), material: topic["material"].as_str().map(str::to_owned) }
	}

	fn json(self) -> Json {
		topic_json(Json::from(self.id), Json::from(self.name), self.members, self.material.as_deref())
	}
}

/// Hands out topic ids: an existing id the draft names, else the one an existing topic of the
/// same name (case-insensitive) holds, else a fresh one.
struct IdClaims<F> {
	existing_ids: HashSet<String>,
	id_by_name: HashMap<String, String>,
	used: HashSet<String>,
	new_id: F,
}

impl<F: FnMut() -> String> IdClaims<F> {
	fn claim(&mut self, own: Option<&str>, name: &str) -> String {
		let own = own.map(text::trim).filter(|id| !id.is_empty());
		let id = if let Some(own) = own.filter(|id| self.existing_ids.contains(*id) && !self.used.contains(*id)) {
			own.to_owned()
		} else if let Some(by_name) = self.id_by_name.get(&name.to_lowercase()).filter(|id| !self.used.contains(*id)) {
			by_name.clone()
		} else {
			let mut id = (self.new_id)();
			while self.used.contains(&id) || self.existing_ids.contains(&id) {
				id = (self.new_id)();
			}
			id
		};
		self.used.insert(id.clone());
		id
	}
}

/// The write rule: a submitted grouping becomes a valid snapshot body over the current facts.
/// Unknown fact ids drop and a fact listed twice stays in its first topic; a topic that keeps an
/// existing id keeps that topic's material, so a regroup can't flip it (the draft's counts only
/// when there was none); facts the draft left out join the topic most of their chain neighbors
/// are in (repeated until nothing more can be placed), the rest go into "Other"; empty topics
/// drop. Topics are `{ id, name, members[, material] }`.
pub fn repair_topics(drafts: &[TopicDraft], fact_ids: &[String], chains: &[Json], existing: &[Json], new_id: impl FnMut() -> String) -> Vec<Json> {
	let live: HashSet<&str> = fact_ids.iter().map(String::as_str).collect();
	let mut claims = IdClaims {
		existing_ids: existing.iter().filter_map(|t| t["id"].as_str().map(str::to_owned)).collect(),
		id_by_name: existing.iter().filter_map(|t| Some((clean_topic_name(t["name"].as_str()?).to_lowercase(), t["id"].as_str()?.to_owned()))).collect(),
		used: HashSet::new(),
		new_id,
	};
	let material_of: HashMap<&str, &str> = existing.iter().filter_map(|t| Some((t["id"].as_str()?, t["material"].as_str()?))).collect();
	let mut topics: Vec<Topic> = Vec::new();
	let mut topic_of: HashMap<String, usize> = HashMap::new();

	for draft in drafts {
		let name = clean_topic_name(&draft.name);
		if name.is_empty() {
			continue;
		}
		let mut members = Vec::new();
		for id in &draft.members {
			if !live.contains(id.as_str()) || topic_of.contains_key(id) {
				continue;
			}
			topic_of.insert(id.clone(), topics.len());
			members.push(id.clone());
		}
		if members.is_empty() {
			continue;
		}
		let id = claims.claim(draft.id.as_deref(), &name);
		let material = material_of.get(id.as_str()).map(|m| (*m).to_owned()).or_else(|| draft.material.clone());
		topics.push(Topic { id, name, members, material });
	}

	let missing = place_by_neighbors(&mut topics, &mut topic_of, fact_ids, chains);
	if !missing.is_empty() {
		let rest = missing.into_iter().cloned();
		match topics.iter_mut().find(|t| t.name.to_lowercase() == OTHER_TOPIC_NAME.to_lowercase()) {
			Some(other) => other.members.extend(rest),
			None => {
				let id = claims.claim(None, OTHER_TOPIC_NAME);
				let material = material_of.get(id.as_str()).map(|m| (*m).to_owned());
				topics.push(Topic { id, name: OTHER_TOPIC_NAME.to_owned(), members: rest.collect(), material });
			}
		}
	}
	topics.into_iter().map(Topic::json).collect()
}

/// Puts each fact no topic holds into the topic most of its chain neighbors are in, repeated
/// until nothing more can be placed. Returns the facts with no grouped neighbor.
fn place_by_neighbors<'a>(topics: &mut [Topic], topic_of: &mut HashMap<String, usize>, fact_ids: &'a [String], chains: &[Json]) -> Vec<&'a String> {
	let mut neighbors: HashMap<&str, HashSet<&str>> = HashMap::new();
	for chain in chains {
		let mut members = chain["premises"].strs();
		members.extend(chain["conclusion"].as_str());
		for a in &members {
			for b in &members {
				if a != b {
					neighbors.entry(a).or_default().insert(b);
				}
			}
		}
	}
	let mut missing: Vec<&String> = fact_ids.iter().filter(|id| !topic_of.contains_key(*id)).collect();
	let mut progress = true;
	while progress && !missing.is_empty() {
		progress = false;
		let mut still = Vec::new();
		for id in missing {
			let mut votes: HashMap<usize, usize> = HashMap::new();
			for n in neighbors.get(id.as_str()).into_iter().flatten() {
				if let Some(&t) = topic_of.get(*n) {
					*votes.entry(t).or_default() += 1;
				}
			}
			// Most votes wins, the earlier topic on a tie.
			let best = votes.iter().fold(None, |best: Option<(usize, usize)>, (&t, &n)| match best {
				Some((bt, bn)) if n < bn || (n == bn && t > bt) => best,
				_ => Some((t, n)),
			});
			let Some((best, _)) = best else {
				still.push(id);
				continue;
			};
			topic_of.insert(id.clone(), best);
			topics[best].members.push(id.clone());
			progress = true;
		}
		missing = still;
	}
	missing
}

/// The current topics with each new fact beside its chain neighbors, and the new facts that have
/// no grouped neighbor: those need the grouper.
pub fn place_new_facts(current: &[Json], fact_ids: &[String], chains: &[Json]) -> (Vec<Json>, Vec<String>) {
	let mut topics: Vec<Topic> = current.iter().map(Topic::of).collect();
	let mut topic_of: HashMap<String, usize> = HashMap::new();
	for (at, topic) in topics.iter().enumerate() {
		topic_of.extend(topic.members.iter().map(|id| (id.clone(), at)));
	}
	let loose = place_by_neighbors(&mut topics, &mut topic_of, fact_ids, chains).into_iter().cloned().collect();
	(topics.into_iter().map(Topic::json).collect(), loose)
}

/// The grouping after the grouper placed the new facts: each current topic keeps its members and
/// its name, and gains the facts a placement gave it (matched by id, else by name); a placement
/// that matches no topic is a new topic.
pub fn add_placements(current: &[Json], placements: Vec<TopicDraft>) -> Vec<TopicDraft> {
	let mut drafts: Vec<TopicDraft> = current.iter().map(Topic::of).map(|t| TopicDraft { id: Some(t.id), name: t.name, members: t.members, material: t.material }).collect();
	let known = drafts.len();
	for placement in placements {
		let name = clean_topic_name(&placement.name).to_lowercase();
		let by_id = drafts[..known].iter().position(|d| d.id == placement.id);
		match by_id.or_else(|| drafts.iter().position(|d| clean_topic_name(&d.name).to_lowercase() == name)) {
			Some(at) => drafts[at].members.extend(placement.members),
			None => drafts.push(TopicDraft { id: None, ..placement }),
		}
	}
	drafts
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn members_resolve_once_and_rest_is_ungrouped() {
		let snap = json!({ "topics": [{ "id": "t1", "name": "A", "members": ["a", "gone", "b"] }, { "id": "t2", "name": "B", "members": ["a"] }] });
		let ids = ["a", "b", "c"].map(String::from);
		let got = resolve_topics(Some(&snap), &ids);
		assert_eq!(got, vec![json!({ "id": "t1", "name": "A", "members": ["a", "b"] }), json!({ "id": "ungrouped", "name": "Ungrouped", "members": ["c"], "ungrouped": true })]);
		let with_material = json!({ "topics": [{ "id": "t1", "name": "A", "material": "proof", "members": ["a"] }] });
		assert_eq!(resolve_topics(Some(&with_material), &ids[..1]), vec![json!({ "id": "t1", "name": "A", "members": ["a"], "material": "proof" })]);
	}

	fn ids(items: &[&str]) -> Vec<String> {
		items.iter().map(|s| (*s).to_owned()).collect()
	}

	fn draft(id: Option<&str>, name: &str, members: &[&str]) -> TopicDraft {
		TopicDraft { id: id.map(str::to_owned), name: name.to_owned(), members: ids(members), material: None }
	}

	fn counter() -> impl FnMut() -> String {
		let mut n = 0;
		move || {
			n += 1;
			format!("new_{n}")
		}
	}

	#[test]
	fn the_same_fact_set_ignores_order_and_dead_repeats() {
		let snap = json!({ "topics": [{ "id": "t1", "name": "A", "members": ["a", "b"] }, { "id": "t2", "name": "B", "members": ["b"] }] });
		assert!(same_fact_set(Some(&snap), &ids(&["b", "a"])));
		assert!(!same_fact_set(Some(&snap), &ids(&["a"])));
		assert!(!same_fact_set(Some(&snap), &ids(&["a", "c"])));
		assert!(!same_fact_set(None, &[]));
	}

	#[test]
	fn names_are_one_to_four_words() {
		assert_eq!(topic_name_problem("  Sum   and product "), None);
		assert!(topic_name_problem("   ").unwrap().starts_with("A topic name is empty"));
		assert_eq!(topic_name_problem("one two three four five").unwrap(), "\"one two three four five\" has 5 words \u{2014} topic names are 1\u{2013}4 words.");
	}

	#[test]
	fn repair_keeps_ids_drops_unknown_facts_and_places_the_rest_by_neighbors() {
		let drafts = [draft(Some("t1"), "Letters", &["a", "zzz", "a"]), draft(None, "numbers", &["c"])];
		let chains = [json!({ "premises": ["a"], "conclusion": "b" }), json!({ "premises": ["c"], "conclusion": "d" })];
		let existing = [json!({ "id": "t1", "name": "Letters", "members": [] }), json!({ "id": "t2", "name": "Numbers", "members": [] })];
		let got = repair_topics(&drafts, &ids(&["a", "b", "c", "d", "e"]), &chains, &existing, counter());
		assert_eq!(got, vec![json!({ "id": "t1", "name": "Letters", "members": ["a", "b"] }), json!({ "id": "t2", "name": "numbers", "members": ["c", "d"] }), json!({ "id": "new_1", "name": "Other", "members": ["e"] })]);
	}

	#[test]
	fn repair_keeps_an_existing_topics_material_over_the_drafts() {
		let mut keep = draft(Some("t1"), "Letters", &["a"]);
		keep.material = Some("term".to_owned());
		let mut fresh = draft(None, "Numbers", &["b"]);
		fresh.material = Some("procedure".to_owned());
		let mut unset = draft(Some("t3"), "Proofs", &["c"]);
		unset.material = Some("proof".to_owned());
		let existing = [json!({ "id": "t1", "name": "Letters", "members": [], "material": "concept" }), json!({ "id": "t3", "name": "Proofs", "members": [] }), json!({ "id": "t9", "name": "Other", "members": [], "material": "term" })];
		let got = repair_topics(&[keep, fresh, unset], &ids(&["a", "b", "c", "d"]), &[], &existing, counter());
		assert_eq!(
			got,
			vec![
				json!({ "id": "t1", "name": "Letters", "members": ["a"], "material": "concept" }),
				json!({ "id": "new_1", "name": "Numbers", "members": ["b"], "material": "procedure" }),
				json!({ "id": "t3", "name": "Proofs", "members": ["c"], "material": "proof" }),
				json!({ "id": "t9", "name": "Other", "members": ["d"], "material": "term" }),
			]
		);
	}

	#[test]
	fn new_facts_join_their_neighbors_topic_and_the_rest_are_left_for_the_grouper() {
		let current = [json!({ "id": "t1", "name": "Letters", "members": ["a"], "material": "term" }), json!({ "id": "t2", "name": "Numbers", "members": ["c"] })];
		// b hangs on a, d on b; e has no chain; f hangs only on e.
		let chains = [json!({ "premises": ["a"], "conclusion": "b" }), json!({ "premises": ["b"], "conclusion": "d" }), json!({ "premises": ["e"], "conclusion": "f" })];
		let (topics, loose) = place_new_facts(&current, &ids(&["a", "b", "c", "d", "e", "f"]), &chains);
		assert_eq!(topics, vec![json!({ "id": "t1", "name": "Letters", "members": ["a", "b", "d"], "material": "term" }), json!({ "id": "t2", "name": "Numbers", "members": ["c"] })]);
		assert_eq!(loose, ids(&["e", "f"]));
	}

	#[test]
	fn placements_add_to_a_topic_by_id_or_name_and_start_new_ones() {
		let current = [json!({ "id": "t1", "name": "Letters", "members": ["a"] }), json!({ "id": "t2", "name": "Numbers", "members": ["c"] })];
		let placed = add_placements(&current, vec![draft(Some("t2"), "Renamed", &["e"]), draft(None, " letters ", &["f"]), draft(Some("made-up"), "Shapes", &["g"]), draft(None, "shapes", &["h"])]);
		let got: Vec<(Option<&str>, &str, Vec<&str>)> = placed.iter().map(|d| (d.id.as_deref(), d.name.as_str(), d.members.iter().map(String::as_str).collect())).collect();
		assert_eq!(got, [(Some("t1"), "Letters", vec!["a", "f"]), (Some("t2"), "Numbers", vec!["c", "e"]), (None, "Shapes", vec!["g", "h"])]);
	}

	#[test]
	fn repair_drops_empty_and_unnamed_topics() {
		let drafts = [draft(None, "  ", &["a"]), draft(None, "Gone", &["nope"])];
		let got = repair_topics(&drafts, &ids(&["a"]), &[], &[], counter());
		assert_eq!(got, vec![json!({ "id": "new_1", "name": "Other", "members": ["a"] })]);
	}
}
