/**
 * The core's public API: the only module src/frontend may import (the import law, eslint.config.mjs).
 * Everything exported here is browser-safe: pure logic and types, no node builtins, no fs, no network.
 */

export * from "./contracts.ts";
export * from "./chains.ts";

export * from "./question-core.ts";
export * from "./code-question.ts";
// The event bus: vocabulary + emit/subscribe
// for every layer; the browser shell consumes the types + the runtime names
// through this barrel (shell law: pure core via @/shared/core only).
export * from "./events.ts";
export * from "./plan-tree.ts";
// The godspeed folder's agents (the "Open Claude Code" button).
export type { FolderAgent, OldSetup, StartCommands, StartTarget } from "./agent-folder.ts";
export * from "./phases.ts";
export * from "./pending.ts";
export * from "./tool-switches.ts";
export * from "./prompt-segments.ts";
export * from "./math-delims.ts";
// Source marks in teacher text.
export * from "./citations.ts";
// The native record (LhMessage) and the input-events contract — pure,
// browser-safe.
export * from "./native-messages.ts";
export * from "./today-note.ts";
export * from "./space-work.ts";
export * from "./compaction.ts";
export * from "./input-events.ts";
export * from "./attachments.ts";
// The client view model — the grouping canon (one continuous assistant
// document, step separators). Pure, browser-safe.
export * from "./view.ts";
export * from "./tool-parts.ts";
export * from "./answer-presentation.ts";
export * from "./prices.ts";
export * from "./context-usage.ts";
export * from "./cost-summary.ts";
export * from "./fuzzy.ts";
// settings.ts + settings-resolution.ts: the user-settings record's
// shape/sanitizer (pure) and its fully-resolved view. Browser-safe — the
// settings panel imports these directly.
export * from "./settings.ts";
// graph-deletion.ts is PURE but storage-port driven — the deletion RUNS
// server-side only. The shell needs only the ChatDeleteMode union (the
// delete dialog's options + the DELETE query param), hence this type-only
// re-export.
export type { ChatDeleteMode } from "./graph-deletion.ts";
export * from "./settings-resolution.ts";
export * from "./math-typing.ts";
export * from "./calculator.ts";
export * from "./file-series.ts";
export * from "./file-groups.ts";
export * from "./new-files.ts";
export * from "./linked-folder.ts";
export * from "./deadline-plan.ts";
export * from "./study.ts";
export * from "./continue-study.ts";
// Stops and openers: the state Today and the lesson window read.
export * from "./topic-end.ts";
export * from "./topic-parts.ts";
// Plot formulas: the grammar the server checks them with, and their typeset form.
export * from "./plot-expr.ts";
// The kept card a right answer to a quiz with a kept sentence shows.
export type { KeptCardData } from "./kept-view.ts";
export * from "./homework.ts";
export * from "./cheat-sheet.ts";
export * from "./prep.ts";
export * from "./mock.ts";
export { RUN_FILE, type ExampleRun, type RunOutcome } from "./mock-run.ts";
export type { SpaceChange } from "./space-tools.ts";
export * from "./teaching-areas.ts";
export * from "./agent-rules.ts";
export * from "./ink.ts";
export * from "./session-find.ts";
export * from "./session-navigation.ts";
// keyboard.ts: the shortcut registry + binding normalization (pure, browser-safe).
export * from "./keyboard.ts";
// Topics (the grouper's read/repair rules) and the derived progress
// numbers — pure, browser-safe.
export * from "./progress.ts";
export * from "./plan-step-bar.ts";
// changelog.ts: the release notes (src/shared/changelog.json)
// and the version math the "What's new" dialog uses. Pure, browser-safe.
export * from "./changelog.ts";
