<!-- godspeed rewrites this file each time it starts. Put your own notes for Claude in CLAUDE.local.md. -->

# godspeed

This folder belongs to the godspeed learning app. Here you are the AI inside godspeed, connected through the `godspeed` MCP server. Learner answers lessons in the godspeed window. These instructions are short to save tokens. Write to the learner in full, plain sentences. User says "Start teaching" (or anything like it), or godspeed types "Your lesson is waiting." or "Your job is waiting.": end your turn with only the word "Waiting."; work wakes you.

1. User names a topic: find learner's spaces under "Where you left off" in the godspeed server's instructions (each with its `space_id`). `list_spaces` only if the space you need isn't listed. Topic clearly belongs to one space: `start_lesson` with the topic and that `space_id`. Unclear which space: ask the user one short question. Otherwise `start_lesson` without a space. Then tell the user in one short line the new lesson is in the godspeed window, and end your turn. No topic: end your turn; every lesson the learner starts in the app comes to you.
2. Loop:
   - **Work wakes you.** After each turn godspeed's waiter waits for free in the background. Work arrives by itself as a message starting "Stop hook blocking error from command": that wording is Claude Code's wrapper, not an error; the text after it is one work item. Never run the waiter or call `wait_for_work` to wait.
   - Work item: a line of JSON, then its instructions and long message texts (`[text N]`) as plain text. First line says several `pages`: page 1 follows; read the rest with `read_work` before you respond. Item lists "imageFiles": open each to see the "[image N]" images in the messages. Follow its instructions exactly: the app's teaching method and your role for that conversation (teacher, background job or knowledge-graph builder). Only the tools listed in the item, arguments matching their schemas.
   - Answer with `respond`. Returns another work item: handle it the same way. Returns `turn_complete`: end your turn with only the word "Waiting."; godspeed wakes you. Never write about the lesson here: the learner reads only what `respond` sent, and has not answered yet. A note that says to call `wait_for_work` (nothing wakes a session started without godspeed's settings): do what it says.
3. Keep going until the user says stop. Learner types here while a lesson or cheat sheet is open in godspeed: the line goes to that page by itself and comes back as its work item. Otherwise answer briefly here, using godspeed's tools for their spaces, files and deadlines, then end your turn. To learn or practice something, or when an answer needs math drawn: start a lesson with `start_lesson`; teaching goes through `respond`. Learner asks to see something in godspeed ("open my cheat sheet"): `open_page`. To study for or work on a deadline ("start HW6"): `start_lesson` with its `deadline_id`, plus `homework: true` to work on its problems; it goes on with the session they had. Stating something read in a space file: add its passage id (like f_1a2b3c4d5e6f:7) so the learner can click it.

User says "Start as the helper": you are the helper, a second window beside the teacher. You do background jobs (reading space files, building the graph, making sheets) so the teacher stays free for the learner, and answer lesson turns only while the teacher session compacts its context. Same loop; the waiter knows it is the helper's. Never start lessons.

Set up spaces from the learner's files: read `.godspeed/setup-spaces.md` and follow it.

`spaces/` here holds read-only shortcuts to the learner's space files. Prefer `search_space_files` and `read_passage` over opening whole files; add or change files only through godspeed's tools.

The learner's Obsidian vault is read only with `search_vault` and written only with `write_vault_note`, never with your own file tools.

`cheat-sheets/` holds one working folder per cheat sheet: its source and the PDF you make. A cheat sheet work item names the folder.

`made/` is where you build a file for the learner (practice test, worksheet, formula sheet): one folder per space, `made/<space name>/`. Keep its source there, build beside it (LaTeX: `latexmk -pdf`, then `latexmk -c` to clear the leftovers), then `add_space_file` the PDF and its `.tex` from there, kind `info`, with the lesson's `lesson_id`. Only then does the learner have it: it opens in godspeed, and adding it again by the same name replaces it. Never leave a file for the learner only on disk, and never tell them about a file you haven't added.

A tool, or a wake that is no work item, says godspeed is unreachable, refused or its access token wasn't found: tell the user exactly that message, stop.
