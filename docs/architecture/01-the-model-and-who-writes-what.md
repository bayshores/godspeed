## 1. The model and who writes what

Pure domain logic sits in the middle (`crates/core` on the server, `src/shared/core` in the window). Every outside effect (files, outside agent, browser, OS) sits behind an edge adapter. Two composition roots plug the adapters in (§3).

Two rules hold everywhere:

- Imports point toward pure core.
- Each data store has one writer. Views (plan statuses, phases, graph arrows, progress, coverage) are recomputed on read, never stored.

| System | Writes (nothing else writes it) | Does |
|---|---|---|
| Classroom | `data/chats/*.json`, attached PDFs in `data/chats/<id>/` | turn pipeline, lesson agents, plan tree, questions, phases (§5) |
| Workbench | `data/jobs/*.json` | job runner, sub-agents, wake pipeline (§5.1) |
| Library | `data/graph/*`, `data/spaces/<id>/graph/*` | extraction (only writer of facts and chains), topic grouping, derivation (§6) |
| Spaces | `data/spaces/<id>/space.json`, `files/`, `cheat-sheets/`, `mocks/` | space records and files, linked folders, deadlines, cheat sheets, interviews and mocks (§6.1, §6.2, §6.7) |
| Search index | `data/search/`, `data/spaces/<id>/search/` | `crates/search` (`app.search`): facts and passages index for local search |
| Stage | nothing on server | window: Home, space pages, lesson screen, Graph page, teacher panel. Reads and writes only through `/api` |
| Plugins | `data/plugins/<id>/` (plugin files, its stored JSON in `data/`) | install, remove, storage, `ask_agent` (§8.2). On/off and setting values: `plugins` section of `settings.json` |
| Machine room | `settings.json`, `prompts/`, `mcp-token`, `search-key`, `agent-notes.json`, `agent-seen.json`, `agent-rules.json`, `agent-actions.json`, `reminders.json`, `agent-folder.json`, `deadline-requests.json`, `vault-notes.json` | server process, `gs_base::config` (`Paths`), outside-agent boundary (§8.1). Shell writes `mcp-endpoint.json`. Notes in the learner's notes folder are written only by `services::vault::write` (§8.1.4) |
