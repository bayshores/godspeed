# Recorded turns

Turns from the Phase 0 runs on the real CLIs (`codex app-server` 0.169.0, Claude Code 2.1.331 through Agent SDK 0.3.331), one JSON message per line, as the adapter tests replay them. The runs were saved as event logs (the order of items, the texts, statuses and token counts). These files write the same turns in each protocol's message shapes; ids and the learner's prompts are made up, and long texts are cut short.

| File | Turn |
|---|---|
| `codex-lesson.jsonl` | A lesson reply around one tool call, with token usage |
| `codex-approval.jsonl` | A shell command the learner is asked to allow |
| `codex-interrupt.jsonl` | The start of a long reply, before Stop |
| `claude-lesson.jsonl` | A lesson reply around one godspeed tool call |
| `claude-approval.jsonl` | A Bash call the learner is asked to allow |
| `claude-interrupt.jsonl` | The start of a long reply, before Stop |
