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

- Before calling a UI change finished, look at it in the real app window (the debug shell) at 1440, 1100 and 640 points wide; 640 is the narrowest the window goes. A browser screenshot does not count.
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
| Noise | Before Menu, on Menu's line when the bar is two lines, and at the right end of the mock's own bar | `NoiseWord` (`noise.tsx`): a flat word, a block of the bar's ink while the noise plays; gone while Sounds is off. The noise is made in the window (`lib/noise-audio.ts`), fades in and out over 0.4 s, plays on across pages, is off at every launch and is saved nowhere |
| A shortcut | Inside the button whose action it is, read from the key registry | `KeyHint` and `keyShortcutProps` |

- No key (`.lh-btn`) in the top bar or in a page's own bar (the mock's): every word there is flat like the tabs. `npm run layout` fails a key in a bar. A pop-up that hangs from the bar keeps its keys.
- A bar word is there only while it acts or tells something: no status for a thing that is not made yet, and no switched-off key for it (the cheat sheet's Show in Finder and Print show once the sheet is made).
- Page tabs (Progress, Files, Graph, Deadlines) and keys inside a card stay on the page.
- Bar words are real buttons or links, never a clickable span: the bar is the window's drag band, and only buttons, links and fields are cut out of it (`crates/shell/src/shim.js`).
- Crowded, the bar gives way in this order (`space-tabs.tsx`): the unlit tabs' names down to 8 letters, then those tabs scroll with the lit tab kept in view. The lit tab and its crumb never give way to the other tabs; in a strip too narrow for both, the crumb's name gives way down to 12 letters (`CrumbName`), then the lit tab's name down to its dot. The date and the clock stay on every page at every width: under 700 points Find is its glass alone, the page's words sit closer, and a plugin's word shortens to five letters before a word would reach the clock.
- The bar is the same on every page: no page changes its height or takes a part of it away. Below 1100 points one line cannot hold it all, so it is two lines tall on every page, Home too: the date, the page's words and the clock above Home, the tabs and Menu (`.lh-bar-top` in `globals.css`). On that top line a Find field narrows before it would reach the date. Whatever sits under the bar reads its height from `--lh-bar-h`, never a fixed 48 points. A menu from a page's word hangs from that word's line and may cover the line below while it is open. Windows that stay open, the teacher's window and a plugin's window, hang under the whole bar and read `--lh-bar-h`.
- Before calling a bar change finished, check that no page draws its actions under the bar, and look at the bar at 1440, 1100, 800 and 640 points wide with the longest real names, on Home and on a page with words in the bar.

## The strip

The strip is the teacher's panel at its narrowest, down the window's right edge under the top bar. What it holds and does is in [08.1.2](architecture/08.1.2-the-teachers-round-and-the-strip.md#the-strip).

- It is 28 points wide (`--lh-strip`) on every page in the app shell and made of the top bar's dark. Nothing else sits on the window's right edge, and no page draws under it: a page ends where the strip starts.
- Its marks (the square, the name, the arrow, "needs you", "your turn", the notices' count, a deadline's countdown) are plain words and shapes, never a key. Anything that needs a key or a longer line goes in its peek, which is a pop-up and keeps its keys.
- A new thing the teacher says or waits for is a row in the peek or a notice, never a new mark or a control elsewhere in the bar.
- What the teacher does in a lesson's turn is the lesson's desk, in the lesson text ([7.1](architecture/07.1-while-the-teacher-works.md)); the strip, the peek's status row and the panel's head then say only "Working", and the strip adds "needs you" while the desk asks the learner to allow something.
- What the teacher does while Follow is on is Follow's slip, one line at the page's foot that ends at the strip (or the docked panel) in the same dark ([8.1.7](architecture/08.1.7-follows-slip.md)): the step it is on, why Follow waits, its count of steps and the list of them. While the slip is up the strip, the peek's status row and the panel's head say only "Working", and the strip's one announcer reads the slip's words. The peek keeps what needs the learner.
- Before calling a change to the strip, the peek or a page's right side finished, look at the page with the peek out and with the panel open, at 1512, 1100 and 640 points wide.

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

- Pages with the same head start their first card at the same height: a space's pages under the tab row, title pages under the title. The lesson page has no head (its title and words sit in the top bar): its step line starts 20 points under the bar, and its text 24 points under the step line, or under the bar when there is none.
- Sheets side by side end on the same line: the shorter one grows to the taller one's foot (Home's spaces beside the week), and a block alone in a row of two takes the row (Home's "Unfinished").
- The width is used, not stretched: wide, a page puts a second block in a side column (Home's spaces, Files' recent changes, the Study page's deadlines) or lays its cards and groups in columns (Deadlines, Settings). Fields stay field-sized and keys stay as wide as their words.
- A different kind of object keeps its own numbers and says why: a card with a count block on its edge (Home's next card, Progress's next deadline, a Deadlines row, a Study page row, a deadline's head, the Files head) has no inset where the block is; the Graph picture runs under the tab row; side lists of picks in Settings have an 8-point inset as their rows carry their own; the Study page's back link sits above its title; a deadline's head sheet is at least as tall as its days block, with the page's main keys at its end.
- The lesson page is an open page, not cards. [5.2](architecture/05.2-the-lesson-page.md) says how the code places each part.
  - The lesson text lies on the page with no sheet or box, in one column at most 760 points wide. A step's heading (its number on a block of the space's color, then its name) shows only when the page holds more than one step, and steps are 40 points apart. The learner's own lines are plates at the right, as wide as their words up to 82% of the column, at the lesson text's size.
  - What is asked is the largest text on the page: a question up to 140 characters is 28 points (34 on a page of its own from 1280 points of room) with its lines balanced, a longer one 22, with one small kind tag under it (`.lh-kind`: Warm-up, Recall, Quiz, Prediction, Explain, Code, Question, From earlier). A problem in practice and the "My words" ask carry their tag over them instead ("Problem 3", "My words"). Choices are plates 56 points tall for one line; up to four short ones (12 characters or fewer, no descriptions) stand side by side, and the picked one is the brightest thing on the page, an ink plate, while it can still change; once answered, the pick is a quiet plate. "How sure?" names the picked level in words. A code question's editor fills the room left.
  - A problem lies on a plate, so the lesson text is never read as part of it. Its keys sit in the plate's corner, or on a row over it with its tag or its printed page. In one column it is pinned over the text and, once the learner has sent something, folds so the text keeps half the room; "Whole problem" opens it and then reads "Less". A problem's parts the learner is not on fold to one line at every width, and a click opens one.
  - The writing row, pinned at the window's foot, holds the field and every key that sends or moves the lesson on: "Ask {teacher}" or Send, the bright key that names the press (Submit answer, Send, Continue, Next problem, Done for today, Start again), and while the teacher works, Stop. Over it is one row of keys: "Stuck?" with three help keys while something is asked, or "Try asking" while nothing is and the teacher is idle. Skip question and Discard problem are the first line of the top bar's More.
  - What is asked rests on the writing row at every width, so the two read as one thing (only a problem pinned over the text in one column stands apart). The text starts under the step line and the page is at least as tall as its window, so blank room falls between the text and the task, never between the task and the row.
  - From 1000 points of the lesson's room, while the learner has something to work on, the text and the turn are two pages of one width 48 points apart (the turn's page stops at 688), with the writing row at the foot of the right page; only the text scrolls. With nothing to work on, the text is one page in the middle at that same width, with the writing row pinned under it. A docked panel or the teacher's panel takes room, so the page falls back to one column.
  - An answered question is one line in the text. While a wide window keeps it on the right page, it stays as it stood when sent, quiet and not pressable, with the verdict on the pick.
- Only screens that are one centered box (onboarding, dialogs, Not found) stay centered.
- `npm run layout` reports the lesson's writing row outside the lesson's window at any width, a card whose inset is off, two neighbouring sheets in a page's column at a gap that is not `--lh-gap`, and a page h1 without `.lh-page-title` (a heading in rendered Markdown is its writer's and does not count). What the learner pans is marked `data-pans`, and a part of it out of view is not reported as hidden. One picture drawn on stacked boxes (a cheat sheet page with its zoomed part drawn sharper over it) is marked `data-picture`, and its boxes are not checked against each other.
- A page works in the narrowest room the teacher's panel leaves it (480 points). No column has a fixed width that starves its neighbour: it gives way, or the columns go one over the other (the cheat sheet over its chat under 768 points; its pages one under another in a canvas under 640; Settings' list of picks over its sheet under 760). A panel beside a lesson (the cheat sheet, the Document panel) covers the lesson where the lesson would keep under 480 points beside it, and Close brings the lesson back as it was.
- A row of words with keys at its end (a Study page row, Progress's next deadline, the Files head) drops the keys under the words where the words would be squeezed, never shortening a name to make room for a key.
- A tab row (`.lh-tabs`) stays on one line: too narrow for its tabs, they scroll sideways with the lit tab kept in view and a cut end faded (`tab-strip.ts`), as the top bar's tabs do, so the page under them never moves down.
- The teacher's terminal can leave the panel for a window of its own: the key is "Pop out", a quiet key in the screen's bottom row, after Paste; the way back is "Put back", the panel head's last key and the only key in the window's head. The window holds the head's status line, the screen and its row, no Follow, Chats or Activity, and works down to 400 by 300 points. On the Mac its head is its title bar, one dark sheet with the traffic lights in it. Popping out closes the panel, so the page gets the room; while the window is open the panel is Activity alone and the strip lit with "needs you" means the window needs the learner. "Put back" in either window opens the panel on the screen.
- A view that fits its content (the cheat sheet canvas) fits it again when its room changes, until the learner moves the view.
- Before calling a page change finished, look at it at 1512, 1100 and 640 points wide, with the teacher's panel open too.

## Motion and waiting

The app moves in one register, quick and quiet, like an e-ink page redrawing. The tokens and classes live in the motion blocks of `src/frontend/globals.css`.

- Motion is part of every UI change, built in the same change without being asked: for each new or changed thing, decide how it arrives, leaves, changes size, swaps what it holds, and answers the pointer and a press. Nothing pops in, vanishes or snaps. A UI change is finished only when its motion has been filmed and watched frame by frame; pictures of it at rest are not enough.
- Things enter in `--lh-dur` (160 ms) and leave in `--lh-dur-fast` (110 ms). A leaving thing is held on screen by presence (`usePresence`, `useLastWhileClosing`) until its exit has played; nothing pops away.
- Anything that replaces part of a page appears stepped (`.lh-block-in`, `.lh-set`), top to bottom, one thing moving at a time. A teacher's reply is drawn as it is written, with the writing mark at its end.
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
- The lesson's book opens or shuts only when a reply has landed whole, at most once per reply, never while the learner reads a reply that is still arriving and never on a stopped or failed one. The page takes its new layout and its rest in one step, and the pages are moved there with transforms and clips: no line wraps anew, the writing row keeps the keyboard and a line being typed, and the page does not scroll by itself during the move or after it. Between two tasks nothing slides. With reduced motion nothing slides and the page is placed at once.
- Before calling a change to the lesson's layout or its scrolling finished, film the book opening and shutting in the real window with the clock slowed, three rounds in a row, and list every change of the scroll position after the reply landed: one placement at the flip, then only what follows a card that opens. Check it once with reduced motion and once while typing in the box.
- The lesson text's newest step and the turn's task glide to a new height where they would jump (`useSheetGlide`: a reply growing as it is written, the desk opening or leaving, the task changing what it holds, a problem folding), 110 to 320 ms by how far the edge travels, parts that change together in the same time. What a part holds is laid out at its new size at once and the edge uncovers it. The page holds still while they glide, then glides to its rest once. A new width or a window of another size lays the page out at once.
- The Graph slip travels in from past the room's foot by its own height (220 to 320 ms by height, `--lh-ease-out`) and leaves the same way (110 to 160 ms, `--lh-ease-in`), cut at the room's foot so it never draws over the foot line; a panel shown alone does the same from the room's foot. The panel is laid over the picture and taken off it: the picture stays drawn under a panel in its place until the panel has arrived, then fades out, and it takes the whole room with its fade the moment a panel starts to leave, so no frame shows an empty room. A panel that moves between the slip and the picture's place keeps its sheet, whose top edge travels between the two places. A panel that replaces another keeps the slip: its edge glides to the new height (`useSheetGlide`) and uncovers the new panel, whose blocks step in top to bottom; a panel that grows in place ("N more") rides its edge up and its new rows come up from the foot. The picture re-fits once to the final height. An opened fact's moon prints row by row (`.lh-print`), link chips step in left to right 20 ms apart and a topic's moons 15 ms apart, the last of a row by 160 ms (`slip-motion-model.ts`). A panel there at first render is simply there.
- Follow's slip travels like the Graph slip (`use-slip-travel.ts`), up from past the window's foot and down again, while the page's foot glides with it; up at the window's first read of a live round, it and the page's room are simply there. Its words and count step in when they change (`.lh-block-in`), its list folds (`useFold`), and a lit mark fades in with `--lh-dur` and out with `--lh-dur-fast`.
- A new keyframe needs a reason the existing ones can't serve.
- Every motion class has a reduced-motion switch: with reduced motion nothing is held, nothing animates and scrolls are instant.
- A wait while data is read is `LoadingBox` (a still box in the size of what comes) or `LoadingLine` (where it has no size yet), in `components/loading.tsx`. Its one live element is the spinner. What replaces a wait the learner saw steps in (`useWaited` with `.lh-set`); what was there at first render never animates.
- A failed load rises in (`LoadFailed`).
- A page opens at rest: after it first shows, nothing in it moves, arrives or changes size by itself. What the first drawing needs is read before it: server data in the route's loader (the active space's record, progress and sheets are read once for the window, in the app shell), stored state (a draft, an open panel, a dragged width) in the state's initializer, a measured layout in a layout effect. An effect after mount never reads what the first drawing depends on.
- A wait has the shape of what comes, at the place it will appear, and shows objects (the lesson's desk shows the learner's files as paper), not skeleton bars. It has one live element. A wait for the teacher says in plain words what it does: the lesson's desk has one sentence and the teacher's steps ([7.1](architecture/07.1-while-the-teacher-works.md)), and while it shows, the strip and the teacher's panel say only "Working".
- Before calling a waiting state finished, reload a lesson mid-wait at 1440, 1100 and 640 points wide: it shows without motion, in place, and nothing jumps as the reply's words come or when the turn ends.

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
