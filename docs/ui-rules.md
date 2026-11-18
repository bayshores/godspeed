# UI rules

Read before building or changing any screen, control, pop-up or label. Each rule ends with the check to run before calling the change finished.

## Crafted, not just working

A UI change must fit the app as if it was always there. Working is not finished.

- Before building, work out the whole interaction: where it opens, its size, what it covers or moves, how it closes, every state.
- A new part never squeezes or splits what the learner is working on.
- Size follows content. Nothing small floats in a big empty box. A control sits beside what it acts on.
- Before showing the owner, look at each state in the real window as the owner would. Fix anything you would not call good.

## Say it once

- Each fact shows in one place. No status, name, instruction or count repeated in a second label, sentence or chip visible at the same time.
- A sentence never repeats the label of the button beside it.
- Failure help shows when it fails, not always.
- Before calling a UI change finished, read every word on the changed screen in each state (empty, working, failed) and cut what is said twice.

## No button behind a button

A click does the thing; it does not open a box holding the button for the thing.

- A control never opens a pop-up, menu, card or dialog holding only one action. It does that action itself.
- A pop-up is for a choice between two or more things, or for something that arrives by itself (a notice, a question).
- Holds in every state: a menu down to one entry does that entry on the first click.
- Before calling a UI change finished, click every control on the changed screen in each state and count what opens. One action inside means the pop-up goes.

## No label sandwich

A big title never sits between a small line above and a small line below.

- Nothing small above a title: no eyebrow, category line or date line.
- A title gets at most one supporting line, under or beside it. More facts go into that line or a chip beside the title, or are cut.
- Holds for every title: page heads, cards, rows, pop-ups, empty states.
- Before calling a UI change finished, check every title on the changed screen for a small line above it.

## No wide buttons

A button is as wide as its words.

- No button stretched across its sheet, row or page.
- A button sits at the end of the row or sheet it acts on.
- Before calling a UI change finished, look for a button wider than its label needs on the changed screen.

## Look at the real window

The Mac app draws with WebKit, not Chrome; a page right in a browser can overlap in the app.

- Before calling a UI change finished, look at it in the real app window (the debug shell) at 1440, 1100 and 800 points wide. A browser screenshot does not count.
- Check each state the change touches, scrolled a little and at the scroll end too, for text on text, text under another box, content spilling out of its box and sideways scrolling.
- Anything that sticks out of its own box (a tag, a badge, a pop-up) sits on a layer above what can move under it, or does not stick out at all. Pop-ups go through `MenuShell` or a dialog, which no box can clip.
- `npm run layout` checks the screens in `scripts/layout-screens.mjs` in the real window at all three widths, each as it opens, scrolled 80 px and scrolled to the end, for overlapping text, text or a control another box is drawn over, spills, sideways scrolling, hidden text and cut-off letters. CI runs it on the Mac; `npm run check` does not. Run it yourself before calling a UI change finished. A new screen or state gets an entry there.

## Page layout

Every page, the lesson page included, uses one column and one set of spacing, so nothing moves as the learner goes from page to page. The values live in `:root` and the classes in `src/frontend/globals.css`. Page files use the tokens (`pt-(--lh-page-top)`, `gap-(--lh-gap)`) and classes, never their own numbers.

| What | Value | Where it applies |
|---|---|---|
| Column | `.lh-page`: at most `--lh-page-w` (1460) wide, centered, sides `--lh-page-side` (32, or 24 when the room is under 900) | Every page |
| Top of a page with a title | `--lh-page-top` (40) from the top bar to the title | Today, Study, a deadline, Settings, All facts, Lessons with no space |
| Page title | `.lh-page-title`: `--lh-title` (44, or 34 when the room is under 900), regular | Every page's one h1 |
| Title to what is under it | `--lh-head-gap` (32) | Under a page title, and above a second section title on a page (Done or past) |
| Between cards | `--lh-gap` (24), across and down | Every page; also a tab row to the first card |
| Card | `.lh-card` on a sheet: inset `--lh-inset` (24) on the sides and bottom, 20 on top | Every card with a title or plain content |
| Card head | `.lh-card-head`: one 40-point line for the title and its key, 12 points above the content | Every card title, and a section title outside a card |
| Card title | `.lh-card-title`: 20, regular | Every card and section title |
| Tabs | `.lh-tabs` and `.lh-tab`: 18-point words on a 2-point line | A space's pages, Settings' sections |
| End of a page | `--lh-page-end` (64) under the last card | Every page that scrolls |
| Line length | `--lh-measure` (75ch) | Sentences and paragraphs outside lesson text |
| Keys | 40 high; `.lh-btn-small` 30; `BIG_KEY` and `MAIN_KEY` 48 for a page's main action | Every key |
| Fields | 40 high (`FIELD`, `SELECT`) | Every field |

- Pages with the same head start their first card at the same height: a space's pages under the tab row, title pages under the title.
- The width is used, not stretched: wide, a page puts a second block in a side column (Today's spaces, Files' recent changes, the Study page's suggestions) or lays its cards and groups in columns (Deadlines, Settings). Fields stay field-sized and keys stay as wide as their words.
- A different kind of object keeps its own numbers and says why: a card with a days block on its edge (Today's next card, Progress's next deadline, a Deadlines row) has no inset where the block is; the Graph picture runs under the tab row; side lists of picks in Settings have an 8-point inset as their rows carry their own; the Study page's back link sits above its title; a deadline's head is as tall as its days block.
- The lesson page is read like a book, so its two sheets are reading surfaces (`.lh-reading`), not cards. The lesson text's sheet and "Your turn" keep a 56-point margin (`--lh-reading-inset`, 28 in a column under 640, `--lh-reading-inset-narrow`) with 40 points above and below, and the step line's words sit on the same margin. "Your turn" is headed at 28 points, a step above its 22-point question, where a card title at 20 would sit under the question. The text keeps a reading measure of 872 points while nothing waits. Everything else on the lesson page takes the shared values: its gaps are `--lh-gap`, its end is `--lh-page-end`, and its head is a 48-point row like a space's tab row, so its first sheet starts where a space page's first card does.
- Only screens that are one centered box (onboarding, dialogs, Not found) stay centered.
- `npm run layout` reports a card whose inset is off, a reading surface whose sides are not the reading inset, two neighbouring sheets in a page's column at a gap that is not `--lh-gap`, and a page h1 without `.lh-page-title`.
- Before calling a page change finished, look at it at 1512, 1100 and 800 points wide, with the teacher's panel docked too.

## Type

Interface and lesson text are one face, Literata, so they stay apart by size, weight and color, as a book sets its running text apart from its headings and notes.

- Lesson text is the reading size (17 px at 100%) in the body ink. Interface text is 15 px or smaller, titles 22 px and up at regular weight, labels medium. Nothing in the interface is heavier than medium, except the legend of a main or danger key.
- Settings, Appearance, Reading font changes lesson text only; the interface stays Literata.
- Dates and counts are DotGothic16 (`font-count`). Code and the agent's screen are the system monospace.
- Italic only where a book would set it (a work's title, a term as it is defined), never for decoration.
- A key takes its size from `lh-btn`, or `lh-btn-small` for a key in a line of text or a card's corner. A new key never gets a height or font size of its own.
- Before calling a UI change finished, check that a new key uses one of those two sizes and that no interface text is set at lesson text's size and weight.
