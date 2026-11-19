import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { BootInfo } from "@/shared/core";
import { getJson } from "@/frontend/lib/api";

/**
 * What the window reads before its first paint (GET /api/boot): onboarding,
 * the welcome screen, What's new, the active space, the spaces, the
 * teacher's name, sounds and the saved look. Read once per page load; `refresh` reads it
 * again (onboarding finishing).
 */

/** What the app shows when the server couldn't answer: the app, No space. */
const UNREAD: BootInfo = { onboarding: false, firstLoad: null, whatsNewSince: null, folderNotice: null, activeSpace: null, startupSound: true, sounds: true };

declare global {
	interface Window {
		/** The first /api/boot answer, asked for by index.html before the app's code loads; null when it failed. */
		bootRequest?: Promise<BootInfo | null>;
	}
}

/** The boot answer: `early` is the page's own first request, when it has one. */
export async function fetchBoot(early?: Promise<BootInfo | null>): Promise<BootInfo> {
	return (await (early ?? getJson<BootInfo>("/api/boot").then((read) => read.body))) ?? UNREAD;
}

/** The welcome screen covers this page load. */
export function showsWelcome(boot: BootInfo): boolean {
	return boot.firstLoad === "welcome" && !boot.onboarding;
}

const BootContext = createContext<{ boot: BootInfo; refresh: () => Promise<void> } | null>(null);

export function BootProvider({ initial, children }: { initial: BootInfo; children: ReactNode }) {
	const [boot, setBoot] = useState(initial);
	const refresh = useCallback(async () => setBoot(await fetchBoot()), []);
	const value = useMemo(() => ({ boot, refresh }), [boot, refresh]);
	return <BootContext.Provider value={value}>{children}</BootContext.Provider>;
}

export function useBoot(): { boot: BootInfo; refresh: () => Promise<void> } {
	const value = useContext(BootContext);
	if (!value) throw new Error("useBoot needs a BootProvider");
	return value;
}
