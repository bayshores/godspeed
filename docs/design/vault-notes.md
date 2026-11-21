# Vault notes

godspeed writes one note per idea the learner worked on into their own notes folder: an Obsidian vault, or a Foam or Logseq folder. A note keeps how well the learner knows the idea, their mistakes and a recall question. Later lessons and questions from earlier update it. Issue #13.

Where it touches the app, the tools, the notes item, the cost and the note file are in [vault-notes-backend.md](vault-notes-backend.md). The owner's fixed decisions are not reopened. My own calls are listed at the end.

## Words

| Word | Means | Kept apart from |
|---|---|---|
| Vault | In code and this doc: the folder the learner picked in Settings. In the interface it is never shown as a word: an Obsidian vault (it has `.obsidian/` or is listed in Obsidian's `obsidian.json`) is called "Obsidian", any other folder "Notes folder" | A space's linked folder, which godspeed only reads |
| Note | A note godspeed wrote in the vault; in the interface always next to "Obsidian" or "notes folder" | "Remembered" (the teacher's short notes about the learner) and `import_notes` (a notes file read into the graph) |
| Your note | A note in the vault without godspeed's `godspeed:` key | |
| Idea | A space topic, such as "Stars and bars". The owner's 14 CSE 21 concept notes match real topics one to one | A fact, which is too small for a note |
| Standing | untested, weak, shaky or strong, from `topic_status` in `crates/core/src/study/progress.rs`. In the note file it is written as the owner's key `confidence`: weak is `shaky`, shaky is `ok`, strong is `solid`, untested is empty | The learner's own 1 to 5 sureness on an answer, which the app also calls confidence |

## The story

### First run, no vault

1. Nothing mentions notes: no banner, notice or onboarding step. The teacher's list, Learn group, has "Note this", dim, "needs a vault". That line is how a learner finds the feature.
2. "Note this" typed anyway: the teacher answers in one line that a vault is picked in Settings first. Every request gets its answer, with no daily limit.

### Picking the vault

1. Settings shows the vaults Obsidian lists in its `obsidian.json` as picks, one row each with its name and path, and under them the linked folder's path field (`LinkFolderField`) with "Use folder" for any other folder.
2. The server checks the folder: it exists, it can be written in, and it is not the godspeed folder, the data folder or inside either.
3. It builds the vault index of note titles and text (backend file).
4. The row shows the path, "Show in Finder", "Remove" and its line, and "Note this" stops being dim.

### During a lesson

1. An answer to a question or a problem lets its topic earn a note. A topic only mentioned earns none. Nothing shows.
2. "Note this" at any time: the teacher calls `write_vault_note` for the current step's topic, answered or not, and answers in one short line, such as "I put that in your Stars and bars note." It shows where the learner asked, and no notice repeats it.

### The lesson end, "<teacher> writes it" (the default)

"Your turn" is as today: "That was the last topic." and "Done for today". The server sends the notes block for every topic answered since the last pass, and the learner never waits for it. How saved notes show depends on the concept; "Already in Obsidian: Combinations." is said when one of the learner's notes covered an idea.

### The lesson end, "I add my own words"

1. At the last topic "Your turn" shows one ask at a time. Head: "Your turn", as on every ask. Question: "Explain stars and bars in your own words." Box placeholder: "One or two sentences". Keys "Skip" and "Save" sit in the box; "Done for today" sits in the head on every ask, so the learner can leave at any moment.
2. A step that is a space topic is asked at once, by the topic's name. A step of a typed lesson is asked only after grouping gives its facts a topic, usually within a minute, and by that topic's name. Until then "Your turn" shows "That was the last topic." and the asks step in when they are ready.
3. One ask per topic with a new note or an empty "My words", the most answered first, at most 3.
4. Typed words wait in `data/vault-notes.json` until that topic's note is written, then go into its "My words".
5. "Skip" writes no "My words" section. The topic is asked once more at a later lesson end, then never again.

### Leaving a lesson halfway

1. The window tells the server which page it shows (`PUT /api/talk-page`). Leaving a lesson with answers since the last pass sends the notes block. So does the next start, for a lesson left when the app quit.
2. No asks: they wait for that lesson's last topic, which "Continue" leads back to.

### A second lesson updates a note

The server recomputes `confidence`, answers, review date and `test`. The teacher adds the new mistakes and may rewrite any section the learner has not touched.

### A question from earlier updates a note

The note's `confidence`, `answered` and `next_review` are written at the next notes pass, or at the first index check of the next day, whichever comes first, so a sitting of reviews writes the file once. A miss joins the next notes pass as a mistake for the teacher to word.

### Opening a note

The server finds the note's current path in the index. A vault listed in Obsidian's `obsidian.json` opens with `obsidian://open?path=<absolute path, encoded>`; anything else shows in Finder (Show in folder on Windows and Linux). So the key reads "Open" or "Show in Finder", and no sentence explains it.

### Finding all notes later

In the notes app, the space's folder `<vault>/CSE 21/`. When godspeed writes the first note in that folder it also writes `CSE 21.base` there, once: an Obsidian Base grouped by `confidence`, with `test`, `mistakes` and `next_review` as columns. It never rewrites that file, and a deleted one is not made again. In godspeed, by concept. Through the teacher, `search_vault`.

### Handing a note to godspeed

A learner who wants godspeed to keep one of their own notes adds `godspeed: keep` to its frontmatter. At the next index check the server matches the file name to a space topic. With a match, the note becomes godspeed's: the key becomes the topic's id, godspeed's keys are filled in, and each section's hash is stored, so godspeed may update the note until the learner edits a section again, as with any note it wrote. The learner's "My words" and other keys stay theirs. With no match, the next notes pass tells the teacher, who asks the learner which topic it is. The lesson end then shows that note like any godspeed note, not "Already in Obsidian".

## Every state and unhappy path

| State | What happens | Learner sees |
|---|---|---|
| No vault | No notes block. Picking a vault later writes notes for answers from then on | The dim line |
| Vault missing or renamed | Notes and words wait in the record and are written when it is back | Settings: "Can't find this folder." with "Pick folder again". A failure notice at a lesson end |
| Not in Obsidian's list | Works the same | "Show in Finder" for "Open" |
| Disk read-only or full | Each write goes to a `.partial` name, is flushed, then renamed. The old note stays whole; the new text waits | Notice: "Couldn't save 2 notes to Obsidian. The disk is full." or "The folder is read-only." with "Try again", which needs no teacher |
| Note deleted | Counted as removed only when the file is gone, its folder is still there and two checks agree. An iCloud placeholder (`.Stars and bars.md.icloud`) counts as present. When 3 or more notes vanish in one check, none is marked removed (a sync or a moved folder) | Nothing. A removed note is never made again, except by "Note this" |
| `godspeed:` key taken out | The note is the learner's now and never written again | Nothing |
| Learner edited a section | Each section has its own hash. An edited section is theirs and is never rewritten. New mistakes still go at the end of "Mistakes to remember", under a new heading if theirs is gone | Their text, word for word |
| Nothing worked on, or space closed or deleted | No block. godspeed never deletes a vault file | |
| Teacher not connected | The block waits like all work | The strip already says "Waiting for <teacher>" |
| Add files on a godspeed note | Refused: "This note was written from your answers, so it isn't read into the graph." | |
| Turned off | "Remove" forgets the vault and stops the index and every write. Files and the record stay, so picking the same folder goes on | "Your notes stay in the folder." once |

States the learner never sees (a moved note, a renamed space, two spaces of one name) are in the backend file.

Every notice is a status (`role="status"`) and takes no focus. No panel opens by itself or moves focus.

## Interface text

| Where | Text |
|---|---|
| Teacher's list | "Note this", dim: "needs Obsidian or a notes folder" |
| Ask | Head "Your turn"; "Explain stars and bars in your own words."; placeholder "One or two sentences"; "Skip" and "Save" in the box, "Done for today" in the head |
| Saved (concept 2, lesson end) | "Saving to Obsidian" under the papers while one is still being written, then "Saved to Obsidian"; a plain folder: "Saved to your notes folder" |
| Saved (concept 1) | "Saved Stars and bars to Obsidian", "Updated Stars and bars in Obsidian", "Saved 3 notes to Obsidian" |
| Covered | "Already in Obsidian: Combinations." |
| Open | Hover on a paper and the Graph row: "Open in Obsidian"; a plain folder: "Show in Finder" |
| Progress card | Title "Obsidian" with "8" in the count face, key "All"; a plain folder: title "Notes" |
| Failed | "Couldn't save 2 notes to Obsidian." then "The disk is full.", "The folder is read-only." or "Can't find this vault."; key "Try again" |
| Settings group | "Obsidian" when Obsidian is installed or the picked folder is a vault; otherwise "Notes folder" |
| Settings, nothing picked | "Pick the vault godspeed writes notes in." Keys: each vault Obsidian lists, by name with the mark, path in its tooltip, then "Other folder…" (the Mac folder picker). Without Obsidian: "Pick the folder your notes app keeps." |
| Settings, picked | The vault's name as the line, under it "In ~/Cowork, 412 notes. Each space gets a folder in it."; a plain folder: "~/Documents/Notes", "37 notes. It is not an Obsidian vault, so notes open in Finder." |
| Settings keys | "Open in Obsidian" (or "Show in Finder") in the same link look as on a paper; "Unlink"; "Other folder…" |
| Settings errors | "Can't find this folder." / "That isn't a folder." / "That's the godspeed folder." / "godspeed can't write in this folder." / "Search reads the first 5,000 notes." |
| After Unlink | "Your notes stay in the folder." |
| Who writes the note | "<teacher> writes it" / "I add my own words", with the line "At the end of a lesson, <teacher> asks you for a sentence or two." |

## Three concepts

The three concepts, their pictures and the recommendation are in `vault-notes-concepts.md`.

## Calls to confirm

1. The interface says "Obsidian" for an Obsidian vault and "Notes folder" for any other folder; "vault" is a word only for code and docs.
2. `write_vault_note` and `search_vault`; the agent never reads the vault with its own tools.
3. The server writes the file and frontmatter; the teacher sends the words.
4. "Open" through `obsidian://open?path=` for vaults in `obsidian.json`, else Show in Finder.
5. One note per space topic.
6. "Note this" is answered by the teacher in one line where asked. It bends "no saved status in the lesson text", but it is the teacher's answer to a request, not a line godspeed draws. The other choice, a row in the panel's Activity, is unseen while the panel is closed.
7. At most 3 asks per lesson end; Skip asks once more.
8. A removed note is never made again except by "Note this".
9. A 5,000-note index cap; a note typed in within 30 seconds is written later.
