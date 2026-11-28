# Features

Every feature a learner can use, and the control that reaches it. A feature is finished only when its Home is a control a learner can see before the feature exists. `tests/repo/features.test.ts` fails when a teacher tool, a key or a route is in no row, when a Home control is no longer in the code, or when a feature only the teacher makes is not proven drawn by a screen of `npm run layout`.

To add a row:

1. Name the feature in the app's own words, and the page it lives on.
2. Put the `data-testid` of the control that reaches it in Home. Write `none: <reason>` only when no such control exists.
3. Put the name of a screen in `scripts/layout-screens.mjs` that draws that control in Shown by. A feature only the teacher makes needs one.
4. Put the teacher tools, key actions and routes the feature is the home of in Covers, each in backticks.

| Column | Holds |
|---|---|
| Home | The control a learner can click or see before the feature exists. A block drawn only after the teacher made the thing is not a home. |
| Shown by | The exact name of a screen in `scripts/layout-screens.mjs` that draws the Home control. |
| Made by | `learner` when a control of the app makes the thing, `teacher` when only the teacher's tool call can. |
| Covers | Teacher tools (`crates/services/src/talk/tools.json`), key actions (`KEYBOARD_ACTIONS`) and routes (`src/frontend/routes/router.tsx`). |

## Features

| Feature | Page | Home | Shown by | Made by | Covers |
|---|---|---|---|---|---|
| Home | Home | `nav-home` | | learner | |
| Next deadline with its Start key | Home | `today-start` | | learner | |
| Study page | Study | `home-study-input` | | learner | `new`, `new-session` |
| Start a lesson from a typed topic | Study | `home-topic-input` | | learner | `start_lesson` |
| Add a space | Top bar, plus list | `spaces-plus` | Home, the plus list | learner | `create_space` |
| Switch between spaces | Top bar | `space-tabs` | | learner | |
| Edit a space's name and description | Space head, Edit space | `space-edit` | | learner | `update_space` |
| A space's signature, icon and color | Edit space | `space-edit` | | learner | |
| Rules for one space | Edit space | `space-edit` | | learner | |
| Close a space | Edit space | `space-close` | | learner | `update_space` |
| Reopen a closed space | Top bar, plus list | `spaces-plus` | The plus list with a closed space | learner | `update_space` |
| Delete a space | Edit space | `space-delete` | | learner | |
| Progress | Progress | `nav-progress` | | learner | `space` |
| Lessons on Progress | Progress | `lesson-record` | Progress | learner | `chat/:id` |
| Confidence against results | Progress | `overview-confidence` | | learner | |
| The deadline after the next one, on the next deadline's card | Progress | `next-deadline-next` | Progress with a homework next | learner | |
| Most needed topic | Progress | `most-needed` | | learner | |
| Teacher's note | Progress | none: drawn only after the teacher wrote one | | teacher | |
| Path to a goal | Progress | `space-start-path` | Progress, a new space | teacher | |
| Files | Files | `nav-files` | | learner | `space/files` |
| Add or drop files | Files | `space-add-files` | | learner | `add_space_file` |
| Link a folder | Files | `space-pick-folder` | | learner | `link_space_folder` |
| Re-link or unlink a folder | Files, linked folder | `space-unlink-folder` | | learner | `unlink_space_folder` |
| Show a space's shortcuts in Finder | Files | `files-show-shortcuts` | | learner | |
| Move, retry, remove or show a file | Files, a file's More menu | `files-list` | Files | learner | `set_space_file_kind` |
| Find a file by name | Files | `files-find` | Files, Find open | learner | |
| Pick files, then Study | Files | `files-pick` | Files, picking files | learner | |
| Search inside files | Files | `files-ask-inside` | Files, nothing found | teacher | `search_space_files` |
| Graph | Graph | `nav-graph` | | learner | `graph`, `jump-graph` |
| Find on the Graph | Graph | `graph-find` | Graph, Find open | learner | |
| Topic and fact panels | Graph | `graph-topic` | Graph, a topic picked | learner | |
| All facts table | Graph | `open-chain-table` | | learner | |
| Delete facts | Graph, All facts | `chain-delete` | | learner | |
| Import notes | Graph | `import-notes` | | learner | `import_notes` |
| Graph zoom and pan | Graph | none: scroll, pinch or drag only | | learner | |
| Deadlines | Deadlines | `nav-deadlines` | | learner | `space/deadlines` |
| Add a deadline | Home, Deadlines | `home-add-deadline` | Home, the Add deadline menu | learner | `add_space_deadline` |
| A card when a space looks to be missing a deadline | Any page | `gap-notice` | Files while the top bar asks about a missing deadline | learner | |
| The outline of a deadline that looks missing, in the week, which opens in the card above | Home | `week-gap` | Home with the outline of a missing deadline | learner | |
| The outline of a deadline that looks missing, among the rows | Deadlines | `gap-row` | Deadlines with the outline of a missing deadline | learner | |
| Ask the teacher to update a space | Deadlines | `deadlines-update` | Deadlines, the key that asks the teacher to update | learner | |
| A deadline's page | Deadline | `deadline-open` | Deadlines | learner | `space/deadline/:id` |
| Edit a deadline | Deadline | `deadline-edit` | | learner | `update_space_deadline` |
| Mark a deadline done | Home | `today-done` | | learner | |
| Remove a deadline | Edit deadline | `deadline-remove` | | learner | `remove_space_deadline` |
| What a deadline covers and leaves out | Deadline | `deadline-edit-files` | | learner | |
| Ask the teacher to check what a deadline covers | Deadline | `deadline-ask` | | learner | |
| Study for a deadline | Deadline | `deadline-study` | | learner | |
| Homework problems | Deadline, a lesson | `deadline-work` | Homework deadline with its two keys | learner | |
| Study guide for an interview | Deadline | none: the key shows only for an interview with nothing to plan from, and no layout screen draws it | | teacher | |
| What it's like file | Deadline | none: drawn only after the teacher linked the file | | teacher | |
| Mock exams | Deadline, a mock | `deadline-mock-take` | | learner | `space/mock/:spaceId/:mockId` |
| Make a cheat sheet | Cheat sheet | `cheat-sheet-empty` | Cheat sheet, not made | teacher | |
| Open a cheat sheet | Deadline, a lesson | `deadline-cheat-sheet` | | learner | `space/deadline/:id/cheat-sheet` |
| Cheat sheet beside a lesson | Lesson | `lesson-cheat-sheet` | Lesson with a quiz and the cheat sheet docked | learner | |
| Write to the teacher in a lesson, in the writing row at the window's foot: a question, or while it writes, what to focus on, with Stop at the row's end | Lesson | `composer` | | learner | |
| The desk: while the teacher works on a reply, in the lesson text with no box, one sentence on what it does, its steps (its own web searches and file reads too) and the page of the file it reads as a sheet of paper, with no paper of its own while the open problem's sheet is on the page; its steps stay until the reply is finished, and in a wide window the page lies under the words at the left while the steps rest on the writing row at the right | Lesson | `agent-at-work` | Lesson whose first reply the teacher works on | learner | |
| The teacher's reply, written into the lesson as it comes | Lesson | `composer` | | learner | |
| Allow or Deny what the teacher wants to run (a command, a file change, a web page), on a card on the desk, or under a cheat sheet's working line while the teacher works on it | Lesson; Cheat sheet | `agent-at-work` | Lesson whose first reply the teacher works on | teacher | |
| Stuck keys, over the writing row while a question or problem waits | Lesson | `help-hint` | | learner | |
| As printed: a problem shown as its PDF page turns into the page's own white paper, at the end of the step line | Lesson | `piece-printed` | Homework lesson with a problem's page as printed | learner | |
| Whole problem: a long problem pinned over the lesson text in a room under 1000 points wide folds, and one key on its plate opens it and folds it again | Lesson | `turn-whole` | Lesson with a long problem folded over the text | learner | |
| A figure the teacher draws under its reply, in the theme's colors ("Draw it" asks for one) | Lesson | `lesson-idea` | Homework lesson with a figure under the method | teacher | |
| Answer a question with the keyboard | Lesson | `question-option` | | learner | `question-focus`, `question-next-row`, `question-prev-row`, `question-pick-row`, `question-submit`, `question-pick-number` |
| Rename a lesson | Lesson | `lesson-title` | Lesson with a 40-letter title among five open spaces | learner | `rename-session` |
| Lesson menu: skip the waiting question or discard the open problem (its first line, in an open lesson), export, move, stats, delete | Lesson, Progress | `lesson-more` | Lesson, its menu | learner | |
| Find in a lesson | Lesson | `lesson-find` | Lesson with Find open in the bar | learner | `find` |
| Document panel | Lesson | `lesson-document` | Lesson on files with the Document panel open | learner | |
| Attach pictures or PDFs | Lesson; Teacher panel | `attach-button` | | learner | |
| Your thinking in a lesson | Lesson | none: ⌘T shows or hides all of it; a single row's own key shows only on that row | | learner | `toggle-user-thinking` |
| Search lessons | Menu | `menu-search-lessons` | | learner | `sessions-search` |
| Calculator | Any writing box | `menu-shortcuts` | Home, the keyboard shortcuts list | learner | `calculator-keep` |
| A plugin's lesson word and space tab | Lesson, space tabs | `plugins-add` | Settings, Plugins, Add | learner | `space/plugin/:id` |
| Teacher's strip | Right edge | `strip` | | learner | |
| Chat with the teacher outside lessons: its reply written as it comes, its steps and Allow cards in the chat, Stop by Send | Teacher panel, on every page but a lesson and a cheat sheet | `talk-try` | Teacher chat, a new chat | learner | |
| A chat's model, by Send | Teacher panel | `talk-model` | Teacher chat, its model list | learner | |
| On a lesson or cheat sheet page, the panel is Activity alone, with Stop for a panel chat still writing; its chat shows there only for an Allow card of its own | Teacher panel | `activity-list` | Teacher's panel beside a lesson | learner | |
| Chats list | Teacher panel, on every page but a lesson and a cheat sheet | `teacher-panel-chats` | Teacher's chats under the Chats key | learner | |
| Follow: its slip at the page's foot saying what the teacher does and listing its steps (its own web searches, file reads and commands too), what it changed staying lit, and the teacher opening pages | Teacher panel; the slip on every page but a lesson, a mock and a cheat sheet | `follow-start` | | learner | `open_page` |
| Pop out the teacher's chat into its own window, and Put back | Teacher panel, on every page but a lesson and a cheat sheet | `teacher-panel-pop-out` | | learner | `chat-window` |
| Try asking | Teacher panel | `talk-try` | | learner | |
| Everything the teacher can do | Teacher panel | `talk-all-ideas` | | learner | |
| Activity and graph costs | Teacher panel | `teacher-panel-activity` | Teacher's Activity | learner | |
| Saved rules | Settings, Teaching | `area-detail` | | learner | `save_rule` |
| Delete a remembered note | Settings, Teaching | `remembered-notes` | | learner | `forget` |
| Notes in Obsidian or a notes folder | Settings, General; Progress; lesson end; Graph | `vault-pick` | Settings, General | teacher | `write_vault_note`, `search_vault` |
| Add a remembered note | Settings, Teaching | none: only the teacher adds one; you can only delete | | teacher | `remember` |
| Settings | Menu | `settings-entry` | | learner | `settings`, `open-settings` |
| Pick the teacher's agent and model, and see whether it can teach | Settings, Teacher; onboarding | `agent-card` | Settings, Teacher | learner | |
| While the agent can't run, the panel's box place says why, with the key that fixes it and the other agent | Teacher panel | `panel-setup` | Teacher's panel while the agent isn't logged in | learner | |
| Log in to the agent | Settings, Teacher, and the card wherever it shows | `agent-row-account` | Settings, Teacher, logged out | learner | |
| Update the agent | Settings, Teacher, and the card wherever it shows | `agent-row-version` | Settings, Teacher, too old | learner | |
| Teacher name | Settings, Teacher | `teacher-name-row` | Settings, Teacher | learner | |
| Sounds | Settings, General | `group-sounds` | Settings, General | learner | |
| Noise: soft brown noise to study to, on and off with one word, hidden while Sounds is off | Top bar | `noise-word` | Home with Sounds on, Noise in the top bar | learner | |
| Deadline reminders | Settings, General | `deadline-reminders-row` | | learner | |
| Menu bar countdown | Settings, General | `menu-bar-countdown-row` | | learner | |
| Updates | Settings, General | `update-check` | | learner | |
| Release notes | Settings, General | `release-notes` | | learner | |
| Report a bug | Settings, General, Mac Help menu | `report-bug` | | learner | |
| Background | Settings, Appearance | `group-background` | | learner | |
| Reading font | Settings, Appearance | `font-trigger` | Settings, Appearance, the font list | learner | |
| Text size | Settings, Appearance | `slider-text-size` | | learner | |
| App icon | Settings, Appearance | `group-app-icon` | | learner | |
| Teaching areas and switches | Settings, Teaching | `area-detail` | | learner | |
| Quiz style | Settings, Teaching | `quiz-style` | | learner | |
| Edit full instructions | Settings, Teaching | `area-detail` | | learner | |
| Web search key | Settings, Teaching | `web-search` | | learner | |
| Teacher folder and start command | Settings, Teacher | `agent-folder-change` | | learner | |
| Welcome screen | First launch | `welcome-go` | | learner | |
| Onboarding | First launch | `onboarding-intro` | Onboarding | learner | |
| Page magnifier | Any page | `menu-shortcuts` | Home, the keyboard shortcuts list | learner | `page-magnify` |
| Keyboard shortcuts list | Menu | `menu-shortcuts` | | learner | `shortcuts` |
| Back and Forward | Mac Go menu | none: the Mac menu and ⌘[ and ⌘] only | | learner | |
| Open godspeed Folder | Mac File menu | none: the Mac menu only | | learner | |
| A page that is gone | Any address | none: shown for an address that is no page, not a feature | | learner | `*` |
| The agent's own tools | None | none: not a learner feature | | teacher | `list_lessons`, `read_lesson`, `list_spaces`, `read_space`, `read_passage`, `search_graph` |

## Upgrade code

Code that only upgrades older installs. Remove it when its last row no longer applies.

| Code | What it does | Goes when |
|---|---|---|
| `crates/services/src/app/old_talk.rs` | Exports the old Talk chat once, as `Talk.md` in the godspeed folder. | Nobody updates from 0.6.6 or older. |
| `crates/services/src/app/old_setup.rs` and `src/frontend/components/agent-folder/folder-notice.tsx` | Remove the old Claude Code plugin and the Codex server block, and offer to set up the godspeed folder. | Nobody updates from before 0.5.8. |
| `crates/shell/src/first_run.rs` | On the first launch after the Electron app, backs up the data once and removes what Electron left. | Nobody updates from the Electron app (before 0.6.1). |
| `crates/core/src/spaces/prep_upgrade.rs` | Turns a space saved as a prep into a normal space with a study guide, an interview deadline and its mocks. | Nobody updates from 0.6.5 or older. |
