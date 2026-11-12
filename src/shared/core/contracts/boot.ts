import type { FolderAgent } from "../agent-folder.ts";
import type { AppearanceSettings } from "../settings.ts";
import type { SpaceSummary } from "./space.ts";

/** GET /api/boot: what the window needs before its first paint. */
export interface BootInfo {
	/** First launch: the onboarding replaces the app until it is finished. */
	onboarding: boolean;
	/** "welcome" on this server's first page load, "restarted" after a crash restart, then null. */
	firstLoad: "welcome" | "restarted" | null;
	/** The version whose release notes the learner saw last, when newer ones are waiting. */
	whatsNewSince: string | null;
	/** Set up the old way (plugin or Codex config): asked once to move to the godspeed folder. */
	folderNotice: FolderAgent | null;
	/** The space the app opens in; null is No space. */
	activeSpace: string | null;
	/** Missing when the space list couldn't be read: the app reads it after mount. */
	spaces?: SpaceSummary[];
	/** The teacher's name (Settings, General); missing means the default. */
	teacherName?: string;
	sounds: boolean;
	/** The saved look, so the first paint already has its colors; missing means the defaults. */
	appearance?: AppearanceSettings;
}
