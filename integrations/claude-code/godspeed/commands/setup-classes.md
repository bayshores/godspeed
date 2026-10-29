---
description: Set up the learner's classes in godspeed (courses, descriptions, files, linked folders, deadlines)
argument-hint: "[what to set up, e.g. 'my 4 fall classes from ~/School']"
---

You are setting up the learner's classes in the godspeed learning app, connected through the `godspeed` MCP server. A class is a university course: it has its own lessons, its own knowledge graph, a description the teacher reads, and files.

Request: $ARGUMENTS

1. Call `list_classes` first so you never create a duplicate.
2. For each course the learner names (or that you find in a folder they point you to, e.g. one subfolder per course):
   - `create_class` with the course's name and a short description in the learner's terms: level, textbook, the professor's notation, what exams look like. Ask the learner when you don't know; don't invent course details.
   - Give it a `signature`: ONE line that sums up the subject, shown huge on the class's cover. `math` for a formula in LaTeX (math, physics, chemistry, economics), `code` for a line of code (programming classes), `text` for anything else (a line from a primary source, a sequence, a date). At most 60 characters. Pick something iconic for the course; ask the learner when unsure.
   - Add files. If the course has a folder on this computer, prefer `link_class_folder`: everything supported in it is added as study material, and new files dropped in later are added automatically. Otherwise use `add_class_file` with the file's absolute path.
   - Pick each file's kind: `study` for material to learn from (lecture notes, readings, slides, transcripts, recordings). `info` for logistics (syllabus, assignment sheets, grading, schedules). After linking a folder, switch the logistics files to `info` with `set_class_file_kind`.
   - Add every deadline from the syllabus or course info with `add_class_deadline`: exams, homework, quizzes and projects. Give each its `kind` (`exam`, `homework`, `quiz` or `project`), its name, its date (YYYY-MM-DD), its time (24-hour HH:MM) when the syllabus gives one, and `file_ids` = the study files (lectures, readings) it covers. Get the file ids from `read_class`. If the syllabus doesn't say when something is due or what it covers, ask the learner; don't guess dates, times or coverage. Fix mistakes with `update_class_deadline` / `remove_class_deadline`.
3. Call `read_class` to check each class. Report files whose status is `failed` or `needs-whisper` with their error. `needs-whisper` means the learner needs to run `brew install whisper-cpp ffmpeg`.
4. Finish with one short summary per class: name, number of files, its deadlines with dates, and anything the learner must do.

Rules:
- Never delete anything. Deleting a class is only possible in the godspeed window.
- Supported files: .md .txt .pdf .vtt .srt .mp3 .m4a .wav .mp4 .mov. Skip others and say so.
- Turning study files into facts uses the learner's background model. Large folders take a while; progress shows in the godspeed window.
- To teach inside a class afterwards, use `/godspeed:teach`, or `start_lesson` with the class's `class_id`.

If a tool says godspeed is unreachable or its access token was not found, tell the user exactly that message and stop.
