//! The space tools' descriptions and argument texts (src/shared/core/space-tools.ts). They go to
//! outside agents and the Talk chat, so they stay word for word the same as the TypeScript's.

use std::sync::LazyLock;

use crate::contracts::space::{SPACE_ICONS, SIGNATURE_MAX};

/// Each tool's description, by tool name, in source order.
pub const SPACE_TOOL_TEXT: [(&str, &str); 13] = [
	("list_spaces", "List the learner's spaces, archived ones included, with file and lesson counts."),
	("read_space", "Read one space: its description, how many files are in each status (pending, extracting, ready, failed, needs-whisper) and the files that could not be read, the topics of its knowledge graph with their fact counts, its deadlines (kind, date, time, done, and the files each covers), its lessons, and today's local date and time. With files: true it lists every file instead (id, kind, status, size, path on disk). To find something inside the files, use search_space_files."),
	("search_space_files", "Search all of a space's files (readings, slides, transcripts, syllabus, assignments) by meaning and keywords. Returns the best passages, each with its id, file, place (page, slide, time or lines) and a short snippet. Open the ones you need with read_passage instead of reading whole files."),
	("read_passage", "Read one passage of a space file by its id from search_space_files, or a file's passages at a place (file_id + range, e.g. a whole page). Returns the text with the ids of the passages before and after it, to keep reading."),
	("create_space", "Create a space for one thing the learner is studying (a university course, a certification, a language). The description is shown to the teacher in every lesson of the space: level, the book or source they follow, its notation, what they are working toward (a course's exams, an interview). Add the space's deadlines with add_space_deadline."),
	("update_space", "Rename a space, change its description, signature or icon, or archive / unarchive it (archiving hides it from the space switcher but keeps everything; an archived space takes no new lessons)."),
	("add_space_file", "Copy a file from this computer into a space, or write one with name and text instead of path (one you wrote before by that name is replaced and keeps its id). Supported: .md .txt, code files (.c .py .java .js and the like), plain text with no extension, .pdf .docx .pptx .epub, .vtt .srt (transcripts) and .mp3 .m4a .wav .mp4 .mov (recordings, transcribed locally with whisper.cpp). Google Docs links (.gdoc) need saving as PDF or Word first. Study files are turned into facts by you, through wait_for_work."),
	("set_space_file_kind", "Switch one or more space files between study material and space info. Study → info removes their facts; info → study builds them. A file that can't be switched is listed under refused; the others still switch."),
	("add_space_deadline", "Add one or more deadlines to a space (send all of a space's deadlines in one call): exams, homework, quizzes, projects and interviews, each with its date, its time if it has one, and which of the space's files (notes, readings) it covers. godspeed uses this to show the learner what is due and what to work on first. Take the deadlines, their dates and times from the space info files (a syllabus, a schedule), and never make up a date or time. Work out what a deadline covers from the space's own files first: a practice exam or review sheet, the schedule, announcements (search_space_files). Link the files they point to (file_ids), list files from before it that it doesn't cover in left_out_ids, and say in source which file it came from. Ask only when the files don't settle it. File ids come from read_space with files: true. A deadline that is refused is listed under refused with the reason; the others are still added, so send only the refused ones again. For an interview: add the posting as space info, the interview with its date and time, What it's like.md as about_file_id, and a Study guide.md you write (study) in file_ids."),
	("update_space_deadline", "Change a deadline's kind, name, date, time, covered files, left-out files, source, assignment file or about file, or tick it done (done: true) or not done (done: false). file_ids and left_out_ids each replace the whole list (a file is never in both); time: null, source: null, assignment_file_id: null and about_file_id: null remove them. Work out coverage from the space's own files as add_space_deadline says; ask the learner when the files don't settle it."),
	("remove_space_deadline", "Remove one deadline from a space (its files and facts are not touched)."),
	("link_space_folder", "Link a folder on this computer to a space. Its supported files are added, and from then on new files dropped there are added automatically and edited files are rebuilt (checked every minute while godspeed is open). godspeed sorts them into study material and space info itself while reading them, and never changes the folder. Use set_space_file_kind only to correct a kind."),
	("start_lesson", "Start a new study session in godspeed taught by you: you teach what is new and give problems on what needs practice. The topic becomes the learner's first message. With space_id the lesson belongs to that space: it opens with the space's card and its facts go into that space's graph. You teach it through wait_for_work; the learner follows along in the godspeed window."),
];

/// The argument descriptions both tool schemas share.
pub struct SpaceArgText {
	pub files: &'static str,
	pub query: &'static str,
	pub limit: &'static str,
	pub passage_id: &'static str,
	pub file_id: &'static str,
	pub range: &'static str,
	pub name: &'static str,
	pub description: &'static str,
	pub signature: String,
	pub icon: String,
	pub file_path: &'static str,
	pub file_name: &'static str,
	pub file_text: &'static str,
	pub folder_path: &'static str,
	pub file_kind: &'static str,
	pub file_ids: &'static str,
	pub deadline_kind: &'static str,
	pub deadline_name: &'static str,
	pub date: &'static str,
	pub time: &'static str,
	pub covered_files: &'static str,
	pub left_out_files: &'static str,
	pub source: &'static str,
	pub assignment_file: &'static str,
	pub about_file: &'static str,
	pub about_file_change: &'static str,
	pub new_time: &'static str,
	pub topic: &'static str,
	pub lesson_space: &'static str,
}

pub static SPACE_ARG_TEXT: LazyLock<SpaceArgText> = LazyLock::new(|| SpaceArgText {
	files: "List every file with its id (needed for file_ids). Default false.",
	query: "What to look for, in plain words.",
	limit: "Most passages to return (default 8).",
	passage_id: "A passage id from search_space_files (or a previous/next id).",
	file_id: "Instead of passage_id: a file id from read_space, with range.",
	range: "With file_id: the place, e.g. \"p. 12\", \"slide 4\", \"section 3\", \"12:30\" or \"lines 40\".",
	name: "The space's name, e.g. \"MATH 20C – Calculus III\" or \"Conversational Spanish\".",
	description: "What the teacher should know about the space, in the learner's terms.",
	signature: format!("The space's signature: ONE line that sums up the subject, shown huge on the space's cover. kind \"math\" = LaTeX without $ (math, physics, chemistry, economics), \"code\" = a line of code (programming spaces), \"text\" = anything else (a line from a primary source, a sequence, a date). At most {SIGNATURE_MAX} characters. Pick something iconic for the subject; ask the learner when unsure."),
	icon: format!("The space's subject icon in the space switcher: {}. Pick the closest subject.", SPACE_ICONS.iter().map(|(icon, subject)| format!("\"{icon}\" {subject}")).collect::<Vec<_>>().join(", ")),
	file_path: "The file's absolute path.",
	file_name: "Instead of path: the new file's name, e.g. \"Study guide.md\".",
	file_text: "With name: its text, in Markdown, up to 20,000 characters.",
	folder_path: "The folder's absolute path.",
	file_kind: "\"study\" = study material turned into graph facts (notes, readings, transcripts, recordings); \"info\" = space info the teacher can read but that never becomes facts (a syllabus, a schedule, logistics).",
	file_ids: "The files to switch (ids from read_space with files: true).",
	deadline_kind: "What the deadline is.",
	deadline_name: "e.g. \"Midterm 1\", \"Homework 5\".",
	date: "The due day as YYYY-MM-DD.",
	time: "The due time as 24-hour \"HH:MM\" on this computer's clock. Leave it out when there is none (it then counts as due at the end of the day).",
	covered_files: "Ids of the space files it covers.",
	left_out_files: "Ids of space files from before it that it does NOT cover (e.g. lectures after the practice exam's last topic). The learner's page stops flagging them as missing.",
	source: "Where you found what it covers, e.g. the practice exam's file name. The learner sees it.",
	assignment_file: "For homework and projects: the id of the space file with its problems (the assignment sheet). The learner works on its problems in godspeed.",
	about_file: "Exams, quizzes and interviews: the id of a space info file on what it is like (\"What it's like.md\", written with add_space_file). Search the space files and the web first; under 200 words; name only sources you read.",
	about_file_change: "The id of the space info file on what it is like (see add_space_deadline), or null to remove it.",
	new_time: "24-hour \"HH:MM\", or null to remove the time.",
	topic: "What the learner wants to study, in their words.",
	lesson_space: "The space id from list_spaces, or \"none\" for lessons without a space (the default).",
});
