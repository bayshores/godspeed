/**
 * THE SERVER-SIDE SURFACE — the only src module (besides the core barrel)
 * that src/app/ may import. Route handlers and server components come through
 * here; nothing under src/app/ touches src/store or src/agent directly.
 */

export * from "./chat-handler.ts";
export * from "./events-stream.ts";
export * from "./chats.ts";
export * from "./classes.ts";
export { classCardFor, applyClassCard } from "./class-card.ts";
export { createLesson, type CreateLessonInput } from "./lessons.ts";
export * from "./graph.ts";
export * from "./topics.ts";
export * from "./progress.ts";
export { NotesImportError } from "../agent/subagents/extraction.ts";
export * from "./jobs.ts";
export * from "./stores.ts";
// The settings record + prompt overrides (settings-storage wave, 2026-09-19).
// The *Record aliases keep the src/app/api/settings routes explicit about which
// seam they touch (the raw record, not the chat-section convenience view).
export {
	readSettings as readSettingsRecord,
	writeSettings as writeSettingsRecord,
	settingsStore,
} from "../store/settings.ts";
export { promptOverrides } from "../store/prompt-overrides.ts";
export { onboardingNeeded } from "./onboarding.ts";
export { isValidSegmentPath } from "../core/prompt-segments.ts";
// The canonical segment discovery/resolution lives in the agent layer
// (composition is an agent concern); the barrel re-exports it for the
// routes — server→agent is the lawful direction (chat-handler precedent).
export { effectivePromptSegments, allSegmentPaths, readPromptOverride } from "../agent/prompt-segments.ts";

export * from "./settings-body.ts";
export * from "./turn-liveness.ts";
export * from "./turn-runs.ts";
export * from "./dismissal-park.ts";
export * from "./compaction.ts";
export { runPiTurn, piTurnResponse, type PiTurnHandle, type PiTurnSpec } from "./pi/ui-stream.ts";
export * from "./observability.ts";
export { sessionCost } from "./pricing.ts";

export { handleMcpRequest, mcpAccessStatus, ensureMcpAccess, rotateMcpToken } from "./mcp.ts";
