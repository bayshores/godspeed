//! The class tools' descriptions and argument texts (src/shared/core/class-tools.ts). They go to
//! outside agents and the Talk chat, so they stay word for word the same as the TypeScript's.

use std::sync::LazyLock;

use crate::contracts::class::{CLASS_ICONS, SIGNATURE_MAX};

/// Each tool's description, by tool name, in source order.
pub const CLASS_TOOL_TEXT: [(&str, &str); 13] = [
	("list_classes", "List the learner's classes (university courses), archived ones included, with file and lesson counts."),
	("read_class", "Read one class: its description, how many files are in each status (pending, extracting, ready, failed, needs-whisper) and the files that could not be read, the topics of its knowledge graph with their fact counts, its deadlines (kind, date, time, done, and the files each covers), its lessons, and today's local date and time. With files: true it lists every file instead (id, kind, status, size, path on disk). To find something inside the files, use search_class_files."),
	("search_class_files", "Search all of a class's files (readings, slides, transcripts, syllabus, assignments) by meaning and keywords. Returns the best passages, each with its id, file, place (page, slide, time or lines) and a short snippet. Open the ones you need with read_passage instead of reading whole files."),
	("read_passage", "Read one passage of a class file by its id from search_class_files, or a file's passages at a place (file_id + range, e.g. a whole page). Returns the text with the ids of the passages before and after it, to keep reading."),
	("create_class", "Create a class for a course the learner is taking. The description is shown to the teacher in every lesson of the class: level, textbook, the professor's notation, what exams and assignments look like. Add the class's deadlines with add_class_deadline."),
	("update_class", "Rename a class, change its description, signature or icon, or archive / unarchive it (archiving hides it from the class switcher but keeps everything; an archived class takes no new lessons)."),
	("add_class_file", "Copy a file from this computer into a class. Supported: .md .txt, code files (.c .py .java .js and the like), plain text with no extension, .pdf .docx .pptx, .vtt .srt (transcripts) and .mp3 .m4a .wav .mp4 .mov (recordings, transcribed locally with whisper.cpp). Google Docs links (.gdoc) need saving as PDF or Word first. Study files are turned into facts by you, through wait_for_work."),
	("set_class_file_kind", "Switch one or more class files between study material and course info. Study → info removes their facts; info → study builds them. A file that can't be switched is listed under refused; the others still switch."),
	("add_class_deadline", "Add one or more deadlines to a class (send all of a syllabus's deadlines in one call): exams, homework, quizzes and projects, each with its date, its time if it has one, and which of the class's files (lecture notes, readings) it covers. godspeed uses this to show the learner what is due and what to work on first. Take the deadlines, their dates and times from the syllabus or course info, and never make up a date or time. Work out what a deadline covers from the class's own files first: a practice exam or review sheet, the syllabus schedule, announcements (search_class_files). Link the lectures they point to (file_ids), list files from before it that it doesn't cover in left_out_ids, and say in source which file it came from. Ask only when the files don't settle it. File ids come from read_class with files: true. A deadline that is refused is listed under refused with the reason; the others are still added, so send only the refused ones again."),
	("update_class_deadline", "Change a deadline's kind, name, date, time, covered files, left-out files, source or assignment file, or tick it done (done: true) or not done (done: false). file_ids and left_out_ids each replace the whole list (a file is never in both); time: null, source: null and assignment_file_id: null remove them. Work out coverage from the class's own files as add_class_deadline says; ask the learner when the files don't settle it."),
	("remove_class_deadline", "Remove one deadline from a class (its files and facts are not touched)."),
	("link_class_folder", "Link a folder on this computer to a class. Its supported files are added, and from then on new files dropped there are added automatically and edited files are rebuilt (checked every minute while godspeed is open). godspeed sorts them into study material and course info itself while reading them, and never changes the folder. Use set_class_file_kind only to correct a kind."),
	("start_lesson", "Start a new study session in godspeed taught by you: you teach what is new and give problems on what needs practice. The topic becomes the learner's first message. With class_id the lesson belongs to that class: it opens with the class's card and its facts go into that class's graph. You teach it through wait_for_work; the learner follows along in the godspeed window."),
];

/// The argument descriptions both tool schemas share.
pub struct ClassArgText {
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
	pub new_time: &'static str,
	pub topic: &'static str,
	pub lesson_class: &'static str,
}

pub static CLASS_ARG_TEXT: LazyLock<ClassArgText> = LazyLock::new(|| ClassArgText {
	files: "List every file with its id (needed for file_ids). Default false.",
	query: "What to look for, in plain words.",
	limit: "Most passages to return (default 8).",
	passage_id: "A passage id from search_class_files (or a previous/next id).",
	file_id: "Instead of passage_id: a file id from read_class, with range.",
	range: "With file_id: the place, e.g. \"p. 12\", \"slide 4\", \"12:30\" or \"lines 40\".",
	name: "The course, e.g. \"MATH 20C – Calculus III\".",
	description: "What the teacher should know about the course, in the learner's terms.",
	signature: format!("The class's signature: ONE line that sums up the subject, shown huge on the class's cover. kind \"math\" = LaTeX without $ (math, physics, chemistry, economics), \"code\" = a line of code (programming classes), \"text\" = anything else (a line from a primary source, a sequence, a date). At most {SIGNATURE_MAX} characters. Pick something iconic for the course; ask the learner when unsure."),
	icon: format!("The class's subject icon in the class switcher: {}. Pick the closest subject.", CLASS_ICONS.iter().map(|(icon, subject)| format!("\"{icon}\" {subject}")).collect::<Vec<_>>().join(", ")),
	file_path: "The file's absolute path.",
	folder_path: "The folder's absolute path.",
	file_kind: "\"study\" = study material turned into graph facts (notes, readings, transcripts, recordings); \"info\" = course info the teacher can read but that never becomes facts (syllabus, assignments, logistics).",
	file_ids: "The files to switch (ids from read_class with files: true).",
	deadline_kind: "What the deadline is.",
	deadline_name: "e.g. \"Midterm 1\", \"Homework 5\".",
	date: "The due day as YYYY-MM-DD.",
	time: "The due time as 24-hour \"HH:MM\" on this computer's clock. Leave it out when there is none (it then counts as due at the end of the day).",
	covered_files: "Ids of the class files it covers.",
	left_out_files: "Ids of class files from before it that it does NOT cover (e.g. lectures after the practice exam's last topic). The learner's page stops flagging them as missing.",
	source: "Where you found what it covers, e.g. the practice exam's file name. The learner sees it.",
	assignment_file: "For homework and projects: the id of the class file with its problems (the assignment sheet). The learner works on its problems in godspeed.",
	new_time: "24-hour \"HH:MM\", or null to remove the time.",
	topic: "What the learner wants to study, in their words.",
	lesson_class: "The class id from list_classes, or \"none\" for lessons without a class (the default).",
});
