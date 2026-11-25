# Architecture

godspeed is a desktop learning app: Tauri shell, Rust server, React window. An outside agent (Claude Code, Codex or another MCP app) does every model call. Where doc and code disagree, the code is right and the doc gets fixed.

Read only the files your task touches. A "§N" in any doc is the file that starts with that number. See [development.md](../development.md) for commands, file layout and testing, [rust-server.md](../rust-server.md) for crates and server process, [tauri-shell/README.md](../tauri-shell/README.md) for the shell.

| File | Read when |
|---|---|
| [01-the-model-and-who-writes-what.md](01-the-model-and-who-writes-what.md) | You need the shape of the app and which system writes which data. |
| [02-layers-and-the-import-law.md](02-layers-and-the-import-law.md) | You add an import, a module or a contract. Also holds §2.1 core barrel and §2.2 contracts. |
| [03-stores-ports-and-the-composition-roots.md](03-stores-ports-and-the-composition-roots.md) | You add a data file, a store or a port. |
| [04-how-the-systems-talk.md](04-how-the-systems-talk.md) | You touch a protocol between window, server, shell or agent. |
| [05-one-chat-turn.md](05-one-chat-turn.md) | You change a chat turn, question tools, side questions, attachments, the plan tree, jobs, compaction or the wake pipeline (§5.1). |
| [05.2-the-lesson-page.md](05.2-the-lesson-page.md) | You change the lesson page's layout: the step line, the lesson text, the turn beside the text or under it, the pinned problem, the writing row, where the page rests. |
| [05.3-the-agent-session.md](05.3-the-agent-session.md) | You change how a lesson's turn runs on the learner's agent: its session, what each turn sends, rollover, the reply checks, Stop, permission questions. |
| [05.4-background-jobs.md](05.4-background-jobs.md) | You change how a background job runs on the learner's agent: its one-off session, the agent it runs on, the pool, a job's permission questions, the catch-up. |
| [06-the-knowledge-graph.md](06-the-knowledge-graph.md) | You change extraction, merging, the graph read side or the Graph page. |
| [06.1-spaces.md](06.1-spaces.md) | You change spaces, linked folders, deadlines, deadline requests, space checks or picking files on the Files page. |
| [06.2-interviews-and-mocks.md](06.2-interviews-and-mocks.md) | You change interview, online assessment or test prep. |
| [06.3-paths.md](06.3-paths.md) | You change a space's path toward a goal. |
| [06.4-source-marks-and-page-pieces.md](06.4-source-marks-and-page-pieces.md) | You change how source marks are written, checked or shown, or how a problem taken from a PDF shows as a piece of its page. |
| [06.5-problem-lists.md](06.5-problem-lists.md) | You change where a deadline's or a file's problems and done marks are kept. |
| [06.6-deadline-reminders-and-the-menu-bar.md](06.6-deadline-reminders-and-the-menu-bar.md) | You change the daily deadline notification or the Mac menu bar countdown. The shell's side is in [magnifier-menu-bar-and-icon.md](../tauri-shell/magnifier-menu-bar-and-icon.md). |
| [06.7-cheat-sheets.md](06.7-cheat-sheets.md) | You change a deadline's cheat sheet: its record, its chat or its studio. |
| [06.8-gaps.md](06.8-gaps.md) | You change how a deadline that looks missing is found, waved off or named to the teacher, or which agent adds are saved done. |
| [07-study-sessions.md](07-study-sessions.md) | You change how a lesson starts, runs or ends, kept sentences or the chain table. |
| [07.1-while-the-teacher-works.md](07.1-while-the-teacher-works.md) | You change what the lesson shows while the teacher works or how its reply lands. |
| [07.2-lessons-on-files-and-homework.md](07.2-lessons-on-files-and-homework.md) | You change a lesson on files, the Document panel or homework sessions. |
| [07.3-plots.md](07.3-plots.md) | You change the plot the teacher draws in a multiple-choice lesson. |
| [08-process-boundaries.md](08-process-boundaries.md) | You need the shell and server split before reading 8.1 to 8.2. |
| [08.1-the-outside-agent-boundary.md](08.1-the-outside-agent-boundary.md) | You change agent access, or when an agent counts as connected. |
| [08.1.1-the-godspeed-folder.md](08.1.1-the-godspeed-folder.md) | You change the godspeed folder, the spaces folder or the agent start script. |
| [08.1.2-the-teachers-round-and-the-strip.md](08.1.2-the-teachers-round-and-the-strip.md) | You change what opens when the teacher in the terminal starts or opens something, the teacher's round of work, or the strip down the window's right edge. |
| [08.1.3-agent-tools-and-notes.md](08.1.3-agent-tools-and-notes.md) | You change the other agent tools, agent notes, saved rules or web search. |
| [08.1.4-claude-codes-start.md](08.1.4-claude-codes-start.md) | You change the arguments, settings or flags every Claude Code start passes. |
| [08.1.6-vault-notes.md](08.1.6-vault-notes.md) | You change the notes folder, Obsidian notes, `write_vault_note`, `search_vault` or the pass that sends them. |
| [08.1.7-follows-slip.md](08.1.7-follows-slip.md) | You change Follow's slip at the page's foot, the teacher's timeline, or the marks on what it changed. |
| [08.1.8-the-teacher-panels-chat.md](08.1.8-the-teacher-panels-chat.md) | You change the teacher panel's chat: talk chat records, their tools and prompt, the Chats list, the model key, pop out, or the old terminal chats carried over. |
| [08.2-plugins.md](08.2-plugins.md) | You change how the app hosts a plugin. Writing one is in [plugins/README.md](../plugins/README.md). |
| [09-invariants.md](09-invariants.md) | You want the rules that always hold and what the build enforces. |
| [10-events-and-observability.md](10-events-and-observability.md) | You change logging, the events channel or what still polls. Also holds §10.1 to §10.5. |
| [11-testing.md](11-testing.md) | You add a test. |
| [12-the-seam-directory.md](12-the-seam-directory.md) | You plan a change and want the one place it should touch. |
