/**
 * THE CORE PUBLIC API — the only module the shell (src/app/, src/frontend/components/) may
 * import. Everything exported here is browser-safe: pure logic + types,
 * no node builtins, no fs, no network.
 *
 * Server-side surfaces (chat streaming, store reads) live behind
 * src/backend/server's barrel instead — the import law (eslint.config.mjs):
 *
 *   src/frontend/components/**  →  "@/shared/core"        (this barrel, ONLY)
 *   src/app/**         →  "@/shared/core" + "@/backend/server"
 *
 * Server-only core modules (core/graph.ts emission/derivation) are pure
 * but need storage ports passed in by a server caller, so they are
 * deliberately NOT re-exported here — the server imports them directly.
 * The storage PORT TYPES are types-only and browser-safe, hence re-exported.
 */

export * from "./contracts.ts";
export * from "./ports.ts";
export * from "./chains.ts";

export * from "./question-core.ts";
export * from "./code-question.ts";
// The event bus: vocabulary + emit/subscribe
// for every layer; the browser shell consumes the types + the runtime names
// through this barrel (shell law: pure core via @/shared/core only).
export * from "./events.ts";
// clusters.ts is deliberately NOT re-exported: the snapshot carries the
// partition from the server.
export * from "./plan-tree.ts";
// The godspeed folder's agents (the "Open Claude Code" button).
export type { FolderAgent, OldSetup, StartCommands, StartTarget } from "./agent-folder.ts";
export * from "./phases.ts";
export * from "./pending.ts";
export * from "./tool-switches.ts";
export * from "./prompt-segments.ts";
export * from "./math-delims.ts";
// The native record (LhMessage) and the input-events contract — pure,
// browser-safe.
export * from "./native-messages.ts";
export * from "./today-note.ts";
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
export * from "./homework.ts";
export * from "./cheat-sheet.ts";
export type { ClassChange } from "./class-tools.ts";
export * from "./teaching-areas.ts";
export * from "./agent-rules.ts";
export * from "./ink.ts";
export * from "./session-find.ts";
export * from "./session-navigation.ts";
// keyboard.ts: the shortcut registry + binding normalization (pure, browser-safe).
export * from "./keyboard.ts";
// coverage.ts is server-only (node:crypto); its callers import it directly.
// Topics (the grouper's read/repair rules) and the derived progress
// numbers — pure, browser-safe.
export * from "./topics.ts";
export * from "./progress.ts";
export * from "./plan-step-bar.ts";
// session-markdown.ts: session to markdown, used by the markdown export
// and the MCP read_lesson tool. Pure, browser-safe.
export * from "./session-markdown.ts";
// changelog.ts: the release notes (src/shared/changelog.json)
// and the version math the "What's new" dialog uses. Pure, browser-safe.
export * from "./changelog.ts";
