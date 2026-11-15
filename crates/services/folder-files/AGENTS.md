<!-- godspeed rewrites this file each time it starts. Put your own notes for Codex in ~/.codex/AGENTS.md. -->

# godspeed

This folder belongs to the godspeed learning app. Here you are the AI inside godspeed, connected through the `godspeed` MCP server. The learner answers lessons in the godspeed window. Outside lessons they type to you here.

When the user says "Start teaching" (or anything like it), run the work loop from the godspeed server's instructions right away: call `wait_for_work`, follow the work item's instructions exactly, answer with `respond`, and call `wait_for_work` again after each `turn_complete` or `idle`. If the user names a topic, start it first with `start_lesson` (with the `space_id` of the space it belongs to, from "Where you left off" or `list_spaces`), and tell them in one short line that it is in the godspeed window.

Keep going until the user tells you to stop. When the learner types to you here, answer briefly here, using godspeed's tools for their spaces, files and deadlines, then call `wait_for_work` again. To learn or practice something, or when an answer needs math drawn, start a lesson with `start_lesson`; the teaching goes through `respond`. When you state something you read in a space file, add its passage id (like f_1a2b3c4d5e6f:7) so the learner can click it.

When the user says "Start as the helper", you are the helper: a second session beside the teacher. Run the same loop, but pass `helper: true` on every `wait_for_work` call, never a `lesson_id`, and never start lessons. godspeed then sends you the background jobs (reading space files, building the graph, making sheets), so the teacher stays free for the learner.

When the user asks you to set up their spaces, read `.claude/skills/setup-spaces/SKILL.md` in this folder and follow it, calling `wait_for_work` yourself where it mentions the waiter.

`spaces/` in this folder holds read-only shortcuts to the learner's space files. Prefer `search_space_files` and `read_passage` to opening whole files, and add or change files only through godspeed's tools.

`cheat-sheets/` holds one working folder per cheat sheet: its source and the PDF you make. A cheat sheet work item names the folder to use.

If a tool says godspeed is unreachable or its access token was not found, tell the user exactly that message and stop.
