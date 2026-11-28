Written short to save tokens. Write to the user, and in UI, docs, commits and code comments, in full plain sentences.

# Two repos: app and landing page

- **This repo** (`bayshores/godspeed`, `/Users/seane/Code/learnharness`): app only.
- **Landing page** (https://learnatgodspeed.com): private repo `bayshores/godspeed-site`, `/Users/seane/Code/godspeed-site`. Page in `site/`, pen.dev design `design/landing.pen`, run and deploy per its README (`npm run serve`, `npm run deploy`).

- Website, landing page, marketing copy, site FAQ, `llms.txt`, sitemap and site download links: work in `godspeed-site`, never here. Never add a landing page, `site/` or `design/landing*` here; moved out on purpose.
- App change that affects what the site says (features, supported agents, platforms, download file names, versions, screenshots): tell the user the site may need the same update.
- Before cleaning up, merging or reporting "everything is committed", check both repos.

# One design file per topic

One pen.dev file per feature or topic in `docs/design/`, named after it (`live-pill.pen`), kept small.

- New file: copy `docs/design/blank.pen` to the new name. A pen.dev file can't be written by hand, and the pen.dev tool only opens an existing file.
- Boards stay after a round, picked or not. Never clear a canvas. A later round on the same topic goes in the same file, right of the earlier one; the picked board gets "(picked)" in its name.
- Delete a design file only when the user says so.
- Delete any image, shader or export in the design folders that no board, README or code uses.
- Code comments never point at design boards or exports.
- After drawing, save with the pen.dev tool, then tell the user which file and boards to look at.

# One app, not a pile of features

Design every feature as part of the whole app.

- Before designing, list what the app already has that does part of the job (screen, control, stored thing, agent tool) and build on it. A new screen, tab, setting, tool or data file needs a reason the existing ones can't serve.
- Reuse the names, controls, looks and flows the app uses for the same idea. One way per action, one home per thing.
- A new feature that overlaps an old one: merge them or remove the old one in the same change. Two features never do the same job.
- A plan says where the feature touches the rest of the app (Home, spaces, lessons, deadlines, the agent's pane, the agent's tools, the godspeed folder) and what changes there.
- A feature is finished only when a learner can find it from the screen (a visible control, or for a thing only the teacher makes, a control on the page where it will show) and it has a row in `docs/features.md`. A plan says where the learner finds it.

# No guessing

Design authority belongs to the human. **Never guess a design or implementation decision.** If anything is ambiguous (naming, behavior, data shapes, UX, defaults, scope boundaries, prompt wording), STOP and ask with the ask-user-question tool. "A little unsure" is unsure. A wrong guess costs far more than a question. Ask early, ask specific, one question per call.

Order: investigate and plan rigorously (asking design questions along the way), get the plan approved, only then implement. Implementation is mechanical execution of the approved plan, not interpretation.

# Code quality contract

Keep godspeed small, tidy and easy to read. The checks below enforce these rules.

**Build only what's asked**
- Build what the approved plan needs, nothing more: no options nobody sets, no "for later" hooks, no wrapper around a single call.
- Add an abstraction (shared helper, base component, generic type) only at a second real use.

**Delete, don't keep**
- No dead code: no unused files, exports, types, variables, parameters or npm packages, no commented-out code.
- A replaced thing is removed in the same change. Exception, stored data: the reader may upgrade old files on read (as the schema-version stamps do).
- No leftover feature flags, shims or "old way" fallbacks once the new way works.

**Where code goes**
- `src/frontend`: what the browser runs, built by Vite (`index.html`, `main.tsx`, `routes/` for the router and its screens, `components/`, `lib/`, `globals.css`, `fonts/`). `src/shared/core`: pure TypeScript logic, only what the frontend uses. `crates/`: all Rust. `crates/shell`: the desktop app (Tauri). Server crates: see `docs/rust-server.md`.
- Tests sit in the matching place: `tests/frontend`, `tests/shared`, `tests/desktop` (the shim and `scripts/`), `tests/repo` (checks of the repo itself). Rust tests sit beside their crate. Shared helpers and `fixtures/` stay in `tests/` itself.

**One job per file**
- Pure logic lives in `src/shared/core` (or a `*-model.ts` next to its component) with unit tests. Components render, hooks fetch. `src/frontend/routes` holds the router, its loaders and screens. Server crates own everything behind `/api`.
- No import cycles. Keep the import law (`eslint.config.mjs`).
- Split a file that does two jobs when you touch it. Never grow it further.

**One owner, one way**
- Search before you write (`graphify query`): a helper, hook, type or component that does the job is used, not copied. The second copy is the moment to make the shared one.
- Server data has one owner in the browser (a provider or one hook). Every other component reads from it. Never fetch the same record a second time and keep the copies in step with an event.
- Every request from the browser goes through `send` or `getJson` in `src/frontend/lib/api.ts`. Lint fails any other `fetch`; one that cannot (a stream, a download) goes on the allow list in `eslint.config.mjs` with its reason.
- Browser storage goes through `readStorage` and `writeStorage` in `src/frontend/lib/storage.ts`. Lint fails any other `localStorage` or `sessionStorage`.
- A hook that loads server data is built on `useServerResource` (newest read wins, reloads on the events it names and on reconnect). A request started by a click runs through `useGuardedAction` (busy, error line, no double send).
- To change one field, send that field; the server merges it under its lock (as `PATCH /api/settings/general` does). Never read a record, change it and send the whole thing back.
- A fixed set of values (a role, a status, a kind) is one type with its values named once, never the same strings compared in many files. Saved text stays the same.

**Two languages, one truth**
- The server decides, the browser shows. No TypeScript copy of logic the Rust server runs. A number or text the server knows is sent by the server.
- Code only tests call is dead code, and knip cannot see it. An export in `src/shared/core` needs a user in `src/frontend` (`tests/repo/core-is-used.test.ts` fails otherwise).
- A name, limit or text that must be written in both languages gets a line in `tests/repo/rust-twins.test.ts` (event names: `event-names.test.ts`; desktop commands: `bridge-names.test.ts` and `crates/shell/tests/command_lists.rs`).

**Failures are seen**
- No silent failure: an error is shown, logged with where it happened, or handled for a stated reason. A damaged data file is kept aside, never read as empty and overwritten. Rust specifics: `docs/rust-server.md`.
- A box allowed to stretch past what it holds carries `data-fills="<reason>"`, which the layout check reads. Nothing else exempts a box from its hollow-box finding.

**Plain names and short comments**
- One name per idea, everywhere (UI, code, tools, tests). Example: "deadline", never mixed with "exam" or "assignment".
- Comments are short and say why, not what. No dates or history in code; git and `docs/` keep history. Trim old ones in code you change.

**Done means clean**
- `npm run check` passes: typecheck (unused variables and parameters are errors), tests, lint, `npm run deadcode` (knip) and `npm run rust:check` (cargo test, clippy, cargo machete). CI runs the same.
- `main` takes a commit only after CI's `quality` job passed on it: push the branch, wait for it, then move `main` (steps in `docs/checks.md`). Never skip a git hook with `--no-verify`.
- A check lets something through only by a list in `tests/repo/exceptions/`, and a list only shrinks. Growing one needs a `Ratchet: <list>, <reason>` line in the commit message.
- The Mac check does not build Rust code behind a Windows or Linux condition (`#[cfg(windows)]`, `demo_webview.rs`, `crates/shell/src/linux/`). After touching such a file, the change is finished only when CI's check job is green, or the same lint passed on the build box.
- `npm run check` does not run `npm run layout`, whose stand-in helper (`scripts/layout-helper.mjs`, started through `LH_CLAUDE_HELPER` in a debug build) plays every lesson. After changing what the teacher is sent or refused (a tool refusal, a reply sent back, a work item, a lesson tool), run `npm run layout` on the Mac before merging.
- Before calling a change finished, reread the diff and cut anything unused, duplicated or over-built. Ask of each new piece: is this data already loaded somewhere, does a helper already do this, does the server already know this, can two copies disagree?
- A new class of mistake gets a check in `npm run check`, in the same change that fixes it, with its row in `docs/checks.md`. A rule written here alone gets broken; write one only where no check can see the mistake.

# Docs

Read only what the task needs. One topic per file; a README in each docs folder lists its files and when to read each; a file over about 2,500 words splits.

| Task | Read |
|---|---|
| Any screen, control, pop-up or label | `docs/ui-rules.md` |
| Adding, moving or removing a feature | `docs/features.md` |
| Commands, file layout, testing | `docs/development.md` |
| Landing a branch on `main`, adding a check or an exception | `docs/checks.md` |
| Layers, data ownership, chat turn, graph, study, agent boundary | `docs/architecture/README.md` |
| Rust crates, server process, locks | `docs/rust-server.md` |
| Desktop shell, `window.lh`, terminals, updates | `docs/tauri-shell/README.md` |
| Building and releasing the desktop app | `docs/desktop-release.md` |
| Writing a plugin | `docs/plugins/README.md` |
| Teaching behavior and prompts | `docs/teaching-methodology.md` |
| Compaction | `docs/compaction-accounting.md` |
| Broken math or escaping in tool-call text | `docs/tool-content-recovery.md` |
| Keyboard | `docs/keyboard.md` |
