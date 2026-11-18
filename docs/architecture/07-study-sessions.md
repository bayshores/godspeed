## 7. Study sessions

Every new lesson is a study session (`kind: "study"` on the chat record). No prober; the tool list is the same every turn.

Started from:

- "Study something new" on the Lessons sheet of a space's Progress page (study page, `/new`)
- Start on Today's card, or Study on a deadline page
- Study in a topic's or a fact's panel on Graph tab, or Study on Progress tab
- "Go over it with the teacher" on a mock's results
- Study on a space's path (§6.3)
- "Start from facts" (chain table in select mode, `src/frontend/components/home/facts-picker.tsx`)
- MCP `start_lesson` tool

Older `teach` and `practice` lessons on disk keep working with their own agents. Practice lessons are never extracted into the graph.

### How a session starts

`create_lesson` (`services::turns::lessons`) writes the opening markers:

1. Picked facts become a `graph-context` marker through `chains_for_selection` (`core::graph::chains`). A chain is included when its conclusion and every premise are picked; a picked fact in no included chain stands alone.
2. Picks are grouped into topics in space order (`core::study::study`). Each topic has its material when it has one, and learner's standing: untested, weak, shaky or strong, with "(latest wrong)" on a weak topic whose latest answer was wrong.
3. These go into a `study-context` marker. The move for each material and standing pair is a table in `crates/agent/prompts/study/10-study.md`, so a prompt override can change it.
4. App saves matching plan tree, so plan row lists topics from start.

A typed subject (also MCP `start_lesson`) or a deadline with no space topics for it starts differently:

1. The `study-context` marker holds the no-topics note (`no_topics_text`) instead of a topic list. It tells the agent to look up what the learner holds with `search_graph`, then write a plan of at most 8 nodes with `plan_init` in its first reply and start the first node.
2. The app saves no tree, so the plan row stays hidden until that `plan_init` call.
3. The agent calls `plan_init` again, with the same slugs for nodes already worked on, when answers show the map is wrong or the learner asks for a change.
4. The note tells the agent to leave `review` out of `topic_done`, since questions from earlier come only from space topics.

The lesson keeps its own plan when files are added to the space later. A mock question gone over with no topic of its own is one weak topic (`FREE_TOPIC_ID`).

A Study session started from a deadline records `deadlineId` (a homework lesson records it too but is not a Study session). While the latest such session is unfinished, the deadline's Study button reopens it, and the button reads "Continue" instead of "Study" (`core::study::continue_study`, `studyLabel`). Where several deadlines' buttons sit together (the Study page), and on a homework's two keys, each names its deadline and an unfinished one adds its count ("Continue studying for Midterm, 1 of 4 topics"). The progress payload carries it as `continueStudy`. A deadline topic with a topic stop in a Study session on the learner's day carries `finishedToday: true` in the progress payload. The plan (`core::study::deadline_plan`, `deadline-plan.ts`) never puts such a topic on today: it moves to tomorrow, or out of the plan when tomorrow is the due day. When that empties today, Today has nothing planned and the deadline's Study button takes all its topics.

### Unfinished lessons

Each lesson row in the progress payload carries `step` (`{ done, total }`, the number the lesson's step bar shows, only when the lesson has a plan), `unfinished` (set only when true) and `deadlineId` (the deadline it was started from). The server decides `unfinished` (`derive_progress::lesson_rows`, with `plan_finished` from `core::study::continue_study`), and Progress (the unfinished lessons in its side column, the finished ones in its Lessons sheet, never both) and the Study page's Continue row both read it. Of the lessons started from one deadline, only the latest can be unfinished. A lesson is unfinished when:

1. It is a homework lesson, it is its deadline's latest homework lesson, the deadline is not done and not every problem is done. A deadline with no problems posted counts as not every problem done.
2. It has a plan that has not reached its end, and either its count has not reached the last step or a stop is left to go on from.
3. It has no plan and a question or problem waits for the learner, or nothing has been answered yet.

### The study agent

The teacher's prompt and tools, without the planning part (`teacher/10-planning.md`) and the deadline changes (the learner makes those outside lessons). `plan_init` is in the list only when `agent_writes_plan` is true (`core::session::plan_blocks`): the app made no tree, or the agent already wrote one. That is fixed for the whole lesson, so the tool list stays the same every turn. It adds:

- `problem` and `conclude` (`agent::tools::practice`; `problem` carries topic's `nodeId`)
- `topic_done`
- `plot`, in multiple-choice lessons
- practice hint rules (`prompts/practice/20-hints.md`) and `prompts/study/`

In a Study session the foot of the lesson text shows "Continue" whenever the teacher has spoken, is idle, nothing waits and no stop card is up, with or without a problem posed. It sends the `next` input (`nextReady` in `chat.tsx`).

A posed problem ends the turn. `practice-next` and `problem-dismissed` mark moving on or skipping. In homework, a `practice-next` with a `number` is a pick from the problem list. Lessons from 0.6.74 may hold `teach-me` markers; they still count as the learner's input and read as his line "Teach me this". A study session is extracted into the graph. A problem solved with hints counts as an answer worth 0.6 of a right one (`HINTED_WEIGHT`), so alone it reads shaky, and counts print it apart: "1 of 2 right, 1 solved with hints". An answer whose facts are in no topic (none extracted yet, or new ones still in Ungrouped) counts once for its question's `nodeId` when that is one of the space's topics (`core::study::derive_progress`), so a topic studied today is not untested while its facts are being saved.

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

### Plots

In a multiple-choice Study lesson, the teacher can send `plot` (`agent::tools::plot`): one or two lines over x, each a formula with one slider, in plain math such as `min(a, 4/(1+lambda))` and never code, or 2 to 12 measured `points` `[x, y]`. A plot with a formula line may also hold one points line (a model against data). The slider and `x.name` are needed only when a line is a formula; a slider with no formula line is refused.

Grammar: `core::session::plot_expr`, twin of `src/shared/core/plot-expr.ts`; both replay `crates/core/tests/golden/plot_expr.json`. Allowed: numbers, the x and slider names, `pi`, `e`, `+ - * / ^`, brackets, `sin cos tan exp ln log10 sqrt abs`, `min max`. No implicit multiplication; an expression is at most 200 characters and 32 levels deep.

The call's checks (`core::session::plot`) run on the call as sent, since the window draws the stored call, and return one line each:

- bounds and names, and a range too narrow for size of its numbers
- each formula
- each points line: 2 to 12 pairs of numbers, x rising, every x inside the x range and every y inside y range when one is given
- a formula with no value at more than a tenth of its 200 x by 20 slider points
- when no y range is given, one from the 2nd to 98th percentile of every formula value and point, refused when values run 20 times wider

A plot comes with a prediction `quiz` in the same reply, whose `onPlot: {line, x, slider?}` names the point it asks about. The before-tool-call hook (`agent::tools::lesson_parts`, check in `core::study::topic_parts::reply_parts_problems`) passes or refuses the two together:

- right option must name drawn value to 2 significant figures; on a points line, `x` is one of its measured x values and value is that point's y
- a topic has one plot
- while a question or problem waits for learner in stored record (`core::study::topic_parts::question_open`), plot comes alone, with no guess and no `hidden` line, and opens at once; its `details` have no `onPlot`. Its result ends turn, and window's `needsContinuation` owes nothing after it, so agent's next work is learner's next input. With nothing open, a plot with no guess is refused as before
- topic's previous reply may not carry a kept sentence learner saw; a page never holds a plot back

While a topic has no plot, its start carries the line "No plot yet in this topic. If its idea is a curve, open with `plot`.": the first topic's under the `[Study plan]`, every later one's after its `[Opener]` line (`core::study::topic_parts::NO_PLOT_YET`). Plots from earlier lessons are not looked up.

A drawn plot is named `p1`, `p2` in lesson order. Its result tells the agent its formula lines' values at the slider's start and every point of a points line, and ends the turn. Its `details` are `{part: "plot", v: 1, id, onPlot: {toolCallId, value}, y: {min, max}}`. The window recomputes the lines from the stored call, draws a points line as straight segments with a square on each point, shows no slider row when the plot has no slider, and never stores or sends the slider position. Until the guess is answered, the point it asks at on a shown points line is held back: no square, no segment to it, not in the screen-reader line (`heldBack` in `plot-part-model.ts`, from the guess's `onPlot` that `src/shared/core/plot-view.ts` joins onto the plot as `guessAt`).

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

### Homework sessions

A homework session (`kind: "homework"`, `deadlineId` required) works on one homework or project deadline's problems.

- "Work on <name>" starts one or reopens the latest (`POST /api/chats` with `homework: true`, `create_homework` in `services::turns::homework`). It is the filled key of a homework's or project's two keys (`DeadlineKeys`, `src/frontend/components/deadline/deadline-keys.tsx`) on its deadline page's Problems sheet, the Graph's deadline card and Progress's next deadline (there, under the deadline's name, they leave the name out: "Study" and "Work on it"); the Study page adds it after the deadline's Study key, and Today's card says "Work on it" while it shows it. The grey key before it, "Study for <name>" ("Continue studying for <name>" while a Study session is unfinished), is the deadline's Study; it hides once the date has passed. A homework lesson is never the deadline's Study session (`lesson_readout`, `services::graph::progress`), so Study never reopens it.
- It opens with space card and a `homework-context` marker: deadline, its assignment file (`assignmentFileId`), a track record line and problems posted before. The line sorts the deadline's topics with the Study rule (`deadline_topics_for`, `core::study::homework`): "Teach first" for untested topics and weak ones whose latest answer was wrong, "Open right away" for the rest. A deadline with no topics reads "none yet".
- Homework agent (`agent::tools::homework`, prompt `prompts/homework/` plus practice hint rules) posts assignment's problems onto deadline with `post_problems`.
- It opens one problem at a time with `problem`, which has no solution field: homework is hints only. `conclude` marks a problem done when learner's own work is right.
- On a go-ahead for a problem whose idea is under Teach first (or in no topic), the teacher first teaches its method once per lesson with a worked example on a different problem, then opens the problem in the same reply (`prompts/homework/00-base.md`). Asked in the teacher's terminal ("teach me this first"), it teaches the open problem's method and leaves the problem open.
- With no problem open, nothing waiting, the teacher idle, at least one teacher reply and a problem not done, the foot of the lesson text shows the key "Start problem N" (`GoAheadKey`, the same key and slot as practice's "Next problem" and study's "Continue", where the desk and Stop show while the teacher works (§7.1); none while a stop card is up). The Your turn sheet is not drawn when only that key waits. The key sends the `next` input, and the teacher opens the problem.
- Every problem in the plan row is a button (`homeworkRow`, `src/frontend/components/lesson/plan-row-model.ts`). A pick sends the `open` input with the problem's number, done or not; the lesson text shows "Start problem N" and a screen reader hears "Opening problem N". The server saves a `practice-next` marker with the number (`new_open_problem_message`) and refuses a number the deadline doesn't have, a pick while a question waits, and the problem already open. The teacher closes an open problem as moved on and opens the pick; a problem closed for a pick makes no long-problem stop (`picked_problem`, `core::study::homework`). A done problem opened again keeps its done mark and shows open with its check. The open problem's cell puts the cursor in the work box. While the teacher writes or a question waits, the other cells stay focusable and say why ("The teacher is writing.", "Waiting for Teacher" by the teacher's name, "Answer the question first.").
- The open problem draws its parts other than the one the teacher marked at 60% opacity (`otherParts`, `src/frontend/components/lesson/problem-parts.ts`). In a problem taller than the window the page rests on the marked part when it sits deep in the problem, under the lesson text or beside it. The open lesson has no head on the page: its title follows the lit space tab in the top bar, and its words sit on the bar's right (`lesson-bar.tsx`, through `top-bar/bar-slots.tsx`). The homework file's word there reads "file.pdf, page N"; no line repeats the deadline name, problem number or file. More opens the same lesson menu a Progress row has (`lesson-more.tsx`): Rename, Export as Markdown, Move to another space and Delete. A delete goes to the space's Progress page; a move reads the lesson's record again, so the top bar marks the new space.
- The top bar's pill has no Open button for the deadline whose lesson is the open page.
- Plan row names every problem over its bar (`homeworkProblems`, `src/shared/core/homework.ts`) once unfolded; folded it says "Problem 2a" and its title with a problem open (no title when it is only the number), or "1 of 14 done" with none open. Today's card says "2 of 7 problems done".

Homework is never extracted into the graph.
