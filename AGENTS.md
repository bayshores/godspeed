Written short to save tokens. Write to the user, and in UI, docs, commits and code comments, in full plain sentences.

# Two repositories: the app and the landing page

godspeed lives in two git repos. Don't forget the second.

- **This repo** (`bayshores/godspeed`, local `/Users/seane/Code/learnharness`): the app only.
- **The landing page** (https://learnatgodspeed.com): private repo `bayshores/godspeed-site`, local `/Users/seane/Code/godspeed-site`. Page in `site/`, pen.dev design in `design/landing.pen`, run and deploy in its README (`npm run serve`, `npm run deploy`).

Rules:
- Work on the website, landing page, marketing copy, site FAQ, `llms.txt`, sitemap or site download links happens in `godspeed-site`, never here. Don't add a landing page, `site/` or `design/landing*` to this repo; it was moved out on purpose.
- If an app change affects what the site says (features, supported agents, platforms, download file names, version numbers, screenshots), tell the user the site may need the same update.
- Before cleaning up, merging or reporting "everything is committed", check both repos.

# One design file per topic

Each feature or topic has its own pen.dev file in `docs/design/`, named after it (`live-pill.pen`). Files stay small; the name says what is inside.

- Start a file by copying `docs/design/blank.pen` to the new name. A pen.dev file can't be written by hand, and the pen.dev tool only opens a file that exists.
- Boards stay in their file after a round, picked or not. Never clear a canvas to make room. A later round on the same topic goes in the same file, right of the earlier one; the picked board gets "(picked)" in its name.
- Delete a design file only when the user says so.
- Delete any image, shader or export in the design folders that no board, README or code uses.
- Code comments don't point at design boards or exports. Code is the reference once built.
- Save with the pen.dev tool after drawing, then tell the user which file and boards to look at.

# One app, not a pile of features

Design every feature as part of the whole app, never by itself.

- Before designing, list what the app already has that does part of the job (screen, control, stored thing, agent tool) and build on it. A new screen, tab, setting, tool or data file needs a reason the existing ones can't serve.
- Use the names, controls, looks and flows the rest of the app uses for the same idea. One way per action, one home per thing.
- If a new feature overlaps an old one, merge them or remove the old one in the same change. Two features never do the same job.
- A plan says where the feature touches the rest of the app (Today, spaces, lessons, deadlines, the agent's pane, the agent's tools, the godspeed folder) and what changes there.

# Say it once

Nothing is said twice on one screen.

- Each fact shows in one place. A status, name, instruction or count is not repeated in a second label, sentence or chip visible at the same time.
- A sentence does not repeat the label of the button beside it. If the button says it, cut the sentence.
- Help for a failure shows when it fails, not all the time.
- Before calling a UI change finished, read every word on the changed screen in each state (empty, working, failed) and cut what is said twice.

# No button behind a button

A click does the thing. It does not open a box holding the button for the thing.

- A control never opens a pop-up, menu, card or dialog that holds only one action. The control does that action itself.
- A pop-up is for a choice between two or more things, or for something that arrives by itself (a notice, a question).
- Holds in every state: a menu down to one entry does that entry on the first click.
- Before calling a UI change finished, click every control on the changed screen in each state and count what opens. One action inside means the pop-up goes.

# No label sandwich

A big title does not sit between a small line above and a small line below.

- Nothing small sits above a title. No eyebrow, category line or date line on top.
- A title gets at most one supporting line, under or beside it. More facts go into that line or a chip beside the title, or are cut.
- Holds wherever a title shows: page heads, cards, rows, pop-ups, empty states.
- Before calling a UI change finished, check every title on the changed screen for a small line above it.

# Look at the real window

The Mac app draws pages with WebKit, not Chrome, and the two lay pages out differently. A page right in a browser can overlap in the app.

- Look at a UI change in the real app window (the debug shell) before calling it finished, at 1440, 1100 and 800 points wide. A browser screenshot does not count.
- Check each state the change touches, and the screen's scroll end, for text on text, content spilling out of its box and sideways scrolling.
- `npm run layout` checks the screens in `scripts/layout-screens.mjs` in the real window at all three widths for overlapping text, spills, sideways scrolling, hidden text and cut-off letters. It runs in CI on the Mac and is not part of `npm run check`: run it yourself before calling a UI change finished. A new screen or state gets an entry there.

# No guessing

All design authority belongs to the human. **Never guess a design or implementation decision.** If anything is ambiguous (naming, behavior, data shapes, UX, defaults, scope boundaries, prompt wording), STOP and ask with the ask-user-question tool before proceeding. "A little unsure" is unsure: ask. A wrong guess costs far more than a question. Ask early, ask specific, one question per call.

Order: investigate and plan rigorously (asking the user design questions along the way), get the plan approved by the user, only then implement. Implementation is mechanical execution of an approved plan, not interpretation.

# Code quality contract

Keep godspeed small, tidy and easy to read. Every change follows these rules; the checks below enforce them.

**Build only what's asked**
- Build what the approved plan needs, nothing more. No options nobody sets, no "for later" hooks, no wrapper around a single call.
- Add an abstraction (shared helper, base component, generic type) only once there's a second real use.

**Delete, don't keep**
- No dead code: no unused files, exports, types, variables, parameters or npm packages, no commented-out code.
- When something is replaced, remove the old version in the same change. One exception, stored data: the reader may upgrade old files on read (as the schema-version stamps do).
- No leftover feature flags, shims or "old way" fallbacks once the new way works.

**Where code goes**
- `src/frontend`: what the browser runs, built by Vite (`index.html`, `main.tsx`, `routes/` for the router and its screens, `components/`, `lib/`, `globals.css`, `fonts/`). `src/shared/core`: pure TypeScript logic, only what the frontend uses. `crates/`: all Rust. `crates/shell`: the desktop app (Tauri). Server crates: laid out as in `docs/rust-server.md`.
- Tests sit in the matching place: `tests/frontend`, `tests/shared`, and `tests/desktop` for the shim and `scripts/`. Rust tests sit beside their crate. Shared helpers and `fixtures/` stay in `tests/` itself.

**One job per file**
- Pure logic lives in `src/shared/core` (or a `*-model.ts` next to its component) and has unit tests. Components render, hooks fetch. `src/frontend/routes` holds the router, its loaders and screens. Server crates own everything behind `/api`.
- No import cycles. Keep the import law (`eslint.config.mjs`).
- Split a file that does two jobs when you touch it. Don't grow it further.

**Plain names and short comments**
- One name per idea, used everywhere (UI, code, tools, tests). Example: "deadline", never mixed with "exam" or "assignment".
- Comments are short and say why, not what. No dates, history, plan phases or "owner ruling" notes in code; git and `docs/` keep history. Trim old ones in code you change.

**Done means clean**
- `npm run check` passes: typecheck (unused variables and parameters are errors), tests, lint, `npm run deadcode` (knip) and `npm run rust:check` (cargo test, clippy, cargo machete). CI runs the same checks.
- Before calling a change finished, read the diff once more for anything unused, duplicated or over-built, and cut it.
