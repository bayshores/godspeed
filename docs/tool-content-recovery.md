# Tool-content presentation recovery

How screens repair broken LaTeX and escaping in text the outside agent wrote into a tool call, without changing what is saved. Read this before you touch math display in question cards, problems or answer reveals.

## Where the code lives

| File | What it does |
|---|---|
| `src/shared/core/content-reader.ts` | Splits tool-authored Markdown into prose, code and math spans (CommonMark parser plus math extension). Holds the TeX checks and `recoverDocumentLayout`. |
| `src/shared/core/math-delims.ts` | `repairMathForDisplay`, the one entry point for display recovery. |
| `src/shared/core/answer-presentation.ts` | `answerForPresentation`, for saved answers. |
| `src/frontend/components/ai-elements/message.tsx` | `ToolContentResponse`, the renderer that applies the repair. |
| `src/shared/core/argument-heal.ts`, `crates/agent/src/tools/heal.rs` | Argument shape healing, a separate step (below). |

## The rule

Recovery changes only what the learner sees. Saved tool arguments, option identities, learner answers, shuffling, grading and later answer snapshots use the content as parsed from the schema, never the repaired text.

`ToolContentResponse` runs text through `repairMathForDisplay`, then the ordinary Markdown renderer. Questions, asks, recalls, explanations, and practice statements and solutions use it. Ordinary assistant prose does not.

Three separate steps:

1. Argument and shape parsing: decodes encoded argument shapes, then converts, validates and cleans them against the schema. No LaTeX recovery.
2. Content projection: tells literal code, prose and document structure, and math apart, and recovers only the escaping defects below.
3. Presentation: renders Markdown and KaTeX, including paragraph layout. In a committed-answer reveal only the first paragraph sits inline with its label; later paragraphs keep normal layout.

## Recovery rules

### Literal code

Code and inline-code ranges come from the CommonMark parser with its math extension (fences, indentation, quotes, lists, no separate container rules). The projection copies them as they are and never turns a syntax tree back into Markdown.

### Code fences with one extra layer

A complete fence that arrived with its line breaks and quotes escaped once more, such as a whole fence on one line with `\n` between its lines, is decoded as one unit and shown as code.

- Only a complete fence qualifies: opening and closing fence of the same kind, every line break encoded, and the text decodes as one JSON string into exactly one code block.
- The decode is one layer for the whole fence. Quotes and backslashes inside the program are never replaced one by one.
- A fence with mixed real and encoded line breaks, an invalid escape, a missing close or two extra layers stays as written, and so does everything inside it.
- Real fences, inline code and fences inside an outer code example are never decoded.
- A valid encoding is evidence, not proof: a program with a literal `\n` in a single-quoted string can look the same as a misplaced line break, and that case is decoded. There is no per-language repair.

### Document escapes

A literal two-character `\n` differs from a real newline.

- Recover document layout only with evidence: repeated document escapes, or one alongside over-escaped known TeX commands.
- Complete known TeX words starting with n (`\nu`, `\nabla`, `\neq`, declared macros) win over reading `\n` as a line break.
- Code, real TeX comments and recognized path tokens are protected.
- Recovered `$$` display framing puts the formula and closing fence on their own lines. Decoding only the opening line could turn the closing dollars into wrong TeX.

### Command prefixes swallowed by JSON

Inside math, a control character can be what is left after JSON consumed the start of a command, for example TAB followed by `ext` instead of `\text`. Recovery rebuilds a command only if the control character plus the whole following word names a known KaTeX command. Every supported case recovers in one pass.

| Case | What happens |
|---|---|
| Inline math | Recognized prefixes recover, including real line feed plus `u` to `\nu`, TAB plus `o` to `\to`. No word-length limit. |
| Display math | Real line feeds and CRLF stay as source formatting. Other recognized prefixes recover. |
| Commands already written correctly | Stay commands in both modes. `\nu` is never decoded into a line feed plus `u`. |
| Unrecognized whitespace | Stays. `x<TAB>+<TAB>y` does not become invented `\t` or `\ty` commands. |

This is ambiguous by nature: whitespace followed by a variable can spell a command, and a successful TeX parse cannot tell the meanings apart. The policy targets LaTeX the outside agent typically writes, not every arrangement a person could type.

### Extra backslashes, percentages and rows

Recovery checks the original TeX context before changing a run of backslashes.

- Complete environment pairs and `\substack` arguments written correctly keep their row separators.
- Environment pairs consistently over-escaped set an escaping factor for commands and rows. An encoded four-backslash row becomes two backslashes, not one.
- Outside protected row and comment contexts, extra backslashes before known commands can recover. Unknown command words are never invented.
- Doubled percent escapes in ordinary numbers can recover to `\%`, including a percentage ending a display formula. Real comment text or equation rows after it stay literal.
- Extra guard: partial recovery never turns source that parses into source that fails to parse. Parse success is not the main test, since a broken matrix and a lost percentage both parse.

Unbalanced, unsupported or ambiguous content is not rewritten into new math. This is escaping recovery, not general TeX repair, with no language-specific decoders.

## Saved answers

`answerForPresentation` joins the display text the outside agent wrote to the original tool call, without changing the recorded answer.

- Option labels match only through an unambiguous selected value, an exact or recovered label, or the one pair left in a complete one-to-one match.
- Ambiguous rows keep their saved snapshots.
- Saved order, indices, selected values, verdicts, confidence and learner text stay as recorded.
- Dismissed answers are returned unchanged.
- Nothing is migrated; no record is rewritten.

## Tests

- `tests/shared/content-recovery.test.ts`: recovery and preservation rules, with hard row, comment and code examples.
- `tests/frontend/tool-content-presentation.test.tsx`: labeled synthetic corpus, saved-answer joins, ambiguity.
- `tests/frontend/escaped-code-recovery.test.tsx`: extra-layer fence profiles, what must stay as written, and the copy, submit and saved-answer flow for a recovered fence.
- `tests/frontend/tool-content-interaction.test.tsx`: select, submit, save and reveal flow, paragraph structure.
- `tests/frontend/repair-math-display.test.tsx`: `repairMathForDisplay` in the renderer.
- Existing Markdown, card, practice, tool-shape and grading suites still apply.
