"use client";

/**
 * The Settings dialog's always-mounted half (speed plan, owner 2026-10-27):
 * the open() context the sidebar and the mod+, chord call, plus the sign-in
 * UI providers the setup dialog also reads. The dialog itself
 * (settings-dialog.tsx and every section) is a separate chunk: it starts
 * loading once the page is idle, so the first open is still instant, and
 * it never weighs on a page's startup.
 */

import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useState } from "react";
import { ChatGPTUIProvider } from "./chatgpt-connection.tsx";
import { NativeSubscriptionUIProvider } from "./subscription-connections.tsx";

const loadDialog = () => import("./settings-dialog.tsx");
const SettingsDialog = lazy(() => loadDialog().then((m) => ({ default: m.SettingsDialog })));

/** `open(section?)` — lands the dialog on a section (default Outside agents). */
const DialogContext = createContext<{ open: (section?: string) => void }>({ open: () => {} });

/** AppShell-level mount: the sidebar row and the mod+, chord call this.
 *  `open(section)` lands the dialog on a specific section. */
export function SettingsDialogProvider({ children }: { children: React.ReactNode }) {
	const [show, setShow] = useState(false);
	// Mounted from the first open on, so it can fade out (motion wave).
	const [mounted, setMounted] = useState(false);
	const [landOn, setLandOn] = useState<string | undefined>(undefined);
	const open = useCallback((section?: string) => {
		setLandOn(section);
		setMounted(true);
		setShow(true);
	}, []);
	useEffect(() => window.lh?.onOpenSettings?.((section) => open(section)), [open]);
	// Warm the chunk once the page is idle.
	useEffect(() => {
		const warm = () => void loadDialog().catch(() => {});
		if (typeof window.requestIdleCallback === "function") {
			const id = window.requestIdleCallback(warm, { timeout: 5000 });
			return () => window.cancelIdleCallback(id);
		}
		const id = window.setTimeout(warm, 2000);
		return () => window.clearTimeout(id);
	}, []);
	return (
		<ChatGPTUIProvider><NativeSubscriptionUIProvider><DialogContext.Provider value={{ open }}>
			{children}
			{mounted && (
				<Suspense fallback={null}>
					<SettingsDialog open={show} onClose={() => setShow(false)} section={landOn} />
				</Suspense>
			)}
		</DialogContext.Provider></NativeSubscriptionUIProvider></ChatGPTUIProvider>
	);
}

export function useSettingsDialog() {
	return useContext(DialogContext);
}
