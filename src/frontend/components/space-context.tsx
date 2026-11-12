"use client";

/**
 * THE ACTIVE SPACE: the space the space pages show (its lessons, files and
 * graph), where new lessons start and where the Graph's Add files imports.
 * null = lessons with no space.
 *
 * Persisted in settings.json (general.activeSpace) so it survives restarts;
 * the server renders the first value (no flash of the wrong graph). The
 * space list refreshes on the server's "spaces-changed" event.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { SpaceSummary } from "@/shared/core";
import { useServerEvent } from "@/frontend/components/server-events";
import { notifySettingsSaved } from "@/frontend/components/settings-signal";

interface SpacesState {
	/** Every space, archived included (most recently updated first). */
	spaces: SpaceSummary[];
	/** False until the first read of the space list finishes. */
	loaded: boolean;
	/** The active space id, or null for "No space". */
	active: string | null;
	/** The active space's summary (null for "No space"). */
	activeSpace: SpaceSummary | null;
	/** Switch the window to a space (null = No space). */
	setActive: (id: string | null) => void;
	/** Re-read the space list now. */
	refresh: () => Promise<void>;
}

const SpacesContext = createContext<SpacesState | null>(null);

/** "?space=<id|none>" for a scope — every space-aware fetch appends it. */
export function spaceQuery(active: string | null, joiner: "?" | "&" = "?"): string {
	return `${joiner}space=${encodeURIComponent(active ?? "none")}`;
}

/** A display name for a scope. */
export function spaceName(spaces: readonly SpaceSummary[], id: string | null | undefined): string {
	if (!id) return "No space";
	return spaces.find((c) => c.id === id)?.name ?? "Unknown space";
}

export function SpaceProvider({
	children,
	initialActive,
	initialSpaces,
}: {
	children: ReactNode;
	initialActive: string | null;
	/** The space list read while the page rendered, so the first paint has
	 *  the space's name and nav (undefined: read it after mount). */
	initialSpaces?: SpaceSummary[];
}) {
	const [spaces, setSpaces] = useState<SpaceSummary[]>(initialSpaces ?? []);
	const [loaded, setLoaded] = useState(initialSpaces !== undefined);
	const [active, setActiveState] = useState<string | null>(initialActive);
	// Follow the server's value when it changes on a refresh (e.g. onboarding
	// finishing with a new space), without overriding client switches.
	const [serverActive, setServerActive] = useState(initialActive);
	if (initialActive !== serverActive) {
		setServerActive(initialActive);
		setActiveState(initialActive);
	}

	const refresh = useCallback(async () => {
		try {
			const res = await fetch("/api/spaces", { cache: "no-store" });
			if (!res.ok) return;
			const body = (await res.json()) as { spaces?: SpaceSummary[] };
			setSpaces(Array.isArray(body.spaces) ? body.spaces : []);
		} catch {
			/* offline: keep what we have */
		} finally {
			setLoaded(true);
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);
	useServerEvent("spaces-changed", () => void refresh());

	const setActive = useCallback((id: string | null) => {
		setActiveState(id);
		void (async () => {
			try {
				const current = await fetch("/api/settings", { cache: "no-store" }).then(
					(r) => r.json() as Promise<{ settings?: { general?: Record<string, unknown> } | null }>,
				);
				const res = await fetch("/api/settings/general", {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ ...(current.settings?.general ?? {}), activeSpace: id ?? "none" }),
				});
				if (res.ok) notifySettingsSaved("general");
			} catch {
				/* the switch still applies to this window */
			}
			// Switching to a space rescans its linked folder.
			if (id) void fetch(`/api/spaces/${encodeURIComponent(id)}?scan=1`, { cache: "no-store" }).catch(() => {});
		})();
	}, []);

	// A deleted space falls back to No space.
	useEffect(() => {
		if (active && spaces.length > 0 && !spaces.some((c) => c.id === active)) setActive(null);
	}, [active, spaces, setActive]);

	const value = useMemo<SpacesState>(
		() => ({ spaces, loaded, active, activeSpace: spaces.find((c) => c.id === active) ?? null, setActive, refresh }),
		[spaces, loaded, active, setActive, refresh],
	);
	return <SpacesContext.Provider value={value}>{children}</SpacesContext.Provider>;
}

/** The active-space state. Outside a provider (isolated renders, tests)
 *  it reads as "No space" with no spaces. */
export function useSpaces(): SpacesState {
	return (
		useContext(SpacesContext) ?? {
			spaces: [],
			loaded: true,
			active: null,
			activeSpace: null,
			setActive: () => {},
			refresh: async () => {},
		}
	);
}
