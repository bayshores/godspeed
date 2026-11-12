/**
 * GET /api/boot: what the window reads on each page load before its first
 * paint. Asking also does what a page load does: it decides onboarding and
 * makes the MCP token, records the version for "What's new", refreshes the
 * godspeed folder (once per start) and uses up this server's welcome screen.
 * Kept light: only modules with no heavy imports (no agent engine, MCP or
 * extraction), so the first paint doesn't wait for the whole server to load.
 */
import type { BootInfo } from "../../shared/core/contracts.ts";
import { spaceStore } from "../store/spaces.ts";
import { readSettings } from "../store/settings.ts";
import { folderNoticeAgent, refreshAgentFolder } from "./agent-folder.ts";
import { onboardingNeeded } from "./onboarding.ts";
import { firstLoadScreen } from "./welcome.ts";
import { whatsNewSince } from "./whats-new.ts";

export function bootInfo(): BootInfo {
	let onboarding = false;
	try {
		onboarding = onboardingNeeded();
	} catch {
		/* unwritable data dir: show the app; /api/mcp retries the token */
	}
	// Decided after onboarding, which marks existing users.
	let whatsNew: string | null = null;
	try {
		whatsNew = whatsNewSince();
	} catch {
		/* unwritable data dir: skip the notes this launch */
	}
	refreshAgentFolder();
	// The move notice waits for a launch without onboarding or "What's new".
	let folderNotice: BootInfo["folderNotice"] = null;
	try {
		folderNotice = !onboarding && !whatsNew ? folderNoticeAgent() : null;
	} catch {
		/* unreadable data dir: ask next launch */
	}
	// Asked even during onboarding, so finishing it doesn't open the welcome
	// screen right after "You're all set".
	const firstLoad = firstLoadScreen();
	const boot: BootInfo = { onboarding, firstLoad, whatsNewSince: whatsNew, folderNotice, activeSpace: null, sounds: true };
	try {
		const record = readSettings();
		const general = record?.general;
		const raw = general?.activeSpace;
		// A space deleted behind the app's back falls back to No space.
		boot.activeSpace = raw && raw !== "none" && spaceStore.getSpace(raw) ? raw : null;
		boot.spaces = spaceStore.listSpaces();
		boot.teacherName = general?.teacherName;
		boot.sounds = general?.sounds !== false;
		boot.appearance = record?.appearance;
	} catch {
		/* unreadable settings: No space */
	}
	return boot;
}
