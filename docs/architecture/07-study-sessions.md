## 7. Study sessions

Every new lesson is a study session (`kind: "study"` on the chat record). No prober; the tool list is the same every turn.

Started from:

- "Study something new" on the Lessons sheet of a space's Progress page (study page, `/new`), or the same words on the "Start this space" card of a space with nothing in it
- The line in Home's head ("What do you want to study?"): a typed topic and the space it goes in (a chip, drawn when there are several open spaces; it starts on the active space), started in that space with `POST /api/chats` and its `spaceId`
- Study or Continue on Home's card, a topic row in Home's Work on next block, or Study on a deadline page
- Study in a topic's or a fact's panel on Graph tab, or Study on Progress tab
- "Go over it with {teacher}" on a mock's results
- Study on a space's path (§6.3)
- "Start from facts" (chain table in select mode, `src/frontend/components/study-page/facts-picker.tsx`)
- Study on the Study page's "Next up" file, or on the Files page's picked bar (a lesson on files, [7.2](07.2-lessons-on-files-and-homework.md))
- MCP `start_lesson` tool

Older `teach` and `practice` lessons on disk keep working with their own agents. Practice lessons are never extracted into the graph.

### How a session starts

`create_lesson` (`services::turns::lessons`) writes the opening markers:

1. Picked facts become a `graph-context` marker through `chains_for_selection` (`core::graph::chains`). A chain is included when its conclusion and every premise are picked; a picked fact in no included chain stands alone.
2. Picks are grouped into topics in space order (`core::study::study`). Each topic has its material when it has one, and learner's standing: untested, weak, shaky or strong, with "(latest wrong)" on a weak topic whose latest answer was wrong.
3. These go into a `study-context` marker. The move for each material and standing pair is a table in `crates/agent/prompts/study/10-study.md`, so a prompt override can change it.
4. App saves matching plan tree, so plan row lists topics from start.

A typed subject (also MCP `start_lesson`) or a deadline with no space topics for it starts differently:

1. The `study-context` marker holds the no-topics note (`no_topics_text`) instead of a topic list. It tells the agent to look up what the files and lessons cover with `search_graph`, where a fact with `asked: never` is not held, then write a plan of at most 8 nodes with `plan_init` in its first reply and start the first node. For a typed subject in a space with no picked facts, the note ends with the nearest space topics and where the learner stands on each (`LessonStart::typed`, `nearest_topics_for`): the topics of the best 8 fact-search hits for the subject, 3 at most. A deadline with no topics gets no such lines. When the search cannot run, the lesson starts without them and the error is logged.
2. The app saves no tree, so the plan row stays hidden until that `plan_init` call.
3. The agent calls `plan_init` again, with the same slugs for nodes already worked on, when answers show the map is wrong or the learner asks for a change.
4. The note tells the agent to leave `review` out of `topic_done`, since questions from earlier come only from space topics.

Lessons on files, the Document panel and homework sessions are in [7.2](07.2-lessons-on-files-and-homework.md).

### Unfinished lessons

Each lesson row in the progress payload carries `step` (`{ done, total }`, the number the lesson's step bar shows, only when the lesson has a plan), `problems` (`{ done, total }` of a homework lesson's deadline's list or a lesson on files' first file's, only when one is listed; its blocks show instead of the steps), `unfinished` (set only when true) and `deadlineId` (the deadline it was started from). The server decides `unfinished` (`derive_progress::lesson_rows`, with `plan_finished` from `core::study::continue_study`), and Progress (the unfinished lessons in its side column, with the key that opens the newest in the card's head; the finished ones in its Lessons sheet, never both), Home's Unfinished block and the Study page's Continue row all read it. Each of a deadline's lessons is unfinished on its own. A lesson is unfinished when:

1. It is a homework lesson, it is its deadline's latest homework lesson, the deadline is not done and not every problem is done. A deadline with no problems posted counts as not every problem done.
2. It is a lesson on files with problems listed, and one is not done.
3. It has a plan that has not reached its end, and either its count has not reached the last step or a stop is left to go on from.
4. It has no plan and a question or problem waits for the learner, or nothing has been answered yet.

### The study agent

The teacher's prompt and tools, without the planning part (`teacher/10-planning.md`) and the deadline changes (the learner makes those outside lessons). `plan_init` is in the list only when `agent_writes_plan` is true (`core::session::plan`): the app made no tree, or the agent already wrote one. That is fixed for the whole lesson, so the tool list stays the same every turn. It adds:

- `problem` and `conclude` (`agent::tools::practice`; `problem` carries topic's `nodeId`)
- `topic_done`, refused while no topic is finished since the last one stored ("No topic is finished since the last topic_done: ...")
- `plot`, in multiple-choice lessons
- practice hint rules (`prompts/practice/20-hints.md`) and `prompts/study/`

Topics go in plan order. A `quiz`, `explain` or `problem` that is the first call on its node is refused when an earlier node in learning order (`ordered_plan_ids`: prerequisites first, then authored order) has no tagged call in the lesson (`skipped_node`, `core::session::plan_step_bar`; a shown opener's question counts). The refusal reads `nodeId "<this>": "<earlier>" comes first and nothing in this lesson asked it. Ask it first. His answers in this lesson justify skipping it: send the same call again.` It is sent once a node: the turn's question and problem share one check (`PlanOrder`, `agent::tools::questions`), so the same call sent again goes through, and once a call on that node is in the record it never blocks again.

With no question or open problem, the turn shows its next state (`turnNext` in `src/frontend/components/lesson/turn-next-model.ts`): one line saying what is next when that is known, and one main key at the end of the writing row. Its label is the go-ahead key's (`goAheadLabel` in `chat-helpers.ts`): "Continue" in a Study session once the teacher has spoken, "Next problem" in practice once a problem was posed, "Start problem N" in homework. With no stop it shows once the teacher is idle and no error line is up, and sends the `next` input. At a stop the learner has not kept going from, the line is "X is next." for a topic stop or "Next is X." for a problem stop (none in practice, and none in homework, whose key names the problem), and the key does what Keep going does (`keepGoing`); it shows even while the teacher reads ahead, and Stop is hidden then. At the last topic the line is "That was the last topic." and the key "Done for today" goes back to Home, with the deadline's card lit when the lesson has one. While the teacher writes with nothing waiting, the question just answered or skipped stays on the right page of a wide window, quiet, with the learner's pick and its verdict (§7.1); after any other move, the last next state's line stays, dimmed, with no key (`turnShown`). A first reply stopped before the teacher wrote anything shows "Start again" there instead (the `continue` input). When the state changes, the old contents fade out (110 ms) and the new rise in, in place while the writing row stays still; with reduced motion they swap at once.

A posed problem ends the turn. `practice-next` and `problem-dismissed` mark moving on or skipping. The lesson text draws nothing for `practice-next`: its row is an empty mark, and the page rests the reply at it. In homework and a lesson on files, a `practice-next` with a `number` is a pick from the problem list. Lessons from 0.6.74 may hold `teach-me` markers; they still count as the learner's input and read as his line "Teach me this". A study session is extracted into the graph. A problem solved with hints counts as an answer worth 0.6 of a right one (`HINTED_WEIGHT`), so alone it reads shaky, and counts print it apart: "1 of 2 right, 1 solved with hints". An answer whose facts are in no topic (none extracted yet, or new ones still in Ungrouped) counts once for its question's `nodeId` when that is one of the space's topics (`core::study::derive_progress`), so a topic studied today is not untested while its facts are being saved.

### Questions from earlier

godspeed asks some earlier topics again by itself; the window grades them, so no agent is woken. Schedule: `core::study::review`.

| Rule | Value |
|---|---|
| Rest after a right answer | 2, 4, 8, 16, 32, then 64 days |
| After a miss | back within 4 days |
| Deadline covering topic | rest shortened to a third of days left, never under 2 |
| Per space | max 3 a local day |
| Never asked | one shown in last 7 days, the one missed last time, one skipped this sitting |

A question is a stored `topic_done.review`, or a Study `quiz` with `standalone: true` and no `keep` that the learner answered right.

They show only in a Study lesson of a space, during a sitting's first wait, with no question, problem, opener or stop open. That wait is the lesson's start, or after the learner's first input on a return, until the teacher's reply lands.

An answer is a UI-only `review` marker: `{of: {chatId, messageId, toolCallId}, nodeId, topic, quiz, answer, sitting, kept?}`. The learner's next input carries one hidden `[From earlier]` line for the answers since the last one. Progress counts each answer for the quiz it came from.

Ask Teacher on one sends `text` with `about: {reviewOf: {chatId, toolCallId}, picked?: [label]}`. A note before the message carries the question, options, pick and explanation, and the question stays open. While the teacher's own question waits behind it, the message is written as a side question.

Plots are in [7.3](07.3-plots.md).

### Kept sentences

A multiple-choice Study `quiz` may carry `keep: {text (160), source?, fits? (120), stops? (120, required with fits), phrase? (60)}`: one sentence the learner keeps on a right answer, with optional analogy lines and a memory phrase. A keep never refuses its quiz: a keep that breaks the rules is left out of what the checks read, and the stored call keeps it as sent.

When a Study turn is saved (`save_turn`), each new keep gets a UI-only `keep-check` marker from `core::study::kept::keep_verdicts`: `{quizCallId, keep: "shown" | "dropped", fits, phrase, source?: "ok" | "dropped", sourceMark?, note?}`. A keep is not shown when:

- its quiz is a prediction, or its fields break rules
- its reply carries a plot or another keep it stores
- topic's previous reply carries a plot or a kept sentence learner saw
- topic already kept 2 learner answered right

Analogy lines show on one keep per topic. A keep's `source` must be one mark pointing at a passage, checked like a reply's marks. `note` reaches the teacher in the hidden note after the learner's answer to that quiz.

The window turns a right-answered quiz with a `shown` verdict into the kept card (`src/shared/core/kept-view.ts`, twin of `core::study::kept`; both replay `crates/core/tests/golden/kept.json`).

- Dropping analogy or phrase writes a UI-only `analogy-drop` or `phrase-drop` marker (`{of, back?, at}`).
- Learner's next input carries one `[Analogy dropped] Regularization: "The leash fits one part"` line per analogy dropped since last such line. Dropping a phrase tells teacher nothing.
- An answered question from earlier carries in `kept` topic's longest-ago shown kept sentence: `{of, text, source?, phrase?}`, never analogy lines.
- Coverage counts `keep.text` as teaching when keep's fields hold.

### Lesson routes that write without a turn

Allowed while a turn runs; never answer 409.

| Route | Body | Answer |
|---|---|---|
| `POST /api/chats/{id}/keep-going` | `{input: {stopOf}}` | `{ok: true, opener, running}`. 404 unknown lesson, 400 when no turn runs and that call has no stop |
| `POST /api/chats/{id}/kept` | `{input: {of, part: "analogy" \| "phrase", back?: true}}` | `{ok: true}` (`services::turns::lesson_events::drop_kept_part`). 400 for a bad input or a quiz with no kept sentence learner saw with that part |
| `POST /api/chats/{id}/review` | `{input: {type: "next"}}` | `{question: {of, nodeId, topic, quiz}}` or `{question: null}` |
| | `{input: {type: "answer", of: {chatId, toolCallId}, answer}}` | `{ok: true}` |
| | `{input: {type: "skip", of}}` | `{ok: true}`, storing nothing |

`review` (`services::turns::review`; 404 unknown lesson, 400 bad input):

- `next` returns open question, so asking again gives same one. A question learner asked teacher about this sitting comes first until answered or skipped. The window asks once when a lesson opens, then when a wait begins and when a turn starts or ends.
- `answer` takes window's graded quiz answer (`{kind: "quiz", correct, answers, confidence?, thinking?}` or `{kind: "quiz", dontKnow: true, answers: []}`), stamped `answeredAt` with server clock.
- An `answer` or `skip` whose `of` is none of sitting's current picks gets 400 `That question from earlier is not open`; window then gives learner's words back and says question is no longer due.
- Any other bad answer gets 400 `An answer is a graded quiz answer with a pick, or I don't know`.
- A skipped question is passed by until sitting ends.

### The chain table

`src/frontend/components/chain-table.tsx` lists every chain of the graph, grouped by birth cluster, with a search. Checkboxes pick clusters, chains or single facts.

- On Graph page, floating bar deletes selection through confirm dialog. Deletes run one at a time, stop at first failure, then announce `lh:graph-revision` so page refetches.
- Opened from "Start from facts" on `/new`, bar has Done instead of Delete, and picks become new session's opening context.
