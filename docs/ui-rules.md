# UI rules

Read before building or changing any screen, control, pop-up or label. Each rule ends with the check to run before calling the change finished.

## Crafted, not just working

A UI change must fit the app as if it was always there. Working is not finished.

- Before building, work out the whole interaction: where it opens, its size, what it covers or moves, how it closes, every state.
- A new part never squeezes or splits what the learner is working on.
- Size follows content. Nothing small floats in a big empty box. A control sits beside what it acts on.
- A box with nothing in it is not drawn. A column appears with its first thing (the cheat sheet's chat column, once something is asked). `npm run layout` fails a sheet or well that shows nothing.
- Before showing the owner, look at each state in the real window as the owner would. Fix anything you would not call good.

## Say it once

- Each fact shows in one place. No status, name, instruction or count repeated in a second label, sentence or chip visible at the same time.
- A sentence never repeats the label of the button beside it.
- The lesson text holds only lesson content: nothing the teacher was handed, no status of the app, no copy of the plan (the step row is its one home).
- Failure help shows when it fails, not always.
- Before calling a UI change finished, read every word on the changed screen in each state (empty, working, failed) and cut what is said twice.

## Obsidian and Notes folder

| Where the notes go | The interface says |
|---|---|
| A folder Obsidian lists, or one that holds `.obsidian/` | "Obsidian": "Saved to Obsidian", "Open in Obsidian" |
| Any other folder | "Notes folder" or "Notes": "Saved to your notes folder", "Show in Finder" |

"Vault" is only a word in code and docs, never in the interface.

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
- A key keeps at least 8 points beside its words: its padding comes from `lh-btn` or `lh-btn-small`, never a `px-` of its own.
- `npm run layout` fails a key more than 96 points wider than its words ("wide key") and a key with less than 8 points beside its words ("tight key").

## No key piles

A list of things to open (related topics, linked facts, files) is rows, not keys. Keys are for actions.

- A row is a square in the thing's color and its name. Rows may wrap as chips, each a well with the thing's square or moon and its name, like the links in a Graph panel (`LinkChips` in `components/graph/link-chips.tsx`). The whole row or chip is the click.
- A title wraps; it is never cut with "...". Only the top bar's names give way, as the Top bar section says.
- `npm run layout` fails three or more keys stacked on three or more lines in one group ("key pile") and a cut title ("cut title"), outside pop-ups and bars.

## Nothing hidden

A feature has a control a learner can see.

- A key, gesture, right-click or hover may repeat a visible control. It is never the only way to something.
- A thing only the teacher makes has its asking control on the page where it will show, drawn before the thing exists.
- Before calling a UI change finished, run `tests/shared/features.test.ts`, and read the changed screen for a control at rest that reaches each feature it touches.

## Look at the real window

The Mac app draws with WebKit, not Chrome; a page right in a browser can overlap in the app.

- Before calling a UI change finished, look at it in the real app window (the debug shell) at 1440, 1100 and 800 points wide. A browser screenshot does not count.
- Check each state the change touches, scrolled a little and at the scroll end too, for text on text, text under another box, content spilling out of its box and sideways scrolling.
- Anything that sticks out of its own box (a tag, a badge, a pop-up) sits on a layer above what can move under it, or does not stick out at all. Pop-ups go through `MenuShell` or a dialog, which no box can clip.
- `npm run layout` checks the screens in `scripts/layout-screens.mjs` in the real window at all three widths, each as it opens, scrolled 80 px and scrolled to the end, for overlapping text, text or a control another box is drawn over, spills, sideways scrolling, hidden text, cut-off letters, a page that scrolls into empty room under the last thing it holds and a question in "Your turn" that opens scrolled past its first line. CI runs it on the Mac; `npm run check` does not. Run it yourself before calling a UI change finished. A new screen or state gets an entry there.

## Top bar

The top bar is the one place for a page's own actions and for where the learner is. Its parts are in `src/frontend/components/top-bar/`.

| What | Where | How |
|---|---|---|
| A page's own actions | The bar's right side, before Menu | `BarActions`, each a flat word as tall as the bar (`barWord`), a block of the bar's ink while its panel is open; Menu is the same word; never a row under the bar |
| Where the learner is inside a space | After the lit space tab, on its paper, after a "›" | `BarCrumb`: a lesson's title, a deadline's name, "Cheat sheet" |
| Find | A magnifying glass in the bar, on every page that can find; open, its field takes the place of that page's own words only, so on Files and Graph the space's Edit space stays, and on a lesson every word gives way | `BarFind` |
| The app's size while it is not 100%, or the page's while a pinch magnifies it | Before Menu, on Menu's line when the bar is two lines | `BarZoom`: the number ("125%"), there only while zoomed or magnified; a click goes back to 100% |
| A shortcut | Inside the button whose action it is, read from the key registry | `KeyHint` and `keyShortcutProps` |

- No key (`.lh-btn`) in the top bar or in a page's own bar (the mock's): every word there is flat like the tabs. `npm run layout` fails a key in a bar. A pop-up that hangs from the bar keeps its keys.
- A bar word is there only while it acts or tells something: no status for a thing that is not made yet, and no switched-off key for it (the cheat sheet's Show in Finder and Print show once the sheet is made).
- Page tabs (Progress, Files, Graph, Deadlines) and keys inside a card stay on the page.
- Bar words are real buttons or links, never a clickable span: the bar is the window's drag band, and only buttons, links and fields are cut out of it (`crates/shell/src/shim.js`).
- Crowded, the bar gives way in this order (`space-tabs.tsx`): the unlit tabs' names down to 8 letters, then those tabs scroll with the lit tab kept in view. The lit tab and its crumb never give way to the other tabs; in a strip too narrow for both, the crumb's name gives way down to 12 letters (`CrumbName`), then the lit tab's name down to its dot. The date and the clock stay on every page at every width.
- The bar is the same on every page: no page changes its height or takes a part of it away. Below 1100 points one line cannot hold it all, so it is two lines tall on every page, Home too: the date, the page's words and the clock above Home, the tabs and Menu (`.lh-bar-top` in `globals.css`). On that top line a Find field narrows before it would reach the date. Whatever sits under the bar reads its height from `--lh-bar-h`, never a fixed 48 points. A menu from a page's word hangs from that word's line and may cover the line below while it is open. Windows that stay open, the teacher's window and a plugin's window, hang under the whole bar and read `--lh-bar-h`.
- Before calling a bar change finished, check that no page draws its actions under the bar, and look at the bar at 1440, 1100, 800 and 640 points wide with the longest real names, on Home and on a page with words in the bar.

## The strip

The strip is the teacher's panel at its narrowest, down the window's right edge under the top bar. What it holds and does is in [08.1.2](architecture/08.1.2-the-work-loop.md#the-strip).

- It is 28 points wide (`--lh-strip`) on every page in the app shell and made of the top bar's dark. Nothing else sits on the window's right edge, and no page draws under it: a page ends where the strip starts.
- Its marks (the square, the name, the arrow, "needs you", "your turn", the notices' count, a deadline's countdown) are plain words and shapes, never a key. Anything that needs a key or a longer line goes in its peek, which is a pop-up and keeps its keys.
- A new thing the teacher says or waits for is a row in the peek or a notice, never a new mark or a control elsewhere in the bar.
- Before calling a change to the strip, the peek or a page's right side finished, look at the page with the peek out and with the panel open, at 1512, 1100 and 800 points wide.

## Page layout

Every page, the lesson page included, uses one column and one set of spacing, so nothing moves as the learner goes from page to page. The values live in `:root` and the classes in `src/frontend/globals.css`. Page files use the tokens (`pt-(--lh-page-top)`, `gap-(--lh-gap)`) and classes, never their own numbers.

| What | Value | Where it applies |
|---|---|---|
| Column | `.lh-page`: at most `--lh-page-w` (1460) wide, centered, sides `--lh-page-side` (32, or 24 when the room is under 900) | Every page |
| Top of a page with a title | `--lh-page-top` (40) from the top bar to the title, or to a deadline's head (its name is in the bar) | Home, Study, a deadline, Settings, All facts, Lessons with no space |
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
- Sheets side by side end on the same line: the shorter one grows to the taller one's foot (Home's spaces beside the week), and a block alone in a row of two takes the row (Home's "Unfinished").
- The width is used, not stretched: wide, a page puts a second block in a side column (Home's spaces, Files' recent changes, the Study page's deadlines) or lays its cards and groups in columns (Deadlines, Settings). Fields stay field-sized and keys stay as wide as their words.
- A different kind of object keeps its own numbers and says why: a card with a count block on its edge (Home's next card, Progress's next deadline, a Deadlines row, a Study page row, a deadline's head, the Files head) has no inset where the block is; the Graph picture runs under the tab row; side lists of picks in Settings have an 8-point inset as their rows carry their own; the Study page's back link sits above its title; a deadline's head sheet is at least as tall as its days block, with the page's main keys at its end.
- The lesson page is read like a book, so its two sheets are reading surfaces (`.lh-reading`), not cards. The lesson text's sheet and "Your turn" keep a 56-point margin (`--lh-reading-inset`, 28 in a column under 640, `--lh-reading-inset-narrow`) with 40 points above and below, and the step line's words sit on the same margin. "Your turn" is headed at 28 points, a step above its 22-point question, where a card title at 20 would sit under the question; the head says what waits in the word its answered card will carry (Prediction, Quiz, Explain, Code, Question; "Problem 3" on a problem) and reads "Your turn" only when nothing is asked. The text keeps a reading measure of 872 points until the lesson starts. From then on, in a room wide enough for two pages, the lesson is a book: open while the learner has a question, a problem or the task he last finished to work on, with "Your turn" on the right page; shut otherwise, one page in the middle as wide as the open book's left page, with "Your turn" a strip of the writing box and one row of keys pinned under it. The right page is never empty, and a task is drawn once: on the right page while it is kept, then as a card in the text. The lesson text is one sheet per step (a plan step; a problem in practice and homework), `--lh-gap` apart, so the page's background shows where one step ends. A sheet carries its step's number on a tab in the space's color at its left edge, beside its first line; the step's name stays in the step line. Two replies on one sheet are parted by room, never a line. An empty sheet is never drawn: a step has no sheet until something of it is drawn, and while the lesson text holds nothing, "Your turn" sits alone in the middle at its own width. Everything else on the lesson page takes the shared values: its gaps are `--lh-gap` and its end is `--lh-page-end`. It has no head of its own (its title and words sit in the top bar), so its first sheet starts `--lh-gap` under the bar. Beside the text, both sheets fill the window like the pages of an open book: "Your turn" is exactly as tall as the window's room, the text's newest sheet at least that tall, the page ends `--lh-gap` under them, and only the lesson text scrolls. In a room too narrow for the two side by side (under 1280 points) and at least 640 points high under the step line, the text keeps the window and "Your turn" is pinned at the window's foot under it, never scrolled away: with nothing to answer it is the writing box and one row of keys, with the key that goes on at the row's end and no head, and while the teacher works it is the box alone. A waiting question or an open problem is shown whole there, with closer margins (28 points above and below), and scrolls in its own box only when the window is too low to leave the text 88 points. In a lower room "Your turn" sits in the page under the text, as tall as what it holds, and the page ends `--lh-page-end` under it. In "Your turn" the question or problem takes the room that is left, so the box and its keys rest at the sheet's foot, and scrolls in its own box when it is longer. A problem's parts the learner is not on fold to one line at every width, and a click opens one.
- Only screens that are one centered box (onboarding, dialogs, Not found) stay centered.
- `npm run layout` reports a "Your turn" foot row outside the window beside the lesson text, a card whose inset is off, a reading surface whose sides are not the reading inset, two neighbouring sheets in a page's column at a gap that is not `--lh-gap`, and a page h1 without `.lh-page-title` (a heading in rendered Markdown is its writer's and does not count). What the learner pans is marked `data-pans`, and a part of it out of view is not reported as hidden. One picture drawn on stacked boxes (a cheat sheet page with its zoomed part drawn sharper over it) is marked `data-picture`, and its boxes are not checked against each other.
- A page works in the narrowest room the teacher's panel leaves it (480 points). No column has a fixed width that starves its neighbour: it gives way, or the columns go one over the other (the cheat sheet over its chat under 768 points; its pages one under another in a canvas under 640).
- The teacher's terminal can leave the panel for a window of its own: the key is "Pop out", a quiet key in the screen's bottom row, after Paste; the way back is "Put back", the panel head's last key and the only key in the window's head. The window holds the head's status line, the screen and its row, no Follow, Chats or Activity, and works down to 400 by 300 points. On the Mac its head is its title bar, one dark sheet with the traffic lights in it. Popping out closes the panel, so the page gets the room; while the window is open the panel is Activity alone and the strip lit with "needs you" means the window needs the learner. "Put back" in either window opens the panel on the screen.
- A view that fits its content (the cheat sheet canvas) fits it again when its room changes, until the learner moves the view.
- Before calling a page change finished, look at it at 1512, 1100 and 800 points wide, with the teacher's panel open too.

## Motion and waiting

The app moves in one register, quick and quiet, like an e-ink page redrawing. The tokens and classes live in the motion blocks of `src/frontend/globals.css`.

- Motion is part of every UI change, built in the same change without being asked: for each new or changed thing, decide how it arrives, leaves, changes size, swaps what it holds, and answers the pointer and a press. Nothing pops in, vanishes or snaps. A UI change is finished only when its motion has been filmed and watched frame by frame; pictures of it at rest are not enough.
- Things enter in `--lh-dur` (160 ms) and leave in `--lh-dur-fast` (110 ms). A leaving thing is held on screen by presence (`usePresence`, `useLastWhileClosing`) until its exit has played; nothing pops away.
- Anything that replaces part of a page appears stepped (`.lh-block-in`, `.lh-set`), top to bottom, one thing moving at a time. A teacher's reply prints line by line (`usePrintIn`).
- A page change is the one large move (`--lh-dur-page`, 420 ms): the pages are sheets lying side by side (`Travel`, `components/travel/`). A still copy of the old page leaves while the new one arrives.

  | From, to | The window travels |
  |---|---|
  | Home, a space, what the + reaches, Settings | Sideways, in the order of the top bar |
  | A space's tabs | Sideways under the space's head, in the order of the tabs; the head stays still |
  | To a deeper page (a deadline's page or the start page, then a lesson, a mock, a cheat sheet) | The deeper page is laid on top from the bottom edge |
  | Back from a deeper page | That sheet is taken off, downward |
  | Settings sections, a mock's questions, a mock's screens (waiting, answering, results) | Sideways, in their order |
  | An area's full instructions in Settings | Laid on top from the bottom edge, and taken off downward |

- A new page takes its place in `travel-model.ts` (its depth and its column). A page never animates its own arrival.
- The lit one of a row of tabs is marked by one box that slides to it (`useLitMarker`): the paper under the lit tab of the top bar, the underline of a space's tabs and of Settings. A tab never draws its own lit background or underline.
- A page's own words in the top bar fade in with the page.
- The lesson's book opens or shuts only when a reply has landed whole, at most once per reply, never while the learner reads a reply that is still arriving and never on a stopped or failed one. The page takes its new layout and its rest in one step, and the pages are moved there with transforms and clips: no line wraps anew, the writing box and the row under it stay in sight and keep the keyboard, and the page does not scroll by itself during the move or after it. Between two tasks nothing slides. With reduced motion nothing slides and the page is placed at once.
- Before calling a change to the lesson's layout or its scrolling finished, film the book opening and shutting in the real window with the clock slowed, three rounds in a row, and list every change of the scroll position after the reply landed: one placement at the flip, then only what follows a card that opens. Check it once with reduced motion and once while typing in the box.
- The lesson's two sheets glide to a new height where they would jump (`useSheetGlide`: a reply landing, the desk opening, a key arriving in "Your turn"), 110 to 320 ms by how far the edge travels, sheets that change together in the same time. What a sheet holds is laid out at its new size at once and the edge uncovers it. The page holds still while they glide, then glides to its rest once. A new width or a window of another size lays the page out at once.
- The Graph slip travels in from past the room's foot by its own height (220 to 320 ms by height, `--lh-ease-out`) and leaves the same way (110 to 160 ms, `--lh-ease-in`), cut at the room's foot so it never draws over the foot line; a panel shown alone does the same from the room's foot. The panel is laid over the picture and taken off it: the picture stays drawn under a panel in its place until the panel has arrived, then fades out, and it takes the whole room with its fade the moment a panel starts to leave, so no frame shows an empty room. A panel that moves between the slip and the picture's place keeps its sheet, whose top edge travels between the two places. A panel that replaces another keeps the slip: its edge glides to the new height (`useSheetGlide`) and uncovers the new panel, whose blocks step in top to bottom; a panel that grows in place ("N more") rides its edge up and its new rows come up from the foot. The picture re-fits once to the final height. An opened fact's moon prints row by row (`.lh-print`), link chips step in left to right 20 ms apart and a topic's moons 15 ms apart, the last of a row by 160 ms (`slip-motion-model.ts`). A panel there at first render is simply there.
- A new keyframe needs a reason the existing ones can't serve.
- Every motion class has a reduced-motion switch: with reduced motion nothing is held, nothing animates and scrolls are instant.
- A wait while data is read is `LoadingBox` (a still box in the size of what comes) or `LoadingLine` (where it has no size yet), in `components/loading.tsx`. Its one live element is the spinner. What replaces a wait the learner saw steps in (`useWaited` with `.lh-set`); what was there at first render never animates.
- A failed load rises in (`LoadFailed`).
- A page opens at rest: after it first shows, nothing in it moves, arrives or changes size by itself. What the first drawing needs is read before it: server data in the route's loader (the active space's record, progress and sheets are read once for the window, in the app shell), stored state (a draft, an open panel, a dragged width) in the state's initializer, a measured layout in a layout effect. An effect after mount never reads what the first drawing depends on.
- A wait has the shape of what comes, at the place it will appear, and shows objects (the lesson's desk shows the learner's files as paper), not skeleton bars. It has one live element and repeats no word the strip already says.
- Before calling a waiting state finished, reload a lesson mid-wait at 1440, 1100 and 800 points wide: it shows without motion, in place, and nothing jumps when the reply lands.

## Type

Interface and lesson text are one face, Literata, so they stay apart by size, weight and color, as a book sets its running text apart from its headings and notes.

- Lesson text is the reading size (17 px at 100%) in the body ink. Interface text is 15 px or smaller, titles 22 px and up at regular weight, labels medium. Nothing in the interface is heavier than medium, except the legend of a main or danger key.
- Settings, Appearance, Reading font changes lesson text only; the interface stays Literata.
- Dates and counts are DotGothic16 (`font-count`). Code and the agent's screen are the system monospace.
- Italic only where a book would set it (a work's title, a term as it is defined), never for decoration.
- Every button is a key, never a bare word: `lh-btn-main` for a view's one main action, `lh-btn` for the others, `lh-btn-quiet` (a lighter key) for its lesser ones, `barWord` on a dark bar.
- A key is a tile like the g in the logo: a face inside a 2-point ink edge, on a dithered ink shadow down and to the right, with square corners. Pressing slides it into its shadow. A key's own color goes in `--lh-key` (its face) and `--lh-key-hover`, never in a fill, edge or corner utility.
- A key takes its size from `lh-btn`, or `lh-btn-small` for a key in a row, a line of text or a card's corner. A new key never gets a height or font size of its own.
- Before calling a UI change finished, check that a new key uses one of those two sizes and that no interface text is set at lesson text's size and weight.
