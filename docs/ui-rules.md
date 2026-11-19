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
- The lesson text holds only lesson content: nothing the teacher was handed, no status of the app, no copy of the plan (the step row is its one home).
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

## Top bar

The top bar is the one place for a page's own actions and for where the learner is. Its parts are in `src/frontend/components/top-bar/`.

| What | Where | How |
|---|---|---|
| A page's own actions | The bar's right side, after the teacher pill and before Menu, so the pill's changing words never move them | `BarActions`, each a flat word as tall as the bar (`barWord`), a block of the bar's ink while its panel is open; Menu is the same word; never a row under the bar |
| Where the learner is inside a space | After the lit space tab, on its paper, after a "›" | `BarCrumb`: a lesson's title, a deadline's name, "Cheat sheet" |
| Find | A magnifying glass in the bar, on every page that can find; open, its field takes the place of that page's own words only, so on Files and Graph the space's Edit space stays, and on a lesson every word gives way | `BarFind` |
| A shortcut | Inside the button whose action it is, read from the key registry | `KeyHint` and `keyShortcutProps` |

- No keycap (`.lh-btn`) in the top bar or in a page's own bar (the mock's): every word there is flat like the tabs, and a key inside the pill is a flat chip. `npm run layout` fails a keycap in a bar. A pop-up that hangs from the bar keeps its keys.
- Page tabs (Progress, Files, Graph, Deadlines) and keys inside a card stay on the page.
- Bar words are real buttons or links, never a clickable span: the bar is the window's drag band, and only buttons, links and fields are cut out of it (`crates/shell/src/shim.js`).
- Crowded, the bar gives way in this order (`space-tabs.tsx`): the pill's words and its deadline's name (the countdown stays), then the unlit tabs' names down to 8 letters, then those tabs scroll with the lit tab kept in view. The lit tab and its crumb never give way to the other tabs; in a strip too narrow for both, the crumb's name gives way down to 12 letters (`CrumbName`), then the lit tab's name down to its dot. The wordmark and the clock leave below 1200 points while a page has words in the bar, and below 760 always (`.lh-bar-spare`).
- Below 1100 points a page's words take a line of their own above the bar's, at its right end, so the bar is two lines tall (`.lh-bar-actions` in `globals.css`). Whatever sits under the bar reads its height from `--lh-bar-h`, never a fixed 48 points. A menu from a page's word hangs from that word's line and may cover the line below while it is open. Windows that stay open, the teacher's window and a plugin's window, hang under the whole bar and read `--lh-bar-h`.
- Before calling a bar change finished, check that no page draws its actions under the bar, and look at the bar at 1440, 1100 and 800 points wide with the longest real names.

## Page layout

Every page, the lesson page included, uses one column and one set of spacing, so nothing moves as the learner goes from page to page. The values live in `:root` and the classes in `src/frontend/globals.css`. Page files use the tokens (`pt-(--lh-page-top)`, `gap-(--lh-gap)`) and classes, never their own numbers.

| What | Value | Where it applies |
|---|---|---|
| Column | `.lh-page`: at most `--lh-page-w` (1460) wide, centered, sides `--lh-page-side` (32, or 24 when the room is under 900) | Every page |
| Top of a page with a title | `--lh-page-top` (40) from the top bar to the title, or to a deadline's head (its name is in the bar) | Today, Study, a deadline, Settings, All facts, Lessons with no space |
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

- Pages with the same head start their first card at the same height: a space's pages under the tab row, title pages under the title. The lesson page has no head: its first sheet starts `--lh-gap` under the bar.
- Sheets side by side end on the same line: the shorter one grows to the taller one's foot (Today's spaces beside the week), and a block alone in a row of two takes the row (Today's "Unfinished").
- The width is used, not stretched: wide, a page puts a second block in a side column (Today's spaces, Files' recent changes, the Study page's suggestions) or lays its cards and groups in columns (Deadlines, Settings). Fields stay field-sized and keys stay as wide as their words.
- A different kind of object keeps its own numbers and says why: a card with a days block on its edge (Today's next card, Progress's next deadline, a Deadlines row) has no inset where the block is; the Graph picture runs under the tab row; side lists of picks in Settings have an 8-point inset as their rows carry their own; the Study page's back link sits above its title; a deadline's head is as tall as its days block.
- The lesson page is read like a book, so its two sheets are reading surfaces (`.lh-reading`), not cards. The lesson text's sheet and "Your turn" keep a 56-point margin (`--lh-reading-inset`, 28 in a column under 640, `--lh-reading-inset-narrow`) with 40 points above and below, and the step line's words sit on the same margin. "Your turn" is headed at 28 points, a step above its 22-point question, where a card title at 20 would sit under the question. The text keeps a reading measure of 872 points while nothing waits. Everything else on the lesson page takes the shared values: its gaps are `--lh-gap` and its end is `--lh-page-end`. It has no head of its own (its title and words sit in the top bar), so its first sheet starts `--lh-gap` under the bar. Beside the text, both sheets fill the window like the pages of an open book: "Your turn" is exactly as tall as the window's room, the text's sheet at least that tall, the page ends `--lh-gap` under them, and only the lesson text scrolls. In "Your turn" the question or problem takes the room that is left, so the box and its keys rest at the sheet's foot, and scrolls in its own box when it is longer. A problem's parts the learner is not on fold to one line at every width, and a click opens one.
- Only screens that are one centered box (onboarding, dialogs, Not found) stay centered.
- `npm run layout` reports a "Your turn" foot row outside the window beside the lesson text, a card whose inset is off, a reading surface whose sides are not the reading inset, two neighbouring sheets in a page's column at a gap that is not `--lh-gap`, and a page h1 without `.lh-page-title`.
- Before calling a page change finished, look at it at 1512, 1100 and 800 points wide, with the teacher's panel docked too.

## Motion and waiting

The app moves in one register, quick and quiet, like an e-ink page redrawing. The tokens and classes live in the motion blocks of `src/frontend/globals.css`.

- Things enter in `--lh-dur` (160 ms) and leave in `--lh-dur-fast` (110 ms). A leaving thing is held on screen by presence (`usePresence`, `useLastWhileClosing`) until its exit has played; nothing pops away.
- Anything that replaces part of a page appears stepped (`.lh-block-in`, `.lh-set`), top to bottom, one thing moving at a time.
- A new keyframe needs a reason the existing ones can't serve.
- Every motion class has a reduced-motion switch: with reduced motion nothing is held, nothing animates and scrolls are instant.
- A wait has the shape of what comes, at the place it will appear, and shows objects (the lesson's desk shows the learner's files as paper), not skeleton bars. It has one live element and repeats no word the top bar's pill already says.
- Before calling a waiting state finished, reload a lesson mid-wait at 1440, 1100 and 800 points wide: it shows without motion, in place, and nothing jumps when the reply lands.

## Type

Interface and lesson text are one face, Literata, so they stay apart by size, weight and color, as a book sets its running text apart from its headings and notes.

- Lesson text is the reading size (17 px at 100%) in the body ink. Interface text is 15 px or smaller, titles 22 px and up at regular weight, labels medium. Nothing in the interface is heavier than medium, except the legend of a main or danger key.
- Settings, Appearance, Reading font changes lesson text only; the interface stays Literata.
- Dates and counts are DotGothic16 (`font-count`). Code and the agent's screen are the system monospace.
- Italic only where a book would set it (a work's title, a term as it is defined), never for decoration.
- Every button is a key, never a bare word: `lh-btn-main` for a view's one main action, `lh-btn` for the others, `lh-btn-quiet` (a lighter key) for its lesser ones, `barWord` on a dark bar.
- A key takes its size from `lh-btn`, or `lh-btn-small` for a key in a row, a line of text or a card's corner. A new key never gets a height or font size of its own.
- Before calling a UI change finished, check that a new key uses one of those two sizes and that no interface text is set at lesson text's size and weight.
