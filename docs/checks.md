# Code checks

What stops messy code, when each check runs, and how a change reaches `main`. Read before landing a branch, adding a check or adding an exception.

A rule that is only written down gets broken. A kind of mistake is stopped by a check in `npm run check`, so each row below names the check, not the rule.

## When the checks run

| When | What runs | Can an agent skip it |
|---|---|---|
| `git commit` and `git push` | `npm run check:fast`, about 15 seconds: typecheck, lint, dead code and the repo checks in `tests/repo`. | Yes (`--no-verify`). It is an early warning, not the gate. |
| A push of any branch to GitHub | CI's `quality` job: `npm run check` and the skill's tests, about 8 minutes. | No. |
| A push to `main` | GitHub's rule "main takes checked commits" refuses a commit until `quality` has passed on it. | No. |

The hooks are the files in `.githooks`. `npm install` points git at them for every worktree. In a checkout where it never ran, run `node scripts/install-hooks.mjs` once.

## Landing a change on main

1. Rebase the branch on `origin/main`, so `main` can move to it without a merge commit.
2. Run `npm run check`, and `npm run layout` for a UI change.
3. Have a fresh agent review the branch with [review.md](review.md) as its whole brief, and fix what it finds. The checks cannot see what it looks for.
4. Push the branch: `git push origin <branch>`.
5. Wait for CI on that commit: `gh run watch -R bayshores/godspeed --exit-status $(gh run list -R bayshores/godspeed --branch <branch> --limit 1 --json databaseId --jq '.[0].databaseId')`.
6. Move `main` to it: `git push origin <branch>:main`. GitHub refuses when `quality` has not passed on that exact commit, or when `main` moved since step 1 (go back to step 1).
7. CI then runs the slow jobs (`desktop`, `window`) on `main`. Watch them too.

## What each check stops

| Kind of mess | Check | Where it is set |
|---|---|---|
| An unused variable or parameter | `npm run typecheck` | `tsconfig.json` |
| An unused file, export, type or npm package | `npm run deadcode` (knip) | `knip.json` |
| A core export only tests use | `tests/repo/core-is-used.test.ts` | the test |
| A function, constant or type written in two files, also with its names changed | `tests/repo/copies.test.ts` | the test |
| A name or file in a comment that does not exist, or history in a comment ("for now", "phase 2", "Wave D") | `tests/repo/comment-names.test.ts` | the test |
| A path in a doc that leads nowhere | `tests/repo/doc-paths.test.ts` | the test |
| A class or custom property of the stylesheet that nothing uses | `tests/repo/css-used.test.ts` | the test |
| An import across the layers, an import cycle | `npm run lint` | `eslint.config.mjs` |
| A request outside `lib/api.ts`, browser storage outside `lib/storage.ts` | `npm run lint` | `eslint.config.mjs` |
| A right-click menu | `npm run lint` | `eslint.config.mjs` |
| A hand-typed size, line height, corner, timing, curve or layer | `npm run lint`, `tests/frontend/type-ladder.test.ts`, `tests/frontend/motion-times.test.ts` | `eslint.config.mjs`, `src/frontend/globals.css` |
| A value written in both languages that no longer matches | `tests/repo/rust-twins.test.ts`, `tests/repo/event-names.test.ts`, `tests/repo/bridge-names.test.ts`, `crates/shell/tests/command_lists.rs` | the tests |
| A feature with no control a learner can see, or no row in `docs/features.md` | `tests/repo/features.test.ts` | the test |
| A Rust warning, `unsafe`, `dbg!`, `println!` | clippy with `-D warnings` | `Cargo.toml`, `[workspace.lints]` |
| An exception to a Rust lint without a reason, or one nothing needs any more (`#[allow]`) | clippy | `Cargo.toml`, `[workspace.lints]` |
| A Rust function over 100 lines, a block nested more than 6 deep, a result dropped with `.ok();` | clippy | `Cargo.toml`, `clippy.toml` |
| An `unwrap` or `expect` in Rust the app runs, other than an `expect` that cannot fail under `#[expect(clippy::expect_used, reason = "...")]` | clippy on the libraries and binaries only | `package.json`, `rust:check` |
| A bare task spawn, clock read, sleep or file write in Rust | clippy | `clippy.toml` |
| A Rust `pub` item that nothing but tests uses | `tests/repo/rust-pub-used.test.ts` | the test |
| A Rust `pub` item that no other crate and no test outside its crate's `src` takes, which rustc cannot report once nothing uses it | `tests/repo/rust-pub-used.test.ts` | `tests/repo/exceptions/rust-pub-wide.json` |
| A Rust save or delete whose error is thrown away (`let _ =`, `.ok();`) | `tests/repo/ignored-writes.test.ts` | the test |
| A Rust file over 17,000 characters, about 500 lines | `tests/repo/file-size.test.ts` | `tests/repo/exceptions/file-size.json` |
| An unused Rust dependency | `cargo machete` | `package.json`, `rust:check` |
| A heading drawn with classes of its own instead of `.lh-page-title`, `.lh-card-title` or `.lh-inner-title` | `tests/repo/headings.test.ts` | `tests/repo/exceptions/own-headings.json` |
| A small grey label (`text-sm` or `text-xs` in a quiet ink) | `tests/repo/small-labels.test.ts` | `tests/repo/exceptions/small-labels.json` |
| A broken screen layout | `npm run layout` (not part of `check`) | `scripts/layout-screens.mjs` |
| A list of exceptions that grew | `tests/repo/ratchet.test.ts` | `tests/repo/exceptions/` |

## Exceptions

A check that must let something through reads it from a list, never from a comment that switches the check off.

- A list is a file in `tests/repo/exceptions/`: each name with its reason, or each name with a count.
- A list may only shrink. `tests/repo/ratchet.test.ts` compares every commit since the branch left `origin/main` with the commit before it, and fails on a new name or a higher count.
- To grow a list for a reason that holds, write one line in the message of the commit that grows it: `Ratchet: <list>, <reason>`. The list's name is its file name without `.json`.
- A check whose own cases are the list (`rust-twins`) is counted from its source, by the `COUNTED` table in the ratchet test.

## Adding a check

1. Fix the mistake, and write the check in the same change.
2. A check of the repo itself is a test in `tests/repo/`. Have it also run its own reader on a few lines of made-up text, so a reader that stops finding anything fails.
3. Mess already in the code that cannot be fixed in the same change goes in a list in `tests/repo/exceptions/`.
4. Add a row to "What each check stops", and remove the written rule from `AGENTS.md` that the check now enforces.
