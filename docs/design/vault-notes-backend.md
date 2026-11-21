# Vault notes: the server side

Where the feature touches the app, the teacher's block and what it costs, the tools' inputs, and the note file. The story, states and text are in [vault-notes.md](vault-notes.md). Stored data, routes, who computes what, the pass and who owns each key are in [08.1.4-vault-notes.md](../architecture/08.1.4-vault-notes.md).

## Where it touches the app

| Part | What exists | What changed |
|---|---|---|
| Home | Spaces, the week, Unfinished | Nothing |
| Progress | Next deadline, path, Most needed, Facts, Lessons | A card of note pages after the teacher's note |
| Graph | The topic panel | One row, "Open in Obsidian", at the end of its list |
| Files | The real record of the space's files | Nothing. The linked folder scan skips godspeed's notes |
| Lessons | "Your turn" next states (`turn-next-model.ts`), "Done for today" at the last topic | Pages under "That was the last topic.", and the "My words" asks with Done for today, Skip and Save in the box. The lesson text never changes |
| Strip and peek | Notices (`notice-store.ts`) | A failure notice |
| Teacher's pane | "Everything <teacher> can do", whose dim lines say what they need | "Note this", dim until a folder is picked |
| Agent tools | `search_graph`, `search_space_files`, which search what was read into the graph | `write_vault_note` and `search_vault`; the notes folder is never read into the graph |
| Work loop | Background items | A notes block, sent the cheapest way (below) |
| godspeed folder | `CLAUDE.md` says files change only through godspeed's tools | One line: the notes folder is read only with `search_vault` and written only with `write_vault_note` |
| Settings | Sections | General, group "Obsidian" or "Notes folder", with "Who writes the note" |
| Questions from earlier | `core::study::review`, graded by the window | A note's standing and review date follow, with no agent woken |

## Sending the notes and what it costs

A notes block is self-contained: it never carries the lesson, so any agent writes it at the same cost. It rides in the space's next topic grouping item when a helper runs, so it pays no item of its own; otherwise it is an item of its own for the teacher once idle. A helper is never started for notes: a cold helper session pays godspeed's tool list (about 9,000 tokens), `CLAUDE.md` (about 1,000) and server instructions (about 1,000) before its agent's own system prompt, against the cheap single-agent rule. The steps are in 08.1.4.

Cost for a lesson with three topics:

| Part | Tokens |
|---|---|
| Instructions of the block (by reference after the first) | about 170 in |
| Per new topic | 200 to 300 in |
| Per updated topic whose sections are godspeed's | up to 600 in |
| Per note written | 150 to 300 out |
| `write_vault_note` schema in the tool list, once per conversation (by reference after) | about 350 in |
| `search_vault` | none in lessons (MCP only) |
| **Total, three topics** | **about 1,300 to 2,000 in and 700 to 900 out** |

### The block

In the short style agent texts use:

```
[Vault notes] One write_vault_note per idea (space_id spc_1), then go on with the item.
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

With the first note in a space folder the server writes `<folder>/<space folder>/<space name>.base`, unless a file of that name is there:

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

The space record notes that it was written, so a deleted Base is not made again.

## States the learner never sees

| State | What happens |
|---|---|
| Note renamed or moved | Found again by its `godspeed:` key |
| Learner changed a godspeed key | That key is theirs in that note from then on. Keys they added are kept in order |
| One of their notes already covers the idea | The teacher answers `covered_by` with its path: a link, no file |
| A file of that name is there | The new one takes " (2)", as does a second space of the same name (`CSE 21 (2)`) |
| Linked folder holds the notes folder | The scan skips the notes folders and any `.md` with a `godspeed:` key |

## Tools

### `write_vault_note`

An MCP tool, and a lesson tool in every lesson started while a folder is picked (a lesson's tool list stays the same for the whole lesson).

| Input | Rule |
|---|---|
| `space_id` | MCP only |
| `topic_id` | Or left out in a lesson, for the current step's topic |
| `title` | 80 characters; names a new file only |
| `text` | Markdown, 1,200 characters |
| `recall` | One question, 200 characters |
| `mistakes` | `[{id?, text (160), kind (30)}]`; ids from the block, none for "Note this" |
| `source` | One passage id, checked like a kept sentence's |
| `links` | Up to 6 note names in the folder or in the same pass |
| `covered_by` | A path of one of the learner's notes; nothing else with it |

Answer: `{status: "written" | "updated" | "linked" | "waiting", name, path, confidence, next_review?, kept?: ["in short", "confidence"]}`. `kept` names what was the learner's and was left alone; `waiting` means the folder is missing and the text is kept. Refused with a reason: no folder picked, unknown topic, closed space, a link to no note, a removed note outside "Note this".

### `search_vault`

MCP only. `{query?, path?, limit (default 8, max 30), space_id?}`.

- With `query`: `{notes: [{name, path, owner: "you" | "godspeed", class?, confidence?, snippet (200)}], indexed}`.
- With `path`: the whole note, `{name, path, owner, text}`, cut at 20,000 characters with `cut: true`.
- Refused with no folder, or a path outside it.

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

Who owns each key and section is in 08.1.4.

### Mistakes

- One line per kind. A repeat of a kind adds its date to that line ("again Nov 24") while the section is godspeed's, and adds nothing once it is the learner's, since the kind already shows.
- At most 6 kinds. A seventh is left out of the note; the track record keeps it.
- `mistakes` in the frontmatter lists each kind once, for a Base column.

### An untested topic

Only "Note this" makes one before any answer. It has an empty `confidence`, `answered: none yet`, no `next_review` and no `mistakes` key, and no "Mistakes to remember" section.

### Check yourself

The teacher's `source` passage gives the file and page. A file inside the notes folder is embedded, as above. A file outside it is a link that opens in its own app: "Open Day6 Stars and Bars.pdf, page 13".
