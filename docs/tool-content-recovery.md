# Tool-content presentation recovery

How the screens repair broken LaTeX and escaping in text the outside agent wrote into a tool call, without changing what is saved. Read this before you touch math display in question cards, problems or answer reveals.

## Where the code lives

| File | What it does |
|---|---|
| `src/shared/core/content-reader.ts` | Splits tool-authored Markdown into prose, code and math spans with the CommonMark parser and its math extension. Holds the TeX checks and `recoverDocumentLayout`. |
| `src/shared/core/math-delims.ts` | `repairMathForDisplay`, the one entry point for display recovery. |
| `src/shared/core/answer-presentation.ts` | `answerForPresentation`, for saved answers. |
| `src/frontend/components/ai-elements/message.tsx` | `ToolContentResponse`, the renderer that applies the repair. |
| `src/shared/core/argument-heal.ts`, `crates/agent/src/tools/heal.rs` | Argument shape healing, a separate step (see below). |

## The rule

Recovery changes only what the learner sees. The saved tool arguments, option identities, learner answers, shuffling, grading and later answer snapshots all use the content as parsed from the schema, never the repaired text.

`ToolContentResponse` passes text through `repairMathForDisplay`, then through the ordinary Markdown renderer. Questions, asks, recalls, explanations, and practice statements and solutions all use this path. Ordinary assistant prose does not get tool-content recovery.

There are three separate steps:

1. Argument and shape parsing decodes encoded argument shapes, then converts, validates and cleans them against the schema. No LaTeX recovery happens here.
2. Content projection tells literal code, prose and document structure, and math apart, and recovers only the escaping defects listed below.
3. Presentation renders Markdown and KaTeX, including paragraph layout. In a committed-answer reveal, only the first paragraph sits inline with its label, and later paragraphs keep their normal layout.

## Recovery rules

### Literal code

Code and inline-code ranges come from the CommonMark parser with its math extension. This covers fences, indentation, quotes and lists without separate container rules. The projection copies those ranges as they are and never turns a syntax tree back into Markdown.

### Document escapes

A literal two-character `\n` is different from a real newline.

- Document layout is recovered only with evidence, such as repeated document escapes, or one alongside over-escaped known TeX commands.
- Complete known TeX words that start with n, like `\nu`, `\nabla`, `\neq` and declared macros, win over reading their `\n` as a line break.
- Code, real TeX comments and recognized path tokens are protected.
- Recovered `$$` display framing puts the formula and the closing fence on their own lines. Decoding only the opening line could turn the closing dollars into wrong TeX.

### Command prefixes swallowed by JSON

Inside math, a control character can be what is left after JSON consumed the start of a command, for example TAB followed by `ext` instead of `\text`. Recovery rebuilds a command only if the control character plus the whole following word names a known KaTeX command. Every supported case recovers in one pass.

| Case | What happens |
|---|---|
| Inline math | Recognized prefixes recover, including a real line feed plus `u` to `\nu`, and TAB plus `o` to `\to`. There is no word-length limit. |
| Display math | Real line feeds and CRLF stay as source formatting. Other recognized prefixes recover. |
| Commands already written correctly | Stay commands in both modes. `\nu` is never decoded into a line feed plus `u`. |
| Unrecognized whitespace | Stays as it is. `x<TAB>+<TAB>y` does not become invented `\t` or `\ty` commands. |

This case is ambiguous by nature: whitespace followed by a variable can happen to spell a command. The policy targets the LaTeX the outside agent typically writes, not every arrangement a person could type. A successful TeX parse cannot tell the two meanings apart.

### Extra backslashes, percentages and rows

Recovery looks at the original TeX context before it changes a run of backslashes.

- Complete environment pairs and `\substack` arguments that are written correctly keep their row separators.
- Environment pairs that are consistently over-escaped set an escaping factor for commands and rows. An encoded four-backslash row becomes two backslashes, not one.
- Outside protected row and comment contexts, extra backslashes before known commands can recover. Unknown command words are never invented.
- Doubled percent escapes in ordinary numbers can recover to `\%`, including a percentage at the end of a display formula. Real comment text or equation rows after it stay literal.
- As an extra guard, partial recovery never turns source that parses into source that fails to parse. Parse success is not the main test, because a broken matrix and a lost percentage can both parse.

Unbalanced, unsupported or ambiguous content is not rewritten into new math. This is escaping recovery, not a general TeX repair tool, and there are no language-specific decoders.

## Saved answers

`answerForPresentation` joins the display text the outside agent wrote to the original tool call, without changing the recorded answer.

- Option labels match only through an unambiguous selected value, an exact or recovered label, or the one pair left in a complete one-to-one match.
- Ambiguous rows keep their saved snapshots.
- Saved order, indices, selected values, verdicts, confidence and learner text stay as recorded.
- Dismissed answers are returned unchanged.
- Nothing is migrated and no record is rewritten.

## Tests

- `tests/shared/content-recovery.test.ts`: recovery and preservation rules, with hard row, comment and code examples.
- `tests/frontend/tool-content-presentation.test.tsx`: a labeled synthetic corpus, saved-answer joins and ambiguity.
- `tests/frontend/tool-content-interaction.test.tsx`: the select, submit, save and reveal flow, and paragraph structure.
- `tests/frontend/repair-math-display.test.tsx`: `repairMathForDisplay` in the renderer.
- The existing Markdown, card, practice, tool-shape and grading suites still apply.
