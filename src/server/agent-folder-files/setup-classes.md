---
name: setup-classes
description: Set up the learner's classes in godspeed (courses, descriptions, files, linked folders, deadlines)
argument-hint: "[what to set up, e.g. 'my 4 fall classes from ~/School']"
---

You are setting up the learner's classes in the godspeed learning app, connected through the `godspeed` MCP server. A class is a university course: it has its own lessons, its own knowledge graph, a description the teacher reads, and files.

Request: $ARGUMENTS

1. Call `list_classes` first so you never create a duplicate.
2. For each course the learner names (or that you find in a folder they point you to, e.g. one subfolder per course):
   - `create_class` with the course's name and a short description in the learner's terms: level, textbook, the professor's notation, what exams look like. Ask the learner when you don't know; don't invent course details.
   - Give it a `signature`: ONE line that sums up the subject, shown huge on the class's cover. `math` for a formula in LaTeX (math, physics, chemistry, economics), `code` for a line of code (programming classes), `text` for anything else (a line from a primary source, a sequence, a date). At most 60 characters. Pick something iconic for the course; ask the learner when unsure.
   - Give it an `icon`: the subject icon shown in the class switcher (`create_class` lists the choices). Pick the closest subject without asking; the learner can change it in Edit class.
   - Add files. If the course has a folder on this computer, prefer `link_class_folder`: everything supported in it is added as study material, and new files dropped in later are added automatically. Otherwise use `add_class_file` with the file's absolute path.
   - Pick each file's kind: `study` for material to learn from (lecture notes, readings, slides, transcripts, recordings). `info` for logistics (syllabus, assignment sheets, grading, schedules). After linking a folder, get the file ids from `read_class` with `files: true` and switch all the logistics files to `info` in one `set_class_file_kind` call (`file_ids`).
   - Add every deadline from the syllabus or course info in one `add_class_deadline` call (`deadlines`): exams, homework, quizzes and projects. Give each its `kind` (`exam`, `homework`, `quiz` or `project`), its name, its date (YYYY-MM-DD), its time (24-hour HH:MM) when the syllabus gives one, and `file_ids` = the study files (lectures, readings) it covers. Get the file ids from `read_class` with `files: true`. If the syllabus doesn't say when something is due or what it covers, ask the learner; don't guess dates, times or coverage. If some deadlines come back under `refused`, fix and send only those again. Fix mistakes with `update_class_deadline` / `remove_class_deadline`.
3. Call `read_class` to check each class. Report the files under `failedFiles` with their error. `needs-whisper` means the learner needs to run `brew install whisper-cpp ffmpeg`.
4. Give one short summary per class: name, number of files, its deadlines with dates, and anything the learner must do.
5. Start the work loop from CLAUDE.md so the files get read: run `node .godspeed/wait-for-work.mjs` with the Bash tool and `run_in_background: true`, then end your turn. Never poll its output file. When it finishes, read its output file: it holds one work item. Follow the item's `instructions`, answer with `respond`, and start the waiter again after each `turn_complete`. Reading the files does not progress until you run this loop.

Rules:
- Never delete anything. Deleting a class is only possible in the godspeed window.
- Supported files: .md .txt .pdf .vtt .srt .mp3 .m4a .wav .mp4 .mov. Skip others and say so.
- Turning study files into facts is work for you (the connected agent): it comes through `wait_for_work`, and it waits until an agent is taking work. Large folders take a while; progress shows in the godspeed window.
- To teach inside a class afterwards, use `start_lesson` with the class's `class_id`.

If a tool says godspeed is unreachable or its access token was not found, tell the user exactly that message and stop.
