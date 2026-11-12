---
name: setup-spaces
description: Set up the learner's spaces in godspeed (names, descriptions, files, linked folders, deadlines)
argument-hint: "[what to set up, e.g. 'my 4 fall courses from ~/School' or 'a space for my Spanish notes']"
---

You are setting up the learner's spaces in the godspeed learning app, connected through the `godspeed` MCP server. A space is one thing the learner is studying (a university course, a certification, a language): it has its own lessons, its own knowledge graph, a description the teacher reads, and files.

Request: $ARGUMENTS

1. Call `list_spaces` first so you never create a duplicate.
2. For each space the learner names (or that you find in a folder they point you to, e.g. one subfolder per subject):
   - `create_space` with its name and a short description in the learner's terms: level, the book or source they follow, its notation, what they are working toward (a course's exams, an interview). Ask the learner when you don't know; don't invent details.
   - Give it a `signature`: ONE line that sums up the subject, shown huge on the space's cover. `math` for a formula in LaTeX (math, physics, chemistry, economics), `code` for a line of code (programming spaces), `text` for anything else (a line from a primary source, a sequence, a date). At most 60 characters. Pick something iconic for the subject; ask the learner when unsure.
   - Give it an `icon`: the subject icon shown in the space switcher (`create_space` lists the choices). Pick the closest subject without asking; the learner can change it in Edit space.
   - Add files. If the space has a folder on this computer, prefer `link_space_folder`: everything supported in it is added, new files dropped in later are added automatically, and godspeed sorts them into study material and space info itself while reading them. Otherwise use `add_space_file` with the file's absolute path and its kind: `study` for material to learn from (lecture notes, readings, slides, transcripts, recordings), `info` for logistics (syllabus, assignment sheets, grading, schedules). Fix a wrong kind with `set_space_file_kind` (`file_ids`).
   - Add every deadline from the space info files (a syllabus, a schedule) in one `add_space_deadline` call (`deadlines`): exams, homework, quizzes and projects. Give each its `kind` (`exam`, `homework`, `quiz` or `project`), its name, its date (YYYY-MM-DD), its time (24-hour HH:MM) when the file gives one, and `file_ids` = the study files (lectures, readings) it covers. Get the file ids from `read_space` with `files: true`. Work out what a deadline covers from the space's own files first: a practice exam or review sheet, the schedule, announcements (`search_space_files`). Link the files they point to, put files from before it that it doesn't cover in `left_out_ids`, and say which file it came from in `source`. Ask the learner only when the files don't settle it. Never make up dates or times. If some deadlines come back under `refused`, fix and send only those again. Fix mistakes with `update_space_deadline` / `remove_space_deadline`.
3. Call `read_space` to check each space. Report the files under `failedFiles` with their error. `needs-whisper` means the learner needs to run `brew install whisper-cpp ffmpeg`.
4. Give one short summary per space: name, number of files, its deadlines with dates, and anything the learner must do.
5. Start the work loop from CLAUDE.md so the files get read: run `node .godspeed/wait-for-work.mjs` with the Bash tool and `run_in_background: true`, then end your turn. Never poll its output file. When it finishes, read its output file: it holds one work item. Follow the item's instructions, answer with `respond`, and start the waiter again after each `turn_complete`. Reading the files does not progress until you run this loop.

Rules:
- Never delete anything. Deleting a space is only possible in the godspeed window.
- Supported files: .md .txt, code files (.c .py .java .js and the like), plain text with no extension, .pdf .docx .pptx, .vtt .srt, .mp3 .m4a .wav .mp4 .mov. Google Docs links (.gdoc) can't be read: ask the learner to save them as PDF or Word. Skip others and say so.
- Turning study files into facts is work for you (the connected agent): it comes through `wait_for_work`, and it waits until an agent is taking work. Large folders take a while; progress shows in the godspeed window.
- To teach inside a space afterwards, use `start_lesson` with the space's `space_id`.

If a tool says godspeed is unreachable or its access token was not found, tell the user exactly that message and stop.
