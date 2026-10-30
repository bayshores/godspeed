<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Two repositories: the app and the landing page

godspeed lives in two separate git repos. Don't forget the second one.

- **This repo** (`bayshores/godspeed`, local `/Users/seane/Code/learnharness`) is the app only.
- **The landing page** (https://learnatgodspeed.com) is its own private repo: `bayshores/godspeed-site`, local `/Users/seane/Code/godspeed-site`. Its page is in `site/`, its pen.dev design in `design/landing.pen`, and its README says how to run and deploy it (`npm run serve`, `npm run deploy`).

Rules:
- Any work on the website, landing page, marketing copy, the site's FAQ, `llms.txt`, the sitemap or the site's download links happens in `godspeed-site`, never here. Don't add a landing page, `site/` or `design/landing*` to this repo; it was moved out on purpose.
- When an app change affects what the site says (features, supported agents, platforms, download file names, version numbers, screenshots), tell the user the site may need the same update.
- Before cleaning up, merging or reporting that "everything is committed", check both repos.

# Keep the design files clean

The pen.dev files hold only what someone still needs to look at, so they never pile up into old mockups.

- A board stays only while it is waiting for the user's pick or being built. Once it is rejected or built, delete its boards in the same change: the code and the live page are the reference from then on.
- Delete any image, shader or export in the design folders that no remaining board, README or code uses.
- Code comments don't point at design boards or exports. The code is the reference once it's built.
- pen.dev saves on ⌘S; ask the user to save after a cleanup.

# No guessing

All design authority belongs to the human. **Never guess a design or implementation decision.** If anything is ambiguous — naming, behavior, data shapes, UX, defaults, scope boundaries, prompt wording — STOP and ask with the ask-user-question tool before proceeding. If you are "a little unsure," you are unsure: ask. A wrong guess is far more expensive than a question. Ask early, ask specific, one question per call.

Concretely: first investigate and plan rigorously (asking the user design questions along the way), get the plan approved by the user, and only then implement. Implementation should be mechanical execution of an approved plan — not interpretation.

# Code quality contract

Keep godspeed small, tidy and easy to read. Every change follows these rules, and the checks below enforce them.

**Build only what's asked**
- Build what the approved plan needs, nothing more. No options nobody sets, no "for later" hooks, and no wrapper around a single call.
- Add an abstraction (shared helper, base component, generic type) only once there's a second real use.

**Delete, don't keep**
- No dead code: no unused files, exports, types, variables, parameters or npm packages, and no commented-out code.
- When something is replaced, remove the old version in the same change. Stored data is the one exception: the reader may upgrade old files on read (as the schema-version stamps do).
- No leftover feature flags, shims, or "old way" fallbacks once the new way works.

**One job per file**
- Pure logic lives in `src/core` (or a `*-model.ts` next to its component) and has unit tests. Components render, hooks fetch, routes translate HTTP.
- No import cycles. Keep the import law (`eslint.config.mjs`).
- Split a file that does two jobs when you touch it. Don't grow it further.

**Plain names and short comments**
- One name per idea, used everywhere (UI, code, tools, tests). For example, "deadline", never mixed with "exam" or "assignment".
- Comments are short and say why, not what. No dates, history, plan phases or "owner ruling" notes in code; git and `docs/` keep history. Trim old ones in code you change.

**Done means clean**
- `npm run check` passes: typecheck (with unused variables and parameters as errors), tests, lint, and `npm run deadcode` (knip). CI runs the same checks.
- Before calling a change finished, read the diff once more for anything unused, duplicated or over-built, and cut it.
