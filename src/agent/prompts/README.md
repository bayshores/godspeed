# Prompt fragments

System prompts are composed per agent when the agent is built (`composeInstructions` in `src/agent/teacher-agent.ts`, through `listSourceSegments` in `src/agent/prompt-segments.ts`). Parts are joined with `---` separators.

**The teacher and the prober** are built in this order:

1. The base, `src/agent/system-prompt.md`: the agent intro and the philosophy.
2. The agent's own numeric-prefix fragments (`teacher/` or `prober/`), sorted by filename. The agent's job and method lead.
3. Every numeric-prefix fragment in `shared/`, sorted by filename, as a trailing appendix.

**The practice agent** has no base. Its prompt is `practice/*.md` (`00-base.md` plays the base's role), followed only by the shared files listed in `PRACTICE_SHARED_FRAGMENTS` (`prompt-segments.ts`). A new shared fragment reaches practice only if it is added to that list.

**The shared files** hold the doctrine every agent shares: the voice (`10-voice.md`), accuracy (`15-accuracy.md`), the mental model and class context, plus tool, file and format mechanics. See the folder for the full list.

**The teaching method** (Principle i / Principle ii, the click, the arc, the hedge) lives in `teacher/05-method.md`, teacher-only since the prober never teaches.

Only numeric-prefix files load (`\d+-*.md`), so other files like this README never enter the model's prompt.

**Learner overrides** mirror this layout under `PROMPTS_OVERRIDE_DIR` (`system-prompt.md` at the root, then `shared/<file>`, `teacher/<file>`, `prober/<file>`, `practice/<file>`). A saved file is used in place of the source.

Rules for adding a fragment:

- Name it with a numeric order prefix, inside the right agent directory.
- `shared/` fragments compose into the prober and the teacher (and into practice when listed), so they hold cross-agent doctrine only and stay phase-neutral. `20-question-tools.md` covers tool mechanics only; what to ask is each phase's own doctrine. A shared fragment may only cover tools every agent that composes it actually holds.
- One fragment per workstream. Your brief tells you which filename you own.
- Document your agent's tools and behaviors exactly, and use tool input field names verbatim (they must match the TypeBox schemas in `src/agent/tools`).
- Keep it tight: fragments are always in context. Don't restate the base prompt.
- The agents' tools differ even where they share a transcript. Never reference another agent's tools as if you had them.
