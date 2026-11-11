//! How sure the learner was against how often they were right (progress.ts: calibration).

use gs_base::locale;
use gs_json::{Json, Obj, json};

/// Per confidence level the right rate against what the level claims, and the newest 5 wrong
/// answers given at level 4-5. `answers` are the class's graded answers.
pub fn calibration(answers: &[&Json], title_of: impl Fn(&str) -> String) -> Json {
	let levels: Vec<Json> = (1..=5)
		.map(|level| {
			let at: Vec<&&Json> = answers.iter().filter(|a| a["level"].as_i64() == Some(level) && a["outcome"].as_str() != Some("dontKnow")).collect();
			let right = at.iter().filter(|a| a["outcome"].as_str() == Some("right")).count();
			json!({ "level": level, "target": level * 20, "answered": at.len(), "right": right, "rate": (!at.is_empty()).then(|| right as f64 / at.len() as f64) })
		})
		.collect();
	let mut wrong: Vec<&&Json> = answers.iter().filter(|a| a["outcome"].as_str() == Some("wrong") && a["level"].as_i64().is_some_and(|l| l >= 4)).collect();
	wrong.sort_by(|a, b| locale::compare(b["answeredAt"].as_str().unwrap_or(""), a["answeredAt"].as_str().unwrap_or("")));
	let sure_but_wrong: Vec<Json> = wrong
		.into_iter()
		.take(5)
		.map(|a| {
			let chat_id = a["chatId"].as_str().unwrap_or("");
			let mut o = Obj::new();
			o.insert("chatId", a["chatId"].clone());
			o.insert("lessonTitle", title_of(chat_id));
			o.insert("messageId", a["messageId"].clone());
			o.insert("toolCallId", a["toolCallId"].clone());
			o.insert("question", a["question"].clone());
			o.insert("level", a["level"].clone());
			o.insert("answeredAt", a["answeredAt"].clone());
			Json::Obj(o)
		})
		.collect();
	json!({ "levels": levels, "sureButWrong": sure_but_wrong })
}

#[cfg(test)]
mod tests {
	use gs_json::stringify;

	use super::*;

	#[test]
	fn levels_and_the_newest_sure_misses() {
		let a = |o: &str, l: i64, at: &str| json!({ "chatId": "c", "messageId": "m", "toolCallId": "t", "question": "q", "outcome": o, "level": l, "answeredAt": at });
		let answers = [a("right", 5, "2026-01-01"), a("wrong", 5, "2026-01-02"), a("wrong", 4, "2026-01-03"), a("wrong", 2, "2026-01-04"), a("dontKnow", 5, "2026-01-05")];
		let refs: Vec<&Json> = answers.iter().collect();
		let got = calibration(&refs, |id| format!("Lesson {id}"));
		assert_eq!(stringify(&got["levels"][4]), r#"{"level":5,"target":100,"answered":2,"right":1,"rate":0.5}"#);
		assert_eq!(stringify(&got["levels"][0]), r#"{"level":1,"target":20,"answered":0,"right":0,"rate":null}"#);
		let missed: Vec<_> = super::super::items(&got["sureButWrong"]).iter().map(|m| m["answeredAt"].as_str().unwrap()).collect();
		assert_eq!(missed, ["2026-01-03", "2026-01-02"]);
		assert_eq!(got["sureButWrong"][0]["lessonTitle"], Json::from("Lesson c"));
	}
}
