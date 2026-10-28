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

# No guessing

All design authority belongs to the human. **Never guess a design or implementation decision.** If anything is ambiguous — naming, behavior, data shapes, UX, defaults, scope boundaries, prompt wording — STOP and ask with the ask-user-question tool before proceeding. If you are "a little unsure," you are unsure: ask. A wrong guess is far more expensive than a question. Ask early, ask specific, one question per call.

Concretely: first investigate and plan rigorously (asking the user design questions along the way), get the plan approved by the user, and only then implement. Implementation should be mechanical execution of an approved plan — not interpretation.
