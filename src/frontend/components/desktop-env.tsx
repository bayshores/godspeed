import { useEffect } from "react";
import type { UpdateState } from "@/frontend/components/settings/update-settings.tsx";

declare global {
	interface Window {
		/** The desktop shell's bridge (crates/shell/src/shim.js), absent in a plain browser. */
		lh?: {
			/** Read-only host OS; determines the native-control gutter. */
			platform?: string;
			/** Native folder picker: absolute path or null. */
			pickFolder?: () => Promise<string | null>;
			/** Opens Finder (File Explorer) with this file selected. */
			showInFolder?: (path: string) => Promise<void>;
			/** Opens this folder in Finder (File Explorer), or this PDF in its default app. */
			openPath?: (path: string) => Promise<void>;
			/** Opens a terminal running the godspeed folder's start script: null, or why it couldn't. */
			openAgent?: (folder: string, agent: "claude" | "claude-backup" | "codex") => Promise<string | null>;
			/** A dropped file's or folder's absolute path, or "" where the OS gives none (onboarding drop zone). */
			pathForFile?: (file: File) => Promise<string>;
			/** The first screen is drawn: show the window (hidden until then). */
			showWindow?: () => void;
			/** The zoom truth: subscribes to "lh:zoom" pushes; returns unsubscribe. */
			onZoom?: (cb: (factor: number) => void) => () => void;
			getZoom?: () => Promise<number>;
			/** Observational update events and a snapshot for late subscribers. */
			onUpdateStatus?: (cb: (status: UpdateState) => void) => () => void;
			getUpdateState?: () => Promise<UpdateState>;
			/** Explicit manual check also downloads and stages available updates. */
			checkForUpdates?: () => Promise<void>;
			installUpdate?: () => void;
			/** Opens a new GitHub issue with the app version and OS filled in. */
			reportBug?: () => void;
			/** The installed font families, sorted. */
			listFonts?: () => Promise<string[]>;
			onOpenSettings?: (cb: (section: string) => void) => () => void;
			/** Opens the system print sheet for a PDF in the data folder. Mac only. */
			printPdf?: (path: string) => Promise<void>;
		};
	}
}

/**
 * What the page does only inside the desktop shell: mark the document
 * (.lh-desktop in globals.css makes room for the traffic lights), and
 * publish the zoom factor so the gutters beside the native window buttons
 * keep their size at every zoom. The shell's shim defines window.lh before
 * the page's scripts run, so a plain browser never gets the class.
 */
export function DesktopEnv() {
	useEffect(() => {
		if (window.lh) {
			document.documentElement.classList.add("lh-desktop");
			document.documentElement.dataset.lhPlatform = window.lh.platform ?? "";
		}
		const setZoomVar = (factor: number) => document.documentElement.style.setProperty("--lh-zoom", String(factor));
		const off = window.lh?.onZoom?.(setZoomVar);
		// The first paint can beat the first push.
		void window.lh?.getZoom?.().then(setZoomVar);
		return off;
	}, []);
	return null;
}
