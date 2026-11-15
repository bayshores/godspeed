# Prompt fragments

System prompts are composed per agent when the agent is built (`compose_instructions` in `crates/agent/src/teacher/teacher_agent.rs`, through `crates/agent/src/teacher/prompt_segments.rs`). Parts are joined with `---` separators.

**The teacher and the prober** are built in this order:

1. The base, `system-prompt.md` in this folder: the agent intro and the philosophy.
2. The agent's own numeric-prefix fragments (`teacher/` or `prober/`), sorted by filename. The agent's job and method lead.
3. Every numeric-prefix fragment in `shared/`, sorted by filename, as a trailing appendix.

**The practice agent** has no base. Its prompt is `practice/*.md` (`00-base.md` plays the base's role), followed only by the shared files listed in `PRACTICE_SHARED` (`prompt_segments.rs`). A new shared fragment reaches practice only if it is added to that list.

**The homework agent** (working on one assignment's problems, hints only) has no base either: `homework/*.md`, then practice's `20-hints.md`, then the same shared files as practice.

**The study agent** is the teacher's parts except `10-planning.md`, then practice's `20-hints.md`, then `study/*.md`, then every shared file except `14-deadline-changes.md` (both in `STUDY_SKIPPED`). Study plans from its [Study plan] note, has no deadline tools, and `study/10-study.md` sends deadline changes to the terminal, outside lessons.

**The shared files** hold the doctrine every agent shares: the voice (`10-voice.md`), the learner's question first (`11-learner-first.md`), source marks (`13-source-marks.md`, also in `PRACTICE_SHARED`), deadline changes mid-lesson (`14-deadline-changes.md`, read by the teacher, the prober, practice and homework, not by Study), accuracy (`15-accuracy.md`), the mental model and space context, plus tool, file and format mechanics. See the folder for the full list.

**The teaching method** (Principle i / Principle ii, the click, the arc, the hedge) lives in `teacher/05-method.md`, teacher-only since the prober never teaches.

**After the fragments**, every agent's system prompt gets two optional parts, in this order (`teacher_agent.rs`):

1. One note naming the tools the learner switched off in Settings (`switched_off_tools_note` in `crates/core/src/session/tool_switches.rs`), so the model doesn't plan around a tool the fragments still mention. Each agent's note covers only the switchable tools it carries (`switches` in `teacher_agent.rs`): the teacher can lose `research`, `demo`, `visual` and `pdf`; the prober, practice and homework can lose `research` and `pdf`. No tool off, no note.
2. The learner's teaching rules (`learner_rules_section` in `crates/core/src/records/teaching_areas.rs`).

Only numeric-prefix files load (`\d+-*.md`), so other files like this README never enter the model's prompt.

**Learner overrides** mirror this layout under the `prompts` folder of the data folder (`system-prompt.md` at the root, then `shared/<file>`, `teacher/<file>`, `prober/<file>`, `practice/<file>`, `homework/<file>`, `study/<file>`). A saved file is used in place of the source.

Rules for adding a fragment:

- Name it with a numeric order prefix, inside the right agent directory.
- `shared/` fragments compose into the prober and the teacher (and into practice when listed), so they hold cross-agent doctrine only and stay phase-neutral. `20-question-tools.md` covers tool mechanics only; what to ask is each phase's own doctrine. A shared fragment may only cover tools every agent that composes it actually holds.
- One fragment per workstream. Your brief tells you which filename you own.
- Document your agent's tools and behaviors exactly, and use tool input field names verbatim (they must match the tool schemas in `crates/agent/src/tools`).
- Keep it tight: fragments are always in context. Don't restate the base prompt. Write in the short style the others use (no articles or filler, fragments are fine); `system-prompt.md`, `practice/00-base.md` and `homework/00-base.md` open by telling the agent to write to the learner in full sentences. Rules about the teacher's tone, praise and reading level, and quoted examples of how the teacher sounds, stay in full sentences.
- The agents' tools differ even where they share a transcript. Never reference another agent's tools as if you had them.
