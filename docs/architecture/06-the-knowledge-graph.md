## 6. The knowledge graph

The extraction pipeline is the only writer of facts and chains: nothing else appends to a graph's `nodes.jsonl` or `chains.jsonl`. Two other writes exist:

- Deletion (`core::graph::graph_deletion`) rewrites ledgers when learner deletes a fact, deletes or moves a lesson, or removes or rebuilds a space file.
- Topic grouper appends to `topics.jsonl`.

A graph folder holds `nodes.jsonl`, `chains.jsonl`, `sessions.jsonl` (run checkpoints), `coverage.jsonl`, `topics.jsonl`, `sources.json`, `format.json`.

### One extraction run

1. After a turn, `trigger_extraction` (`services::turns::turn_service`) compares lesson with its coverage ledger (`coverage_of`). It starts a run when uncovered tokens reach 4096 (`graph.extractionChunkTokens` in `factory_settings`, not a setting). One run per source in flight.
2. `batch_runs` (`core::graph::coverage`) fills token-budgeted batches with oldest uncovered teacher-prose messages.
3. Per batch, extractor (a job on the learner's agent, [5.4](05.4-background-jobs.md)) submits new propositions, reasoning chains and `reteaches`.
4. Merger (`merge_findings`, `core::graph::merge`, deterministic) appends results and runs chain simplification.
5. Coverage is checkpointed for what merged.
6. When run ends, topic grouping is scheduled for that graph (`schedule_topic_grouping`, debounced 20 s).

A failure at any step checkpoints nothing; the next trigger reruns it.

### What the extractor sees

Teacher prose only: plain paragraphs under the session title, no learner messages, thinking, tool calls, tool results or quiz blocks. Coverage fingerprints, slot tokens and batch budgets come from the same selection (`message_view_lines`, `core::graph::coverage`), so "covered" means "what the extractor saw". A quiz answer or learner edit never opens a run; only an edit to teacher prose reopens its message.

The prompt is a short `SESSION_PREAMBLE` or `NOTES_PREAMBLE`, then a goal and a selection rule of its own, then the chain, graph and submit rules both share, assembled in `agent::extraction::findings`. Notes keep definitions, formulas and claims even with no derivation, and make chains only for reasoning the notes give; a session keeps its own goal. Beside the text it lists:

- `THE GRAPH SO FAR`: this source's merged propositions and chains, ids as they are (none for a source's first stretch).
- `RELATED IDEAS`: about 25 existing ideas from other sources, picked by local search (`related_facts`, embedding and BM25 search in `crates/search`).

The extractor references those ids instead of restating them, and lists ideas it teaches again under `reteaches`. Each stretch builds on every earlier merge, so a source's batches run strictly in order.

`core::session::session_markdown` renders a whole lesson for the markdown export (`GET /api/chats/{id}/markdown`) and the panel chat's `read_lesson` tool. Extraction does not use it.

### Propositions and chains

- A proposition is an objective fact about world (id, name, statement, optional aliases). Nothing about learner's understanding is stored.
- A chain is a set of premises that jointly entail a conclusion. Independent arguments for one conclusion are separate chains; a conclusion can be a premise elsewhere.
- Chains are stored as submitted in `chains.jsonl`. No typed edge is stored; every arrow on screen derives from a chain.
- Chain endpoints may be fresh local ids or existing `n_` ids. The merger's per-job id map passes existing ids through.

The submit step checks these rules and returns an error the model fixes within its turns:

- every premise and conclusion id resolves to a submitted proposition or existing idea
- premises are not empty; a chain does not reference itself
- every `reteaches` id is an existing idea
- `propositions`, `chains` and `reteaches` are present, even when empty

The submit agent repairs payloads that arrive as strings before checking (`heal_encoded_arguments`, `core::session::argument_heal`, called from `agent::extraction::submit_agent`).

### The duplicate check

The first submit that passes the rules is checked once against the facts the graph holds (`core::graph::duplicates`, `agent::extraction::duplicate_check`). No model runs for the check.

1. A new proposition is flagged when an existing fact has the same name (lower case, spaces collapsed), or when the two "name: statement" texts score a cosine of 0.92 or more (`Search::similar_facts`).
2. Nothing flagged: the submit is merged.
3. Something flagged: the submit returns a notice listing each flagged proposition with at most 3 existing facts as `id | name | statement`. The notice is a plain tool result, not an error, and it does not use one of the turns kept for rule errors.
4. The extractor submits again. A proposition that is the same idea as a listed fact is left out, and that fact's id goes in chains, `tests` and `reteaches`. This submit is merged without a second check.

A search failure skips the check and the submit is merged. Duplicates stored before this check stay separate nodes.

### What the merger writes

- Each new proposition becomes a node.
- Each valid `reteaches` id gets a credit line with this source's provenance, so source counts toward that idea.
- Chains dedupe by sorted premises plus conclusion. A known argument found again appends under same `arg_` id, provenance combined.
- The merger does not compare names or statements. Duplicates are caught before it, by the duplicate check.

### Chain simplification

At every merge, `simplify_chains` (`core::graph::simplify`) walks the whole chain ledger and drops provably redundant chains: those whose premises already derive their conclusion through the other kept chains.

- Chains with most premises, then newest, are checked first, so leanest and earliest derivation stays.
- A dropped chain never helps derive another, so two chains deriving each other never both go.
- Example: `[A,B]⟹X` plus `[X,C]⟹Y` make `[A,B,C]⟹Y` redundant. `[A]⟹Y` next to `[A,B]⟹X` and `[X]⟹Y` stays, because A alone never reaches X.

The rewrite happens inside the merge's lock (`rewrite_ledgers`). Run stats count dropped chains separately (`droppedChains`).

### Jobs and the graph lock

Every batch of a lesson and every part of a notes file is its own job, with its own row, usage record and failure.

- Extract and merge run inside one process-wide graph lock (`with_graph_lock`, `agent::extraction::extraction`). The extractor reads live graph, so two at once would miss each other's additions. A job waiting for lock shows the `waiting` phase.
- One failing job leaves its messages uncovered and re-runnable while others still merge.
- Abort stops whole source at first abort, also while waiting for lock. Jobs that merged keep their checkpoints.
- Activity feed shows one row per job, with a `(2/5)` suffix for parts. Each job saves its own usage record, failed jobs included.
- Run registry (`agent::extraction::extraction_runs`) feeds activity feed, coverage menu and abort.

### Coverage

Each message's view is hashed into the lesson's `coverage.jsonl`. Covered means a run merged on exactly that content; uncovered is the difference. The prompt shows a richer markdown version, kept apart on purpose so a presentation change never reopens covered history. `sessions.jsonl` also gets a checkpoint per merged run.

### Notes and space files

The same pipeline reads notes and space files:

- Notes come in through `POST /api/graph/import` or the panel chat's `import_notes` tool. A notes file's source id is `src_` plus first 12 hex of sha256 of its path. A "No space" re-import reads whole file again and adds to that source. In a space, `import_notes` writes through `write_agent_file` (`services::spaces`), like `add_space_file` with text: it replaces only a file marked `written` and refuses any other file of that name (learner's own, or notes an older version imported; nothing stored tells those two apart).
- A space file's source id is unique per space. A changed or removed file has its old facts removed first (`delete_source_traces`), then is read again.
- Notes split at line boundaries under same token budget; each chunk runs as its own job, in order, under graph lock. No model call carries a whole file.

### The read side

`GET /api/graph` and `GET /api/progress` read the ledgers and never write.

- `graph_snapshot` merges ledgers; `derive_view` (`core::graph::graph`) rebuilds view on every read.
- Each stored chain becomes an implication node (id is its `arg_` id, name `⟹`) with arrows premises to implication to conclusion. A chain with a deleted member drops out.
- Two arguments for one conclusion stay two implication nodes.
- Clusters are birth sessions: a fact joins cluster of lesson or notes file that created it (`birth_session_partition`, `core::graph::session_clusters`). The chain table groups chains by them.
- How well learner knows a fact derives from lesson answers at read time (`services::graph::progress`, `src/shared/core/progress.ts`). Nothing writes learner state into graph.

### Deletion

- Deleting a proposition removes every stored chain referencing it, as premise or conclusion.
- Deleting an implication node (any `arg_` id) removes exactly that stored chain.
- One confirm dialog (`src/frontend/components/delete-node-dialog.tsx`) opens from All facts' Delete. The topic sheet's fact rows only open the fact.

### The teacher's graph tool

Every lesson kind has one graph tool, `search_graph` (`agent::tools::graph`):

1. It searches only the lesson's own graph: its space's, or "No space" for a lesson with no space.
2. With a query it ranks facts by meaning and keywords (`search_facts`, `crates/search`); without one it gives the newest facts.
3. It returns at most 8 facts and at most 8 chains whose conclusion or a premise is among them, as "premises → conclusion".
4. Each fact is `{id, name, statement, from, asked}`. `from` is `files`, `lessons` or `both`, read from the fact's provenance (`fact_from`). `asked` is the learner's latest answer on the fact from the Progress read (`right`, `hinted`, `wrong`, `dontKnow`), or `never`. The graph holds what files and lessons say, so a fact never asked is not one the learner holds.

Its body is `services::graph::graph::search_graph`, shared with the panel chat's tool of the same name (§8.1). The `agent.graphTools` setting, or the graph switched off, removes it from every lesson (`graph_tools_enabled`). Besides the tool, a study lesson starts with the `[Session context]` and `[Study plan]` notes (§7).

### The Graph page

`/graph` is one picture of the space and how it connects, fitted to the window, over one quiet line at the window's foot. The page never scrolls. The layout is worked out in the browser from `GET /api/progress` and `GET /api/graph`; the same data always gives the same picture, and nothing is stored.

| Part | File | What it does |
|---|---|---|
| Page | `src/frontend/components/graph/graph-screen.tsx` | Loads the data, holds Find's state, the foot line and the chain table, and holds the camera's latest flight (the picture asks for picks, the foot line and Find for the whole space). |
| Top bar | `graph-bar.tsx`, `import-notes.tsx`, `use-bar-find.ts` | Find (with facts) and, with no space, Add files, in that order before Edit space. Opening Find swaps Add files for its field. What building the graph took (`GET /api/graph/costs`) is at the end of the teacher's Activity (`teacher/graph-costs.tsx`). |
| Foot line | `graph-foot.tsx` | The counts (the fact count opens the chain table). While something is typed in Find it says what matches. Zoomed in, the counts are what is in view and Whole space flies out. With one topic in view the line reads its name and how many of its facts are lit ("16 of 18 lit"). Before any topic it counts only facts. |
| Picture and panel | `graph-body.tsx`, `graph-layout.tsx`, `graph-layout-model.ts`, `slip-motion-model.ts`, `use-step-in.ts`, `use-room.ts` | `use-room.ts` measures the room (its width, its height down to 16 px above the foot line, and how far the page reaches past it). `graph-body.tsx` holds the pick, asks for a flight on each pick and close, moves keyboard focus and handles Escape. `graph-layout.tsx` puts the picked topic's or fact's panel in a slip under the picture and gives the picture the room above it; `graph-layout-model.ts` holds the sizes (pure, unit-tested). The panel's travel, its glide and what steps in: `slip-motion-model.ts` (step times, pure, unit-tested), `use-step-in.ts`, and the travel shared with Follow's slip (`slip-travel-model.ts`, `use-slip-travel.ts`). |
| Picture | `constellation.tsx` | One SVG: every fact is a square star, grouped by topic with the topic's name under it; lines join topics that build on each other. Topics are buttons on top. Zoomed in, it adds no words except the pointed fact's name tag, and it is drawn past its box: out to the window's sides, dissolving in 24 px pixel dither (`constellation-edges.tsx`) just under the tab row and just above the foot line. Stars drawn past the box are pointed at, clicked, dragged and zoomed like the rest. Before any topic the facts are plain squares with no name, and one line under them says the teacher sorts them into topics next (with fewer facts than the server sorts, the progress payload's `minFactsForTopics`, it says topics appear at that many); while the grouping run goes the work frame says it instead. A square opens its fact alone, with no back key. |
| Layout | `constellation-layout.ts`, `constellation-routes.ts` | Where groups sit (by a topic's `column`, start on the left), and which lines are drawn and how they route around names. Facts with no topic yet (only Ungrouped) stand loose, twice as far apart, in the middle of the page. Pure, unit-tested. |
| Fit | `constellation-fit.ts` | The scale that fits the picture in its room: smaller when it is too tall, never larger. Names that would be under 11 px are not drawn at rest. Pure, unit-tested. |
| Reveal | `constellation-reveal.ts` | When each cluster, name and line inks in as the tab opens. When the first topics arrive, each fact travels from its loose square to its place (`useArrival` in `use-figure.ts`) while names and lines ink in. Pure. |
| Camera | `use-camera.ts`, `constellation-camera.ts` | Zoom and pan: the wheel or a pinch zooms toward the pointer, a drag pans while zoomed in, a pick flies in. The maths is pure and unit-tested; the camera outlives the picture while a small room shows a panel in its place. |
| Figure | `constellation-figure.ts`, `use-figure.ts`, `constellation-figure-layer.tsx` | Near, each topic is a figure: its facts placed by what they need, its links as lines, a fact's path. The maths is pure and unit-tested; `use-figure.ts` glides facts into place and the layer draws lines, arrows, facts and the pointed fact's name tag. |
| Moon | `constellation-moon.ts` | A fact's moon as pixel cells, by its phase. Pure, unit-tested. |
| Name tag | `constellation-tips.ts` (`tagSpot`) | Where a pointed fact's name tag goes. Pure, unit-tested. |
| In view | `use-in-view.ts` | What the foot line counts while zoomed in: a topic counts once half its facts are in view. The count is pure and unit-tested. |
| Panels | `topic-pane.tsx`, `fact-pane.tsx`, `pane-buttons.tsx`, `link-chips.tsx`, `topic-moons.tsx`, `fact-moon.tsx`, `fact-file-key.tsx`, `note-key.tsx` | The picked topic: its name, count line, each fact as its moon (pointing shows the fact's name, a click opens it), the sure-miss note, the topics it needs first and leads to as chips, its note's key and Study. The picked fact: its moon (`fact-moon.tsx`, the picture's moon drawn large) with its answer line under it, its name and statement (once when they are the same words), the facts it builds on and leads to as chips, one key named after its file or lesson (a PDF opens, any other file shows in the file browser, a lesson opens), and Study. Its topic stands on the slip's top edge as a tab back to the topic. A group of more than five chips shows four and a chip with how many more. |
| No facts yet | `graph-empty.tsx` | "Start a lesson or add files to build your graph." |

What the learner does:

1. Pointer on a topic: its lines light up with arrows and the rest dims. Pointer on a fact: the facts it builds on light up. Near, pointing at a fact shows its name on a tag instead (below).
2. Click a topic: the topic's panel travels up as a slip across the foot of the picture's room, from past the room's foot by its own height (220 to 320 ms by height), its moons stepping in left to right; the picture re-fits above it with one short fade, and the camera flies in until the topic, drawn as its figure, fills the picture. Once the slip's height is known the camera fits the topic again. A topic in the panel's Needs first or Leads to flies the same way. The slip is never cut at rest. Its links fold, one at a time and shared between both groups, behind an "N more" chip until the slip fits 45% of the room (`use-link-fit.ts`); with every link folded, a fact's name and words may grow it further, as long as the picture keeps at least 180 px. Opening the links shows all, and past that greatest height the slip's middle scrolls with a pixel fade at its foot while Close, the tab, the file key and Study stay in view. In a room under 760 px wide or 470 px high, or when the panel is taller than its greatest height even with every link folded, the panel takes the picture's place; under 760 px wide it is one column. It travels up over the picture, which fades out once the panel has arrived; a slip that becomes such a panel keeps its sheet, whose top edge travels up to the panel's place, and the way back brings the edge down to the slip's height while the picture fades in above it.
3. Click a fact (a star or moon in the picture, a moon in the topic's panel, or a chip in a fact's panel): its fact panel opens, with its topic picked, and the camera flies to the topic unless the fact is already near and in view. The topic's tab on the slip goes back to the topic. A panel that replaces another keeps the slip: the slip's edge glides to the new height (`useSheetGlide`), its blocks step in top to bottom, and the picture re-fits once to the final height. Each time a fact opens its moon prints row by row in nine steps, and its link chips step in left to right; opening "N more" glides the edge up with everything already shown riding it, and steps in only the new chips as they come up from the foot (`slip-motion-model.ts`). A panel there when the page first draws is simply there.
4. Close: the panel's Close, Escape (the fact first, then the topic), a click on empty picture, or a click on the picked topic again. Closing flies back to the view before the first fly-in. The slip (or the panel shown alone) leaves downward in 110 to 160 ms, held on screen until it has left, over the picture, which takes the whole room with its fade as the panel starts to leave. With reduced motion the panel comes and goes at once.
5. Zoom by hand: the wheel or a pinch zooms toward the pointer. Zoomed in, a drag pans, from a topic's name too (a press that does not move is a click). Whole space in the foot line, or Escape with nothing open, flies back to the whole space; a panel stays open.
6. Find, in the top bar: the magnifying glass (or the find key) opens a field, the foot line shows the topic and fact counts, and the camera flies to the whole space. Topics and facts that don't match dim, the picked topic never does, and the counts show what matches. Typing that matches nothing says "Nothing matches".
7. Stop finding: the x, Escape in the typing line (it clears the typed text and keeps any open panel), or leaving the line while it is empty. The counts come back.

Zooming in adds no words: facts are named only by their panel and the name tag, and the far view (zoom 1) is unchanged. By the star gap on screen:

| Star gap | Facts | Lines |
|---|---|---|
| Under 28 px | Square stars in their clusters. | Faint lines between topics. |
| 28 px and up (near) | Squares glide into their topic's figure, basics at the bottom. Facts no link in the topic reaches (loose) sit in rows under it. | One line for each link inside a topic, from the fact it needs (lower) to the fact built on it (higher). Links to other topics are not drawn. |
| 44 px and up | Each fact a moon: its phase is how many of its last four answers were right (0 to 4), and never asked is a dark moon. | The same, with a small arrow pointing up on each line. |

A fact is lit when its latest answer was right. A line is lit when both its facts are lit, half lit with one, and a faint ghost with none.

Near, with a fact pointed at or open in its panel, the facts it needs stand out solid, the facts it leads to are dashed, and the rest dims. Pointing also shows the fact's name on a one-line tag (at most 44 letters), except for the fact whose panel is open. The tag takes the first of right, left, above and below that stays inside the picture and covers no star; when every side is crowded it hangs above the topic with a dotted leader down to the fact.

Zoomed in, a topic name or the name tag that would cross the dissolving top or bottom is not drawn there; the foot line names the topic instead. The name tag stays inside the box; a fact drawn past the box's side gets its tag at that edge, level with it. The foot line counts only what is in the camera's view, not the wider drawn area.

On a picture too tall for its room, a name drawn under 11 px waits until its topic is pointed at, picked or lit by Find, and then shows at full size.

The picture inks in once each time the tab opens, in 0.9 s (a change to the graph, Find or a pick never replays it). A flight takes 0.3 s. Flying into a topic, its facts glide into their figure places in 0.36 s, and its lit lines draw in from the basics up over 0.6 s, starting after the flight. With reduced motion there is no reveal, a flight is a jump, and the figure shows at once with nothing moving.

A graph change keeps the pick; a picked topic or fact that is gone closes its panel.

The topic grouper (`agent::extraction::topic_grouper`, scheduled by `services::graph::topics`) groups a graph's facts into topics. It labels each topic's material as term, procedure, concept or proof. Every run appends a full snapshot to `topics.jsonl`. Older snapshots may have no material. A topic keeping its id across a regroup keeps its stored material (`repair_topics`, `core::graph::topics`). No layout is stored.

A run does one of three things:

| When | What runs | Model call |
|---|---|---|
| First grouping, or a space's file queue just drained | The grouper gets every fact and the current topics | Yes |
| New facts that all have a chain neighbor in a topic | Each joins the topic most of its neighbors are in (`place_new_facts`) | No |
| New facts, some with no grouped neighbor | The rest are placed as above; the grouper gets only the loose facts, and each topic as its name and six of its facts' names (`add_placements` merges its answer) | Yes, a small one |
