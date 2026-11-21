# Vault notes: the concepts

The story, states and text of what was built are in [vault-notes.md](vault-notes.md). Pictures: `vault-notes.pen` and `vault-notes/`.

## Concepts

| Concept | Idea | Result |
|---|---|---|
| 1. Quiet notice | Saved notes arrive as one notice in the strip's peek, with "Open note" beside Study in the Graph | Not built: easy to miss, and no view of all notes |
| 2. Notes on Progress | Notes are page objects on Progress, and the same pages land at the lesson end | Built |
| 3. Closing sheet | The lesson end is a page that lists one row per answered topic | Not built: one more step before leaving every time, and a new page depth |

Concept 2 was picked because notes become objects in the record the learner already reads, the lesson end changes only inside "Your turn", and the same page on both screens explains the feature without an extra word. A docked notes panel was dropped: it needed a third panel kind and a Markdown renderer for callouts, embeds and wikilinks that would never match Obsidian.

## Concept 2 as built

| Part | What it is |
|---|---|
| The page | A portrait sheet with a folded corner: the topic's name, its recall question, a band in the topic's color along its foot (dim when untested) and the crystal. Hover or focus shows "Open in Obsidian" (a plain folder: "Show in Finder"). A page being written is dashed with a bar at its foot |
| Progress | A card after the teacher's note, titled "Obsidian" (a plain folder: "Notes") with the count and "All". One row of the pages that fit, weakest first. No folder or no notes: no card |
| Lesson end | Under "That was the last topic." the pages land one at a time, then "Saving to Obsidian" and "Saved to Obsidian". No separate notice. In the short pinned sheet they scroll sideways |
| Graph | The topic panel ends its list with one row, "Open in Obsidian", for a topic that has a note. No second key beside Study |
| Settings | General, a group "Obsidian" or "Notes folder": the folder, "Who writes the note" as a segmented control |

Full text and states are in [vault-notes.md](vault-notes.md).
