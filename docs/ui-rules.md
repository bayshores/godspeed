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

## Look at the real window

The Mac app draws with WebKit, not Chrome; a page right in a browser can overlap in the app.

- Before calling a UI change finished, look at it in the real app window (the debug shell) at 1440, 1100 and 800 points wide. A browser screenshot does not count.
- Check each state the change touches, scrolled a little and at the scroll end too, for text on text, text under another box, content spilling out of its box and sideways scrolling.
- Anything that sticks out of its own box (a tag, a badge, a pop-up) sits on a layer above what can move under it, or does not stick out at all. Pop-ups go through `MenuShell` or a dialog, which no box can clip.
- `npm run layout` checks the screens in `scripts/layout-screens.mjs` in the real window at all three widths, each as it opens, scrolled 80 px and scrolled to the end, for overlapping text, text or a control another box is drawn over, spills, sideways scrolling, hidden text and cut-off letters. CI runs it on the Mac; `npm run check` does not. Run it yourself before calling a UI change finished. A new screen or state gets an entry there.
