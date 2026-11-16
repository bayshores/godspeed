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
| [06-the-knowledge-graph.md](06-the-knowledge-graph.md) | You change extraction, merging, the graph read side or the Graph page. |
| [06.1-spaces.md](06.1-spaces.md) | You change spaces, linked folders, deadlines, source marks or cheat sheets. |
| [06.2-interviews-and-mocks.md](06.2-interviews-and-mocks.md) | You change interview, online assessment or test prep. |
| [06.3-paths.md](06.3-paths.md) | You change a space's path toward a goal. |
| [07-study-sessions.md](07-study-sessions.md) | You change how a lesson starts, runs or ends, plots, kept sentences or homework. |
| [08-process-boundaries.md](08-process-boundaries.md) | You need the shell and server split before reading 8.1 to 8.2. |
| [08.1-the-outside-agent-boundary.md](08.1-the-outside-agent-boundary.md) | You change agent access, when an agent counts as connected or teaching. |
| [08.1.1-the-godspeed-folder.md](08.1.1-the-godspeed-folder.md) | You change the godspeed folder, the spaces folder or the agent start script. |
| [08.1.2-the-work-loop.md](08.1.2-the-work-loop.md) | You change the work loop, the helper or work items. |
| [08.1.3-agent-tools-and-notes.md](08.1.3-agent-tools-and-notes.md) | You change the other agent tools, agent notes, saved rules or web search. |
| [08.2-plugins.md](08.2-plugins.md) | You change how the app hosts a plugin. Writing one is in [plugins.md](../plugins.md). |
| [09-invariants.md](09-invariants.md) | You want the rules that always hold and what the build enforces. |
| [10-events-and-observability.md](10-events-and-observability.md) | You change logging, the events channel or what still polls. Also holds §10.1 to §10.5. |
| [11-testing.md](11-testing.md) | You add a test. |
| [12-the-seam-directory.md](12-the-seam-directory.md) | You plan a change and want the one place it should touch. |
