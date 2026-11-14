# Compaction and usage accounting

How a long lesson gets shortened, how the lesson's size meter is measured, and how token usage is counted. Read this before you change the cutoff rule, the meter or the usage numbers.

## Where the code lives

| File | What it holds |
|---|---|
| `crates/core/src/session/compaction.rs` | The cutoff rule, the token estimate, `local_summary` and the compaction marker. This is the copy the server runs. |
| `crates/services/src/turns/compaction.rs` | When shortening and the summary run. |
| `src/shared/core/compaction.ts` | The TypeScript port of the same rule. The screens use `activeCompactionOf`, `keptIndexFor` and `effectiveThresholdTokens` from it. |
| `src/shared/core/context-usage.ts` | `measuredContextTokens`, the meter's number. |
| `src/frontend/components/stats-bar.tsx` | The meter (`contextMeter`). |
| `src/shared/core/prices.ts`, `src/shared/core/cost-summary.ts` | Usage totals and plan labels. |

Tests:

- `tests/shared/compaction-native-parity.test.ts` holds golden outputs from the original package.
- `tests/shared/compaction.test.ts` covers the TypeScript port.
- `crates/core/tests/session_golden.rs` checks the Rust copy against recorded outputs of the TypeScript one.

## When a lesson gets shortened

| Setting or constant | Value |
|---|---|
| Summarize point (`compaction.thresholdTokens` on the server, no longer shown or written by the window) | 40,000 |
| Context window godspeed assumes for the outside agent (`OUTSIDE_AGENT_CONTEXT_WINDOW`) | 200,000 |
| Reserve subtracted from that window | 16,384 |
| Recent tail kept word for word (`KEEP_RECENT_TOKENS`) | about 20,000 |
| Quiet time before the agent writes the summary | 5 minutes |

The summarize point is the smaller of the setting and the window minus the reserve (`effective_threshold_tokens`).

1. Past the summarize point, the server cuts the record at once and writes its own short version of the dropped part (`local_summary`). This runs at the turn-start gate and when a turn settles, never during a live run.
2. The compaction marker is written right away with that short version. A turn that starts now goes ahead on it.
3. Once the lesson has been quiet for 5 minutes, the outside agent writes the real summary, and it replaces the marker's text in place.

A cut that drops no active history adds no marker. The full history always stays in the record. The model sees the summary followed by every message from the cut onward.

## The cutoff rule

The cutoff selection is ported from **@earendil-works/pi-coding-agent 1.4.0** (`findCutPoint`). There is no dependency on that package. Upgrade the port on purpose, and update the golden cases with it.

1. Walk backward from the newest message until the tail reaches about 20,000 tokens.
2. Take the nearest valid cut at or after that message. A valid cut is a user, assistant or custom message, never a tool result.
3. If the trailing tool results alone pass the budget, keep the assistant call before them.
4. Keep context-invisible metadata next to the cut with it. The walk never crosses an earlier compaction.

godspeed treats its visible custom markers as user-like entries, leaves out UI-only markers, and starts from the active compaction's kept history rather than messages already dropped.

Token estimates follow the same package:

- Text, visible thinking, and tool-call names and arguments count as characters divided by four.
- Each image gets a fixed allowance of 1,200 tokens (4,800 characters).
- Encrypted signatures are not measured or stripped.
- Whole-message cuts can overshoot, so the tail is not a measured 20,000 tokens and the request size after compaction is not fixed.

Only the cutoff selection is ported. godspeed keeps its own summary prompt (built for teaching), plan continuity, storage, threshold, scheduling and lifecycle. It does not use the package's coding summary or its separate split-turn summary calls.

## The lesson's size meter

The meter shows `tokens / summarize point`, for example "33k / 40k". It is never a percentage.

- The number is the latest completed response's `input + output + cacheRead + cacheWrite`. Reasoning is already inside output, and `totalTokens` is not used.
- A response counts only if it ended with `stop`, `length` or `toolUse` and its usage is finite, not negative and not all zero. Partial stream updates, errors and aborts don't count.
- A compaction marker clears every earlier reading. Summary runs never feed the meter.
- The maximum is the 40,000 summarize point, capped by the window minus the reserve (`effectiveThresholdTokens`).
- The meter is hidden until the lesson reaches 80% of the summarize point, and while either number is unknown.

## Usage, not dollars

Every model call runs on the outside agent, which bills the learner's own plan. Nothing has a dollar price, so the app only counts tokens.

- `prices.ts` and `cost-summary.ts` add up token counts and name the plan "Your agent".
- Records from before the built-in sign-ins were removed keep their old plan labels: ChatGPT, GitHub Copilot and Grok.
- A call with no plan shows as unpriced, never as zero.
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
