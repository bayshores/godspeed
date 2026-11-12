"use client";
/**
 * Applies the settings record's appearance section as runtime CSS
 * variables on <html> (appearance-model.ts builds them). Every surface was
 * built on tokens, so applying is setProperty and nothing re-renders.
 *
 * Mounted at the root layout, which paints the saved look on the server
 * and hands it here. Settings writes a section, hands the new appearance
 * here, and the variables move immediately.
 */

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { AppearanceSettings, EffectiveAppearance } from "@/shared/core";
import { appearanceVars, resolveAppearance, staleVarNames } from "./appearance-model.ts";

interface AppearanceContextValue {
	/** Resolved appearance. */
	appearance: EffectiveAppearance;
	/** Called by the settings dialog after a successful section PUT. */
	onAppearanceChange: (delta: AppearanceSettings | undefined) => void;
}

const AppearanceContext = createContext<AppearanceContextValue>({
	appearance: resolveAppearance(undefined),
	onAppearanceChange: () => {},
});

export function useAppearance() {
	return useContext(AppearanceContext);
}

export function AppearanceProvider({ initial, children }: { initial: AppearanceSettings | undefined; children: React.ReactNode }) {
	const [delta, setDelta] = useState(initial);
	const appliedRef = useRef<string>("");

	const appearance = useMemo(() => resolveAppearance(delta), [delta]);
	const vars = useMemo(() => appearanceVars(appearance), [appearance]);
	const key = useMemo(() => JSON.stringify(vars), [vars]);
	// Every name ever set is tracked: one absent from the new set is removed
	// so the stylesheet value returns.
	const appliedNamesRef = useRef<Set<string>>(new Set());
	useEffect(() => {
		if (appliedRef.current === key) return;
		appliedRef.current = key;
		const root = document.documentElement;
		// Paper is the one light background.
		root.classList.toggle("dark", appearance.background !== null);
		for (const name of staleVarNames([...appliedNamesRef.current], vars)) {
			root.style.removeProperty(name);
			appliedNamesRef.current.delete(name);
		}
		for (const [name, value] of Object.entries(vars)) {
			root.style.setProperty(name, value);
			appliedNamesRef.current.add(name);
		}
	}, [key, vars, appearance]);

	const value = useMemo(() => ({ appearance, onAppearanceChange: setDelta }), [appearance]);
	return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}
