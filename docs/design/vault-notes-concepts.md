# Vault notes: the three concepts

The story, states and text are in `vault-notes.md`. Pictures: `vault-notes.pen` and `vault-notes/`.

## Concepts

### Concept 1: Quiet notice

Notes are a file the app tells you about, then gets out of the way.

- **Lesson end.** "Your turn" as in the story. Saved notes arrive as one notice in the strip's peek: the title, a row per note with its name and "Open" at the row's end, then the covered line. It folds into the strip's count after 12 seconds, and while the teacher's panel is open it waits folded there from the start.
- **In the app.** The Graph topic panel, beside Study: a quiet key "Open note" when the topic has a note, godspeed's or the learner's.
- **Settings.** Teaching, a new area "Vault notes" above Remembered, about line "Notes <teacher> writes in Obsidian after lessons": the vault row, "Who writes the note" as a select like "Quiz style", and "Full instructions" for the notes prompt. An area because who writes is teaching behavior and the prompt needs an editable home.
- **Ups.** The smallest change.
- **Downs.** Easy to miss: a folded notice says only a count, and a learner who never opens Graph never meets "Open note". No view of all notes in godspeed.

### Concept 2: Notes on Progress

Notes are objects in the track record, and the same object lands at the lesson end.

- **The object.** A note page: a portrait sheet about 148 by 188 points, filled a step lighter than the card, with a folded top corner, no edge and no shadow, so it reads as a page, not a key or a topic tile. The topic's name in 15 px, two lines at most; under it the note's own first line (its recall question, or the learner's first line) in 13 px, three lines at most. Along its foot, the standing as a band in the ramp color fact cells use (`fact-cells.ts`). A small pixel Obsidian mark in ink sits at the bottom right (the words-only variant has none). A learner's own note says "Yours" at the bottom left. Hover lifts it 3 points and shows "Open in Obsidian", the same link look used in Settings and the Graph panel; a click opens the note. A page being written is a dashed outline whose band inks in.
- **Progress.** A card titled "Obsidian" in the record column after the teacher's note, "8" in the count face. One row of pages, weakest first; "All" at the card's head shows the rest. No vault or no notes: no card (an empty box is not drawn). Reason for a new card: nothing on Progress shows a topic as one thing.
- **Lesson end.** At the last topic, under "That was the last topic." in "Your turn", the lesson's papers land one at a time, top to bottom, in `--lh-dur` each (`.lh-block-in`). A paper not yet written is its outline (`LoadingBox` in its shape) and inks in when it is written. With reduced motion they are simply there. The "My words" ask sits above them, and the paper it is about is lit. Leaving halfway: the next look at Progress has the new papers lit once, as Home lights a deadline's card. One line under the papers, "Saving to Obsidian" while one is still being written, then "Saved to Obsidian"; no separate notice. In "my words" mode the box sits right under that line.
- **Graph.** The topic panel ends its list with one quiet row "Open in Obsidian" with the mark, for a topic that has a note. No second key beside Study.
- **Settings.** General, a group "Obsidian" (or "Notes folder") after "Reminders": the vault row and "Who writes the note" as a select. General is where godspeed meets the learner's computer (sounds, menu bar, reminders), and a vault is a folder there. The notes prompt is a part of the existing "Lesson flow" area's full instructions, so no new area.
- **Ups.** Objects, not text. The lesson end and Progress agree, since they show the same paper. One click opens a note, nothing nags, one thing moves at a time.
- **Downs.** A new card and object to build and check at every width. Progress grows. A space with many notes shows only two rows on the page.

### Concept 3: Closing sheet

A lesson has a real close, and the close is where notes are made and read.

- **Lesson end.** No extra page: after the last topic "Your turn" reads "That was the last topic. These notes are in Obsidian now." and lists one row per answered topic. Each row is its note's recall question at 18 px, which opens the note (underline on hover), and under it the standing as 12-point blocks and the topic name. A row still being written shows two faint lines in the shape of its text, which ink in. "Done for today" ends the foot row and goes Home. In "I add my own words" mode the asked row gets a bar at its left, and the usual box sits at the foot with "Done for today", "Skip" and "Save". Leaving halfway writes in silence; a failure is a notice.
- **In the app.** The Graph picture: a topic with a note gets a paper mark before its name, a shape and no word; a click on it opens the note.
- **Settings.** The vault folder is a "Vault notes" group in General, like the other folders the app keeps. "Who writes the note" sits in Teaching, "Lesson flow", below "Quiz style", because the close is part of how a lesson flows.
- **Ups.** One clear moment with room for the learner's words, filling the window.
- **Downs.** One more step before leaving, every time. A learner who leaves halfway never sees it. A new page depth. The Graph mark is only found by those who open Graph.

I dropped the docked notes panel: it needed a third panel kind and a Markdown renderer for callouts, embeds and wikilinks that would never match Obsidian.

### Recommendation

Concept 2. Notes become objects in the record the learner already reads, the lesson end changes only inside "Your turn", and the same paper on both pages explains the feature without an extra word.
