/**
 * THE SERVER-SIDE SURFACE — the only src module (besides the core barrel)
 * that src/app/ may import. Route handlers and server components come through
 * here; nothing under src/app/ touches src/backend/store or src/backend/agent directly.
 */

export * from "./chat-handler.ts";
export { extraction } from "./extraction.ts";
export * from "./events-stream.ts";
export * from "./chats.ts";
export * from "./spaces.ts";
export { spaceFilePath } from "./space-card.ts";
export { createLesson } from "./lessons.ts";
export { createHomework, homeworkView } from "./homework.ts";
export * from "./graph.ts";
export * from "./topics.ts";
export * from "./progress.ts";
export { NotesImportError } from "../agent/subagents/extraction.ts";
export * from "./jobs.ts";
export * from "./stores.ts";
// The settings record + prompt overrides.
// The *Record aliases keep the src/app/api/settings routes explicit about which
// seam they touch (the raw record, not the chat-section convenience view).
export {
	readSettings as readSettingsRecord,
	writeSettings as writeSettingsRecord,
	settingsStore,
} from "../store/settings.ts";
export { promptOverrides } from "../store/prompt-overrides.ts";
export { isValidSegmentPath } from "../../shared/core/prompt-segments.ts";
// The canonical segment discovery/resolution lives in the agent layer
// (composition is an agent concern); the barrel re-exports it for the
// routes — server→agent is the lawful direction (chat-handler precedent).
export { effectivePromptSegments, allSegmentPaths } from "../agent/prompt-segments.ts";

export * from "./settings-body.ts";
export * from "./turn-liveness.ts";
export * from "./turn-runs.ts";
export * from "./dismissal-park.ts";
export * from "./compaction.ts";
export { piTurnResponse } from "./pi/ui-stream.ts";
export * from "./observability.ts";
export { recentAgentActions, recordDeadlineChange } from "./agent-actions.ts";
export { readingDocument, readingPdfPage } from "./reading-pages.ts";
export { citedPage, citedPassage } from "./citations.ts";

export { AgentFolderError, agentFolderView, spaceShortcutDir, dismissFolderNotice, setStartCommand, setUpAgentFolder, shortcutPathProblem } from "./agent-folder.ts";
export { removeOldSetup } from "./old-setup.ts";
export { handleAgentCompacting, handleAgentForget, handleMcpRequest, mcpAccessStatus, rotateMcpToken } from "./mcp.ts";
export { agentNotesView, removeAgentNote } from "./agent-memory.ts";
export { agentSavedRules, editRule, removeRule } from "./agent-rules.ts";
export { clearTalk, openTalk } from "./talk.ts";
export { askAboutNewDeadlines } from "./agent-catch-up.ts";
export { askCheatSheet, cheatSheetFile, cheatSheetPdf, cheatSheetView, spaceSheetsView, removeSheetRule, retryCheatSheet, sheetPdfFile, stopCheatSheet } from "./cheat-sheets.ts";
export { pdfjsAsset } from "./pdfjs-assets.ts";
