# Compaction and usage accounting

How a long lesson is shortened, how the lesson's size is measured and how token usage is counted. Read this before you change the cutoff rule, the lesson's size or the usage numbers.

## Where the code lives

| File | What it holds |
|---|---|
| `crates/core/src/session/compaction.rs` | Cutoff rule, token estimate, the lesson's size the threshold measures (`lesson_tokens`), `local_summary`, compaction marker. The copy the server runs. |
| `crates/services/src/turns/compaction.rs` | When shortening and the summary run. |
| `src/shared/core/compaction.ts` | What the screens need to draw a shortened lesson (`activeCompactionOf`). The rule itself is Rust only. |
| `src/shared/core/context-usage.ts` | `measuredContextTokens`, the lesson's size. |
| `src/frontend/components/lesson/lesson-stats.tsx` | The Lesson stats pop-up from the open lesson's More; the size's words are `lessonSizeLabel` in `usage-format.ts`. |
| `src/shared/core/prices.ts`, `src/shared/core/cost-summary.ts` | Usage totals and plan labels. |

Tests:

- `crates/core/src/session/compaction.rs` (`published_cases`): the cut cases published with the original package.
- `crates/core/tests/session_golden.rs`: recorded outputs of the original TypeScript rule.
- `tests/shared/compaction.test.ts`: the marker and divider the screens read.

## When a lesson gets shortened

| Setting or constant | Value |
|---|---|
| Summarize threshold (`compaction.thresholdTokens` in `factory_settings`, not a setting; a value in an old `settings.json` is ignored) | 40,000 |
| Context window assumed for the outside agent (`OUTSIDE_AGENT_CONTEXT_WINDOW`) | 200,000 |
| Reserve subtracted from that window | 16,384 |
| Recent tail kept word for word (`KEEP_RECENT_TOKENS`) | about 20,000 |
| Quiet time before the agent writes the summary | 5 minutes |

`effective_threshold_tokens` caps the summarize point at window minus reserve, but that cap is 183,616, so it never applies.

The threshold measures the lesson's transcript only (`lesson_tokens`): the messages the model sees (the active summary, then every message from the cut onward), estimated as below. The system prompt and tool schemas (about 20,000 tokens) are left out, since no cut can shrink them; counting them would keep a shortened lesson over the threshold, so it would be cut again every turn. Provider-reported usage is not read here. After a cut the lesson holds the kept tail (about 20,000) and the summary (at most 6,000), so at least 10,000 tokens of new lesson fit before the next cut.

1. Past the summarize point the server cuts the record at once and writes its own short version of the dropped part (`local_summary`), at the turn-start gate and when a turn settles, never during a live run.
2. The compaction marker is written right away with that version. A turn that starts now goes ahead on it.
3. After 5 quiet minutes the outside agent writes the real summary, replacing the marker's text in place.

A cut that drops no active history adds no marker. A cut that can't move past the previous kept boundary (the kept tail alone is over the threshold) adds none either, and says so in the log once for that boundary. Full history always stays in the record. The model sees the summary, then every message from the cut onward.

## The teacher session

The teacher's own Claude Code chat is not the lesson record. It holds every work item the teacher took and every answer it sent, across lessons and jobs, so it grows on its own. Every Claude Code start sets `--autocompact 150000` ([Claude Code's start](architecture/08.1.1-the-godspeed-folder.md#claude-codes-start)), so Claude Code compacts it at 150,000 tokens. The helper's chat compacts the same way.

1. Claude Code's PreCompact hook (`compacting.mjs`) tells godspeed the session compacts. While it does, that session takes no work. With a helper here, the lesson turns it held go back in the queue and the helper answers them meanwhile ([the helper](architecture/08.1.2-the-work-loop.md#the-helper)). A mark that never ends lapses after 10 minutes.
2. When the compaction ends, the SessionStart hook with matcher `compact` (`forget.mjs`) tells godspeed the session lost its context. godspeed forgets what that session has seen, so its next items come in full: instructions, tools and the lesson's messages.
3. An item the teacher still held comes back to it at once, in full, the next time its waiter waits.

The lesson record is unchanged by this: its own shortening (above) and the teacher's compaction are separate.

## The cutoff rule

Cutoff selection is ported from **@earendil-works/pi-coding-agent 1.4.0** (`findCutPoint`), with no dependency on it. Upgrade the port on purpose and update the golden cases with it.

1. Walk backward from the newest message until the tail reaches about 20,000 tokens.
2. Take the nearest valid cut at or after that message: a user, assistant or custom message, never a tool result.
3. If trailing tool results alone pass the budget, keep the assistant call before them.
4. Keep context-invisible metadata next to the cut with it. The walk never crosses an earlier compaction.

godspeed treats its visible custom markers as user-like entries, leaves out UI-only markers, and starts from the active compaction's kept history, not dropped messages.

Token estimates follow the same package:

- Text, visible thinking, tool-call names and arguments: characters divided by four.
- Each image: 1,200 tokens (4,800 characters).
- Encrypted signatures are not measured or stripped.
- Whole-message cuts can overshoot, so the tail is not a measured 20,000 tokens and the post-compaction request size is not fixed.

Only cutoff selection is ported. godspeed keeps its own teaching summary prompt, plan continuity, storage, threshold, scheduling and lifecycle, and does not use the package's coding summary or split-turn summary calls.

## The lesson's size

The Lesson stats pop-up (open lesson's More menu) shows it in pages against the summarize point, for example "about 79 of 80 pages" (500 tokens a page), "about 79 pages" while the summarize point is unknown, and no row while the size is unknown. Never a percentage.

- Number: the latest completed response's `input + output + cacheRead + cacheWrite`. Reasoning is already inside output. `totalTokens` is not used.
- A response counts only if it ended with `stop`, `length` or `toolUse` and its usage is finite, not negative and not all zero. Partial stream updates, errors and aborts don't count.
- A compaction marker clears every earlier reading. Summary runs never feed the size.
- Maximum: the summarize point the server sends as `summarizeAt` with `GET /api/chats/{id}`: 40,000, capped by window minus reserve (`effective_threshold_tokens`).
- Shown at any size.
- This number includes the system prompt and tool schemas, which the summarize point leaves out (see [When a lesson gets shortened](#when-a-lesson-gets-shortened)), so it can read above the summarize point while the lesson itself is under it.

## Usage, not dollars

Every model call runs on the outside agent, which bills the learner's own plan. Nothing has a dollar price, so the app only counts tokens.

- `prices.ts` and `cost-summary.ts` add up token counts and name the plan "Your agent".
- Records from before the built-in sign-ins were removed keep their old plan labels: ChatGPT, GitHub Copilot and Grok.
- A call with no plan shows as unpriced, never zero.
- Saved input is the package's normalized fresh input, separate from the cache buckets. Never subtract cached reads from it again, and never migrate old logs as raw prompt tokens that include the cache.
- Missing usage stays missing.

## Upstream attribution

The cutoff and estimator port adapts MIT-licensed code from `@earendil-works/pi-coding-agent` 1.4.0, author Mario Zechner (published package metadata). The inspected `dist/core/compaction/compaction.js` SHA-256 is `f51e78ef1da66b5803fc91e185f07b968f8f989ab9326b7744958416aad3f6f6`.

MIT License

Copyright (c) Mario Zechner

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
