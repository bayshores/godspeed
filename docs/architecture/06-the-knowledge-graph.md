## 6. The knowledge graph

The extraction pipeline is the only writer of facts and chains: nothing else appends to a graph's `nodes.jsonl` or `chains.jsonl`. Two other writes exist:

- Deletion (`core::graph::graph_deletion`) rewrites ledgers when learner deletes a fact, deletes or moves a lesson, or removes or rebuilds a space file.
- Topic grouper appends to `topics.jsonl`.

A graph folder holds `nodes.jsonl`, `chains.jsonl`, `sessions.jsonl` (run checkpoints), `coverage.jsonl`, `topics.jsonl`, `sources.json`, `format.json`.

### One extraction run

1. After a turn, `trigger_extraction` (`services::turns::turn_service`) compares lesson with its coverage ledger (`coverage_of`). It starts a run when uncovered tokens reach 4096 (`graph.extractionChunkTokens` in `factory_settings`, not a setting). One run per source in flight.
2. `batch_runs` (`core::graph::coverage`) fills token-budgeted batches with oldest uncovered teacher-prose messages.
3. Per batch, extractor (outside agent, via a work item) submits new propositions, reasoning chains and `reteaches`.
4. Merger (`merge_findings`, `core::graph::merge`, deterministic) appends results and runs chain simplification.
5. Coverage is checkpointed for what merged.
6. When run ends, topic grouping is scheduled for that graph (`schedule_topic_grouping`, debounced 20 s).

A failure at any step checkpoints nothing; the next trigger reruns it.

### What the extractor sees

Teacher prose only: plain paragraphs under the session title, no learner messages, thinking, tool calls, tool results or quiz blocks. Coverage fingerprints, slot tokens and batch budgets come from the same selection (`message_view_lines`, `core::graph::coverage`), so "covered" means "what the extractor saw". A quiz answer or learner edit never opens a run; only an edit to teacher prose reopens its message.

The prompt is one shared `EXTRACTION_CORE` plus a short `SESSION_PREAMBLE` or `NOTES_PREAMBLE`, assembled in `agent::extraction::findings`. Beside the text it lists:

- `THE GRAPH SO FAR`: this source's merged propositions and chains, ids as they are (none for a source's first stretch).
- `RELATED IDEAS`: about 25 existing ideas from other sources, picked by local search (`related_facts`, embedding and BM25 search in `crates/search`).

The extractor references those ids instead of restating them, and lists ideas it teaches again under `reteaches`. Each stretch builds on every earlier merge, so a source's batches run strictly in order.

`core::session::session_markdown` renders a whole lesson for the markdown export (`GET /api/chats/{id}/markdown`) and the MCP `read_lesson` tool. Extraction does not use it.

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

### What the merger writes

- Each new proposition becomes a node.
- Each valid `reteaches` id gets a credit line with this source's provenance, so source counts toward that idea.
- Chains dedupe by sorted premises plus conclusion. A known argument found again appends under same `arg_` id, provenance combined.
- Search misses stay separate nodes. No second model call matches duplicates.

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

- Notes come in through `POST /api/graph/import` or MCP `import_notes` tool. A notes file's source id is `src_` plus first 12 hex of sha256 of its path. A "No space" re-import reads whole file again and adds to that source. In a space, `import_notes` writes through `write_agent_file` (`services::spaces`), like `add_space_file` with text: it replaces only a file marked `written` and refuses any other file of that name (learner's own, or notes an older version imported; nothing stored tells those two apart).
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
- One confirm dialog (`src/frontend/components/delete-node-dialog.tsx`) opens from a fact's right-click menu and from chain table's Delete.

### The teacher's graph tools

The teacher reads the graph only through `list_sessions` (birth sessions, the learner's files) and `list_propositions` (facts a session covered), in `agent::tools::graph`. The `agent.graphTools` setting turns them off. No topic embedding, no top-K pick, no start-of-lesson injection.

### The Graph page

`/graph` shows topics in level columns (`src/frontend/components/graph/level-columns.tsx`); each column is one prerequisite depth (a topic's `column`). Each topic is a row with one square per fact, colored by its right rate, with no lines and no zoom. A picked topic marks what it needs and what it leads to.

The right side (`side-panes.tsx`) shows the next deadline on top, then what to work on next, the picked topic (`topic-pane.tsx`) or picked fact (`fact-pane.tsx`: its answers, where it came from, facts it builds on and leads to).

The topic grouper (`agent::extraction::topic_grouper`, scheduled by `services::graph::topics`) groups a graph's facts into topics. It labels each topic's material as term, procedure, concept or proof, and appends a full snapshot to `topics.jsonl`. Older snapshots may have no material. A topic keeping its id across a regroup keeps its stored material (`repair_topics`, `core::graph::topics`). No layout is stored.
