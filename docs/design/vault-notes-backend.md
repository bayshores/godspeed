# Vault notes: the server side

Where the feature touches the app, what the server decides, what the teacher writes, how the notes reach an agent and what that costs, the two tools, and the note file. The story, states, text and concepts are in [vault-notes.md](vault-notes.md).

## Where it touches the app

| Part | What exists | What changes |
|---|---|---|
| Home | Spaces, the week, Unfinished | Nothing |
| Progress | Next deadline, path, Most needed, Facts, Lessons | Concept 2 only |
| Graph | The topic panel and the picture | Concepts 1 and 3, in different places |
| Files | The real record of the space's files | Nothing. The linked folder scan skips godspeed's notes |
| Lessons | "Your turn" next states (`turn-next-model.ts`), "Done for today" at the last topic | The "My words" asks. The lesson text never changes |
| Strip and peek | Notices (`notice-store.ts`) | Failures always; saved notes in concept 1 |
| Teacher's pane | "Everything <teacher> can do", whose dim lines say what they need | One line, "Note this", dim with "needs a vault" until one is picked |
| Agent tools | `search_graph`, `search_space_files` | `write_vault_note` (MCP, and a lesson tool while a vault is picked) and `search_vault` (MCP only). Nothing writes outside godspeed's folders today, and `search_space_files` searches files read into the graph, which the vault never is |
| Work loop | Background items | A notes block, sent the cheapest way (backend file) |
| godspeed folder | `CLAUDE.md` says files change only through godspeed's tools | One line: the vault is read only with `search_vault` and written only with `write_vault_note` |
| Settings | Sections and Teaching areas | The vault and "Who writes the note", placed by concept |
| Questions from earlier | `core::study::review`, graded by the window | A note's standing and review date follow, with no agent woken |

## Stored data

| Where | What |
|---|---|
| `settings.json` | `vault: { path, words: "teacher" \| "mine" }`, the only home of the vault path. Changed one field at a time, as `PATCH /api/settings/general` does |
| `data/vault-notes.json` (`store::vault_notes`) | The folder each space uses, by space id. Per note: topic id, last known path, the value godspeed last wrote to each key, one hash per section godspeed last wrote, the mistake kinds already written, the state (`active`, `yours`, `removed`), text and words not yet written, and the asks owed per lesson |

A damaged record is kept aside, never read as empty and overwritten.

A write the disk refuses (full, read-only) is kept as waiting, with the reason on the note record (`failure`), and `POST /api/vault/retry` writes it again.

## What the window reads

| Route | Answer |
|---|---|
| `GET` and `PATCH /api/vault` | `{folder, words, obsidian, vaults, notes, capped, state, message?, waiting}`. `waiting` is `{count, why}` while notes wait, else null; `why` is a line ready to show ("The disk is full.", "The folder is read-only.", "Can't find this vault.") |
| `POST /api/vault/retry` | The same answer, after the notes that waited were written again |
| `GET /api/spaces/{id}/vault-notes` and `GET /api/chats/{id}/vault-notes` | Pages, `{topicId, name, recall, color, kind: "godspeed" \| "kept" \| "mine", path, saving}`. A space's come weakest first, then by name; a lesson's in the order the topics were answered, with `{asks: [{topicId, name, maxLength}]}` beside them |
| `POST /api/chats/{id}/vault-words` | `{topicId, words}` or `{topicId, skip: true}`, the answer to one ask |

The event `vault-notes-changed` makes every reader read again.

## The vault index

Every `.md` outside hidden folders (`crates/files/src/walk.rs` already skips `.obsidian`, `.trash` and `.git`), titles and text, in the offline search (`crates/search`), at most 5,000 notes, checked every minute like a linked folder. The picker reads Obsidian's vault list from `obsidian.json` (`~/Library/Application Support/obsidian/` on the Mac, `%APPDATA%\obsidian\` on Windows, `~/.config/obsidian/` on Linux); a missing or unreadable list just leaves the path field.

## Who computes what

The server decides and the browser shows. The teacher only writes words.

| Thing | Who | How |
|---|---|---|
| Which topics earned a note | Server | Topics with an answer (quiz, explain, problem, question from earlier) since the last pass, from the lesson readout (`lesson_readout`, `facts_for_answer`) and the question's `nodeId`. A lesson end starts the lesson's last extraction run below the 4,096-token mark and waits for grouping. An answer with no topic after 10 minutes waits for the next pass |
| Standing, answer counts | Server | `topic_status` in `crates/core/src/study/progress.rs`, hinted answers at 0.6 |
| Next review | Server | `core::study::review`, the same walk and gaps; none until a right answer |
| Tests | Server | Open deadlines whose topics hold this one, written as `test` |
| Mistakes to send | Server | Wrong answers and problems solved with hints for the topic (`space_mistakes`), newest first, at most 4 a pass |
| Path and file name | Server | `<vault>/<space folder>/<topic name>.md`, names safe on every OS |
| Frontmatter | Server | From the values above, in the owner's keys: `class` (the space's name), `test`, `confidence` (`shaky`, `ok` or `solid`) |
| The space's `.base` file | Server | Written once with the space's first note, never rewritten |
| A note marked `godspeed: keep` | Server | Matched to a topic by file name at the index check; taken over as described in `vault-notes.md` |
| godspeed's or the learner's | Server | The `godspeed:` key, the last values per key and the hash per section |
| Learner notes that may cover a topic | Server proposes, teacher picks | Up to 3 of the learner's notes from the vault search. The search has no cutoff, so the server cannot decide alone |
| Text, recall, mistake lines and kinds, links, source passage | Teacher | `write_vault_note` |

## Sending the notes and what it costs

A notes block is self-contained: it never carries the lesson, so any agent writes it at the same cost.

| Route, in order | When |
|---|---|
| 1. Inside the lesson's last extraction item | A helper is running. The block rides in the same item as the extraction run the lesson end starts, so it pays no item of its own |
| 2. Its own item, to the teacher | No helper runs. It waits until the teacher is idle (no lesson turn waiting), then goes like an asked item |
| Never | A helper is never started for notes. A cold helper session pays godspeed's tool list (about 9,000 tokens), `CLAUDE.md` (about 1,000) and server instructions (about 1,000) before its agent's own system prompt, against the cheap single-agent rule |

Cost for a lesson with three topics:

| Part | Tokens |
|---|---|
| Instructions of the block (by reference after the first) | about 170 in |
| Per new topic | 200 to 300 in |
| Per updated topic whose sections are godspeed's | up to 600 in |
| Per note written | 150 to 300 out |
| `write_vault_note` schema in the tool list, once per conversation (by reference after) | about 350 in |
| `search_vault` | none in lessons (MCP only) |
| The extraction run at lesson end | 0 to about 4,000 in and 300 to 800 out; this run would mostly have run at the next trigger anyway, so it moves cost earlier. It is new cost only for a lesson that never reaches the mark |
| **Total, three topics** | **about 1,300 to 2,000 in and 700 to 900 out, plus up to 4,800 when the extraction run is new** |

### The block

In the short style agent texts use:

```
[Vault notes] One write_vault_note per idea, then go on with the item.
Write to the learner in full plain sentences.
text: 2 to 5 sentences, what it is and when it applies, math as $…$.
recall: one question answerable without notes.
mistakes: one line each, what went wrong and the fix; kind 1 to 3 words,
reuse a listed kind when it is the same mistake.
source: one passage id from the list. links: only names listed.
covered_by: path of a "yours" note that already covers it; then nothing else.
Space CSE 21. Mode: teacher writes.

1. tpc_9f2 "Stars and bars", new. shaky, 2 of 3 right.
   m1 wrong: "Solutions to x1+x2+x3=7, xi≥0?" said C(9,3), right C(9,2).
   kinds so far: none
   passages: f_ab12cd34ef56:4 "n identical items into k bins..."
   links: Combinations (yours), Objects into boxes
   yours, maybe covering: none
2. tpc_1aa "Combinations", new. strong, 3 of 3 right.
   yours, maybe covering: courses/fa26/cse21/concepts/Combinations.md "What does C(n,k) count..."
```

An update adds `updating; sections godspeed's: recall, in short` with those sections (1,500 characters at most), or `all sections yours: send only mistakes`.

## The space's Base file

With the first note in a space folder the server writes `<vault>/<space folder>/<space name>.base`, unless a file of that name is there:

```yaml
views:
  - type: table
    name: By confidence
    filters:
      and:
        - file.inFolder("CSE 21")
        - godspeed != null
    groupBy:
      property: confidence
    order:
      - file.name
      - test
      - mistakes
      - next_review
```

The space record notes that it was written, so a deleted Base is not made again. The exact Base syntax is checked against Obsidian's docs before building.

## States the learner never sees

| State | What happens | Learner sees |
|---|---|---|
| Note being typed in | A note changed in the last 30 seconds is written at the next minute's check | Nothing |
| Note renamed or moved | Found again by its `godspeed:` key | Nothing |
| Learner changed a godspeed key | That key is theirs in that note from then on. Keys they added are kept in order | Their value |
| Same name as one of their notes | Covered: a link, no file. Something else: `Stars and bars (godspeed).md` | |
| Two spaces of one name | `CSE 21 (2)`. The record keeps folders by space id | |
| Space renamed | The folder is renamed when no folder of the new name exists | |
| Learner renamed the space's folder | Its notes are found by key; new ones go where most of them are | |
| Topic merged away | The note follows the topic holding most of its facts, or is left alone | |
| Linked folder holds the notes folder | The scan skips the notes folders and any `.md` with a `godspeed:` key | |

## Tools

### `write_vault_note`

An MCP tool, and a lesson tool in every lesson started while a vault is picked (a lesson's tool list stays the same for the whole lesson).

| Input | Rule |
|---|---|
| `space_id` | MCP only |
| `topic_id` | Or left out in a lesson, for the current step's topic |
| `title` | 80 characters; names a new file only |
| `text` | Markdown, 1,200 characters |
| `recall` | One question, 200 characters |
| `mistakes` | `[{id?, text (160), kind (30)}]`; ids from the block, none for "Note this" |
| `source` | One passage id, checked like a kept sentence's |
| `links` | Up to 6 note names in the vault or in the same pass |
| `covered_by` | A path of one of the learner's notes; nothing else with it |

Answer: `{status: "written" | "updated" | "linked" | "waiting", name, path, confidence, next_review?, kept?: ["in short", "confidence"]}`. `kept` names what was the learner's and was left alone; `waiting` means the vault is missing and the text is kept. Refused with a reason: no vault ("No vault picked. The learner picks one in Settings."), unknown topic, closed space, a link to no note, a removed note outside "Note this".

### `search_vault`

MCP only. `{query?, path?, limit (default 8, max 30), space_id?}`.

- With `query`: `{notes: [{name, path, owner: "you" | "godspeed", class?, confidence?, snippet (200)}], indexed}`.
- With `path`: the whole note, `{name, path, owner, text}`, cut at 20,000 characters with `cut: true`.
- Refused with no vault, or a path outside it. The agent never reads the vault with its own file tools; `CLAUDE.md` says so.

## The note file

```markdown
---
godspeed: tpc_9f2
class: CSE 21
test:
  - Midterm 1
confidence: ok
answered: 2 of 3 right
mistakes:
  - bar count
next_review: 2026-11-24
facts:
  - n_4k2a91
  - n_4k2a97
up: "[[CSE 21]]"
---
> [!recall] Without looking at your notes
> For x1 + ... + xk = n with every xi at least 0, what are the stars and what are the bars?

## In short
Each solution is a row of n stars cut into k groups by k − 1 bars, so the count is $\binom{n+k-1}{k-1}$. When every xi must be at least 1, give each one a star first and count $\binom{n-1}{k-1}$.

## My words
Stars are the units I hand out and bars are the walls between the people. Two walls make three people.

## Mistakes to remember
- Bar count (Nov 20, again Nov 24): counted k bars instead of k − 1. Three groups need two bars, so 7 stars and 2 bars give C(9,2).

## Related
- [[Combinations]]
- [[Objects into boxes]]

> [!example]- Check yourself: Day6 Stars and Bars.pdf, page 13
> ![[courses/fa26/cse21/lectures/Day6 Stars and Bars.pdf#page=13]]
```

### Who owns each part

| Part | Owner |
|---|---|
| `godspeed`, `class`, `test`, `confidence`, `answered`, `mistakes`, `next_review`, `facts`, `up` | godspeed, rewritten at each update, until the learner changes one; that key is then theirs. `up` only when a note of the space's name exists |
| Any other key | The learner |
| Recall, "In short", "Related", "Check yourself" | godspeed while that section's hash matches what godspeed last wrote; the learner's once they change it |
| "Mistakes to remember" | godspeed adds and merges lines while the section is its own; once the learner edits it, godspeed only adds lines at its end |
| "My words" | The learner, never hashed. godspeed writes it once, from the words typed at a lesson end. Skip, or "<teacher> writes it" mode, means no section |

### Mistakes

- One line per kind. A repeat of a kind adds its date to that line ("again Nov 24") while the section is godspeed's, and adds nothing once it is the learner's, since the kind already shows.
- At most 6 kinds. A seventh is left out of the note; the track record keeps it.
- `mistakes` in the frontmatter lists each kind once, for a Base column.

### An untested topic

Only "Note this" makes one before any answer. It has an empty `confidence`, `answered: none yet`, no `next_review` and no `mistakes` key, and no "Mistakes to remember" section.

### Check yourself

The teacher's `source` passage gives the file and page. A file inside the vault is embedded, as above. A file outside it is a link that opens in its own app: "Open Day6 Stars and Bars.pdf, page 13".
