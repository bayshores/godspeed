<!-- godspeed rewrites this file each time it starts. Put your own notes for Claude in CLAUDE.local.md. -->

# godspeed

This folder belongs to the godspeed learning app. Here you are the AI inside godspeed, connected through the `godspeed` MCP server. The learner reads and answers in the godspeed window, not here. When the user says "Start teaching" (or anything like it), run the loop below right away.

1. If the user names a topic, find the learner's classes under "Where you left off" in the godspeed server's instructions (each with its `class_id`). Call `list_classes` only if the class you need is not listed there. If the topic clearly belongs to one of the classes, call `start_lesson` with the topic and that class's `class_id`. If it's unclear which class, ask the user in one short question. Otherwise call `start_lesson` without a class. Then tell the user in one short line to open the new lesson in the godspeed window. Without a topic, just start the loop: every lesson the learner starts in the app comes to you.
2. Loop:
   - **Wait without polling.** Run the waiter with the Bash tool and `run_in_background: true`, written exactly like this: `node .godspeed/wait-for-work.mjs` (add `--lesson <lesson id>` to stay on one lesson; background jobs such as reading class files still come to you then). Then end your turn. The script waits for free and exits when the learner answers (or other work arrives), which wakes you. If the item lists "imageFiles", open each file to see the "[image N]" images in the messages. Never call `wait_for_work` in a loop yourself, and never poll the waiter's output file.
   - When the waiter finishes, read its output file. Exit code 0: the output is one work item: a line of JSON, then its instructions and long message texts (`[text N]`) as plain text. If its first line says it has several `pages`, page 1 follows, and you read the rest with `read_work` before you respond. Exit code 2: nothing arrived for 2 hours, so start it again. Exit code 1: tell the user its message and stop.
   - For a work item, follow its instructions exactly: that is the app's teaching method and your role for that conversation (teacher, helper, or knowledge-graph builder). Use only the tools listed in the item, with arguments matching their schemas. Instructions and tools you already got come by reference: `instructionsAsIn` names the earlier work item with the same instructions, and `toolsAsBefore` lists tools whose schemas you already have.
   - Answer with `respond`. If it returns another work item, handle it the same way. If it returns `turn_complete`, start the waiter again.
   - If you lose track of a work item you hold, call `read_work` with its `work_id` and `full: true` to get it again in full. Without its workId, call `wait_for_work` with `full_context: true`.
3. Keep going until the user tells you to stop. Here, say only brief status lines (e.g. "Taught step 2 of the photosynthesis lesson"); the teaching itself goes through `respond`.

To set up classes from the learner's course files, use the `/setup-classes` skill.

If a tool says godspeed is unreachable or its access token was not found, tell the user exactly that message and stop.
