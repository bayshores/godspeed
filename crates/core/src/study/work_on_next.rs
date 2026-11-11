//! "Work on next" over a set of topics, and the status counts (progress.ts: deadlines).

use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

use gs_base::{locale, num};
use gs_json::{Json, Obj, json};

use super::progress::TopicStatus;
use super::topic_links::TopicLink;

/// What the recommendations read of a topic's progress.
pub struct TopicView {
	pub id: String,
	pub name: String,
	pub status: TopicStatus,
	pub rate: Option<f64>,
	pub column: i64,
	pub overconfident: bool,
}

impl TopicView {
	pub fn of(topic: &Json) -> TopicView {
		TopicView {
			id: topic["id"].as_str().unwrap_or("").to_owned(),
			name: topic["name"].as_str().unwrap_or("").to_owned(),
			status: topic["status"].as_str().and_then(TopicStatus::parse).unwrap_or(TopicStatus::Untested),
			rate: topic["rate"].as_f64(),
			column: topic["column"].as_i64().unwrap_or(0),
			overconfident: topic["overconfident"].truthy(),
		}
	}

	fn struggling(&self) -> bool {
		matches!(self.status, TopicStatus::Weak | TopicStatus::Shaky)
	}
}

/// How many topics are in each status: `{ strong, shaky, weak, untested }`.
pub fn status_counts<'a>(statuses: impl IntoIterator<Item = &'a TopicStatus>) -> Json {
	let mut counts = [0usize; 4];
	for s in statuses {
		counts[*s as usize] += 1;
	}
	json!({ "strong": counts[0], "shaky": counts[1], "weak": counts[2], "untested": counts[3] })
}

/// Four groups:
///  1. weak or shaky topics another weak or shaky topic in the set builds on ("<dependent>
///     builds on it, so fix it first");
///  2. overconfident topics ("overconfident");
///  3. the remaining weak or shaky ones ("Needed for <dependent>" when a topic in the set builds
///     on it, else "<n>% right");
///  4. untested topics (no reason: the status line already says "Not tested").
///
/// Within a group: lowest right rate first, then earlier column, then name.
pub fn work_on_next(topics: &[&TopicView], links: &[TopicLink]) -> Vec<Json> {
	let in_set: HashMap<&str, &TopicView> = topics.iter().map(|t| (t.id.as_str(), *t)).collect();
	let mut sorted: Vec<&TopicView> = topics.to_vec();
	sorted.sort_by(|a, b| {
		let (ra, rb) = (a.rate.unwrap_or(2.0), b.rate.unwrap_or(2.0));
		ra.partial_cmp(&rb).unwrap_or(Ordering::Equal).then(a.column.cmp(&b.column)).then_with(|| locale::compare(&a.name, &b.name))
	});
	let mut out = Vec::new();
	let mut listed: HashSet<&str> = HashSet::new();
	for t in &sorted {
		if t.struggling()
			&& let Some(dep) = dependent(&in_set, links, &t.id, |d| d.id != t.id && d.struggling())
		{
			listed.insert(&t.id);
			out.push(item(t, format!("{} builds on it, so fix it first", dep.name)));
		}
	}
	for t in &sorted {
		if !listed.contains(t.id.as_str()) && t.overconfident {
			listed.insert(&t.id);
			out.push(item(t, "overconfident".to_owned()));
		}
	}
	for t in &sorted {
		if listed.contains(t.id.as_str()) || !t.struggling() {
			continue;
		}
		let reason = match dependent(&in_set, links, &t.id, |_| true) {
			Some(dep) => format!("Needed for {}", dep.name),
			None => format!("{}% right", gs_json::js_number(num::math_round(t.rate.unwrap_or(0.0) * 100.0))),
		};
		listed.insert(&t.id);
		out.push(item(t, reason));
	}
	for t in &sorted {
		if !listed.contains(t.id.as_str()) && t.status == TopicStatus::Untested {
			listed.insert(&t.id);
			out.push(item(t, String::new()));
		}
	}
	out
}

/// The topic in the set that builds most on `id` (heaviest link, then by id) and passes `filter`.
fn dependent<'a>(in_set: &HashMap<&str, &'a TopicView>, links: &[TopicLink], id: &str, filter: impl Fn(&TopicView) -> bool) -> Option<&'a TopicView> {
	let mut found: Vec<(&TopicLink, &TopicView)> = links.iter().filter(|l| l.from == id).filter_map(|l| in_set.get(l.to.as_str()).filter(|d| filter(d)).map(|d| (l, *d))).collect();
	found.sort_by(|a, b| b.0.weight.cmp(&a.0.weight).then_with(|| locale::compare(&a.0.to, &b.0.to)));
	found.first().map(|(_, d)| *d)
}

fn item(t: &TopicView, reason: String) -> Json {
	let mut o = Obj::new();
	o.insert("topicId", &t.id);
	o.insert("name", &t.name);
	o.insert("status", t.status.as_str());
	o.insert("reason", reason);
	Json::Obj(o)
}

#[cfg(test)]
mod tests {
	use super::*;

	fn view(id: &str, status: TopicStatus, rate: Option<f64>, over: bool) -> TopicView {
		TopicView { id: id.into(), name: id.to_uppercase(), status, rate, column: 0, overconfident: over }
	}

	#[test]
	fn the_four_groups_come_in_order() {
		let (a, b, c, d, e) = (
			view("a", TopicStatus::Weak, Some(0.2), false),
			view("b", TopicStatus::Shaky, Some(0.6), false),
			view("c", TopicStatus::Strong, Some(0.9), true),
			view("d", TopicStatus::Untested, None, false),
			view("e", TopicStatus::Weak, Some(0.5), false),
		);
		let links = [TopicLink { from: "a".into(), to: "b".into(), weight: 1 }, TopicLink { from: "e".into(), to: "c".into(), weight: 1 }];
		let got: Vec<String> = work_on_next(&[&a, &b, &c, &d, &e], &links).iter().map(|i| format!("{}:{}", i["topicId"].as_str().unwrap(), i["reason"].as_str().unwrap())).collect();
		assert_eq!(got, ["a:B builds on it, so fix it first", "c:overconfident", "e:Needed for C", "b:60% right", "d:"]);
	}

	#[test]
	fn counts_follow_the_status_order() {
		let counts = status_counts([TopicStatus::Weak, TopicStatus::Weak, TopicStatus::Strong].iter());
		assert_eq!(gs_json::stringify(&counts), r#"{"strong":1,"shaky":0,"weak":2,"untested":0}"#);
	}
}
