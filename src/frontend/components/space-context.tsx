/**
 * THE ACTIVE SPACE: the space the space pages show (its lessons, files and
 * graph), where new lessons start and where the Graph's Add files imports.
 * null = lessons with no space.
 *
 * Persisted in settings.json (general.activeSpace) so it survives restarts;
 * the first value comes from /api/boot, read before the first paint (no
 * flash of the wrong graph). The
 * space list refreshes on the server's "spaces-changed" event.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { SpaceColor, SpaceSummary } from "@/shared/core";
import { useServerEvent } from "@/frontend/components/server-events";
import { useSettings } from "@/frontend/components/settings-context";
import { getJson } from "@/frontend/lib/api";

interface SpacesState {
	/** Every space, closed ones included (most recently updated first). */
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
		const { body } = await getJson<{ spaces?: SpaceSummary[] }>("/api/spaces");
		// Offline or refused: keep what we have.
		if (body) setSpaces(Array.isArray(body.spaces) ? body.spaces : []);
		setLoaded(true);
	}, []);

	// Boot already read the list when it could.
	useEffect(() => {
		if (initialSpaces === undefined) void refresh();
	}, [refresh, initialSpaces]);
	useServerEvent("spaces-changed", () => void refresh());

	const { patchGeneral } = useSettings();
	const setActive = useCallback(
		(id: string | null) => {
			setActiveState(id);
			void (async () => {
				// A failed save still switches this window.
				await patchGeneral({ activeSpace: id ?? "none" });
				// Switching to a space rescans its linked folder.
				if (id) void getJson(`/api/spaces/${encodeURIComponent(id)}?scan=1`);
			})();
		},
		[patchGeneral],
	);

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

/** A space's color by id (undefined for no space or one not in the list). */
export function useSpaceColor(id: string | undefined): SpaceColor | undefined {
	return useSpaces().spaces.find((c) => c.id === id)?.color;
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
