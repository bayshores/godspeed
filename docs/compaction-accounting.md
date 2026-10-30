# Compaction and usage accounting

## Retention

`src/core/compaction.ts` locally ports the cutoff-selection behavior and relevant
message-size heuristic from **@earendil-works/pi-coding-agent 1.4.0**. There is no
coding-agent dependency. Upgrade this port deliberately; the native golden
fixtures are in `tests/compaction-native-parity.test.ts`.

Walk backward to the approximately 20,000-token retained-tail budget, then select
the nearest valid user/assistant boundary at or after the crossing. Never start
at a tool result. If trailing results alone exceed the budget, keep the preceding
assistant call. Preserve adjacent context-invisible metadata. godspeed adapts
its visible custom markers to user-like entries, excludes UI-only markers, and
uses the active compaction's retained history rather than discarded messages.

Text, visible thinking, tool-call names/arguments use characters divided by four;
images receive the native fixed 1,200-token allowance. Encrypted signatures are
not measured or stripped. Whole-message boundaries can overshoot. This does
**not** guarantee a measured 20k tail or a fixed post-compaction request size.

Only cutoff selection is ported. godspeed retains its educational summary
prompt, plan continuity, persistence, threshold, scheduling, and authorization
lifecycle. It does not adopt Pi's coding summary or separate split-turn summary
calls. A cut that drops no active history does not launch a summarizer.

## Conversation meter

The numerator is the latest qualifying completed conversation response's native
Pi `input + output + cacheRead + cacheWrite`. Reasoning is already inside output;
`totalTokens` is not an override. Partial stream updates, errors, aborts, invalid
counts, and all-zero usage do not replace the last measurement. A successful
compaction marker invalidates earlier measurements: show `? / maximum` until a
new qualifying response completes. Summarizer usage never supplies this meter.

The denominator is the context window godspeed assumes for the outside agent:
a fixed 200,000 tokens (`OUTSIDE_AGENT_CONTEXT_WINDOW` in `src/core/settings.ts`),
independent of the last numeric measurement. The meter shows `tokens / maximum`,
never a percentage.

## Usage, not dollars

Every model call runs on the outside agent, which bills the learner's own plan.
So nothing has a dollar price. `src/core/prices.ts` and `src/core/cost-summary.ts`
only fold token counts and name the plan ("Outside agent"). Records from before
the built-in sign-ins were removed keep their old plan labels (ChatGPT, GitHub
Copilot, Grok). A call with no plan shows as unpriced, never as zero.

Saved input is Pi-normalized **fresh input**, disjoint from cache buckets. Never
subtract cached reads from it again or migrate old logs as raw inclusive prompt
tokens. Missing usage stays missing.

## Upstream attribution

The cutoff/estimator port adapts MIT-licensed code from
`@earendil-works/pi-coding-agent` 1.4.0, author Mario Zechner (published package
metadata). The inspected `dist/core/compaction/compaction.js` SHA-256 is
`f51e78ef1da66b5803fc91e185f07b968f8f989ab9326b7744958416aad3f6f6`.

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
