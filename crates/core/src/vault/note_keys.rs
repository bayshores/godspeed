//! The only place the note file's property names are written. They are the owner's own keys;
//! everywhere else the app says "space", "deadline" and "standing".

use crate::study::progress::TopicStatus;

pub const SPACE_KEY: &str = "class";
pub const DEADLINES_KEY: &str = "test";
pub const STANDING_KEY: &str = "confidence";
pub const ANSWERED_KEY: &str = "answered";
pub const MISTAKES_KEY: &str = "mistakes";
pub const NEXT_REVIEW_KEY: &str = "next_review";
pub const OWNER_KEY: &str = "godspeed";
pub const FACTS_KEY: &str = "facts";
pub const UP_KEY: &str = "up";
/// The value of `godspeed` that hands a learner's own note to godspeed.
pub const KEEP: &str = "keep";

/// The word the file holds for a standing; an untested topic leaves the key empty.
pub fn confidence_word(status: TopicStatus) -> Option<&'static str> {
	match status {
		TopicStatus::Weak => Some("shaky"),
		TopicStatus::Shaky => Some("ok"),
		TopicStatus::Strong => Some("solid"),
		TopicStatus::Untested => None,
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn every_standing_has_its_word() {
		assert_eq!(confidence_word(TopicStatus::Weak), Some("shaky"));
		assert_eq!(confidence_word(TopicStatus::Shaky), Some("ok"));
		assert_eq!(confidence_word(TopicStatus::Strong), Some("solid"));
		assert_eq!(confidence_word(TopicStatus::Untested), None);
	}
}
