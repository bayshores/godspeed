# Vault notes

godspeed writes one note per idea the learner worked on into a folder the learner picked: an Obsidian vault, or any other notes folder. A note keeps how well the learner knows the idea, their mistakes and a recall question. Later lessons and reviews update it. Issue #13.

The words, the code, the stored data, the routes and the rules for who owns a key are in [08.1.4-vault-notes.md](../architecture/08.1.4-vault-notes.md). The teacher's block, its cost and the note file are in [vault-notes-backend.md](vault-notes-backend.md). The three concepts and why the second was built are in [vault-notes-concepts.md](vault-notes-concepts.md). The interface says "Obsidian" or "Notes folder", never "vault" (`docs/ui-rules.md`).

## The story

### First run, no folder

1. Nothing mentions notes: no banner, notice or onboarding step. The teacher's list, Learn group, has "Note this", dim, "needs Obsidian or a notes folder". That line is how a learner finds the feature.
2. "Note this" typed anyway: the teacher says in one line that a folder is picked in Settings first.

### Picking the folder

1. Settings, General, group "Notes folder". With Obsidian installed the vaults it lists are keys, one each by name with its path in the tooltip, then "Other folder…" (the folder picker). The group's line is "Pick the vault godspeed writes notes in."; with no Obsidian, "Pick the folder godspeed writes notes in."
2. The server refuses a folder that does not exist ("That folder does not exist."), else keeps it and builds the index of note titles and text.
3. The group is now named "Obsidian" for a vault, "Notes folder" for any other. It shows the folder's name, a line ("In ~/Cowork, 412 notes. Each space gets a folder in it."; a plain folder: "37 notes. It is not an Obsidian vault, so notes open in Finder."), "Open in Obsidian" or "Show in Finder", and "Unlink". "Note this" stops being dim.
4. Past 5,000 notes the line adds that the rest are not searched.

### During a lesson

1. An answer to a question or a problem lets its topic earn a note. A topic only mentioned earns none. Nothing shows.
2. "Note this" at any time: the teacher writes the current step's topic, answered or not, and says in one short line what it did.

### The lesson end, "<teacher> writes it" (the default)

1. "Your turn" says "That was the last topic." and has "Done for today". The server sends the notes block for every topic answered since the last pass, and the learner never waits for it.
2. Under that line the lesson's pages land one at a time. A page is a portrait sheet: the topic's name, its recall question, a band along its foot in the standing's color (dim when untested) and the pixel crystal. A page still being written is dashed with a bar at its foot, which fills when it is written. In the short pinned sheet the row scrolls sideways.
3. Under the pages one line says "Saving to Obsidian", then "Saved to Obsidian"; a plain folder: "Saved to your notes folder". There is no separate notice.

### The lesson end, "I add my own words"

1. At the last topic "Your turn" asks about one topic at a time. The head is "My words", the question is "Explain stars and bars in your own words.", the box says "One or two sentences", and the asked page is outlined.
2. The box row holds "Done for today", "Skip" and "Save"; Save is the main key once the words fit.
3. One ask per topic with a new note or an empty "My words", the most answered first, at most 3 a lesson end. A step of a typed lesson is asked only after grouping gives its facts a topic. Until then the sheet says "That was the last topic."
4. Typed words wait until the topic's note is written, then go into its "My words". "Skip" writes no section. A topic skipped twice is never asked again.

### Leaving a lesson halfway

The window tells the server which page it shows (`PUT /api/talk-page`). Leaving a lesson with answers since the last pass sends the notes block; so does the next start, for a lesson left when the app quit. The asks wait for the lesson's last topic.

### A second lesson, or a review, updates a note

The server recomputes `confidence`, `answered`, `next_review` and `test` and the teacher adds new mistakes, and may rewrite any section the learner has not touched. A review writes the keys at the next pass or the next day's key refresh, whichever is first.

### Looking at the notes later

1. Progress has a card, "Obsidian" (a plain folder: "Notes"), with the count and "All". One row of pages, weakest first. No folder or no notes: no card.
2. The page opens the note: "Open in Obsidian", else "Show in Finder". In a plain browser a page does not open.
3. The Graph's topic panel ends its list with one row, "Open in Obsidian", for a topic that has a note.
4. In the notes app, the space's folder `<folder>/CSE 21/` holds `CSE 21.base`, written once with the first note: an Obsidian Base grouped by `confidence` with `test`, `mistakes` and `next_review` as columns. It is never rewritten and a deleted one is not made again.
5. Through the teacher, `search_vault`.

### Handing a note to godspeed

A learner who wants godspeed to keep one of their own notes adds `godspeed: keep` to its frontmatter. At the next minute check a file named like one space topic becomes godspeed's: the key becomes the topic's id, godspeed's keys are filled in and each section's hash is stored. The learner's "My words" and other keys stay theirs. A note with no matching name is left for the teacher to match at the next pass.

## Every state and unhappy path

| State | What happens | Learner sees |
|---|---|---|
| No folder | No notes block. Picking one later writes notes for answers from then on | The dim line |
| Folder missing or renamed | Notes and words wait in the record and are written when it is back | Settings: "Can't find this vault." or "Can't find this folder.", with "Pick folder again". A failure notice |
| Not in Obsidian's list | Works the same | "Show in Finder" for "Open" |
| Disk read-only or full | The old note stays whole and the new text waits | Notice: "Couldn't save A and B to Obsidian." (more than two: "A, B and 3 more"), the line "The disk is full." or "The folder is read-only.", and "Try again" (or "Settings" when the folder is gone) |
| Note deleted | Marked removed under the minute check's rules (08.1.4). Never made again except by "Note this" | Nothing |
| `godspeed:` key taken out | The note is the learner's and never written again | Nothing |
| Learner edited a section | That section is theirs and never rewritten. New mistakes still go at the end of "Mistakes to remember" | Their text, word for word |
| Nothing worked on, or space closed or deleted | No block. godspeed never deletes a file in the folder | |
| Teacher not connected | The block waits like all work | The strip already says "Waiting for <teacher>" |
| Unlink | Forgets the folder and stops the index and every write. The record stays, so picking the same folder goes on | The group goes back to its pick line |

Every notice is a status (`role="status"`) and takes no focus. No panel opens by itself or moves focus.

## Interface text

| Where | Text |
|---|---|
| Teacher's list | "Note this", dim: "needs Obsidian or a notes folder" |
| Ask | Head "My words"; "Explain stars and bars in your own words."; placeholder "One or two sentences"; "Done for today", "Skip" and "Save" in the box |
| Saved | "Saving to Obsidian", then "Saved to Obsidian"; a plain folder: "Saved to your notes folder" |
| Open | "Open in Obsidian"; a plain folder: "Show in Finder" (the file browser's name on Windows and Linux) |
| Progress card | Title "Obsidian" with the count and key "All"; a plain folder: title "Notes" |
| Failed | "Couldn't save A and B to Obsidian.", then the reason; key "Try again" |
| Settings, nothing picked | "Pick the vault godspeed writes notes in." Keys: each vault by name, "Other folder…". Without Obsidian: "Pick the folder godspeed writes notes in." |
| Settings, picked | The folder's name, its line, "Open in Obsidian" or "Show in Finder", "Unlink" |
| Who writes the note | "<teacher> writes it" / "I add my own words" |
