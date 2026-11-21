//! The Obsidian Base file for one space's folder: its notes grouped by confidence. It follows
//! the owner's Concepts.base, but filters by folder, since `this.class` needs a note to embed
//! the Base.

use super::note_keys::{DEADLINES_KEY, MISTAKES_KEY, NEXT_REVIEW_KEY, OWNER_KEY, STANDING_KEY};

/// The text of `<space name>.base` for the notes in `folder`, the folder's name in the vault.
pub fn base_text(folder: &str) -> String {
	let folder = folder.replace('\\', "\\\\").replace('"', "\\\"");
	format!(
		r#"filters:
  and:
    - file.inFolder("{folder}")
    - file.ext == "md"
    - note.{OWNER_KEY} != null
formulas:
  rank: if(note.{STANDING_KEY} == "shaky", 1, if(note.{STANDING_KEY}.isEmpty(), 2, if(note.{STANDING_KEY} == "ok", 3, 4)))
  status: if(note.{STANDING_KEY}.isEmpty(), "Not tried yet", if(note.{STANDING_KEY} == "shaky", "Shaky", if(note.{STANDING_KEY} == "ok", "OK", "Solid")))
  mistake_count: if(note.{MISTAKES_KEY}.isEmpty(), 0, note.{MISTAKES_KEY}.length)
properties:
  file.name:
    displayName: Idea
  formula.status:
    displayName: Confidence
  formula.mistake_count:
    displayName: Mistakes
  note.{MISTAKES_KEY}:
    displayName: Kind
  note.{DEADLINES_KEY}:
    displayName: Test
  note.{NEXT_REVIEW_KEY}:
    displayName: Review on
views:
  - type: table
    name: By confidence
    groupBy:
      property: {STANDING_KEY}
      direction: ASC
    groupOrder:
      -
      - shaky
      - ok
      - solid
    order:
      - file.name
      - {DEADLINES_KEY}
      - formula.mistake_count
      - {MISTAKES_KEY}
      - {NEXT_REVIEW_KEY}
    sort:
      - property: file.name
        direction: ASC
    columnSize:
      file.name: 340
      formula.mistake_count: 120
"#
	)
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn filters_by_the_folder_and_groups_empty_shaky_ok_solid() {
		let text = base_text("CSE 21");
		assert!(text.contains("- file.inFolder(\"CSE 21\")\n"));
		assert!(!text.contains("this.class"));
		assert!(text.contains("groupBy:\n      property: confidence\n"));
		assert!(text.contains("groupOrder:\n      -\n      - shaky\n      - ok\n      - solid\n"));
		assert!(text.contains("displayName: Confidence") && text.contains("displayName: Idea"));
	}

	#[test]
	fn a_folder_name_with_a_quote_or_backslash_cannot_break_the_filter() {
		assert!(base_text("A \"B\" \\ C").contains(r#"file.inFolder("A \"B\" \\ C")"#));
	}
}
