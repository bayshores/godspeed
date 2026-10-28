"use client";

/**
 * THE ACTIVE CLASS (classes wave, owner-approved 2026-10-26): the class the
 * whole window shows — the sidebar's lessons, home's graph, where new
 * lessons start and where "Import notes…" imports. null = "No class".
 *
 * Persisted in settings.json (general.activeClass) so it survives restarts;
 * the server renders the first value (no flash of the wrong graph). The
 * class list refreshes on the server's "classes-changed" event.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ClassSummary } from "@/core";
import { useServerEvent } from "@/components/server-events";
import { notifySettingsSaved } from "@/components/settings-signal";

interface ClassesState {
	/** Every class, archived included (most recently updated first). */
	classes: ClassSummary[];
	/** The active class id, or null for "No class". */
	active: string | null;
	/** The active class's summary (null for "No class"). */
	activeClass: ClassSummary | null;
	/** Switch the window to a class (null = No class). */
	setActive: (id: string | null) => void;
	/** Re-read the class list now. */
	refresh: () => Promise<void>;
}

const ClassesContext = createContext<ClassesState | null>(null);

/** "?class=<id|none>" for a scope — every class-aware fetch appends it. */
export function classQuery(active: string | null, joiner: "?" | "&" = "?"): string {
	return `${joiner}class=${encodeURIComponent(active ?? "none")}`;
}

/** A display name for a scope. */
export function className(classes: readonly ClassSummary[], id: string | null | undefined): string {
	if (!id) return "No class";
	return classes.find((c) => c.id === id)?.name ?? "Unknown class";
}

export function ClassProvider({ children, initialActive }: { children: ReactNode; initialActive: string | null }) {
	const [classes, setClasses] = useState<ClassSummary[]>([]);
	const [active, setActiveState] = useState<string | null>(initialActive);
	// Follow the server's value when it changes on a refresh (e.g. onboarding
	// finishing with a new class), without overriding client switches.
	const [serverActive, setServerActive] = useState(initialActive);
	if (initialActive !== serverActive) {
		setServerActive(initialActive);
		setActiveState(initialActive);
	}

	const refresh = useCallback(async () => {
		try {
			const res = await fetch("/api/classes", { cache: "no-store" });
			if (!res.ok) return;
			const body = (await res.json()) as { classes?: ClassSummary[] };
			setClasses(Array.isArray(body.classes) ? body.classes : []);
		} catch {
			/* offline: keep what we have */
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);
	useServerEvent("classes-changed", () => void refresh());

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
					body: JSON.stringify({ ...(current.settings?.general ?? {}), activeClass: id ?? "none" }),
				});
				if (res.ok) notifySettingsSaved("general");
			} catch {
				/* the switch still applies to this window */
			}
			// Switching to a class rescans its linked folder (owner ruling).
			if (id) void fetch(`/api/classes/${encodeURIComponent(id)}?scan=1`, { cache: "no-store" }).catch(() => {});
		})();
	}, []);

	// A deleted class falls back to No class.
	useEffect(() => {
		if (active && classes.length > 0 && !classes.some((c) => c.id === active)) setActive(null);
	}, [active, classes, setActive]);

	const value = useMemo<ClassesState>(
		() => ({ classes, active, activeClass: classes.find((c) => c.id === active) ?? null, setActive, refresh }),
		[classes, active, setActive, refresh],
	);
	return <ClassesContext.Provider value={value}>{children}</ClassesContext.Provider>;
}

/** The active-class state. Outside a provider (isolated renders, tests)
 *  it reads as "No class" with no classes. */
export function useClasses(): ClassesState {
	return (
		useContext(ClassesContext) ?? {
			classes: [],
			active: null,
			activeClass: null,
			setActive: () => {},
			refresh: async () => {},
		}
	);
}
